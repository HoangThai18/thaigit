/**
 * So sánh tên "tự nhiên" như `localizedStandardCompare` của Foundation (Finder): không phân biệt hoa/thường và dấu, số được
 * so theo giá trị ("f2" < "f10"). Dùng để xếp nhánh và tag trong sidebar. Hai tên chỉ khác hoa/thường vẫn có thứ tự ổn định.
 */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function compareNatural(a: string, b: string): number {
  const result = collator.compare(a, b);
  if (result !== 0) return result;
  return a < b ? -1 : a > b ? 1 : 0;
}

const folded = new Map<string, string>();

/** Chữ thường, bỏ dấu (Unicode NFD) — để lọc "tinh-tien" khớp "Tính-Tiền" như `localizedStandardContains`. Có nhớ đệm. */
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

/** `text` có chứa `query` không (không phân biệt hoa/thường và dấu). `query` nên là kết quả của `foldText`. */
export function containsFolded(text: string, foldedQuery: string): boolean {
  return foldedQuery === '' || foldText(text).includes(foldedQuery);
}
