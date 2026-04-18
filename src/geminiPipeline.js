require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const sharp = require('sharp');

const MODEL = 'gemini-3-flash-preview';
const COLS = 50;
const ROWS = 35;
const MAX_RETRIES = 3;

const SYSTEM_PROMPT = `Act as a High-Precision Visual Grid Parser. Your goal is to convert a hand-drawn ${COLS}x${ROWS} grid into a structured JSON object. Use your internal thinking process to verify the contents of each cell individually before finalizing the output.

The image is a photo of standard 3-hole-punched paper placed on a table.

KNOWN PAPER FEATURES TO IGNORE:
- Three circular punch holes along one edge. They are NOT player spawn circles.
- A blank margin strip (red or blue line) near one edge. The drawable area starts past this margin.
- Printed grid/rule lines. These are guides, not fills.
- Shadows, background, table surface, anything outside the paper.

Output positions as FRACTIONS (0.0 to 1.0) of the drawable grid area — NOT pixel counts, NOT cell indices.

Detect only deliberate hand-drawn markings inside the drawable grid area:
1. Filled/shaded rectangular platform regions → bounding box as fractions.
2. A single hand-drawn circle (O) → center as fractions. NOT a punch hole.
3. A single hand-drawn star (★) → center as fractions.
4. Triangle shapes (△/▲) drawn inside a cell → danger spikes, one per cell.

Required JSON output (no text outside it):
{
  "shapes": [ { "top": <0.0–1.0>, "bottom": <0.0–1.0>, "left": <0.0–1.0>, "right": <0.0–1.0> }, ... ],
  "playerStart": { "y": <0.0–1.0>, "x": <0.0–1.0> } or null,
  "goal": { "y": <0.0–1.0>, "x": <0.0–1.0> } or null,
  "spikes": [ { "y": <0.0–1.0>, "x": <0.0–1.0> }, ... ]
}

Where top=0.0/left=0.0 is the top-left of the drawable area, bottom=1.0/right=1.0 is the bottom-right.
When in doubt about a cell, leave it empty. Punch holes, margin lines, and printed rules are never fills.`;

