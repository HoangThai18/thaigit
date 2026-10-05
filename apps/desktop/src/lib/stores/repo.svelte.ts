/**
 * State and actions of ONE open repo (a port of `RepoModel.swift`): loads refs / status / stash / remotes in parallel, decides
 * whether to reload history using a ref "fingerprint", builds the graph (lanes + labels), receives `repo-changed` events,
 * tracks the commit / stash selection plus detail loading, and provides a queue for write operations (4a is read-only, but the
 * queue already has the shape later phases need).
 *
 * Reactivity (Svelte 5): big arrays (entries, refs…) use `$state.raw` — replace the whole array on change instead of wrapping
 * it in a deep proxy. Each field is its own signal, so a component depends only on what it actually reads (the sidebar never reads
 * `status`/`selection`).
 */
import {
  CancelledError,
  CommandLog,
  EMPTY_STATUS,
  GitRepository,
  buildHistory,
  headBranchName,
  headOid,
  isStatusClean,
  isWorkingTreeCommit,
  keepingRefs,
  NO_REF_FILTER,
  progressFraction,
  refFilterActive,
  refName,
  refVisible,
  stashDisplayMessage,
  type Commit,
  type CommitDetails,
  type GitRef,
  type GraphRefFilter,
  type GraphRow,
  type HeadState,
  type HistoryGaps,
  type LfsPattern,
  type Remote,
  type RepoOperation,
  type Stash,
  type Submodule,
  type Worktree,
  type WorkingTreeStatus,
} from '@thaigit/core';
import type { RepoChangedEvent } from '@thaigit/contracts';
import { compareNatural } from '../format/natural.ts';
import { buildRefLabels, type RefLabel } from '../graph/pills.ts';
import { DiffStore } from './diff.svelte.ts';
import { TimelineStore } from '../snapshots/timeline.svelte.ts';
import { BlameStore } from '../history/blame.svelte.ts';
import { FileHistoryStore } from '../history/fileHistory.svelte.ts';
import { ReviewStore } from '../forge/review.svelte.ts';
import { RiskStore } from '../risk/risks.svelte.ts';
import { commitDrafts, type CommitDrafts } from '../staging/commitDrafts.ts';
import { loadGraphFilter, saveGraphFilter } from '../graph/filterStorage.ts';
import type { RepoPort } from '../platform/host.ts';
import { operationTitle } from '../operationLabel.ts';
import { vi } from '../strings.vi.ts';
import { jsonEqual } from './equality.ts';
import { COMMIT_LIMIT_MAX, prefs as globalPrefs, type PrefsData, type PrefsStore } from './prefs.svelte.ts';
import { toasts as globalToasts, describeError, type ToastAction, type ToastStore } from './toasts.svelte.ts';

// MARK: - Types

/** A refresh scope (bit flags like Swift's `RefreshScope`). */
export const Scope = { status: 1, refs: 2, history: 4, all: 7 } as const;
export type RefreshScope = number;

export type RepoSelection =
  | { readonly kind: 'none' }
  | { readonly kind: 'workingTree' }
  | { readonly kind: 'commit'; readonly sha: string }
  | { readonly kind: 'stash'; readonly sha: string };

export interface GraphEntry {
  readonly commit: Commit;
  readonly row: GraphRow;
  readonly labels: readonly RefLabel[];
}

export interface BusyState {
  title: string;
  detail: string;
  fraction: number | null;
  canCancel: boolean;
}

export interface ScrollRequest {
  readonly row: number;
  readonly id: number;
}

export interface PerformOptions {
  showsProgress?: boolean;
  cancellable?: boolean;
  /** The refresh scope to run afterwards (default status + refs; history reloads by itself when the ref fingerprint changes). */
  refresh?: RefreshScope;
  onSuccess?: () => void;
  /** Return `true` when the error was already handled (so the default toast is skipped). */
  onError?: (error: unknown) => boolean;
}

export interface RepoStoreOptions {
  prefs?: PrefsStore;
  toasts?: ToastStore;
  /** Defaults to `navigator.clipboard.writeText`. */
  clipboard?: (text: string) => Promise<void>;
  /** Delay before loading commit details while arrowing through keys (Swift: 35 ms). */
  detailsDelayMs?: number;
  /**
   * Rust refused a command because the repo is not trusted (the config changed after opening, an `include` pointing into a repo
   * file…): the "Review repo config" button on the notification calls this to ask for trust again.
   */
  onUntrusted?: () => void;
  /** The per-repo commit draft store (defaults to the webview's localStorage). */
  drafts?: CommitDrafts;
}

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

async function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    return { ok: false, error };
  }
}

const NO_LABELS: readonly RefLabel[] = Object.freeze([]);
const REFRESH_ERROR_TAG = 'refresh-error';
/** A serial number for the repo window (reopening the same repo is a different toast owner). */
let storeSerial = 0;

export function sameSelection(a: RepoSelection, b: RepoSelection): boolean {
  if (a.kind !== b.kind) return false;
  return (a.kind === 'commit' || a.kind === 'stash') && (b.kind === 'commit' || b.kind === 'stash')
    ? a.sha === b.sha
    : true;
}

/**
 * The fingerprint deciding whether history reloads: changing refs / HEAD / display options changes the history, changing
 * ahead / behind or the working tree does not. Same idea as Swift's `makeFingerprint`.
 */
