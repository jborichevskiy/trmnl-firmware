import { Hono } from "https://esm.sh/hono@3.11.7";
import { blob } from "https://esm.town/v/std/blob";
import UPNG from "npm:upng-js";
import qrcodeGenerator from "npm:qrcode-generator";

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
    const url = new URL(c.req.url);
    const baseUrl = `${url.protocol}//${url.host}`;
    const timestamp = Date.now();
    const imageUrl = `${baseUrl}/image/display_${timestamp}.bmp`;

    return c.json({
      status: 0,
      image_url: imageUrl,
      filename: `display_${timestamp}`,
      refresh_rate: 900
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
  const body = await c.req.json().catch(() => ({}));
  console.log("TRMNL Log:", body);
  return c.json({ status: 200 });
});

// Auth check for upload endpoints
function checkAuth(c: any): boolean {
  const key = c.req.header("X-Upload-Key") || new URL(c.req.url).searchParams.get("key");
  return UPLOAD_SECRET !== "" && key === UPLOAD_SECRET;
}

// Upload overlay PNG by name
app.post("/overlay/:name", async (c) => {
  if (!checkAuth(c)) return c.text("Unauthorized", 401);
  const name = c.req.param("name");
  if (!OVERLAY_CONDITIONS.includes(name as OverlayCondition)) {
    return c.text(`Invalid name. Use: ${OVERLAY_CONDITIONS.join(", ")}`, 400);
  }
  const body = await c.req.arrayBuffer();
  await blob.set(`overlay_${name}`, new Uint8Array(body));
  return c.text(`Overlay '${name}' saved! (${body.byteLength} bytes)`);
});

// Delete overlay by name
app.delete("/overlay/:name", async (c) => {
  if (!checkAuth(c)) return c.text("Unauthorized", 401);
  const name = c.req.param("name");
  if (!OVERLAY_CONDITIONS.includes(name as OverlayCondition)) {
    return c.text(`Invalid name. Use: ${OVERLAY_CONDITIONS.join(", ")}`, 400);
  }
  await blob.delete(`overlay_${name}`);
  return c.text(`Overlay '${name}' deleted`);
});

// Get overlay PNG by name (for gallery previews)
app.get("/overlay/:name", async (c) => {
  const name = c.req.param("name");
  if (!OVERLAY_CONDITIONS.includes(name as OverlayCondition)) {
    return c.text("Not found", 404);
  }
  try {
    const data = await blob.get(`overlay_${name}`);
    const buf = await data.arrayBuffer();
    return new Response(buf, {
      headers: { "Content-Type": "image/png", "Cache-Control": "no-cache" }
    });
  } catch {
    return c.text("Not found", 404);
  }
});

// List which overlays exist
app.get("/api/overlays", async (c) => {
  const results: Record<string, boolean> = {};
  for (const name of OVERLAY_CONDITIONS) {
    try {
      const data = await blob.get(`overlay_${name}`);
      results[name] = true;
    } catch {
      results[name] = false;
    }
  }
  return c.json(results);
});

// Weather data fetching from WeatherLink (Melody Heights station)
const WEATHERLINK_STATION_TOKEN = "23ece686c4004fb2921ea8cba43c09b3";
const UPLOAD_SECRET = Deno.env.get("UPLOAD_SECRET") || "";

interface WeatherData {
  temperature: string;
  low: string;
  high: string;
  condition: string;
  city: string;
  time: string;
  // Raw values for condition detection
  rawTemp: number;
  rawWindSpeed: number;
  rawRainRate: number;
  rawHumidity: number;
  rawDewPoint: number;
}

async function fetchWeatherData(): Promise<WeatherData> {
  try {
    const response = await fetch(
      `https://www.weatherlink.com/embeddablePage/summaryData/${WEATHERLINK_STATION_TOKEN}`,
      { signal: AbortSignal.timeout(10000) }
    );

    if (!response.ok) {
      throw new Error(`WeatherLink API error: ${response.status}`);
    }

    const data = await response.json();

    const findCurrent = (name: string) => {
      const item = data.currConditionValues?.find((v: any) => v.sensorDataName === name);
      return item ? item.reportedValue : null;
    };

    const findHighLow = (name: string) => {
      const item = data.highLowValues?.find((v: any) => v.sensorDataName === name);
      return item ? Math.round(item.reportedValue) : null;
    };

    const rawTemp = findCurrent("Temp") ?? 0;
    const rawWindSpeed = findCurrent("Wind Speed") ?? 0;
    const rawRainRate = findCurrent("Rain Rate") ?? 0;
    const rawHumidity = findCurrent("Hum") ?? 0;
    const rawDewPoint = findCurrent("Dew Point") ?? 0;
    const temp = Math.round(rawTemp);
    const high = findHighLow("High Temp") ?? 0;
    const low = findHighLow("Low Temp") ?? 0;

    return {
      temperature: `${temp}°F`,
      low: `${low}°F`,
      high: `${high}°F`,
      condition: "",
      city: "Boulder, CO",
      time: new Date().toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Denver'
      }),
      rawTemp,
      rawWindSpeed,
      rawRainRate,
      rawHumidity,
      rawDewPoint,
    };
  } catch (error) {
    console.error("WeatherLink API error:", error);
    return {
      temperature: "??°F",
      low: "??°F",
      high: "??°F",
      condition: "",
      city: "Boulder, CO",
      time: new Date().toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Denver'
      }),
      rawTemp: 40,
      rawWindSpeed: 0,
      rawRainRate: 0,
      rawHumidity: 50,
      rawDewPoint: 30,
    };
  }
}

// All supported weather overlay conditions
const OVERLAY_CONDITIONS = ["sunny", "cloudy", "foggy", "wind", "rain", "snow", "hail", "stormy"] as const;
type OverlayCondition = typeof OVERLAY_CONDITIONS[number];