const USER_PROMPT = `Examine the image. The paper is standard 3-hole-punched paper with a margin line.

Step 0 — Find the drawable area:
  - Locate the three punch holes (circles on one edge). Ignore them — they are NOT spawn markers.
  - Locate the margin line (red or blue line near an edge). The drawable area starts past this margin.
  - Define the drawable rectangle: top-left = (y=0.0, x=0.0), bottom-right = (y=1.0, x=1.0).
  - Think through each cell of the ${COLS}×${ROWS} grid individually before deciding if it is marked.

Step 1 — Platforms:
  - Inside the drawable area, find every clearly and deliberately filled/shaded region.
  - Ignore: punch holes, margin line, printed lines, shadows, paper texture, noise.
  - Output each as a bounding box fraction of the drawable area.
  - Example: shape in the bottom-left quarter → top≈0.75, bottom≈1.0, left≈0.0, right≈0.25.

Step 2 — Player spawn:
  - Find a hand-drawn circle (O) inside the drawable area. Punch holes are NOT this.
  - Output center as fractions: y = vertical fraction from top, x = horizontal fraction from left.

Step 3 — Goal:
  - Find a hand-drawn star (★) inside the drawable area.
  - Output center as fractions.

Step 4 — Spikes:
  - Find every hand-drawn triangle (△/▲) inside the drawable area.
  - Output the center of each as fractions.

Return ONLY the JSON object — no words, no markdown, no reasoning text outside the JSON:
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
    .linear(1.3, -15)
    .resize(1920, null, { fit: 'inside', withoutEnlargement: true, kernel: sharp.kernel.lanczos3 })
    .jpeg({ quality: 92 })
    .toBuffer();
}

/**
 * Extract only the JSON object from a response string, ignoring any reasoning
 * text or thought signatures that Gemini 3 may include outside the JSON block.
 */
function extractJSON(text) {
  // Strip markdown fences
  const stripped = text.replace(/```(?:json)?/gi, '').replace(/```/g, '');

  // Find the outermost { ... } by balanced brace walk — more robust than lastIndexOf
  const start = stripped.indexOf('{');
  if (start === -1) throw new Error('No JSON object found in response');

  let depth = 0, end = -1;
  for (let i = start; i < stripped.length; i++) {
    if (stripped[i] === '{') depth++;
    else if (stripped[i] === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) throw new Error('Unterminated JSON object in response');

  const candidate = stripped.slice(start, end + 1);
  const parsed = JSON.parse(candidate);

  // Strict schema validation
  if (!Array.isArray(parsed.shapes))
    throw new Error('"shapes" must be an array');
  for (const s of parsed.shapes) {
    for (const k of ['top', 'bottom', 'left', 'right']) {
      if (typeof s[k] !== 'number' || s[k] < 0 || s[k] > 1)
        throw new Error(`Shape has invalid "${k}": ${s[k]}`);
    }
  }
  if (parsed.playerStart !== null && parsed.playerStart !== undefined) {
    if (typeof parsed.playerStart.x !== 'number' || typeof parsed.playerStart.y !== 'number')
      throw new Error('"playerStart" must have numeric x and y');
  }
  if (parsed.goal !== null && parsed.goal !== undefined) {
    if (typeof parsed.goal.x !== 'number' || typeof parsed.goal.y !== 'number')
      throw new Error('"goal" must have numeric x and y');
  }

  return parsed;
}

/**
 * Convert fraction-based bounding boxes into a ROWS×COLS binary grid.
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

/** Convert a fraction-based {x, y} point to a {row, col} grid cell. */
function fracToCell(pt) {
  if (!pt) return null;
  return {
    row: Math.min(ROWS - 1, Math.max(0, Math.floor(pt.y * ROWS))),
    col: Math.min(COLS - 1, Math.max(0, Math.floor(pt.x * COLS))),
  };
}

/**
 * Extract the text answer from a Gemini response, handling Gemini 3 thought
 * parts and thought signatures (used in multi-turn sessions).
 *
 * Returns { text, thoughtSignature }
 */
function extractResponseText(response) {
  let text = '';
  let thoughtSignature = null;

  const parts = response.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    if (part.thought) {
      // Thinking part — capture signature for potential multi-turn reuse
      if (part.thoughtSignature) thoughtSignature = part.thoughtSignature;
    } else if (typeof part.text === 'string') {
      text += part.text;
    }
  }

  // Fallback: use the convenience .text() method if parts yielded nothing
  if (!text) {
    try { text = response.text(); } catch { /* ignore */ }
  }

  return { text, thoughtSignature };
}

/**
 * Convert an image buffer to a ROWS×COLS level grid using Gemini 3 Flash.
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
      thinkingConfig: {
        thinkingLevel: 'MEDIUM',
      },
    },
  });

  const processedBuffer = await preprocessImage(imageBuffer);
  const base64 = processedBuffer.toString('base64');

  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 1) console.warn(`[retry ${attempt}/${MAX_RETRIES}] Previous attempt failed: ${lastError.message}`);

    const result = await model.generateContent([
      { text: USER_PROMPT },
      {
        inlineData: {
          mimeType: 'image/jpeg',
          data: base64,
        },
      },
    ]);

    const { text, thoughtSignature } = extractResponseText(result.response);
    console.log(`[debug attempt ${attempt}] Response preview:`, text.slice(0, 300));
    if (thoughtSignature) console.log('[debug] Thought signature present (length:', thoughtSignature.length, ')');

    try {
      const obj        = extractJSON(text);
      const grid       = shapesToGrid(obj.shapes);
      const playerStart = fracToCell(obj.playerStart);
      const goal       = fracToCell(obj.goal);
      const spikes     = Array.isArray(obj.spikes) ? obj.spikes.map(fracToCell).filter(Boolean) : [];
      return { grid, playerStart, goal, spikes, thoughtSignature };
    } catch (e) {
      lastError = e;
      console.warn(`[debug attempt ${attempt}] Parse error: ${e.message}`);
    }
  }

  throw new Error(`Conversion failed after ${MAX_RETRIES} attempts. Last error: ${lastError.message}`);
}

module.exports = { processLevelWithGemini, COLS, ROWS };
