#!/usr/bin/env python3
"""Rasterize the KINVO launcher from resources/kinvo-app-icon.png.

Legacy and web icons use the full artwork. Adaptive foreground keeps that
artwork inside the 66dp safe circle (a square inscribed in the circle, with
a little inset) on a transparent canvas. The adaptive background is a flat
deep blue sampled from the tile, so circle and squircle masks do not clip
the family or the KINVO word. Notification and monochrome icons stay white
silhouettes; Android tints those.
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "resources" / "kinvo-app-icon.png"
# Android adaptive safe circle is 66dp inside the 108dp layer.
SAFE_DIAMETER = 66 / 108
# Keep the square a hair inside that circle so mask antialiasing does not eat the wordmark.
SAFE_INSET = 0.96
BACKGROUND = (0x01, 0x49, 0xD3)  # #0149D3, the tile's deep blue


def punch_white_corners(tile: Image.Image, background: tuple[int, int, int]) -> Image.Image:
    """The source rounded square is padded with near-white corners. Fill those with the tile blue."""
    image = tile.convert("RGBA")
    pixels = image.load()
    width, height = image.size
    for y in range(height):
        for x in range(width):
            red, green, blue, _alpha = pixels[x, y]
            if red >= 248 and green >= 248 and blue >= 248:
                pixels[x, y] = (*background, 255)
    return image


def cover(size: int, tile: Image.Image) -> Image.Image:
    return tile.resize((size, size), Image.Resampling.LANCZOS)


def circle_mask(size: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    from PIL import ImageDraw
    ImageDraw.Draw(mask).ellipse((0, 0, size - 1, size - 1), fill=255)
    return mask


def adaptive_foreground(size: int, tile: Image.Image) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    side = max(1, int(round(size * SAFE_DIAMETER / math.sqrt(2) * SAFE_INSET)))
    icon = tile.resize((side, side), Image.Resampling.LANCZOS)
    canvas.paste(icon, ((size - side) // 2, (size - side) // 2), icon)
    return canvas


def on_background(size: int, tile: Image.Image, fraction: float) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (*BACKGROUND, 255))
    side = max(1, int(round(size * fraction)))
    icon = tile.resize((side, side), Image.Resampling.LANCZOS)
    canvas.paste(icon, ((size - side) // 2, (size - side) // 2), icon)
    return canvas


def splash(width: int, height: int, tile: Image.Image) -> Image.Image:
    canvas = Image.new("RGB", (width, height), BACKGROUND)
    side = max(1, int(round(min(width, height) * 0.62)))
    icon = tile.resize((side, side), Image.Resampling.LANCZOS).convert("RGB")
    canvas.paste(icon, ((width - side) // 2, (height - side) // 2))
    return canvas


def write_background() -> None:
    drawable = ROOT / "android" / "app" / "src" / "main" / "res" / "drawable" / "ic_launcher_background.xml"
    drawable.write_text(
        """<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path
        android:fillColor="#FF0149D3"
        android:pathData="M0,0h108v108h-108z" />
</vector>
""",
        encoding="utf-8",
    )
    values = ROOT / "android" / "app" / "src" / "main" / "res" / "values" / "ic_launcher_background.xml"
    values.write_text(
        """<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#0149D3</color>
</resources>
""",
        encoding="utf-8",
    )
    foreground = ROOT / "android" / "app" / "src" / "main" / "res" / "drawable" / "ic_launcher_foreground.xml"
    foreground.write_text(
        """<?xml version="1.0" encoding="utf-8"?>
<bitmap xmlns:android="http://schemas.android.com/apk/res/android"
    android:gravity="fill"
    android:src="@mipmap/ic_launcher_foreground" />
""",
        encoding="utf-8",
    )
    adaptive = """<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
    <monochrome android:drawable="@drawable/ic_launcher_monochrome"/>
