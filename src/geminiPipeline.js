require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const sharp = require('sharp');

const MODEL = 'gemini-2.5-flash-lite';
const COLS = 50;
const ROWS = 35;
const MAX_RETRIES = 3;

const SYSTEM_PROMPT = `You are a precise image-to-grid converter for a 2-D platformer level editor.
Output ONLY a valid JSON object — no explanation, no markdown, no extra text.

The image is a photo of standard 3-hole-punched paper placed on a table.

KNOWN PAPER FEATURES TO IGNORE:
- Three circular punch holes along one edge. They are NOT player spawn circles.
- A blank margin strip (red or blue line) near one edge. The drawable area starts past this margin.
- Printed grid/rule lines. These are guides, not fills.
- Shadows, background, table surface, anything outside the paper.

You will output positions as FRACTIONS (0.0 to 1.0) of the drawable grid area width and height — NOT pixel counts, NOT cell indices. This removes any guesswork about cell sizes.

Detect only deliberate hand-drawn markings inside the drawable grid area:
1. Filled/shaded rectangular platform regions → bounding box as fractions.
2. A single hand-drawn circle (O) → center as fractions. NOT a punch hole.
3. A single hand-drawn star (★) → center as fractions.
4. Triangle shapes drawn inside a cell → danger spikes. Each triangle occupies roughly one cell.

Required output:
{
  "shapes": [ { "top": <0.0–1.0>, "bottom": <0.0–1.0>, "left": <0.0–1.0>, "right": <0.0–1.0> }, ... ],
  "playerStart": { "y": <0.0–1.0>, "x": <0.0–1.0> } or null,
  "goal": { "y": <0.0–1.0>, "x": <0.0–1.0> } or null,
  "spikes": [ { "y": <0.0–1.0>, "x": <0.0–1.0> }, ... ]
}

Where top=0.0 is the top edge of the drawable area, bottom=1.0 is the bottom edge, left=0.0 is the left edge, right=1.0 is the right edge.
Doubt = empty. If no deliberate markings, return { "shapes": [], "playerStart": null, "goal": null, "spikes": [] }.`;

const USER_PROMPT = `Examine the image. The paper is standard 3-hole-punched paper with a margin line.

Step 0 — Find the drawable area:
  - Locate the three punch holes (circles on one edge). Ignore them entirely — they are NOT spawn markers.
  - Locate the margin line (red or blue line near an edge). The drawable area starts past this margin.
  - The drawable area is the rectangular region of the paper that is past the margin and away from the punch holes.
  - Define this rectangle: its top-left corner is (y=0.0, x=0.0) and its bottom-right corner is (y=1.0, x=1.0).

Step 1 — Platforms:
  - Inside the drawable area only, find every clearly and deliberately filled/shaded region.
  - Ignore: punch holes, margin line, printed lines, shadows, paper texture, noise.
  - For each filled region output its bounding box as fractions of the drawable area:
    top = (distance from top of drawable area to top of shape) / (height of drawable area)
    bottom = (distance from top of drawable area to bottom of shape) / (height of drawable area)
    left = (distance from left of drawable area to left of shape) / (width of drawable area)
    right = (distance from left of drawable area to right of shape) / (width of drawable area)
  - Example: a shape in the bottom-left quarter → top≈0.75, bottom≈1.0, left≈0.0, right≈0.25.
  - Example: a shape spanning the full bottom row → top≈0.9, bottom≈1.0, left≈0.0, right≈1.0.

Step 2 — Player spawn:
  - Find a hand-drawn circle (O) inside the drawable area. Punch holes are NOT this.
  - Output its center as fractions: y = vertical fraction from top, x = horizontal fraction from left.

Step 3 — Goal:
  - Find a hand-drawn star (★) inside the drawable area.
  - Output its center as fractions: y = vertical fraction from top, x = horizontal fraction from left.

Step 4 — Spikes:
  - Find every hand-drawn triangle (△ or ▲) inside the drawable area. These are danger spikes.
  - Each triangle fits inside roughly one grid cell.
  - Output the center of each triangle cell as fractions: y = vertical fraction from top, x = horizontal fraction from left.
  - If none found, output an empty array.

Return:
{
  "shapes": [ { "top": ..., "bottom": ..., "left": ..., "right": ... }, ... ],
  "playerStart": { "y": ..., "x": ... } or null,
  "goal": { "y": ..., "x": ... } or null,
  "spikes": [ { "y": ..., "x": ... }, ... ]
}`;

async function preprocessImage(imageBuffer) {
  return sharp(imageBuffer)
    .grayscale()
    .normalise()
    .linear(1.3, -15)  // gentler boost — avoids turning shadows into fake platforms
    .resize(1920, null, { fit: 'inside', withoutEnlargement: true, kernel: sharp.kernel.lanczos3 })
    .jpeg({ quality: 90 })
    .toBuffer();
}

function extractJSON(text) {
  const stripped = text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object in response');
  return JSON.parse(stripped.slice(start, end + 1));
}

/**
 * Convert fraction-based bounding boxes into a ROWS×COLS binary grid.
 * Each shape has { top, bottom, left, right } as 0.0–1.0 fractions of the drawable area.
 */
function shapesToGrid(shapes) {
  const grid = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
  for (const s of shapes) {
    const r0 = Math.max(0, Math.floor(s.top    * ROWS));
    const r1 = Math.min(ROWS - 1, Math.ceil(s.bottom * ROWS) - 1);
    const c0 = Math.max(0, Math.floor(s.left   * COLS));
    const c1 = Math.min(COLS - 1, Math.ceil(s.right  * COLS) - 1);
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++)
        grid[r][c] = 1;
  }
  return grid;
}

/** Convert a fraction-based point to a grid cell. */
function fracToCell(pt) {
  if (!pt) return null;
  return {
    row: Math.min(ROWS - 1, Math.max(0, Math.floor(pt.y * ROWS))),
    col: Math.min(COLS - 1, Math.max(0, Math.floor(pt.x * COLS))),
  };
}

/**
 * Convert an image buffer to a ROWS×COLS binary level grid using Gemini 2.5 Flash.
 * The model outputs shape bounding boxes; the grid is built programmatically.
 */
async function processLevelWithGemini(imageBuffer, apiKey) {
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key) throw new Error('No Gemini API key. Set GEMINI_API_KEY in your environment.');

  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({
    model: MODEL,
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 65536,
    },
  });

  const processedBuffer = await preprocessImage(imageBuffer);
  const base64 = processedBuffer.toString('base64');

  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 1) console.warn(`[retry ${attempt}/${MAX_RETRIES}] Previous attempt failed: ${lastError.message}`);

    const result = await model.generateContent([
      { text: USER_PROMPT },
      { inlineData: { mimeType: 'image/jpeg', data: base64 } },
    ]);

    const text = result.response.text();
    console.log(`[debug attempt ${attempt}] Response preview:`, text.slice(0, 300));

    try {
      const obj = extractJSON(text);
      if (!Array.isArray(obj.shapes)) throw new Error('"shapes" is not an array');
      const grid        = shapesToGrid(obj.shapes);
      const playerStart = fracToCell(obj.playerStart);
      const goal        = fracToCell(obj.goal);
      const spikes      = Array.isArray(obj.spikes) ? obj.spikes.map(fracToCell).filter(Boolean) : [];
      return { grid, playerStart, goal, spikes };
    } catch (e) {
      lastError = e;
    }
  }

  throw new Error(`Conversion failed after ${MAX_RETRIES} attempts. Last error: ${lastError.message}`);
}

module.exports = { processLevelWithGemini, COLS, ROWS };
