// Nội dung menu chuột phải (port phần "Menu ngữ cảnh" của RepoModel+Actions.swift): commit trên graph, dòng WIP, nhánh / tag,
// stash, file thay đổi. Chỉ dựng dữ liệu (MenuItem) — vẽ ở MenuHost.

import {
  isWorkingTreeCommit,
  refName,
  refShortBranchName,
  shortSha,
  type Commit,
  type FileChange,
  type GitRef,
  type Stash,
} from '@thaigit/core';
import type { RefLabel } from '../graph/pills.ts';
import type { GraphEntry } from '../stores/repo.svelte.ts';
import type { RepoStore } from '../stores/repo.svelte.ts';
import type { DiffSource } from '../stores/diff.svelte.ts';
import { tidyMenu, type MenuItem } from '../stores/menus.svelte.ts';
import { vi } from '../strings.vi.ts';
import { describePullRequest, explainCommit } from '../ai/actions.ts';
import { AI_ENABLED } from '../ai/enabled.ts';
import { openBlame, openFileHistory } from '../history/actions.ts';
import {
  beginInteractiveRebase,
  canRewriteCommit,
  dropCommit,
  moveCommit,
  rewordCommit,
} from '../rebase/actions.ts';
import { assignAccountForRepo } from '../forge/assignOwner.ts';
import { createPullRequest } from '../forge/createPullRequest.svelte.ts';
import { targetOf } from '../forge/pullRequests.ts';
import { requestWording } from '../forge/wording.ts';
import { commitWebUrl } from '../forge/target.ts';
import { openUrl } from '../ipc/os.ts';
import {
  beginCreateBranch,
  beginRenameBranch,
  checkout,
  checkoutDetached,
  deleteBranch,
  deleteRemoteBranch,
  fastForward,
} from './branches.ts';
import { cherryPick, discardAll, ignore, merge, rebaseCurrent, reset, revert } from './history.ts';
import { lfsFileItems } from './lfs.ts';
import { graphFilterItems } from './graphFilter.ts';
import { pull, push, pushBranch } from './remote.ts';
import { discardFiles, stageAll, stageFiles, unstageAll, unstageFiles } from './staging.ts';
import { applyStash, beginStash, dropStash, popStash, quickStash } from './stash.ts';
import { beginCreateTag, deleteRemoteTag, deleteTag, pushTag } from './tags.ts';
import type { IconName } from '../ui/icons.ts';

function refIcon(ref: GitRef): IconName {
  return ref.kind === 'localBranch' ? 'laptop' : ref.kind === 'remoteBranch' ? 'cloud' : 'tag';
}

/** Menu của một hàng trên graph: các nhánh / tag trỏ vào commit (menu con), rồi thao tác trên commit. */
/** Menu của viên "+N" trên graph: mọi nhánh / tag bị gom, mỗi cái một menu con (Checkout, Merge, Push…). */
export function labelsMenu(store: RepoStore, labels: readonly RefLabel[]): MenuItem[] {
  const refs = labels.filter((label) => !label.isDetachedHead).flatMap((label) => label.refs);
  return [
    { kind: 'header', title: vi.graph.moreTitle(refs.length) },
    ...refs.map((ref): MenuItem => ({
      kind: 'submenu',
      title: refName(ref),
      icon: refIcon(ref),
      items: refMenu(store, ref),
    })),
  ];
}

