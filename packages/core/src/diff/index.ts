// Public API of the byte-oriented diff/patch/conflict code. Display decoding lives separately in `presentation`/`inline-diff`.

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
  ConflictChoice,
  ConflictChoices,
  ConflictLinePick,
  ConflictFile,
  ConflictParseResult,
  ConflictResolution,
  ConflictSegment,
} from './conflict-file.ts';
export {
  conflictLineSets,
  conflictResolutions,
  parseConflictFile,
  previewConflicts,
  resolveConflicts,
  toggleConflictLine,
} from './conflict-file.ts';

export type { InlineLine, TextRange } from './inline-diff.ts';
export { changedRanges, hunkHighlights, inlineHighlights } from './inline-diff.ts';

export type { DiffPresentation, PresentationHunk, PresentationLine, SplitRow } from './presentation.ts';
export { MAX_DISPLAY_LENGTH, buildPresentation, buildSplitRows, displayText } from './presentation.ts';