export function makeFingerprint(
  refs: readonly Pick<GitRef, 'fullName' | 'target'>[],
  head: HeadState,
  options: { showRemotes: boolean; showTags: boolean; order: string },
): string {
  const parts = refs.map((ref) => `${ref.fullName}=${ref.target}`);
  parts.push(`HEAD=${headOid(head) ?? '-'}@${headBranchName(head) ?? '-'}`);
  parts.push(`remotes=${options.showRemotes},tags=${options.showTags},order=${options.order}`);
  return parts.join('\n');
}

// MARK: - Store

const NO_HISTORY_GAPS: HistoryGaps = { shallow: false, narrowRemotes: [] };

export class RepoStore {
  readonly port: RepoPort;
  readonly git: GitRepository;
  readonly commandLog = new CommandLog();
  private readonly prefs: PrefsStore;
  private readonly toasts: ToastStore;
  /** The per-repo commit draft: the editor reads it back when a repo is opened and it is written on every keystroke. */
  readonly drafts: CommitDrafts;
  private readonly clipboard: (text: string) => Promise<void>;
  private readonly detailsDelayMs: number;
  private readonly onUntrusted: (() => void) | undefined;

  // --- repository data ---
  refs = $state.raw<readonly GitRef[]>([]);
  /** Filtered and sorted whenever refs change (a big repo has thousands — never recomputed while rendering). */
  localBranches = $state.raw<readonly GitRef[]>([]);
  remoteBranches = $state.raw<readonly GitRef[]>([]);
  tags = $state.raw<readonly GitRef[]>([]);
  status = $state.raw<WorkingTreeStatus>(EMPTY_STATUS);
  stashes = $state.raw<readonly Stash[]>([]);
  remotes = $state.raw<readonly Remote[]>([]);
  /** The repo's worktrees (including the currently open one). */
  worktrees = $state.raw<readonly Worktree[]>([]);
  submodules = $state.raw<readonly Submodule[]>([]);
  /** Git LFS patterns from the root `.gitattributes` (empty = the repo does not use LFS). */
  lfsPatterns = $state.raw<readonly LfsPattern[]>([]);
  /** The git-lfs version on this machine: `undefined` = not checked yet, `null` = not installed. */
  lfsVersion = $state.raw<string | null | undefined>(undefined);
  operation = $state.raw<RepoOperation | null>(null);
  /** The repo tracks only a few remote branches / is a shallow clone → show the "Fetch everything from the remote" bar. */
  historyGaps = $state.raw<HistoryGaps>(NO_HISTORY_GAPS);
  /** The user pressed "Later" on that bar (this session only). */
  historyGapsDismissed = $state(false);
  entries = $state.raw<readonly GraphEntry[]>([]);
  graphVersion = $state(0);
  graphLanes = $state(1);
  mayHaveMoreCommits = $state(false);
  isLoadingHistory = $state(false);
  hasLoaded = $state(false);
  /** The most recent history-load error (so the graph reports it instead of "no commits"). */
  historyError = $state<string | null>(null);
  commitLimit: number;
  /**
   * The most recent "load more history" attempt failed: stop every AUTOMATIC extra load (scrolling near the bottom of the graph)
   * — otherwise a persistent failure would make the UI call `git log` forever. Only a user action (`loadMoreHistory(true)`)
   * clears the flag and retries.
   */
  loadMoreFailed = $state(false);

  // --- selection, details ---
  selection = $state.raw<RepoSelection>({ kind: 'none' });
  details = $state.raw<CommitDetails | null>(null);
  isLoadingDetails = $state(false);
  scrollRequest = $state.raw<ScrollRequest | null>(null);

  // --- UI ---
  busy = $state.raw<BusyState | null>(null);
  /** The most recent successful fetch / pull (ms, `Date.now()`), so autofetch does not run right after the user's own fetch. */
  lastFetch = $state<number | null>(null);
  /** The file open in the centre pane (replacing the graph) plus the lines selected for per-line staging. */
  readonly diff: DiffStore;
  /** Hidden / "solo" branches on the graph, remembered per repo (actions/graphFilter.ts). */
  graphFilter = $state.raw<GraphRefFilter>(NO_REF_FILTER);
  /** The most recent undoable git operation (the toolbar Undo button, like GitKraken) — taken from a notification's "Undo" button. */
  lastUndo = $state.raw<{ title: string; fingerprint: string; run: () => void } | null>(null);
  /** A notification with an "Undo" button has just appeared and has not finished refreshing: lock the fingerprint until that operation's refresh completes. */
  pendingUndoFingerprint = $state(false);
  /** The commit editor (kept when switching between WIP and other commits). */
  commitDraft = $state({ summary: '', body: '', amend: false });
  /** The timeline (automatic snapshots) — replaces the right-hand details panel when open. */
  readonly timeline: TimelineStore;
  /** A file's history — replaces the right-hand details panel when open. */
  readonly fileHistory: FileHistoryStore;
  /** Reviewing a Pull Request / Merge Request — replaces the right-hand details panel when open. */
  readonly review: ReviewStore;
  /** Blame of a file — the centre pane (replacing the graph) when open, below the diff when a diff is open. */
  readonly blame: BlameStore;
  /** Risk flags of the uncommitted changes (the warning strip on the WIP panel). */
  readonly risks: RiskStore;