// Determine which overlay to show based on weather conditions
function pickOverlayName(weather: WeatherData): OverlayCondition {
  const tempDewSpread = Math.abs(weather.rawTemp - weather.rawDewPoint);

  // Stormy: heavy rain + high wind
  if (weather.rawRainRate > 0.1 && weather.rawWindSpeed >= 20) return "stormy";
  // Hail: precipitating near freezing (32-40°F)
  if (weather.rawRainRate > 0 && weather.rawTemp > 32 && weather.rawTemp <= 40) return "hail";
  // Snow: precipitating and freezing
  if (weather.rawRainRate > 0 && weather.rawTemp <= 32) return "snow";
  // Rain: precipitating and above freezing
  if (weather.rawRainRate > 0 && weather.rawTemp > 40) return "rain";
  // Foggy: very high humidity + small temp-dewpoint spread
  if (weather.rawHumidity >= 90 && tempDewSpread < 3) return "foggy";
  // Wind: gusty (15+ mph)
  if (weather.rawWindSpeed >= 15) return "wind";
  // Cloudy: moderate-high humidity
  if (weather.rawHumidity >= 70) return "cloudy";
  // Sunny: default (clear, calm)
  return "sunny";
}

interface GridData {
  percent: number | null;
  isClean: boolean | null;
  hoursUntilClean: number | null;
}

async function fetchGridData(): Promise<GridData> {
  try {
    const response = await fetch("https://weis-api.vercel.app/api/weis-v4", {
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error(`WEIS API error: ${response.status}`);
    const json = await response.json();

    const data = json.data as Array<{ timestamp: string; value: number }>;

    // Walk forward until we pass now; the last entry before now is the current reading.
    const nowMs = Date.now();
    let currentIdx = 0;
    for (let i = 0; i < data.length; i++) {
      if (new Date(data[i].timestamp).getTime() > nowMs) break;
      currentIdx = i;
    }
    const current = data[currentIdx];
    const isClean = current.value > 75;

    // If not currently clean, find the next future entry that crosses 75%.
    let hoursUntilClean: number | null = null;
    if (!isClean) {
      for (let i = currentIdx + 1; i < data.length; i++) {
        if (data[i].value > 75) {
          const cleanMs = new Date(data[i].timestamp).getTime();
          hoursUntilClean = Math.round((cleanMs - nowMs) / 3_600_000);
          break;
        }
      }
    }

    const percent = Math.round(current.value);
    console.log(`[grid] ${current.timestamp} → ${percent}% renewable, clean=${isClean}, hoursUntilClean=${hoursUntilClean}`);
    return { percent, isClean, hoursUntilClean };
  } catch (error) {
    console.error("WEIS grid API error:", error);
    return { percent: null, isClean: null, hoursUntilClean: null };
  }
}

async function fetchUVIndex(): Promise<number | null> {
  try {
    const response = await fetch(
      "https://api.open-meteo.com/v1/forecast?latitude=40.01&longitude=-105.27&current=uv_index&timezone=America/Denver",
      { signal: AbortSignal.timeout(10000) }
    );
    if (!response.ok) throw new Error(`UV API error: ${response.status}`);
    const data = await response.json();
    const val = data.current?.uv_index;
    return val != null ? Math.round(val) : null;
  } catch (error) {
    console.error("UV index API error:", error);
    return null;
  }
}

// Bus stop IDs
const BUS_STOP_NORTH = "12551";
const BUS_STOP_SOUTH = "19193";

async function fetchBusData(stopId: string): Promise<{next: string | null, after: string | null}> {
  try {
    const response = await fetch(
      `https://nodejs-prod.rtd-denver.com/api/v2/nextride/stops/${stopId}`,
      { signal: AbortSignal.timeout(10000) }
    );

    if (!response.ok) {
      throw new Error(`RTD API error: ${response.status}`);
    }

    const data = await response.json();
    const now = Date.now();
    const departures: number[] = [];

    if (data.branches && Array.isArray(data.branches)) {
      for (const branch of data.branches) {
        if (branch.upcomingTrips && Array.isArray(branch.upcomingTrips)) {
          for (const trip of branch.upcomingTrips) {
            const departureTime = trip.predictedDepartureTime || trip.scheduledDepartureTime;
            if (departureTime && departureTime > now) {
              departures.push(departureTime);
            }
          }
        }
      }
    }

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

// BMP image generation
interface BusData {
  next: string | null;
  after: string | null;
}

interface DisplayData {
  weather: WeatherData;
  northBus: BusData;
  southBus: BusData;
  overlayName: string;
  baseUrl: string;
  uvIndex: number | null;
  gridData: GridData;
}

// Overlay image area: 60% width, top-right
const OVERLAY_WIDTH_RATIO = 0.60;
const OVERLAY_OFFSET_X = 800 - Math.round(800 * OVERLAY_WIDTH_RATIO); // 320

// Draw a filled rectangle (black)
function drawRect(pixelData: Uint8Array, x: number, y: number, w: number, h: number, paddedBytesPerRow: number) {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      setPixel(pixelData, x + dx, y + dy, paddedBytesPerRow, false);
    }
  }
}

// Low-poly sun icon (~13px diameter) centered at (cx, cy)
function drawSunIcon(pixelData: Uint8Array, cx: number, cy: number, paddedBytesPerRow: number) {
  drawRect(pixelData, cx - 3, cy - 3, 7, 7, paddedBytesPerRow); // body
  drawRect(pixelData, cx, cy - 6, 1, 2, paddedBytesPerRow);     // top ray
  drawRect(pixelData, cx, cy + 5, 1, 2, paddedBytesPerRow);     // bottom ray
  drawRect(pixelData, cx - 6, cy, 2, 1, paddedBytesPerRow);     // left ray
  drawRect(pixelData, cx + 5, cy, 2, 1, paddedBytesPerRow);     // right ray
  setPixel(pixelData, cx - 5, cy - 5, paddedBytesPerRow, false); // diagonals
  setPixel(pixelData, cx + 5, cy - 5, paddedBytesPerRow, false);
  setPixel(pixelData, cx - 5, cy + 5, paddedBytesPerRow, false);
  setPixel(pixelData, cx + 5, cy + 5, paddedBytesPerRow, false);
}

// Draw a QR code into the BMP pixel data
function drawQRCode(pixelData: Uint8Array, url: string, centerX: number, centerY: number, moduleSize: number, paddedBytesPerRow: number) {
  const qr = qrcodeGenerator(0, 'M');
  qr.addData(url);
  qr.make();

  const count = qr.getModuleCount();
  const totalSize = count * moduleSize;
  const startX = centerX - Math.floor(totalSize / 2);
  const startY = centerY - Math.floor(totalSize / 2);

  // White quiet zone (4 modules)
  const quiet = 4 * moduleSize;
  for (let dy = -quiet; dy < totalSize + quiet; dy++) {
    for (let dx = -quiet; dx < totalSize + quiet; dx++) {
      setPixel(pixelData, startX + dx, startY + dy, paddedBytesPerRow, true);
    }
  }

  // Draw modules
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) {
        drawRect(pixelData, startX + col * moduleSize, startY + row * moduleSize, moduleSize, moduleSize, paddedBytesPerRow);
      }
    }
  }
}

