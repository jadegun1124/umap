#!/usr/bin/env python3
"""Rasterize the KINVO launcher from resources/kinvo-app-icon.png.

Web, splash, and iOS icons keep the framed artwork. Launcher icons do not:
the source's white corners and rounded rim are filled so the blue reaches
the bitmap edge, and the picture is scaled to the launcher's visible face.

AdaptiveIconDrawable draws the 108dp layer at 1.5x and shows the center
72dp. A foreground that only fills the 66dp safe circle therefore sits
inside that face with a flat blue margin — the inner square on a Samsung
squircle. VISIBLE_SCALE 0.92 is the largest scale of this artwork on that
72dp face whose near-white KINVO letters stay inside a circle mask. 1.0
shaves the lower corners of the K and the pin. Notification and monochrome
icons stay white silhouettes; Android tints those.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "resources" / "kinvo-app-icon.png"
# Fraction of the visible launcher face (the center 72dp of the 108dp layer).
# 1.0 fills that face and clips KINVO on a circle. 0.92 keeps the letters in.
VISIBLE_SCALE = 0.92
VIEWPORT = 72 / 108
BACKGROUND = (0x01, 0x49, 0xD3)  # #0149D3, web and splash blue


def punch_white_corners(tile: Image.Image, background: tuple[int, int, int]) -> Image.Image:
    """Fill only the near-white padding connected to the image edge.

    The KINVO letters are also near-white. A full-frame replace turns them into
    the tile blue. Flooding from the border stops at the blue rim around the tile.
    """
    image = tile.convert("RGBA")
    pixels = image.load()
    width, height = image.size

    def is_pad(x: int, y: int) -> bool:
        red, green, blue, _alpha = pixels[x, y]
        return red >= 248 and green >= 248 and blue >= 248

    seen = bytearray(width * height)
    stack: list[tuple[int, int]] = []
    for x in range(width):
        stack.append((x, 0))
        stack.append((x, height - 1))
    for y in range(height):
        stack.append((0, y))
        stack.append((width - 1, y))
    while stack:
        x, y = stack.pop()
        index = y * width + x
        if seen[index] or not is_pad(x, y):
            continue
        seen[index] = 1
        pixels[x, y] = (*background, 255)
        if x + 1 < width:
            stack.append((x + 1, y))
        if x:
            stack.append((x - 1, y))
        if y + 1 < height:
            stack.append((x, y + 1))
        if y:
            stack.append((x, y - 1))
    return image


def cover(size: int, tile: Image.Image) -> Image.Image:
    return tile.resize((size, size), Image.Resampling.LANCZOS)


def circle_mask(size: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size - 1, size - 1), fill=255)
    return mask


def _is_corner_white(red: int, green: int, blue: int) -> bool:
    return min(red, green, blue) >= 230 and max(red, green, blue) - min(red, green, blue) <= 28


def strip_rounded_frame(tile: Image.Image) -> Image.Image:
    """Replace the white corners outside the rounded tile with the neighboring blue.

    The letters are white too. Flooding only from the border, and only through
    near-white pixels, stops at the blue rim and leaves KINVO alone. A blur
    then softens the filled corners so a squarer mask does not show rays.
    """
    image = tile.convert("RGBA")
    pixels = image.load()
    width, height = image.size
    pad = bytearray(width * height)
    stack: list[tuple[int, int]] = []
    for x in range(width):
        stack.append((x, 0))
        stack.append((x, height - 1))
    for y in range(height):
        stack.append((0, y))
        stack.append((width - 1, y))
    while stack:
        x, y = stack.pop()
        index = y * width + x
        red, green, blue, _alpha = pixels[x, y]
        if pad[index] or not _is_corner_white(red, green, blue):
            continue
        pad[index] = 1
        if x + 1 < width:
            stack.append((x + 1, y))
        if x:
            stack.append((x - 1, y))
        if y + 1 < height:
            stack.append((x, y + 1))
        if y:
            stack.append((x, y - 1))

    center_x = (width - 1) / 2
    center_y = (height - 1) / 2
    for y in range(height):
        row = y * width
        for x in range(width):
            if not pad[row + x]:
                continue
            delta_x = center_x - x
            delta_y = center_y - y
            steps = int(max(abs(delta_x), abs(delta_y), 1))
            for step in range(1, steps + 1):
                next_x = int(round(x + delta_x * step / steps))
                next_y = int(round(y + delta_y * step / steps))
                if not 0 <= next_x < width or not 0 <= next_y < height:
                    continue
                if pad[next_y * width + next_x]:
                    continue
                pixels[x, y] = pixels[next_x, next_y]
                break

    blurred = image.filter(ImageFilter.GaussianBlur(radius=14))
    blurred_pixels = blurred.load()
    for y in range(height):
        row = y * width
        for x in range(width):
            if pad[row + x]:
                pixels[x, y] = blurred_pixels[x, y]
    return image


def launcher_edge_color(tile: Image.Image) -> tuple[int, int, int]:
    pixels = tile.convert("RGBA").load()
    width, height = tile.size
    samples = (
        pixels[width // 2, 0],
        pixels[width // 2, height - 1],
        pixels[0, height // 2],
        pixels[width - 1, height // 2],
    )
    return tuple(sum(sample[channel] for sample in samples) // len(samples) for channel in range(3))


def extend_edges(image: Image.Image, size: int) -> Image.Image:
    """Grow a square by repeating its edge pixels so the margin matches the art."""
    image = image.convert("RGBA")
    side = image.size[0]
    if side == size:
        return image
    if side > size:
        return image.resize((size, size), Image.Resampling.LANCZOS)
    left = (size - side) // 2
    top = (size - side) // 2
    right = size - side - left
    bottom = size - side - top
    canvas = Image.new("RGBA", (size, size))
    if top:
        canvas.paste(image.crop((0, 0, side, 1)).resize((side, top), Image.Resampling.NEAREST), (left, 0))
    if bottom:
        canvas.paste(image.crop((0, side - 1, side, side)).resize((side, bottom), Image.Resampling.NEAREST), (left, top + side))
    if left:
        canvas.paste(image.crop((0, 0, 1, side)).resize((left, side), Image.Resampling.NEAREST), (0, top))
    if right:
        canvas.paste(image.crop((side - 1, 0, side, side)).resize((right, side), Image.Resampling.NEAREST), (left + side, top))
    if top and left:
        canvas.paste(Image.new("RGBA", (left, top), image.getpixel((0, 0))), (0, 0))
    if top and right:
        canvas.paste(Image.new("RGBA", (right, top), image.getpixel((side - 1, 0))), (left + side, 0))
    if bottom and left:
        canvas.paste(Image.new("RGBA", (left, bottom), image.getpixel((0, side - 1))), (0, top + side))
    if bottom and right:
        canvas.paste(Image.new("RGBA", (right, bottom), image.getpixel((side - 1, side - 1))), (left + side, top + side))
    canvas.paste(image, (left, top))
    return canvas


def visible_icon(art: Image.Image, size: int) -> Image.Image:
    side = max(1, min(size, int(round(size * VISIBLE_SCALE))))
    resized = art.resize((side, side), Image.Resampling.LANCZOS)
    return extend_edges(resized, size)


def adaptive_foreground(size: int, art: Image.Image) -> Image.Image:
    """Opaque 108dp layer. The center 72dp is the visible face; the rim matches it."""
    visible_side = max(1, int(round(size * VIEWPORT)))
    visible = visible_icon(art, visible_side)
    return extend_edges(visible, size)


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


def write_background(color: tuple[int, int, int]) -> None:
    hex_rgb = f"#{color[0]:02X}{color[1]:02X}{color[2]:02X}"
    hex_argb = f"#FF{color[0]:02X}{color[1]:02X}{color[2]:02X}"
    drawable = ROOT / "android" / "app" / "src" / "main" / "res" / "drawable" / "ic_launcher_background.xml"
    drawable.write_text(
        f"""<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path
        android:fillColor="{hex_argb}"
        android:pathData="M0,0h108v108h-108z" />