  // --- internal (non-reactive) ---
  private rowIndex = new Map<string, number>();
  private refIndex = new Map<string, GitRef>();
  private rawCommits: Commit[] = [];
  private refsFingerprint = '';
  /** The commit limit BEFORE a pending / running "load more" (different from `null` = a load is running); on error it falls back to `commitLimit`. */
  private loadMoreBase: number | null = null;
  /** The owner of every toast of this store (all removed on `dispose`) plus its own tag for refresh errors (so another repo's toast is never overwritten / removed). */
  private readonly ownerId: string;
  private readonly refreshErrorTag: string;
  private active = false;
  private disposed = false;
  private unwatch: (() => Promise<void>) | null = null;
  private refreshTask: Promise<void> | null = null;
  private pendingRefresh: RefreshScope = 0;
  private fileSystemPending: RefreshScope = 0;
  private detailsToken = 0;
  private scrollSerial = 0;
  private didChooseInitialSelection = false;
  private operationChain: Promise<void> = Promise.resolve();
  private runningOperations = 0;
  private abort: AbortController | null = null;
  private lastProgressAt = 0;
  private readonly workingTreeListeners = new Set<() => void>();

  constructor(port: RepoPort, options: RepoStoreOptions = {}) {
    this.port = port;
    this.prefs = options.prefs ?? globalPrefs;
    this.toasts = options.toasts ?? globalToasts;
    this.clipboard = options.clipboard ?? ((text) => navigator.clipboard.writeText(text));
    this.detailsDelayMs = options.detailsDelayMs ?? 35;
    this.onUntrusted = options.onUntrusted;
    this.ownerId = `${port.info.repoId}#${++storeSerial}`;
    this.refreshErrorTag = `${REFRESH_ERROR_TAG}:${this.ownerId}`;
    this.commitLimit = this.prefs.value.commitLimit;
    this.graphFilter = loadGraphFilter(port.info.root);
    this.drafts = options.drafts ?? commitDrafts;
    const saved = this.drafts.load(port.info.root);
    this.commitDraft.summary = saved.summary;
    this.commitDraft.body = saved.body;
    this.git = new GitRepository({
      exec: port.exec,
      fs: port.fs,
      root: port.info.root,
      gitDir: port.info.gitDir,
      commonDir: port.info.commonDir,
      log: this.commandLog,
      typed: port.typedGit,
    });
    // A getter in the object literal below has its own `this`, so the store needs a different name to refer back to.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const store = this;
    this.diff = new DiffStore({
      get git() {
        return store.git;
      },
      get status() {
        return store.status;
      },
      get stashes() {
        return store.stashes;
      },
      diffContext: () => store.prefs.value.diffContext,
      diffIgnoreWhitespace: () => store.prefs.value.diffIgnoreWhitespace,
      reportError: (title, error) => store.showError(title, error),
    });
    this.risks = new RiskStore({
      get git() {
        return store.git;
      },
      get status() {
        return store.status;
      },
    });
    this.timeline = new TimelineStore({
      get git() {
        return store.git;
      },
      get rootPath() {
        return store.rootPath;
      },
      get diff() {
        return store.diff;
      },
      prefs: this.prefs,
      perform: (title, work, options) => store.perform(title, work, options),
      notify: (style, title, options) => store.notify(style, title, options),
      showError: (title, error) => store.showError(title, error),
      closeFileHistory: () => store.fileHistory.close(),
      closeReview: () => store.review.close(),
    });
    this.fileHistory = new FileHistoryStore({
      get git() {
        return store.git;
      },
      get diff() {
        return store.diff;
      },
      closeTimeline: () => store.timeline.close(),
      closeReview: () => store.review.close(),
      showError: (title, error) => store.showError(title, error),
    });
    this.review = new ReviewStore({
      get diff() {
        return store.diff;
      },
      closeTimeline: () => store.timeline.close(),
      closeFileHistory: () => store.fileHistory.close(),
    });
    this.blame = new BlameStore({
      get git() {
        return store.git;
      },
      closeDiff: () => store.diff.close(),
    });
  }

  /** The app is running (or queueing) a write operation on this repo. */
  get isPerforming(): boolean {
    return this.runningOperations > 0;
  }

  /** Listen for "the working tree changed" (the watcher event) — the snapshot scheduler uses this. Returns an unsubscribe function. */
  onWorkingTreeChange(listener: () => void): () => void {
    this.workingTreeListeners.add(listener);
    return () => this.workingTreeListeners.delete(listener);
  }

  get name(): string {
    return this.git.name;
  }

  /** The preferences in effect (pull mode, fetch --prune, autofetch…) for the operations in `actions/`. */
  get preferences(): PrefsData {
    return this.prefs.value;
  }

  get rootPath(): string {
    return this.port.info.root;
  }

  // MARK: - Lifecycle

  /** Load once and start listening for `repo-changed`. Call it once. */
  async start(): Promise<void> {
    if (this.active || this.disposed) return;
    this.active = true;
    this.requestRefresh(Scope.all);
    try {
      const stop = await this.port.watch((event) => this.handleChange(event));
      if (this.disposed) await stop().catch(() => undefined);
      else this.unwatch = stop;
    } catch (error) {
      if (!this.disposed) this.showError(vi.errors.watch, error);
    }
  }

  /** Stop watching and discard the result of everything still in flight. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.active = false;
    this.detailsToken++;
    // A toast of the closed repo may carry a button calling into this store (Review config, Load more…): clicking it would act on a repo that is no longer open.
    this.toasts.dismissOwner(this.ownerId);
    this.diff.close();
    this.risks.dispose();
    this.abort?.abort();
    const stop = this.unwatch;
    this.unwatch = null;
    if (stop) await stop().catch(() => undefined);
  }

  // MARK: - Convenience accessors

  get headOid(): string | null {
    return headOid(this.status.head);
  }

  get currentBranch(): string | null {
    return headBranchName(this.status.head);
  }

  get headDescription(): string {
    const head = this.status.head;
    switch (head.kind) {
      case 'branch':
        return head.name;
      case 'detached':
        return vi.window.detachedHead(head.oid.slice(0, 7));
      case 'unknown':
        return '';
    }
  }

  /** "main ↑2 ↓1 · Merging" — the subtitle under the repo name. */
  get branchSubtitle(): string {
    const parts = [this.headDescription];
    if (this.status.ahead > 0) parts.push(`↑${this.status.ahead}`);
    if (this.status.behind > 0) parts.push(`↓${this.status.behind}`);
    if (this.operation) parts.push(`· ${operationTitle(this.operation)}`);
    return parts.join(' ');
  }

