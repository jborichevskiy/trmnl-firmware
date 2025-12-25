import { Hono } from "https://esm.sh/hono@3.11.7";
import { blob } from "https://esm.town/v/std/blob";

const app = new Hono();

// Unwrap Hono errors to see original error details
app.onError((err) => Promise.reject(err));

// TRMNL Setup endpoint
app.get("/api/setup", (c) => {
  const deviceId = c.req.header("ID") || "unknown";
  
  return c.json({
    status: 200,
    api_key: "test-key-123",
    friendly_id: "WEATHER1",
    image_url: "",
    filename: "setup",
    message: "Device successfully registered"
  });
});

// TRMNL Display endpoint
app.get("/api/display", async (c) => {
  const deviceId = c.req.header("ID");
  const refreshRate = c.req.header("Refresh-Rate") || "900";

  try {
    // Get base URL from request
    const url = new URL(c.req.url);
    const baseUrl = `${url.protocol}//${url.host}`;

    // Just point to the image endpoint - it will fetch data fresh
    const timestamp = Date.now();
    const imageUrl = `${baseUrl}/image/display_${timestamp}.bmp`;

    return c.json({
      status: 0,
      image_url: imageUrl,
      filename: `display_${timestamp}`,  // Unique filename so device knows to refresh
      refresh_rate: 900  // 15 minutes
    });
  } catch (error) {
    console.error("Error generating display:", error);
    return c.json({
      status: 1,
      error: "Failed to generate display"
    }, 500);
  }
});

// TRMNL Log endpoint
app.post("/api/log", async (c) => {
  // Accept any JSON body and just return success
  const body = await c.req.json().catch(() => ({}));
  console.log("TRMNL Log:", body);
  
  return c.json({
    status: 200
  });
});

// WMO Weather codes to descriptions
const weatherCodes: { [key: number]: string } = {
  0: "Clear",
  1: "Mostly Clear",
  2: "Partly Cloudy",
  3: "Overcast",
  45: "Foggy",
  48: "Foggy",
  51: "Light Drizzle",
  53: "Drizzle",
  55: "Heavy Drizzle",
  61: "Light Rain",
  63: "Rain",
  65: "Heavy Rain",
  66: "Freezing Rain",
  67: "Freezing Rain",
  71: "Light Snow",
  73: "Snow",
  75: "Heavy Snow",
  77: "Snow Grains",
  80: "Light Showers",
  81: "Showers",
  82: "Heavy Showers",
  85: "Snow Showers",
  86: "Heavy Snow Showers",
  95: "Thunderstorm",
  96: "Thunderstorm w/ Hail",
  99: "Thunderstorm w/ Hail"
};

// Weather data fetching using Open-Meteo (fast, no API key)
async function fetchWeatherData() {
  try {
    const response = await fetch(
      "https://api.open-meteo.com/v1/forecast?latitude=40.02418864518805&longitude=-105.28462211989343&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&timezone=America/Denver"
    );

    if (!response.ok) {
      throw new Error(`Weather API error: ${response.status}`);
    }

    const data = await response.json();

    const temp = Math.round(data.current.temperature_2m);
    const code = data.current.weather_code;
    const low = Math.round(data.daily.temperature_2m_min[0]);
    const high = Math.round(data.daily.temperature_2m_max[0]);

    return {
      temperature: `${temp}°F`,
      low: `${low}°F`,
      high: `${high}°F`,
      condition: weatherCodes[code] || "Unknown",
      city: "Boulder, CO",
      time: new Date().toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Denver'
      })
    };
  } catch (error) {
    console.error("Weather API error:", error);
    return {
      temperature: "??°F",
      low: "??°F",
      high: "??°F",
      condition: "Unknown",
      city: "Boulder, CO",
      time: new Date().toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Denver'
      })
    };
  }
}

// Bus stop IDs (will move to env vars later)
const BUS_STOP_NORTH = "12551";
const BUS_STOP_SOUTH = "19193";