</vector>
""",
        encoding="utf-8",
    )
    values = ROOT / "android" / "app" / "src" / "main" / "res" / "values" / "ic_launcher_background.xml"
    values.write_text(
        f"""<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">{hex_rgb}</color>
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
    launcher = strip_rounded_frame(Image.open(SOURCE))
    edge = launcher_edge_color(launcher)
    resources = ROOT / "resources"
    tile.save(resources / "icon-master.png", optimize=True)
    tile.save(resources / "icon.png", optimize=True)
    tile.save(resources / "icon-rounded.png", optimize=True)
    adaptive_foreground(1024, launcher).save(resources / "icon-foreground.png", optimize=True)
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
        visible_icon(launcher, size).convert("RGB").save(folder / "ic_launcher.png", optimize=True)
        round_icon = visible_icon(launcher, size)
        round_icon.putalpha(circle_mask(size))
        round_icon.save(folder / "ic_launcher_round.png", optimize=True)
    for density, size in foreground_sizes.items():
        folder = res / f"mipmap-{density}"
        adaptive_foreground(size, launcher).save(folder / "ic_launcher_foreground.png", optimize=True)

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

    write_background(edge)
    save_ios(tile)
    manifest = public / "manifest.json"
    if manifest.is_file():
        import json
        data = json.loads(manifest.read_text(encoding="utf-8"))
        data["background_color"] = "#0149D3"
        data["theme_color"] = "#0149D3"
        manifest.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"KINVO icons written. launcher scale {VISIBLE_SCALE}, edge #{edge[0]:02X}{edge[1]:02X}{edge[2]:02X}")


if __name__ == "__main__":
    emit()
