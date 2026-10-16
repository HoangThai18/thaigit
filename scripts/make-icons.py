#!/usr/bin/env python3
"""Tạo bộ icon Gitlane từ logo gốc brand/gitlane-logo-source.png (xuất từ brand/gitlane-logo-source.svg ở 1024 px,
nền trong suốt — vd. mở SVG bằng Chrome rồi chụp, hoặc `rsvg-convert -w 1024`).

    python3 scripts/make-icons.py

Kết quả:
  brand/gitlane-icon-macos.png    1024×1024, nền trong suốt, theo lưới icon macOS (khối 824 px + bóng đổ)
  brand/gitlane-icon-square.png   1024×1024, nền trong suốt, khối gần kín khung (cho Windows / `tauri icon`)
  apps/desktop/src-tauri/icons/   `tauri icon` từ bản vuông, rồi icon.icns dựng lại từ bản theo lưới macOS
  site/public/                    icon.png, apple-icon.png, logo-256.png, logo-96.png
  apps/desktop/src/lib/assets/logo.png   logo trong app (trang chủ, Có gì mới)

Cần Pillow (`pip3 install pillow`), `iconutil` (có sẵn trên macOS) và pnpm (cho `tauri icon`).
"""
import os
import shutil
import subprocess
import tempfile

from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, "brand", "gitlane-logo-source.png")
ICONS = os.path.join(ROOT, "apps", "desktop", "src-tauri", "icons")
PUBLIC = os.path.join(ROOT, "site", "public")


def place(slab: Image.Image, target_width: int, shadow: bool) -> Image.Image:
    canvas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    scale = target_width / slab.width
    resized = slab.resize((target_width, round(slab.height * scale)), Image.LANCZOS)
    x = (1024 - resized.width) // 2
    y = (1024 - resized.height) // 2
    if shadow:
        shade = Image.new("RGBA", resized.size, (0, 0, 0, 0))
        shade.putalpha(resized.getchannel("A").point(lambda v: v * 70 // 255))
        layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
        layer.paste(shade, (x, y + 12), shade)
        canvas = Image.alpha_composite(canvas, layer.filter(ImageFilter.GaussianBlur(14)))
    canvas.alpha_composite(resized, (x, y))
    return canvas


def build_icns(icon: Image.Image, destination: str) -> None:
    workdir = tempfile.mkdtemp()
    iconset = os.path.join(workdir, "AppIcon.iconset")
    os.makedirs(iconset)
    for size in (16, 32, 128, 256, 512):
        icon.resize((size, size), Image.LANCZOS).save(os.path.join(iconset, f"icon_{size}x{size}.png"))
        icon.resize((size * 2, size * 2), Image.LANCZOS).save(os.path.join(iconset, f"icon_{size}x{size}@2x.png"))
    subprocess.run(["iconutil", "-c", "icns", iconset, "-o", destination], check=True)
    shutil.rmtree(workdir)


def main() -> None:
    source = Image.open(SOURCE).convert("RGBA")
    slab = source.crop(source.getchannel("A").getbbox())
    macos = place(slab, 824, shadow=True)
    square = place(slab, 984, shadow=False)
    macos_path = os.path.join(ROOT, "brand", "gitlane-icon-macos.png")
    square_path = os.path.join(ROOT, "brand", "gitlane-icon-square.png")
    macos.save(macos_path)
    square.save(square_path)

    subprocess.run(
        ["pnpm", "--filter", "@thaigit/desktop", "exec", "tauri", "icon", square_path, "-o", ICONS],
        check=True,
        cwd=ROOT,
    )
    for extra in ("android", "ios"):
        shutil.rmtree(os.path.join(ICONS, extra), ignore_errors=True)
    build_icns(macos, os.path.join(ICONS, "icon.icns"))

    macos.resize((512, 512), Image.LANCZOS).save(os.path.join(PUBLIC, "icon.png"))
    flat = Image.new("RGBA", slab.size, (255, 255, 255, 255))
    flat.alpha_composite(slab)
    flat.convert("RGB").resize((180, 180), Image.LANCZOS).save(os.path.join(PUBLIC, "apple-icon.png"))
    square.resize((256, 256), Image.LANCZOS).save(os.path.join(PUBLIC, "logo-256.png"))
    square.resize((96, 96), Image.LANCZOS).save(os.path.join(PUBLIC, "logo-96.png"))
    square.resize((256, 256), Image.LANCZOS).save(os.path.join(ROOT, "apps", "desktop", "src", "lib", "assets", "logo.png"))
    print("✓ brand/gitlane-icon-*.png, apps/desktop/src-tauri/icons/*, site/public/*.png, apps/desktop/src/lib/assets/logo.png")


if __name__ == "__main__":
    main()
