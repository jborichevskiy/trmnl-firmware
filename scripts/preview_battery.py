#!/usr/bin/env python3
"""
Preview the low-battery indicator overlay on an 800x480 BMP image.

Usage:
    python scripts/preview_battery.py --voltage 3.4
    python scripts/preview_battery.py --voltage 3.0 --input test.bmp
"""

import argparse
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError:
    print("Pillow is required: pip install Pillow")
    raise SystemExit(1)

LOW_BATTERY_WARNING = 3.5
LOW_BATTERY_CRITICAL = 3.3
FULL_VOLTAGE = 4.2

def draw_battery_indicator(draw: ImageDraw.ImageDraw, width: int, height: int, voltage: float):
    """Draw a battery indicator icon in the bottom-right corner, matching firmware logic."""
    batt_w = 30
    batt_h = 16
    nub_w = 3
    nub_h = 8
    margin = 30

    bx = width - batt_w - nub_w - margin
    by = height - batt_h - margin

    # Clear background
    draw.rectangle([bx - 2, by - 2, bx + batt_w + nub_w + 2, by + batt_h + 2], fill="white")

    # Battery outline
    draw.rectangle([bx, by, bx + batt_w - 1, by + batt_h - 1], outline="black", width=1)

    # Terminal nub
    nub_y = by + (batt_h - nub_h) // 2
    draw.rectangle([bx + batt_w, nub_y, bx + batt_w + nub_w - 1, nub_y + nub_h - 1], fill="black")

    # Fill level
    fill_pct = (voltage - LOW_BATTERY_CRITICAL) / (FULL_VOLTAGE - LOW_BATTERY_CRITICAL)
    fill_pct = max(0.0, min(1.0, fill_pct))

    inner_w = batt_w - 4
    inner_h = batt_h - 4
    fill_w = int(inner_w * fill_pct)

    if fill_w > 0:
        draw.rectangle([bx + 2, by + 2, bx + 2 + fill_w - 1, by + 2 + inner_h - 1], fill="black")

    # Critical "!" indicator
    if voltage < LOW_BATTERY_CRITICAL:
        cx = bx + batt_w // 2
        cy = by + batt_h // 2
        # Vertical bar
        for dy in range(-4, 1):
            draw.point((cx, cy + dy), fill="white")
        # Dot
        draw.point((cx, cy + 2), fill="white")


def main():
    parser = argparse.ArgumentParser(description="Preview low-battery indicator overlay")
    parser.add_argument("--voltage", type=float, default=3.4, help="Simulated battery voltage (default: 3.4)")
    parser.add_argument("--input", type=str, default=None, help="Input BMP file (default: test.bmp in repo root)")
    parser.add_argument("--output", type=str, default="preview_battery.png", help="Output file (default: preview_battery.png)")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parent.parent
    input_path = Path(args.input) if args.input else repo_root / "test.bmp"

    if not input_path.exists():
        print(f"Input file not found: {input_path}")
        raise SystemExit(1)

    img = Image.open(input_path).convert("L")  # grayscale
    print(f"Loaded {input_path} ({img.width}x{img.height})")

    draw = ImageDraw.Draw(img)

    if args.voltage < LOW_BATTERY_WARNING:
        draw_battery_indicator(draw, img.width, img.height, args.voltage)
        print(f"Drew battery indicator for {args.voltage:.2f}V (warning={LOW_BATTERY_WARNING}, critical={LOW_BATTERY_CRITICAL})")
    else:
        print(f"Voltage {args.voltage:.2f}V is above warning threshold ({LOW_BATTERY_WARNING}V), no indicator drawn")

    output_path = repo_root / args.output
    img.save(output_path)
    print(f"Saved to {output_path}")


if __name__ == "__main__":
    main()
