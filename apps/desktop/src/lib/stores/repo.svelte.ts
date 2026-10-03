/**
 * Trạng thái và hành động của MỘT repo đang mở (port `RepoModel.swift`): nạp refs/status/stash/remote song song, quyết định
 * có nạp lại lịch sử không bằng "dấu vân tay" ref, dựng graph (xếp làn + nhãn), nhận sự kiện `repo-changed`, theo dõi chọn
 * commit/stash + tải chi tiết, và hàng đợi thao tác ghi (4a chỉ đọc, nhưng hàng đợi có sẵn hình dạng cho các phase sau).
 *
 * Phản ứng (Svelte 5): mảng lớn (entries, refs…) dùng `$state.raw` — thay cả mảng khi đổi, không bọc proxy sâu. Mỗi trường là
 * một signal riêng nên component chỉ phụ thuộc đúng thứ nó đọc (sidebar không đọc `status`/`selection`).
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
  operationTitle,
  progressFraction,
  refName,
  stashDisplayMessage,
  type Commit,
  type CommitDetails,
  type GitRef,
  type GraphRow,
  type HeadState,
  type Remote,
  type RepoOperation,
  type Stash,
  type WorkingTreeStatus,
} from '@thaigit/core';
import type { RepoChangedEvent } from '@thaigit/contracts';
import { compareNatural } from '../format/natural.ts';
import { buildRefLabels, type RefLabel } from '../graph/pills.ts';
import { DiffStore } from './diff.svelte.ts';
import type { RepoPort } from '../platform/host.ts';
import { vi } from '../strings.vi.ts';
import { jsonEqual } from './equality.ts';
import { COMMIT_LIMIT_MAX, prefs as globalPrefs, type PrefsData, type PrefsStore } from './prefs.svelte.ts';
import { toasts as globalToasts, describeError, type ToastAction, type ToastStore } from './toasts.svelte.ts';

// MARK: - Kiểu

/** Phạm vi làm mới (cờ bit như `RefreshScope` của Swift). */
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
  /** Phạm vi làm mới sau khi xong (mặc định status + refs; lịch sử tự nạp lại khi dấu vân tay ref đổi). */
  refresh?: RefreshScope;
  onSuccess?: () => void;
  /** Trả `true` nếu đã tự xử lý lỗi (khỏi hiện toast mặc định). */
  onError?: (error: unknown) => boolean;
}

export interface RepoStoreOptions {
  prefs?: PrefsStore;
  toasts?: ToastStore;
  /** Mặc định `navigator.clipboard.writeText`. */
  clipboard?: (text: string) => Promise<void>;
  /** Trễ trước khi tải chi tiết commit khi lướt phím mũi tên (Swift: 35 ms). */
  detailsDelayMs?: number;
  /**
   * Lõi Rust từ chối lệnh vì repo chưa được tin tưởng (cấu hình đổi sau khi mở, có `include` trỏ vào file trong repo…):
   * nút "Xem lại cấu hình repo" trên thông báo gọi hàm này để hỏi tin tưởng lại.
   */
  onUntrusted?: () => void;
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
/** Số thứ tự cửa sổ repo (cùng một repo mở lại là một chủ sở hữu toast khác). */
let storeSerial = 0;

export function sameSelection(a: RepoSelection, b: RepoSelection): boolean {
  if (a.kind !== b.kind) return false;
  return (a.kind === 'commit' || a.kind === 'stash') && (b.kind === 'commit' || b.kind === 'stash')
    ? a.sha === b.sha
    : true;
}

/**
 * Dấu vân tay quyết định có nạp lại lịch sử không: đổi ref/HEAD/tuỳ chọn hiển thị thì lịch sử đổi, còn đổi ahead/behind hay
 * file làm việc thì không. Giống `makeFingerprint` của Swift.
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

export class RepoStore {
  readonly port: RepoPort;
  readonly git: GitRepository;
  readonly commandLog = new CommandLog();
  private readonly prefs: PrefsStore;
  private readonly toasts: ToastStore;
  private readonly clipboard: (text: string) => Promise<void>;
  private readonly detailsDelayMs: number;
  private readonly onUntrusted: (() => void) | undefined;

  // --- dữ liệu repository ---
  refs = $state.raw<readonly GitRef[]>([]);
  /** Đã lọc + xếp sẵn mỗi khi refs đổi (repo lớn có hàng nghìn ref — không tính lại khi dựng giao diện). */
  localBranches = $state.raw<readonly GitRef[]>([]);
  remoteBranches = $state.raw<readonly GitRef[]>([]);
  tags = $state.raw<readonly GitRef[]>([]);
  status = $state.raw<WorkingTreeStatus>(EMPTY_STATUS);
  stashes = $state.raw<readonly Stash[]>([]);
  remotes = $state.raw<readonly Remote[]>([]);
  operation = $state.raw<RepoOperation | null>(null);
  entries = $state.raw<readonly GraphEntry[]>([]);
  graphVersion = $state(0);
  graphLanes = $state(1);
  mayHaveMoreCommits = $state(false);
  isLoadingHistory = $state(false);
  hasLoaded = $state(false);
  /** Lỗi nạp lịch sử gần nhất (để graph báo thay vì "chưa có commit"). */
  historyError = $state<string | null>(null);
  commitLimit: number;
  /**
   * Lần tải thêm lịch sử gần nhất bị lỗi: dừng mọi lần tải thêm TỰ ĐỘNG (cuộn gần cuối graph) — nếu không, lỗi bền sẽ khiến
   * giao diện gọi `git log` lặp mãi. Chỉ thao tác của người dùng (`loadMoreHistory(true)`) mới xoá cờ và thử lại.
   */
  loadMoreFailed = $state(false);