  /** The checked-out branch's ref (absent when HEAD is detached / the repo has no commits). */
  get currentBranchRef(): GitRef | undefined {
    return this.localBranches.find((ref) => ref.isHead);
  }

  /** The remote to push to for a branch without an upstream: the current upstream's remote, then `origin`, then the first remote. */
  get defaultRemote(): string | null {
    const upstream = this.currentBranchRef?.upstream;
    const fromUpstream = upstream ? this.splitUpstream(upstream)?.remote : undefined;
    if (fromUpstream) return fromUpstream;
    return this.remotes.find((remote) => remote.name === 'origin')?.name ?? this.remotes[0]?.name ?? null;
  }

  /** The most recent local branches (the current one first) — the branch switch menu lists only these. */
  recentLocalBranches(limit: number): readonly GitRef[] {
    if (this.localBranches.length <= limit) return this.localBranches;
    const rank = (ref: GitRef): number => (ref.isHead ? Number.POSITIVE_INFINITY : (ref.date ?? 0));
    return [...this.localBranches].sort((a, b) => rank(b) - rank(a)).slice(0, limit);
  }

  /** Split "origin/feature/x" into remote + branch using the remote list (a remote whose name contains `/` still works). */
  splitUpstream(upstream: string): { remote: string; branch: string } | null {
    const match = [...this.remotes]
      .sort((a, b) => b.name.length - a.name.length)
      .find((remote) => upstream.startsWith(`${remote.name}/`));
    return match ? { remote: match.name, branch: upstream.slice(match.name.length + 1) } : null;
  }

  get hasWorkingTreeRow(): boolean {
    const first = this.entries[0];
    return first !== undefined && isWorkingTreeCommit(first.commit);
  }

  get shouldShowWorkingTree(): boolean {
    return !isStatusClean(this.status) || this.operation !== null;
  }

  /** The row of the selected item (reactive to `selection` and `graphVersion`). */
  get selectedRow(): number | null {
    void this.graphVersion;
    return this.rowFor(this.selection);
  }

  entryAt(row: number): GraphEntry | undefined {
    return this.entries[row];
  }

  rowFor(selection: RepoSelection): number | null {
    switch (selection.kind) {
      case 'workingTree':
        return this.hasWorkingTreeRow ? 0 : null;
      case 'commit':
        return this.rowIndex.get(selection.sha) ?? null;
      default:
        return null;
    }
  }

  findRef(fullName: string): GitRef | undefined {
    void this.refs;
    return this.refIndex.get(fullName);
  }

  // MARK: - Refreshing data

  refreshEverything(): void {
    this.requestRefresh(Scope.all);
  }

  /** Merge the pending requests into one next refresh pass (not a debounce: a running pass is never cancelled). */
  requestRefresh(scope: RefreshScope): void {
    this.pendingRefresh |= scope;
    if (this.refreshTask !== null || this.disposed || this.pendingRefresh === 0) return;
    this.refreshTask = (async () => {
      try {
        while (this.pendingRefresh !== 0 && !this.disposed) {
          const next = this.pendingRefresh;
          this.pendingRefresh = 0;
          try {
            await this.performRefresh(next);
          } catch (error) {
            this.reportRefreshFailure(vi.errors.status, error);
          }
        }
      } finally {
        this.refreshTask = null;
      }
    })();
  }

  async refreshAndWait(scope: RefreshScope): Promise<void> {
    this.requestRefresh(scope);
    if (this.refreshTask !== null) await this.refreshTask;
  }

