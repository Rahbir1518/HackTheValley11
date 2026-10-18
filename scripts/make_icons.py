r"""Export every Ordis icon size from logo.png (black line art on transparent).

    backend\.venv\Scripts\python scripts\make_icons.py .
"""
import sys
from pathlib import Path

from PIL import Image, ImageFilter

REPO = Path(sys.argv[1])
INK = (0x20, 0x23, 0x22)
PAPER = (0xFA, 0xFA, 0xF8)
WHITE = (255, 255, 255)
MARK_ROWS = (0, 910)        # cube only (wordmark starts at row 951)

src = Image.open(REPO / "logo.png").convert("RGBA")
# Drop the near-invisible haze around the art (alpha < 24) so it neither shows nor skews the crop.
alpha = src.getchannel("A").point(lambda v: 0 if v < 24 else v)


def crop(a: Image.Image) -> Image.Image:
    return a.crop(a.point(lambda v: 255 if v > 96 else 0).getbbox())


mark_a = crop(alpha.crop((0, MARK_ROWS[0], src.width, MARK_ROWS[1])))
full_a = crop(alpha)


def thicken(a: Image.Image, px: int) -> Image.Image:
    """Grow strokes by about px pixels (odd max-filter), so lines survive small sizes."""
    return a.filter(ImageFilter.MaxFilter(px | 1)) if px > 1 else a


def tinted(a: Image.Image, rgb) -> Image.Image:
    out = Image.new("RGBA", a.size, rgb + (0,))
    out.putalpha(a)
    return out


def place(a: Image.Image, size, frac: float, fg, bg=None) -> Image.Image:
    """Logo (alpha mask a) coloured fg, fitted to frac of the canvas, centred."""
    w, h = size
    s = min(w * frac / a.width, h * frac / a.height)
    m = a.resize((round(a.width * s), round(a.height * s)), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", size, (bg or fg) + ((255,) if bg else (0,)))
    canvas.alpha_composite(tinted(m, fg), ((w - m.width) // 2, (h - m.height) // 2))
    return canvas


def save(img: Image.Image, rel: str, opaque=False):
    p = REPO / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    (img.convert("RGB") if opaque else img).save(p, optimize=True)
    print(f"{rel}  {img.width}x{img.height}")


mark_bold = thicken(mark_a, 9)       # ~12px strokes -> ~20px, for app icons
mark_heavy = thicken(mark_a, 23)     # for favicons (16-48 px)

# Mobile (Expo)
save(place(mark_bold, (1024, 1024), 0.62, WHITE, INK), "mobile/assets/icon.png", opaque=True)
save(place(mark_bold, (1024, 1024), 0.50, WHITE), "mobile/assets/android-icon-foreground.png")  # inside 66% safe zone
save(Image.new("RGB", (1024, 1024), INK), "mobile/assets/android-icon-background.png")
save(place(mark_bold, (1024, 1024), 0.50, WHITE), "mobile/assets/android-icon-monochrome.png")
save(place(mark_a, (1024, 1024), 0.80, INK), "mobile/assets/splash-icon.png")
save(place(mark_heavy, (48, 48), 0.86, WHITE, INK).resize((48, 48)), "mobile/assets/favicon.png", opaque=True)

# Website (Next.js file conventions: app/icon.png, app/apple-icon.png, app/favicon.ico)
save(place(mark_bold, (512, 512), 0.66, WHITE, INK), "frontend/src/app/icon.png", opaque=True)
save(place(mark_bold, (180, 180), 0.66, WHITE, INK), "frontend/src/app/apple-icon.png", opaque=True)
ico = place(mark_heavy, (256, 256), 0.80, WHITE, INK)   # keep RGBA: Next's ICO decoder rejects RGB
ico.save(REPO / "frontend/src/app/favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
print("frontend/src/app/favicon.ico  16/32/48")
save(place(full_a, (1200, 630), 0.78, INK, PAPER), "frontend/src/app/opengraph-image.png", opaque=True)
save(tinted(full_a, INK), "frontend/public/brand/ordis-logo.png")
save(tinted(mark_a, INK), "frontend/public/brand/ordis-mark.png")

# Devpost (3:2) and previews for checking small sizes
save(place(full_a, (1500, 1000), 0.70, INK, PAPER), "brand/devpost-thumbnail.png", opaque=True)
save(place(full_a, (2048, 2048), 0.80, WHITE), "brand/ordis-logo-white.png")
save(place(full_a, (2048, 2048), 0.80, INK), "brand/ordis-logo-ink.png")
