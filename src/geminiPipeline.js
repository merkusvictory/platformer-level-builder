require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const sharp = require('sharp');

const MODEL = 'gemini-2.5-flash';
const COLS = 50;
const ROWS = 35;
const MAX_RETRIES = 3;

const SYSTEM_PROMPT = `You are a precise image-to-grid converter for a 2-D platformer level editor.
Output ONLY a valid JSON object — no explanation, no markdown, no extra text.

The image shows hand-drawn grid paper with a ${COLS}-column × ${ROWS}-row cell grid (col 0 = left, row 0 = top).

Instead of listing every cell, describe each filled/shaded region as a rectangle:
- "row_start" and "row_end": first and last filled row (inclusive, 0-indexed)
- "col_start" and "col_end": first and last filled column (inclusive, 0-indexed)

Required output:
{ "shapes": [ { "row_start": <r>, "row_end": <r>, "col_start": <c>, "col_end": <c> }, ... ] }

Rules:
- Include one entry per distinct filled rectangle.
- Grid lines are NOT fills — only solid shaded/pencilled cell interiors count.
- If no shapes are filled, return { "shapes": [] }.`;

const USER_PROMPT = `Examine the image and identify every shaded or filled rectangular region on the grid.

Important: treat each visually disconnected filled region as its own separate shape. If two filled areas are separated by even one empty row or column of blank cells, they must be listed as two separate shapes — do not merge them into one bounding box.

For each region, count the exact start and end row and column (0-indexed) within the ${COLS}×${ROWS} grid.
Return: { "shapes": [ { "row_start": ..., "row_end": ..., "col_start": ..., "col_end": ... }, ... ] }`;

async function preprocessImage(imageBuffer) {
  return sharp(imageBuffer)
    .grayscale()
    .normalise()
    .linear(1.8, -40)
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
 * Convert shape bounding boxes into a ROWS×COLS binary grid.
 */
function shapesToGrid(shapes) {
  const grid = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
  for (const s of shapes) {
    const r0 = Math.max(0, s.row_start);
    const r1 = Math.min(ROWS - 1, s.row_end);
    const c0 = Math.max(0, s.col_start);
    const c1 = Math.min(COLS - 1, s.col_end);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        grid[r][c] = 1;
      }
    }
  }
  return grid;
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
      thinkingConfig: { thinkingBudget: 24576 },
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
      return shapesToGrid(obj.shapes);
    } catch (e) {
      lastError = e;
    }
  }

  throw new Error(`Conversion failed after ${MAX_RETRIES} attempts. Last error: ${lastError.message}`);
}

module.exports = { processLevelWithGemini, COLS, ROWS };
