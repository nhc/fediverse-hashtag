#!/usr/bin/env python3
"""Render one caption to a transparent PNG for the stitch pipeline.

Usage: render-caption.py OUTFILE TEXT
A | in TEXT becomes a line break. Style: white text on a black box at 55%
opacity, sized for a 1920x1080 frame; the shell script centres it near the
bottom of the picture.
"""
import sys
from PIL import Image, ImageDraw, ImageFont

out, text = sys.argv[1], sys.argv[2].replace("|", "\n")
try:
    font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 28)
except OSError:
    font = ImageFont.load_default(size=28)

pad, spacing = 14, 8
probe = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
box = probe.multiline_textbbox((0, 0), text, font=font, spacing=spacing, align="center")
w = int(round(box[2] - box[0])) + 2 * pad
h = int(round(box[3] - box[1])) + 2 * pad
img = Image.new("RGBA", (w, h), (0, 0, 0, 140))
ImageDraw.Draw(img).multiline_text(
    (pad - int(box[0]), pad - int(box[1])), text,
    font=font, fill=(255, 255, 255, 255), spacing=spacing, align="center",
)
img.save(out)