export function commitMenu(store: RepoStore, entry: GraphEntry): MenuItem[] {
  const commit = entry.commit;
  if (isWorkingTreeCommit(commit)) return workingTreeMenu(store);
  const refItems: MenuItem[] = [];
  for (const label of entry.labels) {
    if (label.isDetachedHead) continue;
    for (const ref of label.refs) {
      refItems.push({ kind: 'submenu', title: refName(ref), icon: refIcon(ref), items: refMenu(store, ref) });
    }
  }
  const isHead = commit.id === store.headOid;
  const branch = store.currentBranch ?? 'HEAD';
  const sha = shortSha(commit);
  const rewritable = canRewriteCommit(store, commit);
  const target = targetOf(store);
  const webUrl = target === null ? null : commitWebUrl(target, commit.id);
  return tidyMenu([
    ...refItems,
    { kind: 'separator' },
    {
      title: vi.branches.menuCreateBranchHere,
      icon: 'branch',
      run: () => void beginCreateBranch(store, { sha: commit.id, label: sha }),
    },
    {
      title: vi.branches.menuCreateTagHere,
      icon: 'tag',
      run: () => void beginCreateTag(store, commit.id, sha),
    },
    {
      title: vi.branches.menuCheckoutCommit,
      icon: 'checkout',
      disabled: isHead,
      run: () => void checkoutDetached(store, commit.id, vi.branches.commitLabel(sha)),
    },
    { kind: 'separator' },
    AI_ENABLED && { title: vi.ai.explain, icon: 'sparkles', run: () => explainCommit(store, commit) },
    { kind: 'separator' },
    {
      title: vi.branches.menuCherryPick(branch),
      icon: 'cherry-pick',
      disabled: isHead || store.headOid === null,
      run: () => void cherryPick(store, commit),
    },
    {
      title: vi.branches.menuRevert,
      icon: 'revert',
      disabled: store.headOid === null,
      run: () => void revert(store, commit),
    },
    {
      title: vi.rebase.menu,
      icon: 'rebase',
      disabled: isHead || store.currentBranch === null,
      run: () => void beginInteractiveRebase(store, commit),
    },
    {
      kind: 'submenu',
      title: vi.branches.menuReset(branch),
      icon: 'reset',
      disabled: store.headOid === null,
      items: [
        { title: vi.branches.resetSoft, run: () => void reset(store, commit, 'soft') },
        { title: vi.branches.resetMixed, run: () => void reset(store, commit, 'mixed') },
        { title: vi.branches.resetHardMenu, destructive: true, run: () => void reset(store, commit, 'hard') },
      ],
    },
    { kind: 'separator' },
    {
      title: vi.rebase.menuReword,
      icon: 'pencil',
      disabled: !rewritable,
      run: () => void rewordCommit(store, commit),
    },
    {
      kind: 'submenu',
      title: vi.rebase.menuMove,
      icon: 'list',
      disabled: !rewritable,
      items: [
        {
          title: vi.rebase.menuMoveUp,
          icon: 'chevron-up',
          disabled: isHead,
          run: () => void moveCommit(store, commit, 'up'),
        },
        {
          title: vi.rebase.menuMoveDown,
          icon: 'chevron-down',
          run: () => void moveCommit(store, commit, 'down'),
        },
      ],
    },
    {
      title: vi.rebase.menuDrop,
      icon: 'trash',
      destructive: true,
      disabled: !rewritable,
      run: () => void dropCommit(store, commit),
    },
    { kind: 'separator' },
    { title: vi.branches.menuCopySha, icon: 'hash', run: () => void store.copy(commit.id, 'SHA') },
    {
      title: vi.branches.menuCopyMessage,
      icon: 'copy',
      run: () => void store.copy(commit.subject, vi.branches.copyMessageLabel),
    },
    { title: vi.branches.menuCopyPatch, icon: 'copy', run: () => void copyPatch(store, commit) },
    webUrl !== null && { kind: 'separator' },
    webUrl !== null &&
      target !== null && {
        title: vi.branches.menuOpenCommitWeb(target.host),
        icon: 'globe',
        run: () => void osAction(store, () => openUrl(webUrl)),
      },
    webUrl !== null && {
      title: vi.branches.menuCopyCommitLink,
      icon: 'globe',
      run: () => void store.copy(webUrl, vi.branches.copyLinkLabel),
    },
  ]);
}

