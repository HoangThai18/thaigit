#!/usr/bin/env python3
"""Sinh ảnh giao diện cho trang chủ từ docs/screenshots/*.png (ảnh dùng trong README).

    python3 site/scripts/make-shots.py

Tạo public/screenshots/<tên>-1600.webp và <tên>-800.webp, rồi viết lại lib/shots.ts (kích thước + alt).
Cần Pillow (pip install pillow). Chạy lại mỗi khi chụp lại ảnh trong docs/screenshots — site/scripts/take-shots.sh
chụp lại toàn bộ từ app macOS (repo demo dựng bằng make-demo-repos.py) rồi tự gọi script này.
"""
from pathlib import Path

from PIL import Image

SITE = Path(__file__).resolve().parent.parent
SOURCE = SITE.parent / 'docs' / 'screenshots'
OUT = SITE / 'public' / 'screenshots'
WIDTHS = (1600, 800)
QUALITY = 80

# Mô tả ảnh (alt) — cũng là chữ Google đọc được, nên viết đúng nội dung trong ảnh.
ALTS = {
    'conflict': 'Trình giải xung đột: giữ Current, Incoming hoặc cả hai cho từng khối',
    'diff-lines': 'Chọn 3 dòng trong diff rồi bấm Stage dòng',
    'diff-split': 'Diff tách đôi: trước và sau',
    'drag': 'Thả nhánh feature/giao-dien lên main: chọn merge hoặc rebase',
    'image-diff': 'Diff ảnh: logo trước và sau khi đổi',
    'large': 'Repo 30.000 commit, gần 1.100 nhánh và tag',
    'overview': 'Thaigit: graph commit nhiều màu, sidebar nhánh và panel commit',
    'overview-dark': 'Thaigit giao diện tối',
    'switch': 'Hộp tìm và chuyển nhánh nhanh (⌘B)',
    'welcome': 'Màn hình chào: mở, clone, tạo repository',
}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    sizes = {}
    for name, alt in ALTS.items():
        src = Image.open(SOURCE / f'{name}.png').convert('RGB')
        for width in WIDTHS:
            height = round(src.height * width / src.width)
            img = src if src.width == width else src.resize((width, height), Image.LANCZOS)
            img.save(OUT / f'{name}-{width}.webp', 'WEBP', quality=QUALITY, method=6)
            if width == WIDTHS[0]:
                sizes[name] = (width, height)
    total = sum(p.stat().st_size for p in OUT.glob('*.webp'))
    print(f'✓ {len(ALTS) * len(WIDTHS)} ảnh WebP, tổng {total // 1024} KB → {OUT.relative_to(SITE.parent)}')

    lines = [
        '/** Ảnh giao diện trong public/screenshots (WebP 1600 & 800 px) — sinh bằng scripts/make-shots.py, đừng sửa tay. */',
        'export const SHOTS = {',
    ]
    for name, alt in ALTS.items():
        width, height = sizes[name]
        lines.append(f"  '{name}': {{ width: {width}, height: {height}, alt: '{alt}' }},")
    lines += ['} as const;', '', 'export type ShotName = keyof typeof SHOTS;', '']
    (SITE / 'lib' / 'shots.ts').write_text('\n'.join(lines), encoding='utf-8')
    print('✓ site/lib/shots.ts')


if __name__ == '__main__':
    main()