// Draw placeholder when no overlay exists
function drawPlaceholder(
  pixelData: Uint8Array,
  bmpWidth: number,
  bmpHeight: number,
  paddedBytesPerRow: number,
  overlayName: string,
  baseUrl: string
) {
  const destW = Math.round(bmpWidth * OVERLAY_WIDTH_RATIO);
  const destH = Math.round(destW * (bmpHeight / bmpWidth)); // match display aspect ratio
  const offsetX = bmpWidth - destW;
  const offsetY = 0;
  const border = 2;

  // Draw dotted border (every 4th pixel = dashed gray look on 1-bit display)
  const dash = 4;
  for (let i = 0; i < destW; i++) {
    if (i % dash < 2) {
      setPixel(pixelData, offsetX + i, offsetY, paddedBytesPerRow, false);
      setPixel(pixelData, offsetX + i, offsetY + destH - 1, paddedBytesPerRow, false);
    }
  }
  for (let j = 0; j < destH; j++) {
    if (j % dash < 2) {
      setPixel(pixelData, offsetX, offsetY + j, paddedBytesPerRow, false);
      setPixel(pixelData, offsetX + destW - 1, offsetY + j, paddedBytesPerRow, false);
    }
  }

  // Centered text: "{CONDITION} CAPYBARA"
  const label = `${overlayName.toUpperCase()} CAPYBARA`;
  const textScale = 2;
  const charW = 6 * textScale;
  const textW = label.length * charW;
  const textX = offsetX + Math.floor((destW - textW) / 2);
  const textY = offsetY + 30;
  drawText(pixelData, label, textX, textY, bmpWidth, paddedBytesPerRow, textScale);

  // QR code centered below text, linking to draw page
  const drawUrl = `${baseUrl}/draw?key=${UPLOAD_SECRET}`;
  const qrCenterX = offsetX + Math.floor(destW / 2);
  const qrCenterY = offsetY + Math.floor(destH / 2) + 20;
  drawQRCode(pixelData, drawUrl, qrCenterX, qrCenterY, 3, paddedBytesPerRow);

  // Small prompt under QR
  const hint = "SCAN TO DRAW";
  const hintW = hint.length * 6;
  const hintX = offsetX + Math.floor((destW - hintW) / 2);
  drawText(pixelData, hint, hintX, qrCenterY + 70, bmpWidth, paddedBytesPerRow, 1);
}

// Composite a named PNG overlay onto BMP pixel data
async function compositeOverlay(
  pixelData: Uint8Array,
  bmpWidth: number,
  bmpHeight: number,
  paddedBytesPerRow: number,
  overlayName: string,
  baseUrl: string
): Promise<void> {
  try {
    const blobKey = `overlay_${overlayName}`;
    let pngBytes;
    try {
      pngBytes = await blob.get(blobKey);
    } catch (e: any) {
      if (e.name === "ValTownBlobNotFoundError") {
        console.log(`[overlay] No blob for '${blobKey}', drawing placeholder`);
        drawPlaceholder(pixelData, bmpWidth, bmpHeight, paddedBytesPerRow, overlayName, baseUrl);
        return;
      }
      throw e;
    }
    if (!pngBytes) {
      console.log(`[overlay] Null blob for '${blobKey}', drawing placeholder`);
      drawPlaceholder(pixelData, bmpWidth, bmpHeight, paddedBytesPerRow, overlayName, baseUrl);
      return;
    }

    const pngBuffer = await pngBytes.arrayBuffer();
    console.log(`[overlay] Blob size: ${pngBuffer.byteLength} bytes`);
    const img = UPNG.decode(pngBuffer);
    const rgba = new Uint8Array(UPNG.toRGBA8(img)[0]);

    const pngW = img.width;
    const pngH = img.height;

    // Target: 60% of BMP width, preserve aspect ratio
    const destW = Math.round(bmpWidth * OVERLAY_WIDTH_RATIO);
    const destH = Math.round(destW * (pngH / pngW));

    // Position: top-right corner
    const offsetX = bmpWidth - destW;
    const offsetY = 0;

    for (let dy = 0; dy < destH && (offsetY + dy) < bmpHeight; dy++) {
      for (let dx = 0; dx < destW; dx++) {
        const srcX = Math.floor(dx * (pngW / destW));
        const srcY = Math.floor(dy * (pngH / destH));

        if (srcX >= pngW || srcY >= pngH) continue;

        const idx = (srcY * pngW + srcX) * 4;
        const r = rgba[idx];
        const g = rgba[idx + 1];
        const b = rgba[idx + 2];
        const a = rgba[idx + 3];

        // Skip transparent or near-white pixels
        if (a < 128) continue;
        if (r > 200 && g > 200 && b > 200) continue;

        setPixel(pixelData, offsetX + dx, offsetY + dy, paddedBytesPerRow, false);
      }
    }
  } catch (err) {
    console.error("[overlay] compositeOverlay FAILED:", err);
  }
}

