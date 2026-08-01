#!/usr/bin/env python3
"""Build Afdelingsfeer Balloons TTF/WOFF2 from the transparent glyph PNGs."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import cv2
import numpy as np
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen


ROOT = Path(__file__).resolve().parent
LETTERS = ROOT / "letters"
OUT = ROOT / "fonts"
UNITS_PER_EM = 1000
ASCENDER = 800
DESCENDER = -200
SOURCE_HEIGHT = 292
SCALE = 900 / SOURCE_HEIGHT


def glyph_name(char: str) -> str:
    return f"uni{ord(char):04X}"


def signed_area(points: list[tuple[int, int]]) -> float:
    return sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(points, points[1:] + points[:1])) / 2


def png_to_glyph(path: Path):
    image = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
    if image is None or image.shape[2] < 4:
        raise ValueError(f"Expected RGBA PNG: {path}")
    mask = np.where(image[:, :, 3] >= 96, 255, 0).astype(np.uint8)
    contours, hierarchy = cv2.findContours(mask, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
    pen = TTGlyphPen(None)
    for index, contour in enumerate(contours):
        epsilon = max(0.75, cv2.arcLength(contour, True) * 0.0015)
        simplified = cv2.approxPolyDP(contour, epsilon, True).reshape(-1, 2)
        if len(simplified) < 3 or abs(cv2.contourArea(simplified)) < 5:
            continue
        points = [(round(x * SCALE), round(ASCENDER - y * SCALE)) for x, y in simplified]
        is_hole = hierarchy[0][index][3] != -1
        # TrueType convention: outer contours clockwise, holes counter-clockwise.
        should_be_positive = is_hole
        if (signed_area(points) > 0) != should_be_positive:
            points.reverse()
        pen.moveTo(points[0])
        for point in points[1:]:
            pen.lineTo(point)
        pen.closePath()
    advance = round(image.shape[1] * SCALE)
    return pen.glyph(), (advance, 0)


def box_glyph():
    pen = TTGlyphPen(None)
    pen.moveTo((80, 0)); pen.lineTo((520, 0)); pen.lineTo((520, 700)); pen.lineTo((80, 700)); pen.closePath()
    pen.moveTo((150, 70)); pen.lineTo((150, 630)); pen.lineTo((450, 630)); pen.lineTo((450, 70)); pen.closePath()
    return pen.glyph()


def main() -> None:
    OUT.mkdir(exist_ok=True)
    data = json.loads((LETTERS / "glyph-map.json").read_text())
    entries = data["glyphs"]
    order = [".notdef", "space"] + [glyph_name(entry["char"]) for entry in entries]
    glyphs = {".notdef": box_glyph(), "space": TTGlyphPen(None).glyph()}
    metrics = {".notdef": (600, 0), "space": (320, 0)}
    cmap = {32: "space"}
    for entry in entries:
        char = entry["char"]
        name = glyph_name(char)
        glyphs[name], metrics[name] = png_to_glyph(LETTERS / entry["file"])
        cmap[ord(char)] = name

    builder = FontBuilder(UNITS_PER_EM, isTTF=True)
    builder.setupGlyphOrder(order)
    builder.setupCharacterMap(cmap)
    builder.setupGlyf(glyphs)
    builder.setupHorizontalMetrics(metrics)
    builder.setupHorizontalHeader(ascent=ASCENDER, descent=DESCENDER)
    builder.setupNameTable({
        "familyName": "Afdelingsfeer Balloons",
        "styleName": "Regular",
        "uniqueFontIdentifier": "Afdelingsfeer Balloons Regular 1.0",
        "fullName": "Afdelingsfeer Balloons Regular",
        "psName": "AfdelingsfeerBalloons-Regular",
        "version": "Version 1.0",
    })
    builder.setupOS2(
        sTypoAscender=ASCENDER, sTypoDescender=DESCENDER,
        usWinAscent=900, usWinDescent=200,
    )
    builder.setupPost()
    builder.setupMaxp()

    ttf = OUT / "afdelingsfeer-balloons.ttf"
    woff2 = OUT / "afdelingsfeer-balloons.woff2"
    builder.font.save(ttf)
    builder.font.flavor = "woff2"
    builder.font.save(woff2)
    print(f"Built {ttf} and {woff2} with {len(entries)} glyphs")


if __name__ == "__main__":
    main()