  private async performRefresh(scope: RefreshScope): Promise<void> {
    const first = !this.hasLoaded;
    const wantsRefs = (scope & Scope.refs) !== 0 || first;
    const wantsStatus = (scope & Scope.status) !== 0 || first;
    const git = this.git;

    // The first time: history runs in parallel with refs / status. HEAD is still unknown, so `HEAD` is always added to the log; a repo whose HEAD has no
    // commit but which has other branches is handled below.
    const firstLog = first ? settle(this.fetchLog(true)) : null;
    const [
      statusResult,
      refsResult,
      stashResult,
      remoteResult,
      operationResult,
      gapsResult,
      worktreeResult,
      submoduleResult,
      lfsPatternResult,
      lfsVersionResult,
    ] = await Promise.all([
      wantsStatus ? settle(git.status()) : null,
      wantsRefs ? settle(git.refs()) : null,
      wantsRefs ? settle(git.stashes()) : null,
      wantsRefs ? settle(git.remotes()) : null,
      wantsStatus ? settle(git.operationState()) : null,
      wantsRefs ? settle(git.historyGaps()) : null,
      wantsRefs ? settle(git.worktrees()) : null,
      wantsRefs ? settle(git.submodules()) : null,
      wantsStatus ? settle(git.lfsPatterns()) : null,
      first ? settle(git.lfsVersion()) : null,
    ]);
    if (this.disposed) return;

    if (statusResult) {
      if (statusResult.ok) {
        this.toasts.dismissTag(this.refreshErrorTag);
        if (!jsonEqual(statusResult.value, this.status)) this.status = statusResult.value;
        this.risks.schedule();
        // A diff of uncommitted changes is open: reload it (the file was just edited / staged) or close it when the file is gone.
        this.diff.statusDidChange();
      } else {
        this.reportRefreshFailure(vi.errors.status, statusResult.error);
      }
    }
    if (refsResult) {
      if (refsResult.ok) {
        if (!jsonEqual(refsResult.value, this.refs)) this.updateRefs(refsResult.value);
      } else {
        this.reportRefreshFailure(vi.errors.refs, refsResult.error);
      }
    }
    if (stashResult?.ok && !jsonEqual(stashResult.value, this.stashes)) {
      this.stashes = stashResult.value;
      const selected = this.selection;
      if (selected.kind === 'stash' && !stashResult.value.some((stash) => stash.sha === selected.sha)) {
        this.applySelection({ kind: 'none' });
      }
    }
    if (remoteResult?.ok && !jsonEqual(remoteResult.value, this.remotes)) this.remotes = remoteResult.value;
    // Worktrees / submodules / LFS only feed the sidebar: on error (old git, untrusted repo) keep the old lists and report nothing.
    if (worktreeResult?.ok && !jsonEqual(worktreeResult.value, this.worktrees))
      this.worktrees = worktreeResult.value;
    if (submoduleResult?.ok && !jsonEqual(submoduleResult.value, this.submodules)) {
      this.submodules = submoduleResult.value;
    }
    if (lfsPatternResult?.ok && !jsonEqual(lfsPatternResult.value, this.lfsPatterns)) {
      this.lfsPatterns = lfsPatternResult.value;
    }
    if (lfsVersionResult?.ok) this.lfsVersion = lfsVersionResult.value;
    // An error while probing (git too old…) is not worth reporting: it just means no hint bar is shown.
    if (gapsResult?.ok && !jsonEqual(gapsResult.value, this.historyGaps)) this.historyGaps = gapsResult.value;
    if (operationResult?.ok && !jsonEqual(operationResult.value, this.operation)) {
      this.operation = operationResult.value;
    }

    const fingerprint = this.currentFingerprint();
    if (firstLog) {
      this.refsFingerprint = fingerprint;
      await this.loadHistory(firstLog);
    } else if ((scope & Scope.history) !== 0 || fingerprint !== this.refsFingerprint) {
      this.refsFingerprint = fingerprint;
      await this.loadHistory(null);
    } else if (this.shouldShowWorkingTree !== this.hasWorkingTreeRow) {
      this.relayoutGraph();
    } else if (wantsRefs) {
      this.refreshLabels();
    }
    if (this.disposed) return;
    this.hasLoaded = true;
  }

  private currentFingerprint(): string {
    return makeFingerprint(this.refs, this.status.head, {
      showRemotes: this.prefs.value.showRemoteBranches,
      showTags: this.prefs.value.showTags,
      order: this.prefs.value.logOrder,
    });
  }

  private updateRefs(value: readonly GitRef[]): void {
    this.refs = value;
    this.refIndex = new Map(value.map((ref) => [ref.fullName, ref]));
    const byName = (a: GitRef, b: GitRef): number => compareNatural(refName(a), refName(b));
    this.localBranches = value.filter((ref) => ref.kind === 'localBranch').sort(byName);
    this.remoteBranches = value.filter((ref) => ref.kind === 'remoteBranch').sort(byName);
    // The newest tag (by numeric name) first, like Swift (`orderedDescending`).
    this.tags = value.filter((ref) => ref.kind === 'tag').sort((a, b) => byName(b, a));
  }

  private fetchLog(includeHead: boolean): Promise<Uint8Array> {
    const { logOrder, showRemoteBranches, showTags } = this.prefs.value;
    return this.git.logBytes({
      limit: this.commitLimit,
      order: logOrder,
      includeHead,
      includeRemotes: showRemoteBranches,
      includeTags: showTags,
      filter: keepingRefs(this.graphFilter, new Set(this.refs.map((ref) => ref.fullName))),
    });
  }

  /** Change the graph's branch filter: persist it per repo, then reload history. */
  setGraphFilter(filter: GraphRefFilter): void {
    this.graphFilter = filter;
    saveGraphFilter(this.rootPath, filter);
    this.requestRefresh(Scope.history);
  }