async function generateCombinedBMP(data: DisplayData): Promise<Uint8Array> {
  const width = 800;
  const height = 480;
  const bytesPerRow = Math.ceil(width / 8);
  const paddedBytesPerRow = Math.ceil(bytesPerRow / 4) * 4;
  const pixelDataSize = paddedBytesPerRow * height;
  const fileSize = 62 + pixelDataSize;

  const header = new ArrayBuffer(62);
  const headerView = new DataView(header);

  // BMP file header (14 bytes)
  headerView.setUint8(0, 0x42); // 'B'
  headerView.setUint8(1, 0x4D); // 'M'
  headerView.setUint32(2, fileSize, true);
  headerView.setUint32(6, 0, true);
  headerView.setUint32(10, 62, true);

  // DIB header (40 bytes)
  headerView.setUint32(14, 40, true);
  headerView.setInt32(18, width, true);
  headerView.setInt32(22, height, true);
  headerView.setUint16(26, 1, true);
  headerView.setUint16(28, 1, true);
  headerView.setUint32(30, 0, true);
  headerView.setUint32(34, pixelDataSize, true);
  headerView.setInt32(38, 2835, true);
  headerView.setInt32(42, 2835, true);
  headerView.setUint32(46, 2, true);
  headerView.setUint32(50, 0, true);

  // Color palette
  headerView.setUint32(54, 0x00000000, true); // Black
  headerView.setUint32(58, 0x00FFFFFF, true); // White

  const pixelData = new Uint8Array(pixelDataSize);
  pixelData.fill(0xFF); // All white

  // Weather section (top)
  drawText(pixelData, data.weather.temperature, 50, 40, width, paddedBytesPerRow, 8);
  drawText(pixelData, `H ${data.weather.high} L ${data.weather.low} ${data.weather.condition}`, 50, 130, width, paddedBytesPerRow, 3);

  drawText(pixelData, `UV ${data.uvIndex ?? "--"}`, 50, 175, width, paddedBytesPerRow, 3);

  // Divider line — only extends to the image edge (x=50 to x=320, so length=270)
  drawHorizontalLine(pixelData, 50, 220, OVERLAY_OFFSET_X - 50 - 10, paddedBytesPerRow);

  // Bus section
  const northNext = data.northBus.next || "--:--";
  const northAfter = data.northBus.after || "--:--";
  const southNext = data.southBus.next || "--:--";
  const southAfter = data.southBus.after || "--:--";

  drawText(pixelData, `NORTH BUS: ${northNext}`, 50, 245, width, paddedBytesPerRow, 3);
  drawText(pixelData, `THEN: ${northAfter}`, 50, 280, width, paddedBytesPerRow, 2);

  drawText(pixelData, `SOUTH BUS: ${southNext}`, 50, 325, width, paddedBytesPerRow, 3);
  drawText(pixelData, `THEN: ${southAfter}`, 50, 360, width, paddedBytesPerRow, 2);

  // Power / grid section — left panel, below bus data
  drawHorizontalLine(pixelData, 50, 393, OVERLAY_OFFSET_X - 50 - 10, paddedBytesPerRow);
  const pctText = data.gridData.percent !== null ? `${data.gridData.percent}%` : "--";
  drawText(pixelData, `GRID: ${pctText} RENEWABLES`, 50, 408, width, paddedBytesPerRow, 2);
  const cleanText = data.gridData.isClean === true
    ? "CLEAN"
    : data.gridData.hoursUntilClean !== null
      ? `CLEAN IN ${data.gridData.hoursUntilClean} HRS`
      : data.gridData.isClean === false ? "NOT CLEAN" : "---";
  drawText(pixelData, cleanText, 50, 435, width, paddedBytesPerRow, 3);

  // Composite the weather-condition overlay on top
  await compositeOverlay(pixelData, width, height, paddedBytesPerRow, data.overlayName, data.baseUrl);

  const bmpData = new Uint8Array(fileSize);
  bmpData.set(new Uint8Array(header), 0);
  bmpData.set(pixelData, 62);

  return bmpData;
}

// Simple 5x7 font text rendering
function drawText(pixelData: Uint8Array, text: string, x: number, y: number, width: number, paddedBytesPerRow: number, scale: number = 1) {
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
    '.': [0x00, 0x60, 0x60, 0x00, 0x00],
    '-': [0x08, 0x08, 0x08, 0x08, 0x08],
    '%': [0x23, 0x13, 0x08, 0x64, 0x62],
  };
  
  let currentX = x;
  
  for (const char of text.toUpperCase()) {
    const charData = font[char] || font[' '];
    
    for (let col = 0; col < 5; col++) {
      const columnData = charData[col];
      
      for (let row = 0; row < 7; row++) {
        if (columnData & (1 << row)) {
          for (let sy = 0; sy < scale; sy++) {
            for (let sx = 0; sx < scale; sx++) {
              const pixelX = currentX + col * scale + sx;
              const pixelY = y + row * scale + sy;
              
              if (pixelX < width && pixelY < 480) {
                setPixel(pixelData, pixelX, pixelY, paddedBytesPerRow, false);
              }
            }
          }
        }
      }
    }
    
    currentX += 6 * scale;
  }
}

function setPixel(pixelData: Uint8Array, x: number, y: number, paddedBytesPerRow: number, white: boolean) {
  const flippedY = 479 - y;
  const byteIndex = flippedY * paddedBytesPerRow + Math.floor(x / 8);
  const bitIndex = 7 - (x % 8);

  if (white) {
    pixelData[byteIndex] |= (1 << bitIndex);
  } else {
    pixelData[byteIndex] &= ~(1 << bitIndex);
  }
}

function drawHorizontalLine(pixelData: Uint8Array, x: number, y: number, length: number, paddedBytesPerRow: number) {
  for (let i = 0; i < length; i++) {
    setPixel(pixelData, x + i, y, paddedBytesPerRow, false);
  }
}

// Serve BMP images dynamically
app.get("/image/:filename", async (c) => {
  const filename = c.req.param("filename");

  try {
    const [weatherData, northBus, southBus, uvIndex, gridData] = await Promise.all([
      fetchWeatherData(),
      fetchBusData(BUS_STOP_NORTH),
      fetchBusData(BUS_STOP_SOUTH),
      fetchUVIndex(),
      fetchGridData()
    ]);

    const urlParams = new URL(c.req.url).searchParams;
    const overrideOverlay = urlParams.get("overlay");
    const overlayName = (overrideOverlay && OVERLAY_CONDITIONS.includes(overrideOverlay as OverlayCondition))
      ? overrideOverlay
      : pickOverlayName(weatherData);
    console.log(`Weather: temp=${weatherData.rawTemp}°F, wind=${weatherData.rawWindSpeed}mph, rain=${weatherData.rawRainRate} → overlay: ${overlayName}${overrideOverlay ? ' (forced)' : ''}`);

    const url = new URL(c.req.url);
    const baseUrl = `${url.protocol}//${url.host}`;

    const bmpData = await generateCombinedBMP({
      weather: weatherData,
      northBus,
      southBus,
      overlayName,
      baseUrl,
      uvIndex,
      gridData,
    });

    return new Response(bmpData, {
      headers: {
        "Content-Type": "image/bmp",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": overrideOverlay ? "no-cache" : "public, max-age=300"
      }
    });
  } catch (error) {
    console.error("Error serving image:", error);
    return c.text("Error serving image", 500);
  }
});

