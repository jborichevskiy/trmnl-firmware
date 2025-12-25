# TRMNL E-Paper Display Backend

A Val.town HTTP endpoint that serves as a backend for TRMNL e-paper displays, providing weather information for Boulder, CO.

## API Endpoints

### GET /api/setup
Device setup endpoint that returns configuration for the TRMNL display.

**Headers:**
- `ID`: Device MAC address

**Response:**
```json
{
  "status": 200,
  "api_key": "test-key-123",
  "friendly_id": "WEATHER1",
  "image_url": "",
  "filename": "setup"
}
```

### GET /api/display
Main display endpoint that generates weather display images.

**Headers:**
- `ID`: Device MAC address
- `Access-Token`: API key from setup
- `Refresh-Rate`: Refresh interval in seconds (default: 900)

**Response:**
```json
{
  "status": 0,
  "image_url": "data:image/bmp;base64,<base64-encoded-bmp>",
  "filename": "weather",
  "refresh_rate": 900
}
```

The image is a 800x480 pixel, 1-bit BMP showing:
- Current temperature (large font)
- Weather condition
- City name (Boulder, CO)
- Current time (Mountain Time)

### POST /api/log
Logging endpoint for device telemetry.

**Body:** Any JSON object

**Response:**
```json
{
  "status": 200
}
```

## Features

- **Weather Data**: Fetches current weather for Boulder, CO using wttr.in API
- **BMP Generation**: Creates properly formatted 1-bit BMP images (800x480)
- **Text Rendering**: Custom bitmap font rendering for weather information
- **Time Display**: Shows current time in Mountain Time zone
- **CORS Enabled**: Ready for cross-origin requests

## Technical Details

- **Image Format**: 1-bit BMP with 62-byte header + 48000 bytes pixel data
- **Color Depth**: Black and white only (1-bit per pixel)
- **Refresh Rate**: Configurable, defaults to 15 minutes (900 seconds)
- **Weather Source**: wttr.in (no API key required)
- **Time Zone**: America/Denver (Mountain Time)

## Usage

The endpoint is ready to use with TRMNL e-paper displays. Simply configure your device to point to this backend URL and it will automatically fetch and display weather information for Boulder, CO.

## Testing

You can test the endpoints using curl:

```bash
# Setup
curl -H "ID: AA:BB:CC:DD:EE:FF" https://your-val-url/api/setup

# Display
curl -H "ID: AA:BB:CC:DD:EE:FF" -H "Access-Token: test-key-123" https://your-val-url/api/display

# Log
curl -X POST -H "Content-Type: application/json" -d '{"test": "data"}' https://your-val-url/api/log
```