/** Commit dạng patch (áp lại được bằng `git am`) vào clipboard. */
async function copyPatch(store: RepoStore, commit: Commit): Promise<void> {
  let patch: string;
  try {
    patch = await store.git.commitPatch(commit.id);
  } catch (error) {
    store.showError(vi.inspector.copyFailed, error);
    return;
  }
  await store.copy(patch, vi.branches.copyPatchLabel);
}

export function workingTreeMenu(store: RepoStore): MenuItem[] {
  return [
    {
      title: vi.branches.menuStageAll,
      icon: 'stage',
      disabled: store.status.unstaged.length === 0,
      run: () => void stageAll(store),
    },
    {
      title: vi.branches.menuUnstageAll,
      icon: 'unstage',
      disabled: store.status.staged.length === 0,
      run: () => void unstageAll(store),
    },
    { kind: 'separator' },
    { title: vi.branches.menuStashAll, icon: 'stash', run: () => void quickStash(store) },
    { title: vi.branches.stashWithMessage, icon: 'pencil', run: () => void beginStash(store) },
    { kind: 'separator' },
    {
      title: vi.branches.menuDiscardAll,
      icon: 'trash',
      destructive: true,
      disabled: store.operation !== null,
      run: () => void discardAll(store),
    },
  ];
}

/** Menu của một nhánh local / nhánh remote / tag (sidebar, viên nhãn trên graph). */
export function refMenu(store: RepoStore, ref: GitRef): MenuItem[] {
  const current = store.currentBranch;
  const name = refName(ref);
  const items: (MenuItem | null)[] = [];
  switch (ref.kind) {
    case 'localBranch': {
      const isCurrent = name === current;
      if (isCurrent) {
        items.push({ title: vi.branches.menuPull, icon: 'pull', run: () => void pull(store) });
        items.push({ title: vi.branches.menuPush, icon: 'push', run: () => void push(store) });
      } else {
        items.push({
          title: vi.branches.menuCheckout(name),
          icon: 'checkout',
          run: () => void checkout(store, ref),
        });
        if (current !== null) {
          items.push({
            title: vi.branches.menuMergeInto(name, current),
            icon: 'merge',
            run: () => void merge(store, name, name),
          });
          items.push({
            title: vi.branches.menuRebaseOnto(current, name),
            icon: 'rebase',
            run: () => void rebaseCurrent(store, name, name),
          });
        }
        items.push({
          title: vi.branches.menuPushBranch(name),
          icon: 'push',
          run: () => void pushBranch(store, ref),
        });
      }
      if (ref.upstream !== null && ref.behind > 0 && ref.ahead === 0) {
        items.push({
          title: vi.branches.menuFastForward(ref.upstream),
          icon: 'fast-forward',
          run: () => void fastForward(store, ref),
        });
      }
      items.push({ kind: 'separator' });
      if (AI_ENABLED) {
        items.push({
          title: vi.ai.prDescription,
          icon: 'sparkles',
          run: () => void describePullRequest(store, name),
        });
      }
      items.push({
        title: vi.branches.menuCreateBranchFrom(name),
        icon: 'branch',
        run: () => void beginCreateBranch(store, { sha: ref.target, label: name }),
      });
      items.push({
        title: vi.branches.menuRename,
        icon: 'pencil',
        run: () => void beginRenameBranch(store, ref),
      });
      items.push({
        title: vi.branches.menuDeleteBranch,
        icon: 'trash',
        destructive: true,
        disabled: isCurrent,
        run: () => void deleteBranch(store, ref),
      });
      break;
    }
    case 'remoteBranch': {
      const short = refShortBranchName(
        ref,
        store.remotes.map((remote) => remote.name),
      );
      items.push({
        title: vi.branches.menuCheckout(short),
        icon: 'checkout',
        run: () => void checkout(store, ref),
      });
      if (current !== null) {
        items.push({
          title: vi.branches.menuMergeInto(name, current),
          icon: 'merge',
          run: () => void merge(store, name, name),
        });
        items.push({
          title: vi.branches.menuRebaseOnto(current, name),
          icon: 'rebase',
          run: () => void rebaseCurrent(store, name, name),
        });
      }
      items.push({ kind: 'separator' });
      items.push({
        title: vi.branches.menuCreateBranchFrom(name),
        icon: 'branch',
        run: () => void beginCreateBranch(store, { sha: ref.target, label: name }),
      });
      items.push({
        title: vi.branches.menuDeleteOnRemote,
        icon: 'trash',
        destructive: true,
        run: () => void deleteRemoteBranch(store, ref),
      });
      break;
    }
    case 'tag':
      items.push({
        title: vi.branches.menuCheckoutTag(name),
        icon: 'checkout',
        run: () => void checkout(store, ref),
      });
      items.push({
        title: vi.branches.menuPushTag,
        icon: 'push',
        disabled: store.remotes.length === 0,
        run: () => void pushTag(store, ref),
      });
      items.push({
        title: vi.branches.menuCreateBranchFromTag,
        icon: 'branch',
        run: () => void beginCreateBranch(store, { sha: ref.target, label: name }),
      });
      items.push({ kind: 'separator' });
      items.push({
        title: vi.branches.menuDeleteTag,
        icon: 'trash',
        destructive: true,
        run: () => void deleteTag(store, ref),
      });
      items.push({
        title: vi.branches.menuDeleteRemoteTag,
        icon: 'trash',
        destructive: true,
        disabled: store.remotes.length === 0,
        run: () => void deleteRemoteTag(store, ref),
      });
      break;
  }
  items.push({ kind: 'separator' }, ...graphFilterItems(store, ref));
  items.push({ kind: 'separator' });
  items.push({
    title: vi.branches.menuCopyName,
    icon: 'copy',
    run: () => void store.copy(name, vi.branches.copyNameLabel),
  });
  return tidyMenu(items);
}