// Debug live view — renders current image inline
app.get("/debug/live", (c) => {
  const ts = Date.now();
  const overlay = new URL(c.req.url).searchParams.get("overlay") || "";
  const imgSrc = `/image/live_${ts}.bmp` + (overlay ? `?overlay=${overlay}` : "");
  return c.html(`<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TRMNL Live</title>
<style>
  body { margin: 0; background: #111; display: flex; align-items: center; justify-content: center; min-height: 100dvh; flex-direction: column; gap: 12px; font-family: -apple-system, sans-serif; }
  img { max-width: 95vw; max-height: 80vh; image-rendering: pixelated; border: 1px solid #333; }
  .controls { display: flex; gap: 8px; align-items: center; }
  button { font-size: 14px; padding: 8px 16px; border-radius: 6px; border: 1px solid #444; background: #222; color: #e0e0e0; cursor: pointer; }
  button:active { background: #444; }
  span { color: #888; font-size: 13px; }
</style>
</head><body>
<img id="img" src="${imgSrc}">
<div class="controls">
  <button onclick="refresh()">Refresh</button>
  <span id="ts"></span>
</div>
<script>
  function refresh() {
    const params = new URLSearchParams(location.search);
    const overlay = params.get('overlay') || '';
    const img = document.getElementById('img');
    const t = Date.now();
    img.src = '/image/live_' + t + '.bmp' + (overlay ? '?overlay=' + overlay : '');
    document.getElementById('ts').textContent = new Date().toLocaleTimeString();
  }
  document.getElementById('ts').textContent = new Date().toLocaleTimeString();
</script>
</body></html>`);
});

// Health check endpoint
app.get("/", (c) => {
  return c.text("TRMNL Weather Display Backend - Ready!");
});