// Fetch next bus times from RTD API
async function fetchBusData(stopId: string): Promise<{next: string | null, after: string | null}> {
  try {
    const response = await fetch(
      `https://nodejs-prod.rtd-denver.com/api/v2/nextride/stops/${stopId}`
    );

    if (!response.ok) {
      throw new Error(`RTD API error: ${response.status}`);
    }

    const data = await response.json();
    const now = Date.now();

    // Collect all departures from all branches
    const departures: number[] = [];

    if (data.branches && Array.isArray(data.branches)) {
      for (const branch of data.branches) {
        if (branch.upcomingTrips && Array.isArray(branch.upcomingTrips)) {
          for (const trip of branch.upcomingTrips) {
            // Prefer predicted time, fall back to scheduled
            const departureTime = trip.predictedDepartureTime || trip.scheduledDepartureTime;
            if (departureTime && departureTime > now) {
              departures.push(departureTime);
            }
          }
        }
      }
    }

    // Sort and get next 2
    departures.sort((a, b) => a - b);

    const formatTime = (ms: number): string => {
      return new Date(ms).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'America/Denver'
      });
    };

    return {
      next: departures[0] ? formatTime(departures[0]) : null,
      after: departures[1] ? formatTime(departures[1]) : null
    };
  } catch (error) {
    console.error("RTD API error:", error);
    return { next: null, after: null };
  }
}

// BMP image generation for combined weather + bus display
interface BusData {
  next: string | null;
  after: string | null;
}

interface DisplayData {
  weather: {
    temperature: string;
    low: string;
    high: string;
    condition: string;
    city: string;
    time: string;
  };
  northBus: BusData;
  southBus: BusData;
}

function generateCombinedBMP(data: DisplayData): Uint8Array {
  const width = 800;
  const height = 480;
  const bytesPerRow = Math.ceil(width / 8); // 1 bit per pixel, so 8 pixels per byte
  const paddedBytesPerRow = Math.ceil(bytesPerRow / 4) * 4; // BMP rows must be padded to 4-byte boundary
  const pixelDataSize = paddedBytesPerRow * height;
  const fileSize = 62 + pixelDataSize; // 62 byte header + pixel data

  // Create BMP header (62 bytes total)
  const header = new ArrayBuffer(62);
  const headerView = new DataView(header);

  // BMP file header (14 bytes)
  headerView.setUint8(0, 0x42); // 'B'
  headerView.setUint8(1, 0x4D); // 'M'
  headerView.setUint32(2, fileSize, true); // File size
  headerView.setUint32(6, 0, true); // Reserved
  headerView.setUint32(10, 62, true); // Offset to pixel data

  // DIB header (48 bytes for BITMAPV3INFOHEADER)
  headerView.setUint32(14, 40, true); // DIB header size
  headerView.setInt32(18, width, true); // Width
  headerView.setInt32(22, height, true); // Height (positive - TRMNL expects exactly 480)
  headerView.setUint16(26, 1, true); // Planes
  headerView.setUint16(28, 1, true); // Bits per pixel
  headerView.setUint32(30, 0, true); // Compression (none)
  headerView.setUint32(34, pixelDataSize, true); // Image size
  headerView.setInt32(38, 2835, true); // X pixels per meter
  headerView.setInt32(42, 2835, true); // Y pixels per meter
  headerView.setUint32(46, 2, true); // Colors used
  headerView.setUint32(50, 0, true); // Important colors

  // Color palette (8 bytes for 1-bit: black and white)
  headerView.setUint32(54, 0x00000000, true); // Black
  headerView.setUint32(58, 0x00FFFFFF, true); // White

  // Create pixel data (all white background initially)
  const pixelData = new Uint8Array(pixelDataSize);
  pixelData.fill(0xFF); // All white (1 bits)

  // Weather section (top)
  drawText(pixelData, data.weather.temperature, 50, 40, width, paddedBytesPerRow, 8); // Large current temp
  drawText(pixelData, `H ${data.weather.high} L ${data.weather.low} ${data.weather.condition}`, 50, 120, width, paddedBytesPerRow, 3);

  // Divider line
  drawHorizontalLine(pixelData, 50, 160, 700, paddedBytesPerRow);

  // Bus section (tighter vertical spacing within each bus group)
  const northNext = data.northBus.next || "--:--";
  const northAfter = data.northBus.after || "--:--";
  const southNext = data.southBus.next || "--:--";
  const southAfter = data.southBus.after || "--:--";

  drawText(pixelData, `NORTH BUS: ${northNext}`, 50, 190, width, paddedBytesPerRow, 3);
  drawText(pixelData, `THEN: ${northAfter}`, 50, 225, width, paddedBytesPerRow, 2);

  drawText(pixelData, `SOUTH BUS: ${southNext}`, 50, 295, width, paddedBytesPerRow, 3);
  drawText(pixelData, `THEN: ${southAfter}`, 50, 330, width, paddedBytesPerRow, 2);

  // Footer
  drawText(pixelData, `UPDATED ${data.weather.time}`, 50, 430, width, paddedBytesPerRow, 2);

  // Combine header and pixel data
  const bmpData = new Uint8Array(fileSize);
  bmpData.set(new Uint8Array(header), 0);
  bmpData.set(pixelData, 62);

  // Return the raw BMP data
  return bmpData;
}