  /** Load history, lay out the lanes, then build the graph. `pending`: the log already ran in parallel during the first load. */
  private async loadHistory(pending: Promise<Settled<Uint8Array>> | null): Promise<void> {
    this.isLoadingHistory = true;
    // Whether this load uses the raised limit (from `loadMoreHistory`) or not: `fetchLog` runs right below, so `commitLimit` here is exactly
    // the value it uses. Only THAT load may clear `loadMoreBase` / put the limit back — an unrelated load in flight is not affected.
    const raisedFrom = this.loadMoreBase;
    try {
      const head = headOid(this.status.head);
      let result = pending ? await pending : await settle(this.fetchLog(head !== null));
      if (
        pending &&
        result.ok &&
        result.value.length === 0 &&
        head === null &&
        this.refs.length > 0 &&
        !this.disposed
      ) {
        // HEAD has no commits yet (an orphan branch) but the repo has other branches: run again without `HEAD`.
        result = await settle(this.fetchLog(false));
      }
      if (this.disposed) return;
      if (!result.ok) {
        this.historyError = describeError(result.error);
        if (raisedFrom !== null && this.loadMoreBase === raisedFrom) {
          // Loading more failed: drop the raised limit (otherwise the next attempt raises it again on top of the failure), stop the automatic
          // loading, and give the user a Retry button right in the notification.
          this.commitLimit = raisedFrom;
          this.loadMoreFailed = true;
          this.reportFailure(vi.errors.history, result.error, {
            actions: [{ title: vi.graph.loadMore, run: () => this.loadMoreHistory(true) }],
          });
        } else {
          this.reportFailure(vi.errors.history, result.error);
        }
        return;
      }
      this.historyError = null;
      const showWorkingTree = this.shouldShowWorkingTree;
      const history = buildHistory(result.value, { limit: this.commitLimit, headOid: head, showWorkingTree });
      this.rawCommits = showWorkingTree ? history.commits.slice(1) : [...history.commits];
      this.mayHaveMoreCommits = history.mayHaveMore;
      this.applyGraph(history.commits, history.rows);
    } finally {
      if (raisedFrom !== null && this.loadMoreBase === raisedFrom) this.loadMoreBase = null;
      this.isLoadingHistory = false;
    }
  }

  /** WIP just shown / hidden: rebuild from the commits already loaded, without running git again. */
  private relayoutGraph(): void {
    const history = buildHistory(this.rawCommits, {
      limit: this.commitLimit,
      headOid: this.headOid,
      showWorkingTree: this.shouldShowWorkingTree,
    });
    this.applyGraph(history.commits, history.rows);
  }

  /** Older commits remain AND the limit has not hit its cap (`COMMIT_LIMIT_MAX`): once the cap is hit, loading more is pointless. */
  get canLoadMore(): boolean {
    return this.mayHaveMoreCommits && this.commitLimit < COMMIT_LIMIT_MAX;
  }

  /**
   * Load older commits: raise the limit (clamped to ≤ `COMMIT_LIMIT_MAX`), then reload history (like Swift). An AUTOMATIC call
   * (scrolling near the bottom of the graph) is ignored while the previous attempt failed (`loadMoreFailed`); `byUser = true`
   * (a button click) retries and clears the flag.
   */
  loadMoreHistory(byUser = false): void {
    if (this.disposed || !this.canLoadMore || this.isLoadingHistory || this.loadMoreBase !== null) return;
    if (this.loadMoreFailed && !byUser) return;
    this.loadMoreFailed = false;
    const base = this.commitLimit;
    this.loadMoreBase = base;
    this.commitLimit = Math.min(COMMIT_LIMIT_MAX, base + Math.max(2000, Math.floor(base / 2)));
    this.isLoadingHistory = true;
    this.requestRefresh(Scope.history);
  }

  private applyGraph(commits: readonly Commit[], rows: readonly GraphRow[]): void {
    const labels = this.labelsByCommit();
    const entries: GraphEntry[] = [];
    const index = new Map<string, number>();
    let lanes = 1;
    commits.forEach((commit, position) => {
      const row = rows[position];
      if (row === undefined) return;
      entries.push({ commit, row, labels: labels.get(commit.id) ?? NO_LABELS });
      index.set(commit.id, position);
      if (row.width > lanes) lanes = row.width;
    });
    this.rowIndex = index;
    this.entries = entries;
    this.graphLanes = lanes;
    this.graphVersion++;
    this.validateSelection();
  }

  /** Update the graph's branch / tag labels without rebuilding the whole history (e.g. an upstream change). */
  private refreshLabels(): void {
    const labels = this.labelsByCommit();
    let next: GraphEntry[] | undefined;
    for (const [position, entry] of this.entries.entries()) {
      const fresh = labels.get(entry.commit.id) ?? NO_LABELS;
      if (entry.labels === fresh || jsonEqual(entry.labels, fresh)) continue;
      next ??= [...this.entries];
      next[position] = { ...entry, labels: fresh };
    }
    if (next) {
      this.entries = next;
      this.graphVersion++;
    }
  }

  private labelsByCommit(): Map<string, RefLabel[]> {
    // A hidden branch (or one outside the solo group) has no label; the checked-out branch and tags are always shown.
    const current = this.currentBranch;
    const filter = this.graphFilter;
    const refs = refFilterActive(filter)
      ? this.refs.filter(
          (ref) =>
            ref.kind === 'tag' ||
            refVisible(filter, ref.fullName) ||
            (ref.kind === 'localBranch' && refName(ref) === current),
        )
      : this.refs;
    return buildRefLabels(refs, this.status.head, {
      showRemotes: this.prefs.value.showRemoteBranches,
      showTags: this.prefs.value.showTags,
      remoteNames: this.remotes.map((remote) => remote.name),
    });
  }

  private validateSelection(): void {
    if (!this.didChooseInitialSelection && (this.hasLoaded || this.entries.length > 0)) {
      this.didChooseInitialSelection = true;
      const head = this.headOid;
      if (this.hasWorkingTreeRow) this.applySelection({ kind: 'workingTree' }, true);
      else if (head !== null && this.rowIndex.has(head))
        this.applySelection({ kind: 'commit', sha: head }, true);
      return;
    }
    const selected = this.selection;
    if (selected.kind === 'workingTree' && !this.hasWorkingTreeRow) {
      const head = this.headOid;
      if (head !== null && this.rowIndex.has(head)) this.applySelection({ kind: 'commit', sha: head });
      else this.applySelection({ kind: 'none' });
    } else if (selected.kind === 'commit' && !this.rowIndex.has(selected.sha)) {
      this.applySelection({ kind: 'none' });
    }
  }

