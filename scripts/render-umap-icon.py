#!/usr/bin/env python3
"""Build Kinnex launcher, splash, and favicon sizes from the vector pin.

The mark is a blue gradient tile (navy top-left to cyan bottom-right) and a
white location pin with a punched ring and white center dot. Geometry is
written as SVG and Android vector drawables, then rasterized so densities
stay sharp. Pass a padded source JPEG to crop a reference tile and sample
the gradient; the pin itself is never upscaled from that JPEG.
"""

from __future__ import annotations

import json
import math
import sys
from collections import deque
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
MASTER = ROOT / "resources" / "icon-master.png"
SAFE_DIAMETER = 66 / 108
# Composed-icon pin, as fractions of the square tile (measured from the source).
PIN_CX = 0.498
PIN_HEAD_CY = 0.370
PIN_HEAD_R = 0.266
PIN_TIP_Y = 0.837
HOLE_R = 0.1675
DOT_R = 0.0755
CORNER = 0.2237
GRADIENT_START = (0x02, 0x32, 0x72)
GRADIENT_END = (0x30, 0xDD, 0xFF)
GRADIENT_START_HEX = "#023272"
GRADIENT_END_HEX = "#30DDFF"
SUPERSAMPLE = 4


def hex_of(rgb: tuple[int, int, int]) -> str:
    return f"#{rgb[0]:02X}{rgb[1]:02X}{rgb[2]:02X}"


def is_wall(r: int, g: int, b: int) -> bool:
    sat = max(r, g, b) - min(r, g, b)
    if r > 248 and g > 248 and b > 248:
        return False
    if sat <= 12 and abs(r - g) <= 8 and abs(g - b) <= 8:
        return False
    return sat >= 18


def extract_square_icon(source: Image.Image) -> Image.Image:
    """Crop the rounded tile out of the padded source and return a square RGBA."""
    rgb = source.convert("RGB")
    width, height = rgb.size
    pix = rgb.load()
    wall = Image.new("L", (width, height), 0)
    wall_px = wall.load()
    for y in range(height):
        for x in range(width):
            if is_wall(*pix[x, y]):
                wall_px[x, y] = 255
    wall = wall.filter(ImageFilter.MaxFilter(3))
    wall_px = wall.load()

    reached = bytearray(width * height)
    queue: deque[tuple[int, int]] = deque()
    for x in range(width):
        queue.append((x, 0))
        queue.append((x, height - 1))
    for y in range(height):
        queue.append((0, y))
        queue.append((width - 1, y))
    while queue:
        x, y = queue.popleft()
        index = y * width + x
        if reached[index] or wall_px[x, y]:
            continue
        reached[index] = 1
        if x + 1 < width:
            queue.append((x + 1, y))
        if x > 0:
            queue.append((x - 1, y))
        if y + 1 < height:
            queue.append((x, y + 1))
        if y > 0:
            queue.append((x, y - 1))

    inside = Image.new("L", (width, height), 0)
    inside_px = inside.load()
    for y in range(height):
        row = y * width
        for x in range(width):
            if not reached[row + x]:
                inside_px[x, y] = 255
    inside = inside.filter(ImageFilter.MinFilter(5))
    bbox = inside.getbbox()
    if bbox is None:
        raise SystemExit("icon artwork was not found in the source image")
    mask = inside.crop(bbox)
    tile = rgb.crop(bbox)
    side = min(mask.size)
    left = (mask.size[0] - side) // 2
    top = (mask.size[1] - side) // 2
    box = (left, top, left + side, top + side)
    rgba = tile.crop(box).convert("RGBA")
    rgba.putalpha(mask.crop(box))
    return rgba


