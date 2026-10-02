#!/usr/bin/env python3
"""Tạo bộ icon Thaigit từ logo gốc (brand/thaigit-logo-source.png, xuất từ Muse).

    python3 scripts/make-icons.py

Kết quả:
  brand/thaigit-icon-macos.png    1024×1024, nền trong suốt, theo lưới icon macOS (khối 824 px + bóng đổ)
  brand/thaigit-icon-square.png   1024×1024, nền trong suốt, khối gần kín khung (cho Windows / `tauri icon`)
  Resources/AppIcon.icns          icon cho app macOS (Swift)

Cần Pillow (`pip3 install pillow`) và `iconutil` (có sẵn trên macOS).
"""
import os
import shutil
import subprocess
import tempfile

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, "brand", "thaigit-logo-source.png")
WHITE_THRESHOLD = 238  # điểm ảnh có kênh màu nhỏ nhất ≥ ngưỡng này coi là nền trắng
HALO_THRESHOLD = 214   # quầng sáng sát nền (bóng mờ của ảnh gốc) cũng bỏ
SLAB_BOX = (36, 20, 988, 1000)  # khung khối kính trong ảnh gốc 1024 px (đo bằng mắt + profile độ sáng)
SLAB_RADIUS = 196


def rounded_mask(size, box, radius):
    """Mặt nạ bo góc khử răng cưa (vẽ ở 4× rồi thu nhỏ)."""
    scale = 4
    big = Image.new("L", (size[0] * scale, size[1] * scale), 0)
    ImageDraw.Draw(big).rounded_rectangle([v * scale for v in box], radius=radius * scale, fill=255)
    return big.resize(size, Image.LANCZOS)


def cut_out_background(image: Image.Image) -> Image.Image:
    """Bỏ nền trắng quanh khối kính: loang từ mép ảnh qua các điểm gần trắng."""
    rgb = image.convert("RGB")
    whiteness = ImageChops.darker(ImageChops.darker(*rgb.split()[:2]), rgb.split()[2])
    binary = whiteness.point(lambda v: 255 if v >= WHITE_THRESHOLD else 0)
    width, height = binary.size
    for x in range(0, width, 8):
        for y in (0, height - 1):
            if binary.getpixel((x, y)) == 255:
                ImageDraw.floodfill(binary, (x, y), 128)
    for y in range(0, height, 8):
        for x in (0, width - 1):
            if binary.getpixel((x, y)) == 255:
                ImageDraw.floodfill(binary, (x, y), 128)
    # Quầng sáng/bóng mờ quanh khối kính: lấn dần vào các điểm còn khá sáng sát nền (dừng ở viền kính tối hơn).
    background = binary.point(lambda v: 255 if v == 128 else 0)
    halo = whiteness.point(lambda v: 255 if v >= HALO_THRESHOLD else 0)
    for _ in range(10):
        background = ImageChops.darker(background.filter(ImageFilter.MaxFilter(3)), halo)
        background = ImageChops.lighter(background, binary.point(lambda v: 255 if v == 128 else 0))
    alpha = ImageChops.invert(background).filter(ImageFilter.GaussianBlur(1.2))
    # Ảnh gốc để đế khối kính chạm mép dưới → bo lại cạnh dưới bằng mặt nạ bo góc khớp với khối.
    alpha = ImageChops.darker(alpha, rounded_mask(image.size, SLAB_BOX, SLAB_RADIUS))
    result = image.convert("RGBA")
    result.putalpha(alpha)
    return result.crop(alpha.getbbox())


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
    slab = cut_out_background(Image.open(SOURCE))
    macos = place(slab, 824, shadow=True)
    square = place(slab, 984, shadow=False)
    macos.save(os.path.join(ROOT, "brand", "thaigit-icon-macos.png"))
    square.save(os.path.join(ROOT, "brand", "thaigit-icon-square.png"))
    build_icns(macos, os.path.join(ROOT, "Resources", "AppIcon.icns"))
    print("✓ brand/thaigit-icon-macos.png, brand/thaigit-icon-square.png, Resources/AppIcon.icns")


if __name__ == "__main__":
    main()