export function stashMenu(store: RepoStore, entry: Stash): MenuItem[] {
  return [
    { title: vi.branches.stashApplyKeep, icon: 'download', run: () => void applyStash(store, entry) },
    { title: vi.branches.stashPopDrop, icon: 'stash', run: () => void popStash(store, entry) },
    { kind: 'separator' },
    {
      title: vi.branches.dropStashMenu,
      icon: 'trash',
      destructive: true,
      run: () => void dropStash(store, entry),
    },
  ];
}

/** Menu của một file thay đổi (danh sách WIP, file trong commit / stash). */
export function fileMenu(store: RepoStore, change: FileChange, source: DiffSource): MenuItem[] {
  const items: (MenuItem | null)[] = [
    { title: vi.branches.menuOpenDiff, icon: 'compare', run: () => store.diff.open(change, source) },
  ];
  if (source.kind === 'unstaged') {
    items.push({
      title: vi.branches.menuStageFile,
      icon: 'stage',
      run: () => void stageFiles(store, [change]),
    });
    items.push({
      title: vi.branches.menuDiscardFile,
      icon: 'discard',
      destructive: true,
      run: () => void discardFiles(store, [change]),
    });
    if (change.kind === 'untracked') {
      const slash = change.path.lastIndexOf('/');
      const folder = slash > 0 ? change.path.slice(0, slash) : '';
      const base = change.path.slice(slash + 1);
      const dot = base.lastIndexOf('.');
      const extension = dot > 0 ? base.slice(dot + 1) : '';
      const ignoreItems: (MenuItem | null)[] = [
        { title: vi.branches.menuIgnoreFile, run: () => void ignore(store, `/${change.path}`) },
        extension !== ''
          ? {
              title: vi.branches.menuIgnoreExtension(extension),
              run: () => void ignore(store, `*.${extension}`),
            }
          : null,
        folder !== ''
          ? { title: vi.branches.menuIgnoreFolder(folder), run: () => void ignore(store, `/${folder}/`) }
          : null,
      ];
      items.push({
        kind: 'submenu',
        title: vi.branches.menuIgnore,
        icon: 'filter',
        items: tidyMenu(ignoreItems),
      });
    }
  } else if (source.kind === 'staged') {
    items.push({
      title: vi.branches.menuUnstageFile,
      icon: 'unstage',
      run: () => void unstageFiles(store, [change]),
    });
  }
  items.push({ kind: 'separator' }, ...historyItems(store, change, source), { kind: 'separator' });
  const port = store.port;
  const onDisk = (source.kind === 'unstaged' || source.kind === 'staged') && change.kind !== 'deleted';
  if (onDisk) items.push(...lfsFileItems(store, change));
  if (onDisk && port.openInEditor) {
    items.push({
      title: vi.branches.menuOpenInEditor,
      icon: 'pencil',
      run: () => void osAction(store, () => port.openInEditor?.(change.path)),
    });
  }
  if (onDisk && port.reveal) {
    items.push({
      title: vi.branches.menuReveal,
      icon: 'folder',
      run: () => void osAction(store, () => port.reveal?.(change.path)),
    });
  }
  items.push({
    title: vi.branches.menuCopyPath,
    icon: 'copy',
    run: () => void store.copy(change.path, vi.branches.copyPathLabel),
  });
  return tidyMenu(items);
}