// Drawing interface — iPad Pro optimized
app.get("/draw", (c) => {
  const key = new URL(c.req.url).searchParams.get("key");
  if (!UPLOAD_SECRET || key !== UPLOAD_SECRET) {
    return c.text("Unauthorized — add ?key=YOUR_SECRET to the URL", 401);
  }

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
  <title>Capybara Studio</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, sans-serif; background: #1a1a1a; color: #e0e0e0; height: 100dvh; overflow: hidden; display: flex; flex-direction: column; }

    /* Top bar: tabs + actions */
    .topbar {
      display: flex; align-items: center; gap: 0; padding: 0 12px;
      background: #222; border-bottom: 1px solid #333; flex-shrink: 0; height: 48px;
    }
    .tab {
      font-size: 14px; padding: 12px 20px; border: none; background: none;
      color: #888; cursor: pointer; border-bottom: 2px solid transparent;
      font-weight: 600; touch-action: manipulation;
    }
    .tab.active { color: #e0e0e0; border-bottom-color: #4a9eff; }
    .topbar .spacer { flex: 1; }
    .topbar-actions { display: flex; gap: 6px; align-items: center; }
    .topbar-actions button {
      font-size: 13px; padding: 6px 14px; border-radius: 6px; border: 1px solid #444;
      background: #2a2a2a; color: #e0e0e0; cursor: pointer; touch-action: manipulation;
    }
    .topbar-actions button:active { background: #444; }
    .topbar-actions .save-btn { background: #2d8a4e; border-color: #2d8a4e; color: #fff; }
    .topbar-actions .save-btn:active { background: #236b3c; }
    .topbar-actions .danger-btn { background: #8a2d2d; border-color: #8a2d2d; color: #fff; }

    /* Draw toolbar (below topbar, only in draw view) */
    .draw-toolbar {
      display: flex; align-items: center; gap: 8px; padding: 8px 12px;
      background: #1e1e1e; border-bottom: 1px solid #2a2a2a; flex-shrink: 0;
    }
    .conditions { display: flex; gap: 4px; flex-wrap: nowrap; overflow-x: auto; }
    .cond-btn {
      font-size: 12px; padding: 5px 10px; border-radius: 20px; border: 1px solid #444;
      background: #2a2a2a; color: #e0e0e0; cursor: pointer; white-space: nowrap;
      touch-action: manipulation; transition: all 0.15s; flex-shrink: 0;
    }
    .cond-btn:active { background: #444; }
    .cond-btn.active { background: #4a9eff; border-color: #4a9eff; color: #fff; }
    .cond-btn.has-data { border-color: #4ade80; }
    .cond-btn.has-data::after { content: ' \\2713'; color: #4ade80; }
    .draw-toolbar .sep { width: 1px; height: 24px; background: #333; flex-shrink: 0; }
    .tool-btn {
      font-size: 13px; padding: 5px 12px; border-radius: 6px; border: 1px solid #444;
      background: #2a2a2a; color: #e0e0e0; cursor: pointer; touch-action: manipulation;
    }
    .tool-btn.active { background: #4a9eff; border-color: #4a9eff; color: #fff; }
    .brush-size { width: 70px; accent-color: #4a9eff; }
    .size-label { font-size: 12px; color: #888; min-width: 28px; text-align: center; }

    /* Main content area */
    .view { flex: 1; display: none; overflow: hidden; }
    .view.active { display: flex; }

    /* Draw view */
    .draw-view { flex-direction: column; }
    .canvas-area {
      flex: 1; display: flex; align-items: center; justify-content: center;
      padding: 16px; overflow: hidden; background: #111;
    }
    .canvas-wrap {
      position: relative; background: #fff; box-shadow: 0 4px 24px rgba(0,0,0,0.5);
      border-radius: 4px; overflow: hidden;
    }
    canvas { display: block; touch-action: none; cursor: crosshair; image-rendering: pixelated; image-rendering: crisp-edges; }

    /* Gallery view */
    .gallery-view {
      flex-direction: column; overflow-y: auto; padding: 20px;
      background: #111; gap: 16px;
    }
    .gallery-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 16px; padding: 0;
    }
    .gallery-card {
      background: #222; border-radius: 12px; overflow: hidden;
      border: 1px solid #333; transition: border-color 0.15s;
    }
    .gallery-card:hover { border-color: #555; }
    .gallery-card .card-img {
      width: 100%; aspect-ratio: 480/288; background: #fff;
      display: flex; align-items: center; justify-content: center;
      image-rendering: pixelated; position: relative;
    }
    .gallery-card .card-img img {
      width: 100%; height: 100%; object-fit: contain;
      image-rendering: pixelated; image-rendering: crisp-edges;
    }
    .gallery-card .card-img .empty {
      color: #999; font-size: 14px; font-style: italic;
    }
    .card-footer {
      display: flex; align-items: center; gap: 8px; padding: 10px 14px;
    }
    .card-footer .card-label { font-size: 14px; font-weight: 600; flex: 1; }
    .card-footer button {
      font-size: 12px; padding: 5px 12px; border-radius: 6px; border: 1px solid #444;
      background: #2a2a2a; color: #e0e0e0; cursor: pointer; touch-action: manipulation;
    }
    .card-footer button:active { background: #444; }
    .card-footer .edit-btn { border-color: #4a9eff; color: #4a9eff; }
    .card-footer .preview-btn { border-color: #a78bfa; color: #a78bfa; }
    .gallery-card.add-custom {
      border: 2px dashed #555; cursor: pointer; display: flex;
      align-items: center; justify-content: center; min-height: 200px;
      background: transparent;
    }
    .gallery-card.add-custom:hover { border-color: #4a9eff; }
    .gallery-card.add-custom .add-label {
      color: #888; font-size: 18px; font-weight: 600; text-align: center;
    }
    .gallery-card.add-custom:hover .add-label { color: #4a9eff; }

    /* Preview modal */
    .preview-modal {
      display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.85);
      z-index: 100; align-items: center; justify-content: center; flex-direction: column; gap: 16px;
    }
    .preview-modal.active { display: flex; }
    .preview-modal img {
      max-width: 90vw; max-height: 70vh; image-rendering: pixelated;
      border-radius: 4px; box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    }
    .preview-modal .preview-label {
      font-size: 18px; font-weight: 600; color: #fff;
    }
    .preview-modal .close-btn {
      font-size: 15px; padding: 10px 24px; border-radius: 8px; border: 1px solid #555;
      background: #333; color: #e0e0e0; cursor: pointer;
    }

    /* Status bar */
    .status-bar {
      display: flex; align-items: center; gap: 12px; padding: 6px 12px;
      background: #222; border-top: 1px solid #333; font-size: 12px; color: #888; flex-shrink: 0;
    }
    .status-bar .spacer { flex: 1; }
    .status-bar .saved { color: #4ade80; }
    .status-bar .error { color: #f87171; }
  </style>
</head>
<body>
  <!-- Top bar -->
  <div class="topbar">
    <button class="tab active" id="tabDraw" onclick="switchView('draw')">Draw</button>
    <button class="tab" id="tabGallery" onclick="switchView('gallery')">Gallery</button>
    <div class="spacer"></div>
    <div class="topbar-actions" id="drawActions">
      <button onclick="undo()">Undo</button>
      <button onclick="importPNG()">Import PNG</button>
      <button class="danger-btn" onclick="clearCanvas()">Clear</button>
      <button class="danger-btn" onclick="deleteOverlay()">Delete</button>
      <button class="save-btn" onclick="save()">Save</button>
    </div>
    <input type="file" id="fileInput" accept="image/png,image/jpeg,image/gif,image/webp" style="display:none" onchange="handleFileImport(event)">
  </div>

  <!-- Draw toolbar -->
  <div class="draw-toolbar" id="drawToolbar">
    <div class="conditions" id="conditions"></div>
    <div class="sep"></div>
    <button class="tool-btn active" id="brushBtn" onclick="setTool('brush')">Brush</button>
    <button class="tool-btn" id="eraserBtn" onclick="setTool('eraser')">Eraser</button>
    <input type="range" class="brush-size" id="brushSize" min="1" max="40" value="4" oninput="updateSizeLabel()">
    <span class="size-label" id="sizeLabel">4px</span>
  </div>

  <!-- Draw view -->
  <div class="view draw-view active" id="viewDraw">
    <div class="canvas-area">
      <div class="canvas-wrap">
        <canvas id="canvas"></canvas>
      </div>
    </div>
  </div>

  <!-- Gallery view -->
  <div class="view gallery-view" id="viewGallery">
    <div class="gallery-grid" id="galleryGrid"></div>
  </div>

  <!-- Preview modal -->
  <div class="preview-modal" id="previewModal" onclick="closePreview()">
    <span class="preview-label" id="previewLabel"></span>
    <img id="previewImg" src="">
    <button class="close-btn" onclick="closePreview()">Close</button>
  </div>

  <!-- Status bar -->
  <div class="status-bar">
    <span id="status">Ready</span>
    <div class="spacer"></div>
    <span id="coords"></span>
  </div>

  <script>
    const KEY = new URLSearchParams(location.search).get('key');
    const CONDITIONS = [
      { id: 'sunny', label: '\\u2600\\uFE0F Sunny' },
      { id: 'cloudy', label: '\\u2601\\uFE0F Cloudy' },
      { id: 'foggy', label: '\\uD83C\\uDF2B Foggy' },
      { id: 'wind', label: '\\uD83C\\uDF2C Wind' },
      { id: 'rain', label: '\\uD83C\\uDF27 Rain' },
      { id: 'snow', label: '\\u2744\\uFE0F Snow' },
      { id: 'hail', label: '\\uD83E\\uDDCA Hail' },
      { id: 'stormy', label: '\\u26C8 Stormy' },
    ];

    let currentCondition = 'sunny';
    let currentView = 'draw';
    let tool = 'brush';
    let drawing = false;
    let history = [];
    let lastPoint = null;
    let overlayStatus = {};

    // View switching
    function switchView(view) {
      currentView = view;
      document.getElementById('viewDraw').classList.toggle('active', view === 'draw');
      document.getElementById('viewGallery').classList.toggle('active', view === 'gallery');
      document.getElementById('tabDraw').classList.toggle('active', view === 'draw');
      document.getElementById('tabGallery').classList.toggle('active', view === 'gallery');
      document.getElementById('drawActions').style.display = view === 'draw' ? 'flex' : 'none';
      document.getElementById('drawToolbar').style.display = view === 'draw' ? 'flex' : 'none';
      if (view === 'gallery') loadGallery();
      if (view === 'draw') fitCanvas();
    }

    // Gallery
    async function loadGallery() {
      const grid = document.getElementById('galleryGrid');
      grid.innerHTML = '';
      try {
        const res = await fetch('/api/overlays');
        overlayStatus = await res.json();
      } catch { }

      const sorted = [...CONDITIONS].sort((a, b) => (overlayStatus[b.id] ? 1 : 0) - (overlayStatus[a.id] ? 1 : 0));
      const firstEmptyIdx = sorted.findIndex(c => !overlayStatus[c.id]);

      sorted.forEach((c, i) => {
        // Insert + CUSTOM card right before the first empty entry
        if (i === firstEmptyIdx) {
          const addCard = document.createElement('div');
          addCard.className = 'gallery-card add-custom';
          addCard.innerHTML = '<span class="add-label">+ CUSTOM</span>';
          addCard.onclick = () => { saveToLocal(currentCondition); currentCondition = 'custom'; document.querySelectorAll('.conditions .cond-btn').forEach(b => b.classList.remove('active')); clearCanvasRaw(); history = []; setStatus('Editing: custom'); switchView('draw'); };
          grid.appendChild(addCard);
        }

        const card = document.createElement('div');
        card.className = 'gallery-card';
        const hasData = overlayStatus[c.id];
        card.innerHTML =
          '<div class="card-img">' +
            (hasData
              ? '<img src="/overlay/' + c.id + '?t=' + Date.now() + '">'
              : '<span class="empty">No capybara yet</span>') +
          '</div>' +
          '<div class="card-footer">' +
            '<span class="card-label">' + c.label + '</span>' +
            (hasData ? '<button class="preview-btn" onclick="previewRender(\\'' + c.id + '\\')">Preview</button>' : '') +
            '<button class="edit-btn" onclick="editCondition(\\'' + c.id + '\\')">Edit</button>' +
          '</div>';
        grid.appendChild(card);

        // Mark condition buttons too
        const btn = document.getElementById('cond-' + c.id);
        if (btn) btn.classList.toggle('has-data', !!hasData);
      });

      // If all conditions have overlays, add the + CUSTOM card at the end
      if (firstEmptyIdx === -1) {
        const addCard = document.createElement('div');
        addCard.className = 'gallery-card add-custom';
        addCard.innerHTML = '<span class="add-label">+ CUSTOM</span>';
        addCard.onclick = () => { saveToLocal(currentCondition); currentCondition = 'custom'; document.querySelectorAll('.conditions .cond-btn').forEach(b => b.classList.remove('active')); clearCanvasRaw(); history = []; setStatus('Editing: custom'); switchView('draw'); };
        grid.appendChild(addCard);
      }
    }

    function editCondition(id) {
      selectCondition(id);
      switchView('draw');
    }

    function previewRender(id) {
      const modal = document.getElementById('previewModal');
      const img = document.getElementById('previewImg');
      const label = document.getElementById('previewLabel');
      label.textContent = CONDITIONS.find(c => c.id === id).label + ' Capybara — Live Render';
      img.src = '/image/preview_' + Date.now() + '.bmp?overlay=' + id;
      modal.classList.add('active');
    }

    function closePreview() {
      document.getElementById('previewModal').classList.remove('active');
    }

    // Canvas setup
    const DRAW_W = 480;
    const DRAW_H = 288;
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    canvas.width = DRAW_W;
    canvas.height = DRAW_H;
    ctx.imageSmoothingEnabled = false;

    function fitCanvas() {
      const area = document.querySelector('.canvas-area');
      if (!area) return;
      const maxW = area.clientWidth - 32;
      const maxH = area.clientHeight - 32;
      const scale = Math.min(maxW / DRAW_W, maxH / DRAW_H, 2.5);
      canvas.style.width = (DRAW_W * scale) + 'px';
      canvas.style.height = (DRAW_H * scale) + 'px';
    }
    fitCanvas();
    window.addEventListener('resize', () => { if (currentView === 'draw') fitCanvas(); });

    function updateSizeLabel() {
      document.getElementById('sizeLabel').textContent = document.getElementById('brushSize').value + 'px';
    }

    // Condition buttons
    const condContainer = document.getElementById('conditions');
    CONDITIONS.forEach(c => {
      const btn = document.createElement('button');
      btn.className = 'cond-btn';
      btn.textContent = c.label;
      btn.id = 'cond-' + c.id;
      btn.onclick = () => selectCondition(c.id);
      condContainer.appendChild(btn);
    });

    function selectCondition(id) {
      saveToLocal(currentCondition);
      currentCondition = id;
      document.querySelectorAll('.conditions .cond-btn').forEach(b => b.classList.remove('active'));
      document.getElementById('cond-' + id).classList.add('active');
      loadFromLocal(id);
      history = [];
      setStatus('Editing: ' + id);
    }

    function saveToLocal(id) {
      try { localStorage.setItem('overlay_' + id, canvas.toDataURL()); } catch(e) {}
    }

    function loadFromLocal(id) {
      const data = localStorage.getItem('overlay_' + id);
      clearCanvasRaw();
      if (data) {
        const img = new Image();
        img.onload = () => { ctx.imageSmoothingEnabled = false; ctx.drawImage(img, 0, 0); };
        img.src = data;
      }
    }

    // Drawing
    function getPos(e) {
      const rect = canvas.getBoundingClientRect();
      const scaleX = DRAW_W / rect.width;
      const scaleY = DRAW_H / rect.height;
      const touch = e.touches ? e.touches[0] : e;
      return {
        x: (touch.clientX - rect.left) * scaleX,
        y: (touch.clientY - rect.top) * scaleY
      };
    }

    function startDraw(e) {
      e.preventDefault();
      drawing = true;
      history.push(ctx.getImageData(0, 0, DRAW_W, DRAW_H));
      if (history.length > 50) history.shift();
      lastPoint = getPos(e);
      drawAt(lastPoint);
    }

    function moveDraw(e) {
      e.preventDefault();
      if (!drawing) return;
      const pos = getPos(e);
      document.getElementById('coords').textContent = Math.round(pos.x) + ', ' + Math.round(pos.y);
      drawLine(lastPoint, pos);
      lastPoint = pos;
    }

    function endDraw(e) {
      e.preventDefault();
      drawing = false;
      lastPoint = null;
      saveToLocal(currentCondition);
    }

    function stampPixels(x, y) {
      const size = parseInt(document.getElementById('brushSize').value);
      const half = Math.floor(size / 2);
      const px = Math.floor(x) - half;
      const py = Math.floor(y) - half;
      if (tool === 'eraser') {
        ctx.clearRect(px, py, size, size);
      } else {
        ctx.fillStyle = '#000';
        ctx.fillRect(px, py, size, size);
      }
    }

    function drawAt(pos) { stampPixels(pos.x, pos.y); }

    function drawLine(from, to) {
      const dx = Math.abs(to.x - from.x);
      const dy = Math.abs(to.y - from.y);
      const steps = Math.max(Math.ceil(dx), Math.ceil(dy), 1);
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        stampPixels(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
      }
    }

    canvas.addEventListener('pointerdown', startDraw);
    canvas.addEventListener('pointermove', moveDraw);
    canvas.addEventListener('pointerup', endDraw);
    canvas.addEventListener('pointerleave', endDraw);

    function setTool(t) {
      tool = t;
      document.getElementById('brushBtn').classList.toggle('active', t === 'brush');
      document.getElementById('eraserBtn').classList.toggle('active', t === 'eraser');
    }

    function undo() {
      if (history.length === 0) return;
      ctx.putImageData(history.pop(), 0, 0);
      saveToLocal(currentCondition);
    }

    function clearCanvasRaw() { ctx.clearRect(0, 0, DRAW_W, DRAW_H); }

    function clearCanvas() {
      history.push(ctx.getImageData(0, 0, DRAW_W, DRAW_H));
      clearCanvasRaw();
      saveToLocal(currentCondition);
      setStatus('Canvas cleared');
    }

    function importPNG() {
      document.getElementById('fileInput').click();
    }

    function handleFileImport(e) {
      const file = e.target.files[0];
      if (!file) return;
      e.target.value = '';
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          history.push(ctx.getImageData(0, 0, DRAW_W, DRAW_H));
          clearCanvasRaw();
          // Scale to fit canvas preserving aspect ratio, centered
          const scale = Math.min(DRAW_W / img.width, DRAW_H / img.height);
          const dw = Math.round(img.width * scale);
          const dh = Math.round(img.height * scale);
          const dx = Math.floor((DRAW_W - dw) / 2);
          const dy = Math.floor((DRAW_H - dh) / 2);
          ctx.drawImage(img, dx, dy, dw, dh);
          saveToLocal(currentCondition);
          setStatus('Imported: ' + file.name);
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    }

    async function save() {
      let saveAs = currentCondition;
      if (saveAs === 'custom') {
        const picked = await pickCondition();
        if (!picked) return;
        saveAs = picked;
      }
      setStatus('Saving ' + saveAs + '...');
      try {
        const b = await new Promise(r => canvas.toBlob(r, 'image/png'));
        const res = await fetch('/overlay/' + saveAs + '?key=' + KEY, {
          method: 'POST', body: b, headers: { 'Content-Type': 'image/png' }
        });
        const text = await res.text();
        if (res.ok) {
          setStatus(text, 'saved');
          const btn = document.getElementById('cond-' + saveAs);
          if (btn) btn.classList.add('has-data');
          currentCondition = saveAs;
          switchView('gallery');
        } else {
          setStatus(text, 'error');
        }
      } catch (e) { setStatus('Error: ' + e.message, 'error'); }
    }

    function pickCondition() {
      return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:200;display:flex;align-items:center;justify-content:center;';
        const box = document.createElement('div');
        box.style.cssText = 'background:#222;border-radius:12px;padding:24px;max-width:320px;width:90%;';
        box.innerHTML = '<div style="color:#fff;font-size:16px;font-weight:600;margin-bottom:16px;">Save as which condition?</div>';
        const grid = document.createElement('div');
        grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;';
        CONDITIONS.forEach(c => {
          const btn = document.createElement('button');
          btn.textContent = c.label;
          btn.style.cssText = 'padding:12px;border-radius:8px;border:1px solid #444;background:#2a2a2a;color:#e0e0e0;font-size:14px;cursor:pointer;touch-action:manipulation;';
          btn.onclick = () => { document.body.removeChild(overlay); resolve(c.id); };
          grid.appendChild(btn);
        });
        box.appendChild(grid);
        const cancel = document.createElement('button');
        cancel.textContent = 'Cancel';
        cancel.style.cssText = 'margin-top:12px;width:100%;padding:10px;border-radius:8px;border:1px solid #555;background:transparent;color:#999;font-size:14px;cursor:pointer;touch-action:manipulation;';
        cancel.onclick = () => { document.body.removeChild(overlay); resolve(null); };
        box.appendChild(cancel);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
      });
    }

    async function deleteOverlay() {
      if (!confirm('Delete "' + currentCondition + '" overlay from server?')) return;
      setStatus('Deleting ' + currentCondition + '...');
      try {
        const res = await fetch('/overlay/' + currentCondition + '?key=' + KEY, { method: 'DELETE' });
        const text = await res.text();
        if (res.ok) {
          clearCanvasRaw();
          localStorage.removeItem('overlay_' + currentCondition);
          document.getElementById('cond-' + currentCondition).classList.remove('has-data');
          setStatus(text, 'saved');
        } else { setStatus(text, 'error'); }
      } catch (e) { setStatus('Error: ' + e.message, 'error'); }
    }

    function setStatus(msg, type) {
      const el = document.getElementById('status');
      el.textContent = msg;
      el.className = type || '';
    }

    // Init: check which overlays exist, then select first
    (async () => {
      try {
        const res = await fetch('/api/overlays');
        overlayStatus = await res.json();
        CONDITIONS.forEach(c => {
          const btn = document.getElementById('cond-' + c.id);
          if (btn && overlayStatus[c.id]) btn.classList.add('has-data');
        });
      } catch {}
      selectCondition('sunny');
    })();
  </script>
</body>
</html>`;
  return c.html(html, 200, { "Cache-Control": "no-cache" });
});

export default app.fetch;
