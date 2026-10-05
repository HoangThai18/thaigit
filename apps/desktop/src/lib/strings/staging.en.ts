/** Bản tiếng Anh của `staging.vi.ts` (cùng khoá, cùng tham số). */
import type { staging as source } from './staging.vi.ts';
import type { Translation } from './types.ts';

const files = (count: number): string => `${count} ${count === 1 ? 'file' : 'files'}`;

export const staging: Translation<typeof source> = {
  diffPlaceholder: 'Select a file to see its diff.',

  unstagedTitle: 'Unstaged',
  stagedTitle: 'Staged',
  conflictsTitle: 'Conflicts',
  stageAll: 'Stage all',
  unstageAll: 'Unstage all',
  stageFile: 'Stage',
  unstageFile: 'Unstage',
  discardFile: 'Discard changes',
  noUnstaged: 'No unstaged changes',
  noStaged: 'Nothing staged yet — click “Stage” or “Stage all”',
  clean: 'No changes.',
  filesChanged: (count: number) => `${files(count)} changed`,
  onBranch: (branch: string) => `on ${branch}`,

  stageTitle: (count: number) => (count === 1 ? 'Stage file' : `Stage ${count} files`),
  unstageTitle: (count: number) => (count === 1 ? 'Unstage file' : `Unstage ${count} files`),
  stageAllTitle: 'Stage all',
  unstageAllTitle: 'Unstage all',
  discardTitle: 'Discard changes',
  discardConfirmTitle: (count: number, name: string) =>
    count === 1
      ? `Discard all unstaged changes in ${name}?`
      : `Discard all unstaged changes in ${count} files?`,
  discardConfirmMessage:
    "Unstaged changes will be dropped; new (untracked) files are moved to Thaigit's trash. You can click “Undo” right after.",
  discardConfirm: 'Discard changes',
  discarded: (count: number) => (count === 1 ? 'Changes discarded' : `Discarded changes in ${count} files`),
  undo: 'Undo',
  undoTitle: 'Undo',
  undone: 'Undone',

  stageHunk: 'Stage hunk',
  unstageHunk: 'Unstage hunk',
  discardHunk: 'Discard hunk',
  stageLines: 'Stage lines',
  unstageLines: 'Unstage lines',
  discardLines: 'Discard lines',
  selectedLines: (count: number) => `${count} ${count === 1 ? 'line' : 'lines'} selected`,
  clearSelection: 'Clear selection',
  lineTip: 'Click to select this line (stage / unstage / discard line by line)',
  discardHunkConfirmTitle: 'Discard the selected changes?',
  discardHunkConfirmMessage:
    'The selected lines go back to how they are in the index. You can click “Undo” right after.',
  partialUnsupported:
    'This file can only be staged / unstaged as a whole (binary file, permission-only change, or rename).',

  diffLabel: 'File diff',
  back: 'Graph',
  backTip: 'Back to the graph (Esc)',
  sourceUnstaged: 'Unstaged',
  sourceStaged: 'Staged',
  sourceCommit: (sha: string) => `Commit ${sha}`,
  sourceStash: 'Stash',
  loading: 'Loading diff…',
  binary: 'Binary file — the content cannot be shown.',
  layoutLabel: 'Diff layout',
  layoutUnified: 'Unified',
  layoutSplit: 'Split',
  listAsTree: 'Show as folder tree',
  listAsPaths: 'Showing a folder tree — click to show a path list',
  stageFolder: 'Stage whole folder',
  unstageFolder: 'Unstage whole folder',
  ignoreWhitespace: 'Ignore whitespace',
  ignoreWhitespaceTip:
    'Hide changes that only touch whitespace / indentation (git diff -w). While on, you can’t stage or discard single lines.',
  navLabel: 'Move between files — Alt + ↑ / ↓ jumps between hunks',
  previousFile: 'Previous file (Alt + Shift + ↑)',
  nextFile: 'Next file (Alt + Shift + ↓)',
  filePosition: (index: number, total: number) => `${index}/${total}`,
  imageOld: 'Old',
  imageNew: 'New',
  imageNone: 'None',
  imageTooLarge: 'The image is too large to preview.',
  imageFailed: "Couldn't read the image.",
  imageSize: (width: number, height: number, bytes: string) => `${width} × ${height} px · ${bytes}`,
  empty: 'No content changes (maybe only the file mode changed, or it was renamed).',
  emptyWhitespace: 'Only whitespace changed — turn off “Ignore whitespace” to see it.',
  tooLargeTitle: 'Very large diff',
  tooLargeMessage: (lines: number, additions: number, deletions: number) =>
    `${lines.toLocaleString('en-US')} changed lines (+${additions} −${deletions}). Showing it may be slow.`,
  showAnyway: 'Show anyway',
  loadFailed: "Couldn't load the diff",
  retry: 'Try again',

  commitTitle: 'Commit',
  summaryPlaceholder: 'Summary (required)',
  bodyPlaceholder: 'Description (optional)',
  summaryTip: 'Keep the summary line under 72 characters',
  amend: 'Amend previous commit',
  amendTip: 'Fold the staged changes into the last commit and/or edit its message',
  commitButton: (count: number, branch: string) =>
    count > 0 ? `Commit ${files(count)} to ${branch}` : 'Commit',
  amendButton: 'Amend previous commit',
  stageAllAndCommit: 'Stage all & commit',
  needSummary: 'Enter a summary to commit',
  needStaged: 'Stage changes before committing',
  conflictsFirst: (count: number) =>
    `Resolve ${count} conflicted ${count === 1 ? 'file' : 'files'} before committing`,
  committing: 'Commit',
  committed: (branch: string) => `Committed to ${branch}`,
  amended: 'Previous commit amended',
  commitShortcut: 'Ctrl/⌘ + Enter to commit',
  commitAndPush: 'Commit & Push',
  commitAndPushTip: 'Commit, then push to the remote (Ctrl/⌘ + Shift + Enter)',
  undoCommit: 'Undo commit',
};