/**
 * Lịch sử file / Blame (như GitKraken): file chưa từng commit (chưa track, mới thêm) thì không có gì để xem. Với file của một
 * commit, blame tại chính commit đó; file đã xoá thì không blame được.
 */
function historyItems(store: RepoStore, change: FileChange, source: DiffSource): MenuItem[] {
  if (source.kind === 'stash' || source.kind === 'conflict') return [];
  const workingTree = source.kind === 'unstaged' || source.kind === 'staged';
  if (workingTree && (change.kind === 'untracked' || change.kind === 'added')) return [];
  const items: MenuItem[] = [
    { title: vi.history.menuFileHistory, icon: 'history', run: () => openFileHistory(store, change.path) },
  ];
  if (change.kind !== 'deleted') {
    const rev = source.kind === 'commit' ? source.sha : null;
    items.push({
      title: rev === null ? vi.history.menuBlame : vi.history.menuBlameAtCommit,
      icon: 'blame',
      run: () => openBlame(store, change.path, rev),
    });
  }
  return items;
}

/** Mở ứng dụng ngoài (terminal, trình soạn thảo, trình quản lý file); lỗi chỉ báo câu thân thiện. */
export async function osAction(store: RepoStore, run: () => Promise<void> | undefined): Promise<void> {
  try {
    await run();
  } catch (error) {
    store.showError(vi.branches.osFailed, error);
  }
}

/** Mục liên quan tới máy chủ từ xa của repo: tạo Pull Request và gán tài khoản cho owner (chỉ khi remote nói chuyện với GitHub / GitLab / Bitbucket). */
export function repoForgeItems(store: RepoStore): MenuItem[] {
  const target = targetOf(store);
  if (target === null) return [];
  const head = store.currentBranchRef ? refName(store.currentBranchRef) : null;
  return tidyMenu([
    head !== null && {
      title: requestWording(target.provider).createFrom(head),
      icon: 'globe',
      run: () => void createPullRequest.open(store, head),
    },
    {
      title: vi.accounts.ownerForRepo,
      icon: 'shield',
      run: () => void assignAccountForRepo(store),
    },
  ]);
}

/** Mục "mở ra ngoài" của repo (menu Thêm trên thanh công cụ). */
export function repoOsItems(store: RepoStore): MenuItem[] {
  const port = store.port;
  return tidyMenu([
    port.openInTerminal && {
      title: vi.branches.menuOpenTerminal,
      icon: 'terminal',
      run: () => void osAction(store, () => port.openInTerminal?.()),
    },
    port.openInEditor && {
      title: vi.branches.menuOpenRepoInEditor,
      icon: 'pencil',
      run: () => void osAction(store, () => port.openInEditor?.()),
    },
    port.reveal && {
      title: vi.branches.menuRevealRepo,
      icon: 'folder',
      run: () => void osAction(store, () => port.reveal?.()),
    },
  ]);
}