def sample_gradient(tile: Image.Image) -> tuple[tuple[int, int, int], tuple[int, int, int]]:
    rgba = tile.convert("RGBA")
    width, height = rgba.size
    pix = rgba.load()

    def at(fx: float, fy: float) -> tuple[int, int, int]:
        red, green, blue, alpha = pix[int(fx * (width - 1)), int(fy * (height - 1))]
        if alpha < 200:
            return GRADIENT_START if fy < 0.5 else GRADIENT_END
        return (red, green, blue)

    return at(0.08, 0.08), at(0.92, 0.92)


def lerp(start: tuple[int, int, int], end: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    t = min(1.0, max(0.0, t))
    return (
        int(start[0] + (end[0] - start[0]) * t),
        int(start[1] + (end[1] - start[1]) * t),
        int(start[2] + (end[2] - start[2]) * t),
    )


def diagonal_gradient(size: int, start: tuple[int, int, int], end: tuple[int, int, int]) -> Image.Image:
    sample = min(size, 512)
    span = 2 * (sample - 1) if sample > 1 else 1
    buf = bytearray(sample * sample * 3)
    for y in range(sample):
        row = y * sample * 3
        for x in range(sample):
            t = (x + y) / span
            i = row + x * 3
            buf[i] = int(start[0] + (end[0] - start[0]) * t)
            buf[i + 1] = int(start[1] + (end[1] - start[1]) * t)
            buf[i + 2] = int(start[2] + (end[2] - start[2]) * t)
    image = Image.frombytes("RGB", (sample, sample), bytes(buf))
    if sample == size:
        return image
    return image.resize((size, size), Image.Resampling.BILINEAR)


def tangent_points(
    cx: float, cy: float, radius: float, tip_x: float, tip_y: float
) -> tuple[tuple[float, float], tuple[float, float]]:
    dx = tip_x - cx
    dy = tip_y - cy
    dist = math.hypot(dx, dy)
    if dist <= radius:
        raise SystemExit("pin tip is inside the head circle")
    theta = math.acos(radius / dist)
    ang = math.atan2(dy, dx)
    left = (cx + radius * math.cos(ang + theta), cy + radius * math.sin(ang + theta))
    right = (cx + radius * math.cos(ang - theta), cy + radius * math.sin(ang - theta))
    return left, right


def teardrop_points(cx: float, cy: float, radius: float, tip_x: float, tip_y: float, steps: int = 96) -> list[tuple[float, float]]:
    left, right = tangent_points(cx, cy, radius, tip_x, tip_y)
    left_ang = math.atan2(left[1] - cy, left[0] - cx)
    right_ang = math.atan2(right[1] - cy, right[0] - cx)
    # Walk the long way around the head (away from the tip).
    sweep = right_ang - left_ang
    while sweep <= 0:
        sweep += 2 * math.pi
    if sweep < math.pi:
        sweep -= 2 * math.pi
    points = []
    for i in range(steps + 1):
        ang = left_ang + sweep * (i / steps)
        points.append((cx + radius * math.cos(ang), cy + radius * math.sin(ang)))
    points.append((tip_x, tip_y))
    return points


def circle_path(cx: float, cy: float, radius: float) -> str:
    return (
        f"M{cx - radius:.3f},{cy:.3f}"
        f"a{radius:.3f},{radius:.3f} 0 1,0 {radius * 2:.3f},0"
        f"a{radius:.3f},{radius:.3f} 0 1,0 {-radius * 2:.3f},0"
    )


def teardrop_path(cx: float, cy: float, radius: float, tip_x: float, tip_y: float) -> str:
    left, right = tangent_points(cx, cy, radius, tip_x, tip_y)
    # Large arc from left tangent via the top to the right tangent, then the tip.
    return (
        f"M{left[0]:.3f},{left[1]:.3f}"
        f"A{radius:.3f},{radius:.3f} 0 1,0 {right[0]:.3f},{right[1]:.3f}"
        f"L{tip_x:.3f},{tip_y:.3f}Z"
    )


class PinGeom:
    def __init__(self, cx: float, head_cy: float, head_r: float, tip_y: float, hole_r: float, dot_r: float):
        self.cx = cx
        self.head_cy = head_cy
        self.head_r = head_r
        self.tip_y = tip_y
        self.hole_r = hole_r
        self.dot_r = dot_r

    @property
    def tip(self) -> tuple[float, float]:
        return (self.cx, self.tip_y)

    def teardrop(self) -> str:
        return teardrop_path(self.cx, self.head_cy, self.head_r, self.cx, self.tip_y)

    def hole(self) -> str:
        return circle_path(self.cx, self.head_cy, self.hole_r)

    def dot(self) -> str:
        return circle_path(self.cx, self.head_cy, self.dot_r)

    def evenodd(self) -> str:
        return f"{self.teardrop()}{self.hole()}"


def composed_pin(size: float) -> PinGeom:
    return PinGeom(
        cx=PIN_CX * size,
        head_cy=PIN_HEAD_CY * size,
        head_r=PIN_HEAD_R * size,
        tip_y=PIN_TIP_Y * size,
        hole_r=HOLE_R * size,
        dot_r=DOT_R * size,
    )


def fitted_pin(size: float, height: float) -> PinGeom:
    """Scale the composed pin so its height equals `height`, then center it."""
    unit_h = PIN_TIP_Y - (PIN_HEAD_CY - PIN_HEAD_R)
    scale = height / unit_h
    bbox_mid = ((PIN_HEAD_CY - PIN_HEAD_R) + PIN_TIP_Y) / 2
    return PinGeom(
        cx=size / 2,
        head_cy=size / 2 + (PIN_HEAD_CY - bbox_mid) * scale,
        head_r=PIN_HEAD_R * scale,
        tip_y=size / 2 + (PIN_TIP_Y - bbox_mid) * scale,
        hole_r=HOLE_R * scale,
        dot_r=DOT_R * scale,
    )


def adaptive_pin(size: float) -> PinGeom:
    # Keep a few dp inside the 66dp circle so circle and squircle masks clear the tip.
    return fitted_pin(size, size * (SAFE_DIAMETER - 0.04))


def notify_pin(size: float) -> PinGeom:
    return fitted_pin(size, size * 0.78)


def rounded_mask(size: int, radius_frac: float = CORNER) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=size * radius_frac, fill=255)
    return mask