// Simple text rendering function (draws basic block letters)
function drawText(pixelData: Uint8Array, text: string, x: number, y: number, width: number, paddedBytesPerRow: number, scale: number = 1) {
  // Simple 5x7 font bitmap for basic characters
  const font: { [key: string]: number[] } = {
    '0': [0x3E, 0x51, 0x49, 0x45, 0x3E],
    '1': [0x00, 0x42, 0x7F, 0x40, 0x00],
    '2': [0x42, 0x61, 0x51, 0x49, 0x46],
    '3': [0x21, 0x41, 0x45, 0x4B, 0x31],
    '4': [0x18, 0x14, 0x12, 0x7F, 0x10],
    '5': [0x27, 0x45, 0x45, 0x45, 0x39],
    '6': [0x3C, 0x4A, 0x49, 0x49, 0x30],
    '7': [0x01, 0x71, 0x09, 0x05, 0x03],
    '8': [0x36, 0x49, 0x49, 0x49, 0x36],
    '9': [0x06, 0x49, 0x49, 0x29, 0x1E],
    'A': [0x7E, 0x11, 0x11, 0x11, 0x7E],
    'B': [0x7F, 0x49, 0x49, 0x49, 0x36],
    'C': [0x3E, 0x41, 0x41, 0x41, 0x22],
    'D': [0x7F, 0x41, 0x41, 0x22, 0x1C],
    'E': [0x7F, 0x49, 0x49, 0x49, 0x41],
    'F': [0x7F, 0x09, 0x09, 0x09, 0x01],
    'G': [0x3E, 0x41, 0x49, 0x49, 0x7A],
    'H': [0x7F, 0x08, 0x08, 0x08, 0x7F],
    'I': [0x00, 0x41, 0x7F, 0x41, 0x00],
    'J': [0x20, 0x40, 0x41, 0x3F, 0x01],
    'K': [0x7F, 0x08, 0x14, 0x22, 0x41],
    'L': [0x7F, 0x40, 0x40, 0x40, 0x40],
    'M': [0x7F, 0x02, 0x0C, 0x02, 0x7F],
    'N': [0x7F, 0x04, 0x08, 0x10, 0x7F],
    'O': [0x3E, 0x41, 0x41, 0x41, 0x3E],
    'P': [0x7F, 0x09, 0x09, 0x09, 0x06],
    'Q': [0x3E, 0x41, 0x51, 0x21, 0x5E],
    'R': [0x7F, 0x09, 0x19, 0x29, 0x46],
    'S': [0x46, 0x49, 0x49, 0x49, 0x31],
    'T': [0x01, 0x01, 0x7F, 0x01, 0x01],
    'U': [0x3F, 0x40, 0x40, 0x40, 0x3F],
    'V': [0x1F, 0x20, 0x40, 0x20, 0x1F],
    'W': [0x3F, 0x40, 0x38, 0x40, 0x3F],
    'X': [0x63, 0x14, 0x08, 0x14, 0x63],
    'Y': [0x07, 0x08, 0x70, 0x08, 0x07],
    'Z': [0x61, 0x51, 0x49, 0x45, 0x43],
    ' ': [0x00, 0x00, 0x00, 0x00, 0x00],
    '°': [0x02, 0x05, 0x02, 0x00, 0x00],
    ':': [0x00, 0x36, 0x36, 0x00, 0x00],
    ',': [0x00, 0x80, 0x60, 0x00, 0x00],
    '.': [0x00, 0x60, 0x60, 0x00, 0x00]
  };
  
  let currentX = x;
  
  for (const char of text.toUpperCase()) {
    const charData = font[char] || font[' '];
    
    for (let col = 0; col < 5; col++) {
      const columnData = charData[col];
      
      for (let row = 0; row < 7; row++) {
        if (columnData & (1 << row)) {
          // Draw pixel(s) based on scale
          for (let sy = 0; sy < scale; sy++) {
            for (let sx = 0; sx < scale; sx++) {
              const pixelX = currentX + col * scale + sx;
              const pixelY = y + row * scale + sy;
              
              if (pixelX < width && pixelY < 480) {
                setPixel(pixelData, pixelX, pixelY, paddedBytesPerRow, false); // false = black
              }
            }
          }
        }
      }
    }
    
    currentX += 6 * scale; // 5 pixels + 1 space between characters
  }
}