</adaptive-icon>
"""
    anydpi = ROOT / "android" / "app" / "src" / "main" / "res" / "mipmap-anydpi-v26"
    (anydpi / "ic_launcher.xml").write_text(adaptive, encoding="utf-8")
    (anydpi / "ic_launcher_round.xml").write_text(adaptive, encoding="utf-8")


def save_ios(tile: Image.Image) -> None:
    catalog = ROOT / "resources" / "ios" / "AppIcon.appiconset"
    specs = [
        (20, 2, "iphone"),
        (20, 3, "iphone"),
        (29, 2, "iphone"),
        (29, 3, "iphone"),
        (40, 2, "iphone"),
        (40, 3, "iphone"),
        (60, 2, "iphone"),
        (60, 3, "iphone"),
        (20, 1, "ipad"),
        (20, 2, "ipad"),
        (29, 1, "ipad"),
        (29, 2, "ipad"),
        (40, 1, "ipad"),
        (40, 2, "ipad"),
        (76, 1, "ipad"),
        (76, 2, "ipad"),
        (83.5, 2, "ipad"),
        (1024, 1, "ios-marketing"),
    ]
    import json
    images = []
    for pt, scale, idiom in specs:
        px = int(round(pt * scale))
        filename = "icon-1024.png" if idiom == "ios-marketing" else f"icon-{pt:g}@{scale}x.png"
        cover(px, tile).convert("RGB").save(catalog / filename, optimize=True)
        images.append({"filename": filename, "idiom": idiom, "scale": f"{scale}x", "size": f"{pt:g}x{pt:g}"})
    (catalog / "Contents.json").write_text(
        json.dumps({"images": images, "info": {"author": "xcode", "version": 1}}, indent=2) + "\n",
        encoding="utf-8",
    )
    splash_dir = ROOT / "resources" / "ios" / "Splash.imageset"
    base = splash(1366, 1366, tile)
    for name, size in (("splash-1x.png", 512), ("splash-2x.png", 1024), ("splash-3x.png", 1536)):
        base.resize((size, size), Image.Resampling.LANCZOS).save(splash_dir / name, optimize=True)


def emit() -> None:
    if not SOURCE.is_file():
        raise SystemExit(f"missing {SOURCE}")
    tile = punch_white_corners(Image.open(SOURCE), BACKGROUND)
    resources = ROOT / "resources"
    tile.save(resources / "icon-master.png", optimize=True)
    tile.save(resources / "icon.png", optimize=True)
    tile.save(resources / "icon-rounded.png", optimize=True)
    adaptive_foreground(1024, tile).save(resources / "icon-foreground.png", optimize=True)
    splash(2732, 2732, tile).save(resources / "splash.png", optimize=True)
    cover(512, tile).convert("RGB").save(resources / "play-icon.png", optimize=True)

    public = ROOT / "public"
    cover(512, tile).save(public / "umap-icon.png", optimize=True)
    cover(192, tile).save(public / "umap-icon-192.png", optimize=True)
    cover(32, tile).save(public / "favicon.png", optimize=True)
    cover(180, tile).convert("RGB").save(public / "apple-touch-icon.png", optimize=True)
    cover(512, tile).convert("RGB").save(public / "umap-icon-512.png", optimize=True)
    on_background(192, tile, 0.80).convert("RGB").save(public / "umap-icon-192-maskable.png", optimize=True)
    on_background(512, tile, 0.80).convert("RGB").save(public / "umap-icon-512-maskable.png", optimize=True)

    res = ROOT / "android" / "app" / "src" / "main" / "res"
    legacy = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
    foreground_sizes = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}
    for density, size in legacy.items():
        folder = res / f"mipmap-{density}"
        folder.mkdir(parents=True, exist_ok=True)
        cover(size, tile).convert("RGB").save(folder / "ic_launcher.png", optimize=True)
        round_icon = cover(size, tile)
        round_icon.putalpha(circle_mask(size))
        round_icon.save(folder / "ic_launcher_round.png", optimize=True)
    for density, size in foreground_sizes.items():
        folder = res / f"mipmap-{density}"
        adaptive_foreground(size, tile).save(folder / "ic_launcher_foreground.png", optimize=True)

    for relative, (width, height) in {
        "drawable/splash.png": (480, 320),
        "drawable-land-mdpi/splash.png": (480, 320),
        "drawable-land-hdpi/splash.png": (800, 480),
        "drawable-land-xhdpi/splash.png": (1280, 720),
        "drawable-land-xxhdpi/splash.png": (1600, 960),
        "drawable-land-xxxhdpi/splash.png": (1920, 1280),
        "drawable-port-mdpi/splash.png": (320, 480),
        "drawable-port-hdpi/splash.png": (480, 800),
        "drawable-port-xhdpi/splash.png": (720, 1280),
        "drawable-port-xxhdpi/splash.png": (960, 1600),
        "drawable-port-xxxhdpi/splash.png": (1280, 1920),
    }.items():
        target = res / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        splash(width, height, tile).save(target, optimize=True)

    write_background()
    save_ios(tile)
    manifest = public / "manifest.json"
    if manifest.is_file():
        import json
        data = json.loads(manifest.read_text(encoding="utf-8"))
        data["background_color"] = "#0149D3"
        data["theme_color"] = "#0149D3"
        manifest.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("KINVO icons written. adaptive background #0149D3, foreground inside the 66dp circle")


if __name__ == "__main__":
    emit()
