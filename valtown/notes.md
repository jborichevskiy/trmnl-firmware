# TRMNL Custom Backend Notes

## Firmware Setup
- Changed `API_BASE_URL` in `include/config.h` to `https://terminal.jon.bo`
- Board: Seeed XIAO ePaper Display (7.5" DIY Kit)
- Flash command: `~/.platformio/penv/bin/platformio run -e TRMNL_7inch5_OG_DIY_Kit -t upload --upload-port /dev/cu.usbmodem1101`
- To enter bootloader: **double-tap RESET** button, then flash immediately

## Cloudflare
- **Must disable proxy** (orange cloud → grey) - ESP32 can't connect through CF proxy

## API Endpoints Required
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/setup` | GET | Device registration (returns `api_key`, `friendly_id`) |
| `/api/display` | GET | Returns `image_url` for display |
| `/api/log` | POST | Receives device logs |

## BMP Image Requirements (strict!)
- **Dimensions**: 800x480 exactly
- **Format**: BMP3, 1-bit monochrome
- **File size**: 48062 bytes (62 header + 48000 pixel data)
- **Height**: Must be positive 480 (not -480)
- **Color palette**: Black (0x00000000) then White (0x00FFFFFF)
- Y coordinates are flipped (bottom-up format)

## Gotchas
- wttr.in weather API is slow (~12s) - use Open-Meteo instead (~200ms)
- Device timeout is ~15s - image generation must be fast
- Firmware BMP parser is very strict on header values
- **`filename` must be unique** each refresh - firmware skips image download if filename matches previous

## Battery Life vs Refresh Rate
| Refresh Rate | Battery Life |
|-------------|--------------|
| 5 min | ~40 days (upgraded battery) |
| 15 min | 3-4 months (default) |
| 60 min | 1+ year |
| 6 hours | 3+ months |
