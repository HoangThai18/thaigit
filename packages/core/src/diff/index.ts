// API công khai của diff/patch/conflict (theo byte). Phần giải mã hiển thị nằm riêng ở `presentation`/`inline-diff`.

export type { DiffHunk, DiffLine, DiffLineKind, FileDiff, HunkHeader } from './diff.ts';
export {
  changeLineIndices,
  diffLineCount,
  isChangeLine,
  isModeChangeOnly,
  parseDiff,
  parseHunkHeader,
  parsePath,
  supportsPartialStaging,
} from './diff.ts';

export type { LineSelection } from './patch-builder.ts';
export { makePatch, selectionForWholeHunk } from './patch-builder.ts';

export type {
  ByteRange,
  ConflictBlock,
  ConflictChoices,
  ConflictFile,
  ConflictParseResult,
  ConflictResolution,
  ConflictSegment,
} from './conflict-file.ts';
export { conflictResolutions, parseConflictFile, resolveConflicts } from './conflict-file.ts';

export type { InlineLine, TextRange } from './inline-diff.ts';
export { changedRanges, hunkHighlights, inlineHighlights } from './inline-diff.ts';

export type { DiffPresentation, PresentationHunk, PresentationLine, SplitRow } from './presentation.ts';
export { MAX_DISPLAY_LENGTH, buildPresentation, buildSplitRows, displayText } from './presentation.ts';
