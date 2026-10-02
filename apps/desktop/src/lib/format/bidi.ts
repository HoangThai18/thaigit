/**
 * Ký tự điều khiển hai chiều (bidi) trong tên nhánh/tag/tệp: git cho phép chúng, và `fix-‮gnp.exe` (U+202E) hiện ra thành
 * `fix-exe.png` — đánh lừa người đọc về đuôi tệp / tên nhánh ("Trojan Source"). Chỉ để HIỂN THỊ: tên thật (khoá, so sánh,
 * lệnh git) luôn giữ nguyên; chỗ hiển thị gọi `showBidi` rồi đặt trong `<bdi>` để phần còn lại của dòng không bị đảo theo.
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

/** Bỏ hẳn ký tự điều khiển bidi — chỉ để TÍNH TOÁN (vd. chữ cái đầu của avatar), không dùng để hiển thị (xem `showBidi`). */
export function stripBidi(text: string): string {
  return HAS_CONTROL.test(text) ? text.replace(CONTROLS, '') : text;
}

/** Thay mỗi ký tự điều khiển bidi bằng ký hiệu nhìn thấy được `‹RLO U+202E›`; chữ thường (kể cả chữ RTL tự nhiên) giữ nguyên. */
export function showBidi(text: string): string {
  if (!HAS_CONTROL.test(text)) return text;
  return text.replace(CONTROLS, (char) => {
    const code = char.codePointAt(0) ?? 0;
    return `‹${NAMES[char] ?? 'BIDI'} U+${code.toString(16).toUpperCase().padStart(4, '0')}›`;
  });
}
