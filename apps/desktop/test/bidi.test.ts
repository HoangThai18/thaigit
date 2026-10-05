import { describe, expect, it } from 'vitest';
import { hasBidiControls, showBidi, stripBidi } from '../src/lib/format/bidi.ts';
import { initials } from '../src/lib/graph/style.ts';

const RLO = '‮';

describe('showBidi: ký tự điều khiển bidi thành ký hiệu nhìn thấy được (L3)', () => {
  it('thay từng ký tự điều khiển bằng ‹U+XXXX› kèm tên viết tắt; chữ thường giữ nguyên', () => {
    expect(showBidi(`fix-${RLO}gnp.exe`)).toBe('fix-‹RLO U+202E›gnp.exe');
    expect(showBidi('‪a‫b‬c‭d‮e')).toBe('‹LRE U+202A›a‹RLE U+202B›b‹PDF U+202C›c‹LRO U+202D›d‹RLO U+202E›e');
    expect(showBidi('⁦x⁧y⁨z⁩')).toBe('‹LRI U+2066›x‹RLI U+2067›y‹FSI U+2068›z‹PDI U+2069›');
    expect(showBidi('a‎b‏c؜d')).toBe('a‹LRM U+200E›b‹RLM U+200F›c‹ALM U+061C›d');
  });

  it('không đụng vào chữ thường, tiếng Việt, chữ RTL tự nhiên, emoji; kết quả không còn ký tự điều khiển', () => {
    for (const text of [
      'main',
      'tính-tiền/đơn hàng',
      'שלום עולם',
      'مرحبا بالعالم',
      'a-😀-b',
      '',
      'dấu · chấm ↑2',
    ]) {
      expect(showBidi(text)).toBe(text);
      expect(hasBidiControls(text)).toBe(false);
    }
    const shown = showBidi(`${RLO}${RLO}x`);
    expect(hasBidiControls(shown)).toBe(false);
    expect(showBidi(shown)).toBe(shown);
  });

  it('hasBidiControls nhận đúng các ký tự điều khiển', () => {
    expect(hasBidiControls(`a${RLO}b`)).toBe(true);
    expect(hasBidiControls('a‏b')).toBe(true);
    expect(hasBidiControls('a​b')).toBe(false); // a zero-width space is not a bidi control
  });
});

describe('stripBidi / chữ cái đầu của avatar', () => {
  it('stripBidi bỏ hẳn ký tự điều khiển (để tính chữ cái đầu, không để hiển thị)', () => {
    expect(stripBidi(`${RLO}Nguyen`)).toBe('Nguyen');
    expect(stripBidi('Phan Thái')).toBe('Phan Thái');
  });

  it('initials không lấy ký tự điều khiển làm chữ cái đầu', () => {
    expect(initials(`${RLO}nguyen van`)).toBe('NV');
    expect(initials(`${RLO}${RLO}`)).toBe('?');
    expect(initials('Phan Thái')).toBe('PT');
  });
});
