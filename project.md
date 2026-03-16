# TRMNL Personal Dashboard

A custom e-ink display dashboard powered by [TRMNL](https://usetrmnl.com/) hardware and a [Val Town](https://val.town) backend.

**Live endpoint:** https://terminal.jon.bo

## How It Works

```
ESP32 Device (TRMNL firmware)
  → GET /api/display → returns JSON with image_url
  → GET /image/display_{timestamp}.bmp → generates 800x480 1-bit BMP on the fly
  → Device downloads BMP and renders on e-ink display
```

The backend fetches live data, renders it into a 1-bit monochrome BMP using a custom bitmap font, and serves it to the device. The display refreshes every 15 minutes.

## Display Layout

```
┌──────────────────────────────────────┐
│                                      │
│   72°F                  (scale 8)    │
│   H 85°F L 62°F        (scale 3)    │
│   ─────────────────────────────      │
│   NORTH BUS: 3:45 PM   (scale 3)    │
│   THEN: 4:15 PM        (scale 2)    │
│                                      │
│   SOUTH BUS: 3:50 PM   (scale 3)    │
│   THEN: 4:20 PM        (scale 2)    │
│                                      │
│   UPDATED 03:30 PM     (scale 2)    │
└──────────────────────────────────────┘
```

## Data Sources

| Data | Source | Notes |
|------|--------|-------|
| Weather | [WeatherLink API](https://www.weatherlink.com/) | Melody Heights station (Boulder, CO) |
| Bus times | [RTD Denver API](https://www.rtd-denver.com/) | Stops: North `12551`, South `19193` |

## Tech Stack

- **Device**: ESP32-based TRMNL e-ink display (800x480, 1-bit)
- **Firmware**: C++ (PlatformIO), uses `bb_epaper` library
- **Backend**: TypeScript on Val Town (Hono framework, Deno runtime)
- **Image format**: 800x480 1-bit BMP (48,062 bytes)

## Project Structure

```
valtown/terminal-jon-bo/
  index.ts          # Backend: API endpoints, data fetching, BMP generation
  notes.md          # Implementation gotchas and constraints

src/                # ESP32 firmware (C++)
include/config.h    # Firmware config (API base URL, device settings)
```

## How to Flash

**Board:** Seeed XIAO ESP32-S3 with 7.5" ePaper display (`TRMNL_7inch5_OG_DIY_Kit` environment)

### Build

```bash
~/.platformio/penv/bin/pio run -e TRMNL_7inch5_OG_DIY_Kit
```

### Enter Bootloader Mode

1. Hold **BOOT** button
2. Press and release **RESET** button
3. Release **BOOT** button

### Flash

```bash
~/.platformio/penv/bin/pio pkg exec -p tool-esptoolpy esptool.py -- --chip esp32s3 --baud 460800 -p /dev/cu.usbmodem1101 write_flash 0x10000 .pio/build/TRMNL_7inch5_OG_DIY_Kit/firmware.bin
```

### One-liner (build + flash)

```bash
~/.platformio/penv/bin/pio run -e TRMNL_7inch5_OG_DIY_Kit && ~/.platformio/penv/bin/pio pkg exec -p tool-esptoolpy esptool.py -- --chip esp32s3 --baud 460800 -p /dev/cu.usbmodem1101 write_flash 0x10000 .pio/build/TRMNL_7inch5_OG_DIY_Kit/firmware.bin
```

> Note: The serial port (`/dev/cu.usbmodem1101`) may vary. Check with `ls /dev/cu.usb*` after entering bootloader mode.

## Key Constraints

- **1-bit only**: No grayscale — pixels are either black or white
- **Custom font**: 5x7 bitmap font rendered pixel-by-pixel with variable scaling
- **~15s timeout**: Device will give up if image generation takes too long
- **Unique filenames**: Device skips download if filename matches previous, so each response uses a timestamp
- **BMP format**: Bottom-up row order (Y is flipped), rows padded to 4-byte boundaries

## Observations

- **Display grain/noise**: Some faint grain visible on renders that disappears after a full clear. Likely caused by `iUpdateCount` being hardcoded to `1` in the BMP code path (`display.cpp:989`), which prevents the periodic full-refresh logic (`(iUpdateCount & 7) == 0`) from ever triggering. BMP images always get `REFRESH_PARTIAL`, so ghosting accumulates without a cleaning cycle.