def circle_mask(size: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size - 1, size - 1), fill=255)
    return mask


def paint_pin(draw: ImageDraw.ImageDraw, pin: PinGeom, fill: int | tuple[int, int, int, int], hole: int | tuple[int, int, int, int] | None, dot: int | tuple[int, int, int, int] | None) -> None:
    points = [(round(x), round(y)) for x, y in teardrop_points(pin.cx, pin.head_cy, pin.head_r, pin.cx, pin.tip_y)]
    draw.polygon(points, fill=fill)
    if hole is not None:
        r = pin.hole_r
        box = (pin.cx - r, pin.head_cy - r, pin.cx + r, pin.head_cy + r)
        draw.ellipse(box, fill=hole)
    if dot is not None:
        r = pin.dot_r
        box = (pin.cx - r, pin.head_cy - r, pin.cx + r, pin.head_cy + r)
        draw.ellipse(box, fill=dot)


def pin_layer(size: int, pin: PinGeom, with_ring: bool, shadow: bool = False) -> Image.Image:
    scale = SUPERSAMPLE if size * SUPERSAMPLE <= 2048 else max(1, 2048 // max(1, size))
    big = size * scale
    factor = big / size
    geom = PinGeom(pin.cx * factor, pin.head_cy * factor, pin.head_r * factor, pin.tip_y * factor, pin.hole_r * factor, pin.dot_r * factor)
    canvas = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    if shadow:
        shade = Image.new("L", (big, big), 0)
        paint_pin(ImageDraw.Draw(shade), geom, 210, 0, 210)
        shade = shade.filter(ImageFilter.GaussianBlur(radius=max(4, big * 0.018)))
        offset = Image.new("L", (big, big), 0)
        offset.paste(shade, (0, int(big * 0.018)))
        shadow_rgba = Image.new("RGBA", (big, big), (0, 20, 50, 0))
        shadow_rgba.putalpha(offset)
        canvas.alpha_composite(shadow_rgba)
    mask = Image.new("L", (big, big), 0)
    if with_ring:
        paint_pin(ImageDraw.Draw(mask), geom, 255, 0, 255)
    else:
        paint_pin(ImageDraw.Draw(mask), geom, 255, None, None)
    glyph = Image.new("RGBA", (big, big), (255, 255, 255, 0))
    glyph.putalpha(mask)
    canvas.alpha_composite(glyph)
    return canvas.resize((size, size), Image.Resampling.LANCZOS)


def compose_icon(size: int, start: tuple[int, int, int], end: tuple[int, int, int], rounded: bool, pin: PinGeom | None = None, with_ring: bool = True, shadow: bool = True) -> Image.Image:
    bg = diagonal_gradient(size, start, end).convert("RGBA")
    layer = pin_layer(size, pin or composed_pin(size), with_ring=with_ring, shadow=shadow)
    bg.alpha_composite(layer)
    if rounded:
        bg.putalpha(rounded_mask(size))
    return bg


def splash(width: int, height: int, start: tuple[int, int, int], end: tuple[int, int, int]) -> Image.Image:
    side = max(width, height)
    bg = diagonal_gradient(side, start, end)
    left = (side - width) // 2
    top = (side - height) // 2
    canvas = bg.crop((left, top, left + width, top + height)).convert("RGBA")
    pin_box = min(1024, max(64, int(min(width, height) * 0.55)))
    layer = pin_layer(pin_box, fitted_pin(pin_box, pin_box * 0.78), with_ring=True, shadow=False)
    canvas.alpha_composite(layer, ((width - pin_box) // 2, (height - pin_box) // 2))
    return canvas.convert("RGB")


def write_svg(start: tuple[int, int, int], end: tuple[int, int, int]) -> None:
    resources = ROOT / "resources"
    resources.mkdir(parents=True, exist_ok=True)
    pin = composed_pin(1024)
    radius = 1024 * CORNER
    start_hex = hex_of(start)
    end_hex = hex_of(end)
    icon = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" role="img" aria-label="Kinnex">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="{start_hex}"/>
      <stop offset="1" stop-color="{end_hex}"/>
    </linearGradient>
    <clipPath id="tile">
      <rect width="1024" height="1024" rx="{radius:.3f}" ry="{radius:.3f}"/>
    </clipPath>
  </defs>
  <g clip-path="url(#tile)">
    <rect width="1024" height="1024" fill="url(#bg)"/>
    <path fill="#ffffff" fill-rule="evenodd" d="{pin.evenodd()}"/>
    <path fill="#ffffff" d="{pin.dot()}"/>
  </g>
</svg>
"""
    (resources / "icon.svg").write_text(icon, encoding="utf-8")
    adapt = adaptive_pin(108)
    pin_only = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108">
  <path fill="#ffffff" fill-rule="evenodd" d="{adapt.evenodd()}"/>
  <path fill="#ffffff" d="{adapt.dot()}"/>
</svg>
"""
    (resources / "icon-pin.svg").write_text(pin_only, encoding="utf-8")


def android_vector(width: float, height: float, viewport: float, body: str) -> str:
    return f"""<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="{width:g}dp"
    android:height="{height:g}dp"
    android:viewportWidth="{viewport:g}"
    android:viewportHeight="{viewport:g}">
{body}
</vector>
"""


def write_android_vectors(start: tuple[int, int, int], end: tuple[int, int, int]) -> None:
    res = ROOT / "android" / "app" / "src" / "main" / "res"
    drawable = res / "drawable"
    drawable.mkdir(parents=True, exist_ok=True)
    start_hex = hex_of(start)
    end_hex = hex_of(end)
    (drawable / "ic_launcher_background.xml").write_text(
        f"""<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:aapt="http://schemas.android.com/aapt"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path android:pathData="M0,0h108v108h-108z">
        <aapt:attr name="android:fillColor">
            <gradient
                android:type="linear"
                android:startX="0"
                android:startY="0"
                android:endX="108"
                android:endY="108">
                <item android:offset="0" android:color="#FF{start_hex[1:]}"/>
                <item android:offset="1" android:color="#FF{end_hex[1:]}"/>
            </gradient>
        </aapt:attr>
    </path>
</vector>
""",
        encoding="utf-8",
    )
    adapt = adaptive_pin(108)
    (drawable / "ic_launcher_foreground.xml").write_text(
        android_vector(
            108,
            108,
            108,
            f"""    <path
        android:fillColor="#FFFFFFFF"
        android:fillType="evenOdd"
        android:pathData="{adapt.evenodd()}" />
    <path
        android:fillColor="#FFFFFFFF"
        android:pathData="{adapt.dot()}" />
""",
        ),
        encoding="utf-8",
    )
    (drawable / "ic_launcher_monochrome.xml").write_text(
        android_vector(
            108,
            108,
            108,
            f"""    <path
        android:fillColor="#FFFFFFFF"
        android:pathData="{adapt.teardrop()}" />
""",
        ),
        encoding="utf-8",
    )
    notify = notify_pin(24)
    (drawable / "ic_stat_notify.xml").write_text(
        android_vector(
            24,
            24,
            24,
            f"""    <path
        android:fillColor="#FFFFFFFF"
        android:pathData="{notify.teardrop()}" />
""",
        ),
        encoding="utf-8",
    )
    values = res / "values"
    values.mkdir(parents=True, exist_ok=True)
    (values / "ic_launcher_background.xml").write_text(
        f"""<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">{start_hex}</color>
</resources>
""",
        encoding="utf-8",
    )
    adaptive = """<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_background"/>
    <foreground android:drawable="@drawable/ic_launcher_foreground"/>
    <monochrome android:drawable="@drawable/ic_launcher_monochrome"/>
</adaptive-icon>
"""
    anydpi = res / "mipmap-anydpi-v26"
    anydpi.mkdir(parents=True, exist_ok=True)
    (anydpi / "ic_launcher.xml").write_text(adaptive, encoding="utf-8")
    (anydpi / "ic_launcher_round.xml").write_text(adaptive, encoding="utf-8")


def save_ios(full: Image.Image, rounded_icon: Image.Image, start: tuple[int, int, int], end: tuple[int, int, int]) -> None:
    catalog = ROOT / "resources" / "ios" / "AppIcon.appiconset"
    catalog.mkdir(parents=True, exist_ok=True)
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
    images = []
    for pt, scale, idiom in specs:
        px = int(round(pt * scale))
        filename = "icon-1024.png" if idiom == "ios-marketing" else f"icon-{pt:g}@{scale}x.png"
        full.resize((px, px), Image.Resampling.LANCZOS).convert("RGB").save(catalog / filename, optimize=True)
        images.append({"filename": filename, "idiom": idiom, "scale": f"{scale}x", "size": f"{pt:g}x{pt:g}"})
    (catalog / "Contents.json").write_text(
        json.dumps({"images": images, "info": {"author": "xcode", "version": 1}}, indent=2) + "\n",
        encoding="utf-8",
    )
    splash_dir = ROOT / "resources" / "ios" / "Splash.imageset"
    splash_dir.mkdir(parents=True, exist_ok=True)
    base = splash(1366, 1366, start, end)
    for name, size in (("splash-1x.png", 512), ("splash-2x.png", 1024), ("splash-3x.png", 1536)):
        base.resize((size, size), Image.Resampling.LANCZOS).save(splash_dir / name, optimize=True)
    (splash_dir / "Contents.json").write_text(
        json.dumps(
            {
                "images": [
                    {"filename": "splash-1x.png", "idiom": "universal", "scale": "1x"},
                    {"filename": "splash-2x.png", "idiom": "universal", "scale": "2x"},
                    {"filename": "splash-3x.png", "idiom": "universal", "scale": "3x"},
                ],
                "info": {"author": "xcode", "version": 1},
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


def emit(start: tuple[int, int, int], end: tuple[int, int, int]) -> None:
    resources = ROOT / "resources"
    resources.mkdir(parents=True, exist_ok=True)
    write_svg(start, end)
    write_android_vectors(start, end)

    master = compose_icon(1024, start, end, rounded=True)
    master.save(MASTER, optimize=True)
    full = compose_icon(1024, start, end, rounded=False)
    rounded_icon = master
    foreground = pin_layer(1024, adaptive_pin(1024), with_ring=True, shadow=False)

    full.save(resources / "icon.png", optimize=True)
    rounded_icon.save(resources / "icon-rounded.png", optimize=True)
    foreground.save(resources / "icon-foreground.png", optimize=True)
    splash(2732, 2732, start, end).save(resources / "splash.png", optimize=True)
    full.resize((512, 512), Image.Resampling.LANCZOS).save(resources / "play-icon.png", optimize=True)

    public = ROOT / "public"
    rounded_icon.resize((512, 512), Image.Resampling.LANCZOS).save(public / "umap-icon.png", optimize=True)
    rounded_icon.resize((192, 192), Image.Resampling.LANCZOS).save(public / "umap-icon-192.png", optimize=True)
    rounded_icon.resize((32, 32), Image.Resampling.LANCZOS).save(public / "favicon.png", optimize=True)
    full.resize((180, 180), Image.Resampling.LANCZOS).convert("RGB").save(public / "apple-touch-icon.png", optimize=True)
    full.resize((512, 512), Image.Resampling.LANCZOS).convert("RGB").save(public / "umap-icon-512.png", optimize=True)
    # Maskable: full-bleed gradient, pin kept inside the 80% safe circle.
    compose_icon(192, start, end, rounded=False).save(public / "umap-icon-192-maskable.png", optimize=True)
    compose_icon(512, start, end, rounded=False).save(public / "umap-icon-512-maskable.png", optimize=True)

    res = ROOT / "android" / "app" / "src" / "main" / "res"
    legacy = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
    foreground_sizes = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}
    for density, size in legacy.items():
        folder = res / f"mipmap-{density}"
        folder.mkdir(parents=True, exist_ok=True)
        tile = compose_icon(size * SUPERSAMPLE, start, end, rounded=False).resize((size, size), Image.Resampling.LANCZOS).convert("RGB")
        tile.save(folder / "ic_launcher.png", optimize=True)
        round_icon = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        round_icon.paste(tile.convert("RGBA"), (0, 0))
        round_icon.putalpha(circle_mask(size))
        round_icon.save(folder / "ic_launcher_round.png", optimize=True)
    for density, size in foreground_sizes.items():
        folder = res / f"mipmap-{density}"
        pin_layer(size, adaptive_pin(size), with_ring=True, shadow=False).save(folder / "ic_launcher_foreground.png", optimize=True)

    splashes = {
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
    }
    for relative, (width, height) in splashes.items():
        target = res / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        splash(width, height, start, end).save(target, optimize=True)

    save_ios(full, rounded_icon, start, end)
    print(f"Kinnex icons written. gradient {hex_of(start)} -> {hex_of(end)}")


def main() -> None:
    import runpy
    print("Launcher art is resources/kinvo-app-icon.png.")
    runpy.run_path(str(Path(__file__).with_name("render-kinvo-icon.py")), run_name="__main__")


if __name__ == "__main__":
    main()