// Set a pixel in the 1-bit BMP data
// Note: BMP with positive height is bottom-up, so we flip Y
function setPixel(pixelData: Uint8Array, x: number, y: number, paddedBytesPerRow: number, white: boolean) {
  const flippedY = 479 - y; // Flip Y for bottom-up BMP
  const byteIndex = flippedY * paddedBytesPerRow + Math.floor(x / 8);
  const bitIndex = 7 - (x % 8); // MSB first

  if (white) {
    pixelData[byteIndex] |= (1 << bitIndex);
  } else {
    pixelData[byteIndex] &= ~(1 << bitIndex);
  }
}

// Draw a horizontal line
function drawHorizontalLine(pixelData: Uint8Array, x: number, y: number, length: number, paddedBytesPerRow: number) {
  for (let i = 0; i < length; i++) {
    setPixel(pixelData, x + i, y, paddedBytesPerRow, false); // black pixel
  }
}

// Serve BMP images dynamically
app.get("/image/:filename", async (c) => {
  const filename = c.req.param("filename");

  try {
    // Fetch weather and bus data in parallel
    const [weatherData, northBus, southBus] = await Promise.all([
      fetchWeatherData(),
      fetchBusData(BUS_STOP_NORTH),
      fetchBusData(BUS_STOP_SOUTH)
    ]);

    // Generate the combined BMP data
    const bmpData = generateCombinedBMP({
      weather: weatherData,
      northBus,
      southBus
    });

    // Return the BMP file with proper headers
    return new Response(bmpData, {
      headers: {
        "Content-Type": "image/bmp",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "public, max-age=300"
      }
    });
  } catch (error) {
    console.error("Error serving image:", error);
    return c.text("Error serving image", 500);
  }
});

// Health check endpoint
app.get("/", (c) => {
  return c.text("TRMNL Weather Display Backend - Ready!");
});

export default app.fetch;