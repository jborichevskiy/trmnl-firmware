# TRMNL Firmware

ESP32-based e-ink display firmware (PlatformIO) with a Val Town backend that generates dynamic 1-bit BMP images.

## Repo Structure

### Firmware (`src/`, `include/`, `lib/`)
- `src/bl.cpp` — Business logic: WiFi, API polling, sleep, battery
- `src/display.cpp` — Display rendering (BMP, PNG, JPEG, G5 compressed)
- `include/config.h` — Constants, board-specific defines
- `lib/bb_epaper/` — E-paper display library
- `lib/wificaptive/portal/` — WiFi captive portal HTML

### Val Town Backend (`valtown/terminal-jon-bo/`)
Single-file Hono server (`index.ts`) deployed via `vt push` from that directory.

**API endpoints (consumed by firmware):**
- `GET /api/setup` — Device registration
- `GET /api/display` — Returns image URL + refresh rate
- `GET /image/:filename` — Dynamically generates 800x480 1-bit BMP
- `POST /api/log` — Device telemetry

**Display generation (`generateCombinedBMP`):**
- Left side: weather data (temp, high/low), bus times (north/south RTD stops), update timestamp
- Right 60%: weather overlay image composited from stored PNGs
- When no overlay exists: dotted border placeholder with "{CONDITION} CAPYBARA" text + QR code linking to draw page
- Custom 5x7 bitmap font, pixel-level BMP manipulation

**Overlay system:**
- `POST /overlay/:name` — Upload PNG overlay for a weather condition
- `DELETE /overlay/:name` — Remove overlay (triggers placeholder on next render)
- `GET /draw?key=SECRET` — Pixel art editor (HTML5 Canvas, iPad-optimized)
- 8 conditions: sunny, cloudy, foggy, wind, rain, snow, hail, stormy
- `pickOverlayName()` auto-selects condition from weather data

**External APIs:**
- WeatherLink (Melody Heights station) — temperature, humidity, wind, rain
- RTD Denver — bus departure times

## Build
```
~/.platformio/penv/bin/pio run          # firmware (pio not in PATH)
cd valtown/terminal-jon-bo && vt push   # deploy backend (independent of git)
```

## Key Details
- BMP is 1-bit monochrome — no grayscale. Use dithering/dotted patterns for "gray"
- Val Town blob API throws `ValTownBlobNotFoundError` (not null) when key missing
- `vt push` tracks its own state via `.vt/state.json`, independent of git
- Overlay PNGs stored as Val Town blobs (`overlay_{condition}`)
- Draw editor uses `image-rendering: pixelated` for crisp pixel art
