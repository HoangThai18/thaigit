/**
 * "Natural" name comparison like Foundation's `localizedStandardCompare` (Finder): case- and
 * diacritic-insensitive, with numbers compared by value ("f2" < "f10"). Used to sort branches and tags
 * in the sidebar. Two names differing only in case still get a stable order.
 */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function compareNatural(a: string, b: string): number {
  const result = collator.compare(a, b);
  if (result !== 0) return result;
  return a < b ? -1 : a > b ? 1 : 0;
}

const folded = new Map<string, string>();

/** Lowercase and strip diacritics (Unicode NFD) so a filter matches "tinh-tien" against "Tính-Tiền", like `localizedStandardContains`. Memoised. */
export function foldText(text: string): string {
  let value = folded.get(text);
  if (value === undefined) {
    value = text
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replaceAll('đ', 'd')
      .replaceAll('Đ', 'D')
      .toLowerCase();
    if (folded.size > 20_000) folded.clear();
    folded.set(text, value);
  }
  return value;
}

/** Whether `text` contains `query` (case- and diacritic-insensitive). `query` should already be the output of `foldText`. */
export function containsFolded(text: string, foldedQuery: string): boolean {
  return foldedQuery === '' || foldText(text).includes(foldedQuery);
}
