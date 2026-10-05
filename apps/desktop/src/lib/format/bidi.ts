/**
 * Bidirectional (bidi) control characters in branch / tag / file names: git allows them, and `fix-‮gnp.exe`
 * (U+202E) renders as `fix-exe.png` — misleading the reader about the file extension or branch name
 * ("Trojan Source"). Display ONLY: the real name (keys, comparisons, git commands) is always kept intact;
 * display sites call `showBidi` and put the result in `<bdi>` so the rest of the line isn't reordered
 * with it.
 */
const NAMES: Readonly<Record<string, string>> = {
  '؜': 'ALM',
  '‎': 'LRM',
  '‏': 'RLM',
  '‪': 'LRE',
  '‫': 'RLE',
  '‬': 'PDF',
  '‭': 'LRO',
  '‮': 'RLO',
  '⁦': 'LRI',
  '⁧': 'RLI',
  '⁨': 'FSI',
  '⁩': 'PDI',
};

const CONTROLS = /[؜‎‏‪-‮⁦-⁩]/gu;
const HAS_CONTROL = new RegExp(CONTROLS.source, 'u');

export function hasBidiControls(text: string): boolean {
  return HAS_CONTROL.test(text);
}

/** Strip bidi control characters entirely — for COMPUTATION only (e.g. avatar initials), never for display (see `showBidi`). */
export function stripBidi(text: string): string {
  return HAS_CONTROL.test(text) ? text.replace(CONTROLS, '') : text;
}

/** Replace each bidi control character with a visible marker `‹RLO U+202E›`; ordinary text (including genuine RTL scripts) is untouched. */
export function showBidi(text: string): string {
  if (!HAS_CONTROL.test(text)) return text;
  return text.replace(CONTROLS, (char) => {
    const code = char.codePointAt(0) ?? 0;
    return `‹${NAMES[char] ?? 'BIDI'} U+${code.toString(16).toUpperCase().padStart(4, '0')}›`;
  });
}