  // --- chọn, chi tiết ---
  selection = $state.raw<RepoSelection>({ kind: 'none' });
  details = $state.raw<CommitDetails | null>(null);
  isLoadingDetails = $state(false);
  scrollRequest = $state.raw<ScrollRequest | null>(null);

  // --- giao diện ---
  busy = $state.raw<BusyState | null>(null);
  /** Lần fetch / pull thành công gần nhất (ms, `Date.now()`), để tự fetch không chạy ngay sau khi người dùng vừa fetch. */
  lastFetch = $state<number | null>(null);
  /** File đang mở ở vùng giữa (thay graph) và các dòng đang chọn để stage từng dòng. */
  readonly diff: DiffStore;
  /** Ô soạn commit (giữ khi chuyển qua lại giữa WIP và commit khác). */
  commitDraft = $state({ summary: '', body: '', amend: false });

  // --- nội bộ (không phản ứng) ---
  private rowIndex = new Map<string, number>();
  private refIndex = new Map<string, GitRef>();
  private rawCommits: Commit[] = [];
  private refsFingerprint = '';
  /** Giới hạn commit TRƯỚC lần tải thêm đang chờ/chạy (khác `null` = đang tải thêm); lỗi thì trả `commitLimit` về đây. */
  private loadMoreBase: number | null = null;
  /** Chủ sở hữu mọi toast của store này (gỡ hết khi `dispose`) và tag riêng cho lỗi làm mới (không đè/xoá nhầm repo khác). */
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
    this.git = new GitRepository({
      exec: port.exec,
      fs: port.fs,
      root: port.info.root,
      gitDir: port.info.gitDir,
      commonDir: port.info.commonDir,
      log: this.commandLog,
      typed: port.typedGit,
    });
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
      reportError: (title, error) => store.showError(title, error),
    });
  }

  get name(): string {
    return this.git.name;
  }

  /** Cài đặt đang dùng (kiểu pull, fetch --prune, tự fetch…) cho các thao tác ở `actions/`. */
  get preferences(): PrefsData {
    return this.prefs.value;
  }

  get rootPath(): string {
    return this.port.info.root;
  }

  // MARK: - Vòng đời

  /** Nạp lần đầu và bắt đầu nghe `repo-changed`. Gọi một lần. */
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

  /** Dừng theo dõi và bỏ kết quả của mọi việc đang chạy dở. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.active = false;
    this.detailsToken++;
    // Toast của repo đã đóng mang nút gọi vào store này (Xem lại cấu hình, Tải thêm…): bấm vào sẽ tác động lên repo không còn mở.
    this.toasts.dismissOwner(this.ownerId);
    this.diff.close();
    this.abort?.abort();
    const stop = this.unwatch;
    this.unwatch = null;
    if (stop) await stop().catch(() => undefined);
  }

  // MARK: - Thuộc tính tiện dụng

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

  /** "main ↑2 ↓1 · Đang merge" — dòng phụ dưới tên repo. */
  get branchSubtitle(): string {
    const parts = [this.headDescription];
    if (this.status.ahead > 0) parts.push(`↑${this.status.ahead}`);
    if (this.status.behind > 0) parts.push(`↓${this.status.behind}`);
    if (this.operation) parts.push(`· ${operationTitle(this.operation)}`);
    return parts.join(' ');
  }

  /** Ref của nhánh đang checkout (không có khi HEAD tách rời / repo chưa có commit). */
  get currentBranchRef(): GitRef | undefined {
    return this.localBranches.find((ref) => ref.isHead);
  }

  /** Remote dùng khi push nhánh chưa có upstream: remote của upstream hiện tại, rồi `origin`, rồi remote đầu tiên. */
  get defaultRemote(): string | null {
    const upstream = this.currentBranchRef?.upstream;
    const fromUpstream = upstream ? this.splitUpstream(upstream)?.remote : undefined;
    if (fromUpstream) return fromUpstream;
    return this.remotes.find((remote) => remote.name === 'origin')?.name ?? this.remotes[0]?.name ?? null;
  }

  /** Nhánh local gần đây nhất (nhánh hiện tại đứng đầu) — menu đổi nhánh chỉ liệt kê chừng này. */
  recentLocalBranches(limit: number): readonly GitRef[] {
    if (this.localBranches.length <= limit) return this.localBranches;
    const rank = (ref: GitRef): number => (ref.isHead ? Number.POSITIVE_INFINITY : (ref.date ?? 0));
    return [...this.localBranches].sort((a, b) => rank(b) - rank(a)).slice(0, limit);
  }

  /** Tách "origin/feature/x" thành remote + nhánh theo danh sách remote (remote có `/` trong tên vẫn đúng). */
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

  /** Hàng của mục đang chọn (phản ứng theo `selection` và `graphVersion`). */
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

  // MARK: - Làm mới dữ liệu

  refreshEverything(): void {
    this.requestRefresh(Scope.all);
  }

  /** Gộp các yêu cầu đang chờ thành một lượt làm mới kế tiếp (không phải debounce: lượt đang chạy không bị huỷ). */
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

    // Lần đầu: lịch sử chạy song song với refs/status. HEAD chưa biết nên luôn thêm `HEAD` vào log; repo mà HEAD chưa có
    // commit nhưng vẫn có nhánh khác được xử lý bên dưới.
    const firstLog = first ? settle(this.fetchLog(true)) : null;
    const [statusResult, refsResult, stashResult, remoteResult, operationResult] = await Promise.all([
      wantsStatus ? settle(git.status()) : null,
      wantsRefs ? settle(git.refs()) : null,
      wantsRefs ? settle(git.stashes()) : null,
      wantsRefs ? settle(git.remotes()) : null,
      wantsStatus ? settle(git.operationState()) : null,
    ]);
    if (this.disposed) return;

    if (statusResult) {
      if (statusResult.ok) {
        this.toasts.dismissTag(this.refreshErrorTag);
        if (!jsonEqual(statusResult.value, this.status)) this.status = statusResult.value;
        // Diff của thay đổi chưa commit đang mở: nạp lại (file vừa sửa / stage) hoặc đóng nếu file không còn.
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
        this.select({ kind: 'none' });
      }
    }
    if (remoteResult?.ok && !jsonEqual(remoteResult.value, this.remotes)) this.remotes = remoteResult.value;
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
    // Tag mới nhất (theo tên số lớn) lên trước, như Swift (`orderedDescending`).
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
    });
  }

  /** Nạp lịch sử + xếp làn rồi dựng graph. `pending`: log đã chạy sẵn song song ở lần nạp đầu. */
  private async loadHistory(pending: Promise<Settled<Uint8Array>> | null): Promise<void> {
    this.isLoadingHistory = true;
    // Lần nạp này dùng giới hạn đã nới (do `loadMoreHistory`) hay không: `fetchLog` chạy ngay bên dưới nên `commitLimit` lúc này chính là
    // giá trị nó dùng. Chỉ lần nạp ĐÓ mới được xoá `loadMoreBase` / trả giới hạn về cũ — lần nạp khác đang chạy dở không liên quan.
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
        // HEAD chưa có commit (nhánh mồ côi) nhưng repo vẫn có nhánh khác: chạy lại không kèm `HEAD`.
        result = await settle(this.fetchLog(false));
      }
      if (this.disposed) return;
      if (!result.ok) {
        this.historyError = describeError(result.error);
        if (raisedFrom !== null && this.loadMoreBase === raisedFrom) {
          // Tải thêm hỏng: bỏ giới hạn đã nới (không thì lần sau nới tiếp trên nền hỏng), dừng tải thêm tự động, và cho người
          // dùng một nút thử lại ngay trên thông báo.
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

  /** WIP vừa hiện/ẩn: dựng lại từ commit đã tải, không chạy lại git. */
  private relayoutGraph(): void {
    const history = buildHistory(this.rawCommits, {
      limit: this.commitLimit,
      headOid: this.headOid,
      showWorkingTree: this.shouldShowWorkingTree,
    });
    this.applyGraph(history.commits, history.rows);
  }

  /** Còn commit cũ hơn VÀ giới hạn chưa chạm trần (`COMMIT_LIMIT_MAX`): đã chạm trần thì tải thêm cũng vô ích. */
  get canLoadMore(): boolean {
    return this.mayHaveMoreCommits && this.commitLimit < COMMIT_LIMIT_MAX;
  }

  /**
   * Tải thêm commit cũ hơn: nới giới hạn (kẹp ≤ `COMMIT_LIMIT_MAX`) rồi nạp lại lịch sử (như Swift). Lời gọi TỰ ĐỘNG (cuộn gần
   * cuối graph) bị bỏ qua khi lần tải thêm trước hỏng (`loadMoreFailed`); `byUser = true` (bấm nút) thì thử lại và xoá cờ.
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

  /** Cập nhật nhãn nhánh/tag trên graph mà không dựng lại cả lịch sử (vd. đổi upstream). */
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
    return buildRefLabels(this.refs, this.status.head, {
      showRemotes: this.prefs.value.showRemoteBranches,
      showTags: this.prefs.value.showTags,
      remoteNames: this.remotes.map((remote) => remote.name),
    });
  }

  private validateSelection(): void {
    if (!this.didChooseInitialSelection && (this.hasLoaded || this.entries.length > 0)) {
      this.didChooseInitialSelection = true;
      const head = this.headOid;
      if (this.hasWorkingTreeRow) this.select({ kind: 'workingTree' }, true);
      else if (head !== null && this.rowIndex.has(head)) this.select({ kind: 'commit', sha: head }, true);
      return;
    }
    const selected = this.selection;
    if (selected.kind === 'workingTree' && !this.hasWorkingTreeRow) {
      const head = this.headOid;
      if (head !== null && this.rowIndex.has(head)) this.select({ kind: 'commit', sha: head });
      else this.select({ kind: 'none' });
    } else if (selected.kind === 'commit' && !this.rowIndex.has(selected.sha)) {
      this.select({ kind: 'none' });
    }
  }

  // MARK: - Theo dõi file

  /** Sự kiện đã debounce/lọc gitignore ở Rust: đổi thành phạm vi làm mới rồi chạy luôn, không debounce thêm. */
  handleChange(event: RepoChangedEvent): void {
    if (!this.active || this.disposed) return;
    let scope = 0;
    if (event.kinds.includes('workingTree')) scope |= Scope.status;
    if (event.kinds.includes('refs')) scope |= Scope.refs | Scope.status;
    if (event.kinds.includes('rescan')) scope |= Scope.all;
    if (scope === 0) return;
    // Đang chạy thao tác của chính app: việc làm mới diễn ra ngay sau khi thao tác xong (xem `perform`).
    if (this.runningOperations > 0) this.fileSystemPending |= scope;
    else this.requestRefresh(scope);
  }

  // MARK: - Chọn commit / stash

  select(next: RepoSelection, reveal = false): void {
    if (!sameSelection(next, this.selection)) {
      this.selection = next;
      // Như Swift: chọn commit / stash / WIP khác thì đóng file đang xem, quay về graph.
      this.diff.close();
      this.loadDetails();
    }
    if (reveal) {
      const row = this.rowFor(next);
      if (row !== null) this.scrollRequest = { row, id: ++this.scrollSerial };
    }
  }

  /**
   * Chọn commit `sha` và cuộn tới nó; trả `true` nếu đã chọn. Commit ngoài phần đã tải thì không chọn gì, báo kèm nút "Tải thêm"
   * và trả `false` — nơi gọi (sidebar) không được coi như đã chọn.
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
          // Trễ một chút để lướt nhanh bằng phím mũi tên không tạo quá nhiều lệnh git.
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
              subject: stashDisplayMessage(stash),
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

  // MARK: - Thông báo

  showError(title: string, error: unknown, actions: readonly ToastAction[] = []): void {
    if (this.disposed) return;
    this.toasts.error(title, error, { actions, owner: this.ownerId });
  }

  /** Thông báo của repo này cho các thao tác ở `actions/` (gỡ khi đóng repo, không hiện sau `dispose`). */
  notify(
    style: 'info' | 'success' | 'warning',
    title: string,
    options: { message?: string; actions?: readonly ToastAction[]; tag?: string } = {},
  ): void {
    if (this.disposed) return;
    this.toasts[style](title, { ...options, owner: this.ownerId });
  }

  /** Toast thường của store này: có chủ sở hữu (gỡ khi đóng repo) và không hiện sau `dispose`. */
  private toast(
    style: 'info' | 'success',
    title: string,
    options: { actions?: readonly ToastAction[] } = {},
  ): void {
    if (this.disposed) return;
    this.toasts[style](title, { ...options, owner: this.ownerId });
  }

  /**
   * Báo lỗi nạp dữ liệu (status/refs/lịch sử/chi tiết) qua MỘT bộ phân loại: lỗi theo mã của lõi (`not-found`, `untrusted`) thành
   * một cảnh báo rõ ràng chung tag — nên status, refs, lịch sử và chi tiết cùng hỏng một lý do chỉ hiện MỘT thông báo, không kèm
   * thêm lỗi git thô. Lỗi khác hiện nguyên văn với `title` (kèm `tag` nếu có để lần sau thay lần trước).
   */
  private reportFailure(
    title: string,
    error: unknown,
    options: { tag?: string; actions?: readonly ToastAction[] } = {},
  ): void {
    if (this.disposed) return;
    const code = (error as { code?: unknown } | null)?.code;
    if (code === 'not-found') {
      // Thư mục repo bị xoá/đổi tên: một cảnh báo rõ ràng thay vì lỗi git khó hiểu.
      this.toasts.error(vi.errors.repoMissing, this.rootPath, {
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

  // MARK: - Hàng đợi thao tác ghi

  /**
   * Chạy một thao tác git qua hàng đợi tuần tự (tránh tranh chấp index.lock; Rust cũng khoá theo `commonDir`), tự làm mới khi
   * xong và hiện lỗi dạng toast. `work` nhận `signal` (chỉ lệnh `network` huỷ được). Trả khi thao tác và lần làm mới sau nó đã xong.
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
      }
    };
    const task = run();
    // Chuỗi không bao giờ reject: một thao tác hỏng không chặn các thao tác sau.
    this.operationChain = task.catch(() => undefined);
    return task;
  }

  /**
   * Hàm nhận dòng tiến độ của git (`--progress`) cho thanh bận: chữ + phần trăm, cập nhật tối đa ~12 lần/giây (Swift: 80 ms)
   * để repo lớn không làm giao diện giật.
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
