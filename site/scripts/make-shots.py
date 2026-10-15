#!/usr/bin/env python3
"""Sinh ảnh giao diện cho trang chủ từ docs/screenshots/*.png (ảnh dùng trong README).

    python3 site/scripts/make-shots.py

Tạo public/screenshots/<tên>-1600.webp và <tên>-800.webp, rồi viết lại lib/shots.ts (kích thước + alt).
Cần Pillow (pip install pillow). Chạy lại mỗi khi chụp lại ảnh trong docs/screenshots — ảnh chụp từ bản
Tauri qua cầu nối DEV (THAIGIT_DEV_REPO + pw-public), repo demo dựng bằng make-demo-repos.py.
"""
from pathlib import Path

from PIL import Image

SITE = Path(__file__).resolve().parent.parent
SOURCE = SITE.parent / 'docs' / 'screenshots'
OUT = SITE / 'public' / 'screenshots'
WIDTHS = (1600, 800)
QUALITY = 80

# Image descriptions (alt text) — also the text Google reads, so describe what is actually visible in the image.
ALTS = {
    'conflict': (
        'Trình giải xung đột: giữ Current, Incoming hoặc cả hai cho từng khối',
        'Conflict resolver: keep Current, Incoming or both for each block',
    ),
    'diff-lines': (
        'Chọn 3 dòng trong diff rồi bấm Stage dòng',
        'Select 3 lines in the diff, then click Stage lines',
    ),
    'diff-split': ('Diff tách đôi: trước và sau', 'Split diff: before and after'),
    'drag': (
        'Thả nhánh feature/giao-dien lên main: chọn merge hoặc rebase',
        'Drop the feature/giao-dien branch onto main: choose merge or rebase',
    ),
    'image-diff': (
        'Diff ảnh: logo trước và sau khi đổi',
        'Image diff: the logo before and after the change',
    ),
    'large': (
        'Repo 30.000 commit, gần 1.100 nhánh và tag',
        'A repo with 30,000 commits and nearly 1,100 branches and tags',
    ),
    'overview': (
        'Gitlane: graph commit nhiều màu, sidebar nhánh và panel commit',
        'Gitlane: a colorful commit graph, branch sidebar and commit panel',
    ),
    'overview-dark': ('Gitlane giao diện tối', 'Gitlane in the dark theme'),
    'switch': ('Hộp tìm và chuyển nhánh nhanh (⌘B)', 'Quick branch search and switch (⌘B)'),
    'welcome': (
        'Màn hình chào: mở, clone, tạo repository',
        'Welcome screen: open, clone or create a repository',
    ),
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
        "import type { Lang } from './i18n';",
        '',
        'export const SHOTS = {',
    ]
    for name, (vi, en) in ALTS.items():
        width, height = sizes[name]
        lines.append(f"  '{name}': {{")
        lines.append(f'    width: {width},')
        lines.append(f'    height: {height},')
        lines.append(f"    alt: {{ vi: '{vi}', en: '{en}' }},")
        lines.append('  },')
    lines += [
        '} as const satisfies Record<string, { width: number; height: number; alt: Record<Lang, string> }>;',
        '',
        'export type ShotName = keyof typeof SHOTS;',
        '',
    ]
    (SITE / 'lib' / 'shots.ts').write_text('\n'.join(lines), encoding='utf-8')
    print('✓ site/lib/shots.ts')


if __name__ == '__main__':
    main()