  // MARK: - Watching files

  /** An event already debounced / gitignore-filtered in Rust: turn it into a refresh scope and run immediately, with no extra debounce. */
  handleChange(event: RepoChangedEvent): void {
    if (!this.active || this.disposed) return;
    let scope = 0;
    if (event.kinds.includes('workingTree')) scope |= Scope.status;
    if (event.kinds.includes('refs')) scope |= Scope.refs | Scope.status;
    if (event.kinds.includes('rescan')) scope |= Scope.all;
    if (scope === 0) return;
    if (event.kinds.includes('workingTree') || event.kinds.includes('rescan')) {
      for (const listener of this.workingTreeListeners) listener();
    }
    // The app's own operation is running: the refresh happens right after it finishes (see `perform`).
    if (this.runningOperations > 0) this.fileSystemPending |= scope;
    else this.requestRefresh(scope);
  }

  // MARK: - Selecting commits / stashes

  /** The user's selection (graph, sidebar, search): always closes the Timeline / File history / Review so the panel shows exactly what was selected. */
  select(next: RepoSelection, reveal = false): void {
    this.timeline.close();
    this.fileHistory.close();
    this.review.close();
    this.applySelection(next, reveal);
  }

  /** Select without closing the Timeline — used for automatic selection after a load / refresh (e.g. WIP disappearing after a restore). */
  private applySelection(next: RepoSelection, reveal = false): void {
    if (!sameSelection(next, this.selection)) {
      this.selection = next;
      // Like Swift: selecting another commit / stash / WIP closes the open file (diff, blame) and returns to the graph.
      this.diff.close();
      this.blame.close();
      this.loadDetails();
    }
    if (reveal) {
      const row = this.rowFor(next);
      if (row !== null) this.scrollRequest = { row, id: ++this.scrollSerial };
    }
  }

  /**
   * Select commit `sha` and scroll to it; `true` when it got selected. A commit outside the loaded range selects nothing, reports it
   * with a "Load more" button, and returns `false` — the caller (sidebar) must not treat that as a selection.
   */
  reveal(sha: string): boolean {
    if (this.rowIndex.has(sha)) {
      this.select({ kind: 'commit', sha }, true);
      return true;
    }
    const actions: ToastAction[] = this.canLoadMore
      ? [{ title: vi.graph.loadMore, run: () => this.loadMoreHistory(true) }]
      : [];
    this.toast('info', vi.graph.notLoaded(sha.slice(0, 7), this.commitLimit), { actions });
    return false;
  }

  revealRef(ref: GitRef): boolean {
    return this.reveal(ref.target);
  }

  private loadDetails(): void {
    const token = ++this.detailsToken;
    const selection = this.selection;
    switch (selection.kind) {
      case 'commit': {
        const position = this.rowIndex.get(selection.sha);
        const commit = position === undefined ? undefined : this.entries[position]?.commit;
        if (!commit) {
          this.details = null;
          this.isLoadingDetails = false;
          return;
        }
        if (this.details?.commit.id === selection.sha) {
          this.isLoadingDetails = false;
          return;
        }
        this.isLoadingDetails = true;
        void (async () => {
          // A short delay so fast arrowing does not spawn too many git commands.
          await new Promise((resolve) => setTimeout(resolve, this.detailsDelayMs));
          if (token !== this.detailsToken) return;
          const result = await settle(this.git.commitDetails(commit));
          if (token !== this.detailsToken) return;
          if (result.ok) this.details = result.value;
          else {
            this.details = null;
            this.reportFailure(vi.errors.commitDetails, result.error);
          }
          this.isLoadingDetails = false;
        })();
        return;
      }
      case 'stash': {
        const stash = this.stashes.find((candidate) => candidate.sha === selection.sha);
        if (!stash) {
          this.details = null;
          this.isLoadingDetails = false;
          return;
        }
        this.isLoadingDetails = true;
        void (async () => {
          const result = await settle(this.git.stashFiles(stash));
          if (token !== this.detailsToken) return;
          if (result.ok) {
            const commit: Commit = {
              id: stash.sha,
              parents: stash.parents,
              authorName: '',
              authorEmail: '',
              authorDate: stash.date,
              committerName: '',
              committerEmail: '',
              commitDate: stash.date,
              subject: stashDisplayMessage(stash, vi.sidebar.stashWip),
            };
            this.details = { commit, message: stash.message, files: result.value };
          } else {
            this.details = null;
            this.reportFailure(vi.errors.stashDetails, result.error);
          }
          this.isLoadingDetails = false;
        })();
        return;
      }
      case 'workingTree':
      case 'none':
        this.details = null;
        this.isLoadingDetails = false;
    }
  }

  // MARK: - Notifications

  showError(title: string, error: unknown, actions: readonly ToastAction[] = []): void {
    if (this.disposed) return;
    this.toasts.error(title, error, { actions, owner: this.ownerId });
  }

  /** This repo's notifications for the operations in `actions/` (removed when the repo closes, never shown after `dispose`). */
  notify(
    style: 'info' | 'success' | 'warning',
    title: string,
    options: { message?: string; actions?: readonly ToastAction[]; tag?: string } = {},
  ): void {
    if (this.disposed) return;
    this.toasts[style](title, { ...options, owner: this.ownerId });
    const undo = options.actions?.find((action) => action.title === vi.staging.undo);
    if (undo) {
      this.lastUndo = { title, fingerprint: '', run: undo.run };
      this.pendingUndoFingerprint = true;
    }
  }

  /** The state fingerprint guarding the Undo button: HEAD + branch + the list of changed files. */
  get undoFingerprint(): string {
    const files = [
      ...this.status.staged.map((change) => `s:${change.path}`),
      ...this.status.unstaged.map((change) => `u:${change.path}`),
      ...this.status.conflicts.map((entry) => `c:${entry.path}`),
    ].sort();
    return [this.headOid ?? '-', this.currentBranch ?? '-', ...files].join('\n');
  }

  /** Whether the Undo button is clickable: there is an undoable operation and the repo has not changed since (so it never overwrites newer work). */
  get canUndoLast(): boolean {
    const undo = this.lastUndo;
    return undo !== null && !this.pendingUndoFingerprint && undo.fingerprint === this.undoFingerprint;
  }

  undoLast(): void {
    const undo = this.lastUndo;
    if (!undo || !this.canUndoLast) return;
    this.lastUndo = null;
    undo.run();
  }

  /** A normal toast of this store: owned (removed when the repo closes) and never shown after `dispose`. */
  private toast(
    style: 'info' | 'success',
    title: string,
    options: { actions?: readonly ToastAction[] } = {},
  ): void {
    if (this.disposed) return;
    this.toasts[style](title, { ...options, owner: this.ownerId });
  }

  /**
   * Report a data-loading error (status / refs / history / details) through ONE classifier: errors keyed by the core's codes
   * (`not-found`, `untrusted`) become a single clear warning with a shared tag — so when status, refs, history and details all
   * break for one reason only ONE notification appears, with no raw git error attached. Every other error is shown verbatim
   * with its `title` (plus `tag` when present, so the next one replaces the previous).
   */
  private reportFailure(
    title: string,
    error: unknown,
    options: { tag?: string; actions?: readonly ToastAction[] } = {},
  ): void {
    if (this.disposed) return;
    const code = (error as { code?: unknown } | null)?.code;
    if (code === 'not-found') {
      // The repo directory was deleted or renamed: one clear warning instead of a cryptic git error.
      this.toasts.error(vi.errors.repoMissing, undefined, {
        message: this.rootPath,
        tag: this.refreshErrorTag,
        owner: this.ownerId,
      });
      return;
    }
    if (code === 'untrusted') {
      const review = this.onUntrusted;
      this.toasts.warning(vi.errors.repoUntrusted, {
        tag: this.refreshErrorTag,
        owner: this.ownerId,
        actions: review ? [{ title: vi.errors.reviewTrust, run: review }] : [],
      });
      return;
    }
    this.toasts.error(title, error, {
      tag: options.tag,
      actions: options.actions ?? [],
      owner: this.ownerId,
    });
  }

  private reportRefreshFailure(title: string, error: unknown): void {
    this.reportFailure(title, error, { tag: this.refreshErrorTag });
  }

  async copy(text: string, label: string): Promise<void> {
    try {
      await this.clipboard(text);
      this.toast('success', vi.inspector.copied(label));
    } catch (error) {
      this.showError(vi.inspector.copyFailed, error);
    }
  }

  // MARK: - Write operation queue

  /**
   * Run a git operation through the sequential queue (avoiding index.lock contention; Rust also locks per `commonDir`), refresh
   * automatically when it finishes and show errors as toasts. `work` receives a `signal` (only `network` commands are
   * cancellable). Returns once both the operation and the refresh after it are done.
   */
  perform(
    title: string,
    work: (git: GitRepository, signal: AbortSignal) => Promise<void>,
    options: PerformOptions = {},
  ): Promise<void> {
    const previous = this.operationChain;
    this.runningOperations++;
    const run = async (): Promise<void> => {
      await previous;
      const controller = new AbortController();
      this.abort = controller;
      if (options.showsProgress) {
        this.busy = { title, detail: '', fraction: null, canCancel: options.cancellable === true };
      }
      try {
        if (this.disposed) return;
        await work(this.git, controller.signal);
        options.onSuccess?.();
      } catch (error) {
        if (error instanceof CancelledError || controller.signal.aborted) {
          this.toast('info', vi.errors.cancelled(title));
        } else if (!(options.onError?.(error) ?? false)) {
          this.showError(title, error);
        }
      } finally {
        if (this.abort === controller) this.abort = null;
        if (options.showsProgress) this.busy = null;
        this.runningOperations--;
        const scope = (options.refresh ?? Scope.status | Scope.refs) | this.fileSystemPending;
        this.fileSystemPending = 0;
        await this.refreshAndWait(scope);
        if (this.pendingUndoFingerprint && this.lastUndo) {
          this.lastUndo = { ...this.lastUndo, fingerprint: this.undoFingerprint };
          this.pendingUndoFingerprint = false;
        }
      }
    };
    const task = run();
    // The chain never rejects: a failed operation must not block the ones after it.
    this.operationChain = task.catch(() => undefined);
    return task;
  }

  /**
   * Handles git's `--progress` output lines for the busy bar: text + percentage, updated at most ~12 times per second (Swift:
   * 80 ms) so a large repo does not make the UI stutter.
   */
  progressReporter(): (line: string) => void {
    return (line) => {
      const busy = this.busy;
      if (busy === null || this.disposed) return;
      const fraction = progressFraction(line);
      const now = performance.now();
      if (now - this.lastProgressAt < 80 && fraction !== 1) return;
      this.lastProgressAt = now;
      this.busy = { ...busy, detail: line, fraction: fraction ?? busy.fraction };
    };
  }

  cancelCurrentOperation(): void {
    this.abort?.abort();
  }
}
