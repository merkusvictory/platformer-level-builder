require('dotenv').config();
const OpenAI = require('openai');
const sharp = require('sharp');

const MODEL = 'gpt-5.4-mini';
const COLS = 50;
const ROWS = 35;
const MAX_RETRIES = 3;

const SYSTEM_PROMPT = `You are a precise image-to-grid converter for a 2-D platformer level editor.
Analyse the image of hand-drawn grid paper and output ONLY a valid JSON object — no explanation, no markdown.

The grid is ${COLS} columns wide and ${ROWS} rows tall (col 0 = left, row 0 = top).

CRITICAL DISTINCTION — grid lines vs. filled cells:
- The paper has thin horizontal and vertical lines that form the cell grid. These structural lines cross every row and column. They are NOT fills. Do NOT mark a cell as 1 just because a grid line passes through it.
- A cell is 1 (platform) ONLY if its interior area is solidly shaded or filled with pencil — meaning the space INSIDE the cell boundaries is darkened, not just the lines around it.
- A cell is 0 (air) if its interior is white/blank, even if grid lines border it.
- A full row of 1s is almost never correct unless every single cell in that row is visibly filled with solid pencil shading.

Required output format (no other text):
{ "level_data": [[...${COLS} values for row 0...], [...row 1...], ..., [...row ${ROWS - 1}...]] }

Every row must have exactly ${COLS} values. There must be exactly ${ROWS} rows. Values must be 0 or 1.`;

const USER_PROMPT = `Analyse this grid-paper image step by step:
1. Locate the outer boundary of the drawn grid.
2. Divide the interior into a ${COLS}-column × ${ROWS}-row grid.
3. For each cell, look only at the interior of that cell (ignore the lines forming its border).
4. Mark a cell 1 ONLY if pencil shading fills the cell interior. Mark it 0 if the interior is white/blank.
5. Be suspicious of any row where every column is 1 — that almost certainly means you are reading a grid line, not filled cells.
6. Return a JSON object: { "level_data": [[row0], [row1], ...] }`;

/**
 * Normalise → threshold → resize so pencil marks become solid black
 * and blank paper becomes white, without making the image unreadable.
 */
async function preprocessImage(imageBuffer) {
  return sharp(imageBuffer)
    .grayscale()
    .normalise()          // stretch histogram so darkest mark → 0, brightest paper → 255
    .linear(1.8, -40)    // boost contrast without binarising — keeps image readable
    .resize(1024, null, { fit: 'inside', withoutEnlargement: true, kernel: sharp.kernel.lanczos3 })
    .jpeg({ quality: 90 })
    .toBuffer();
}

/**
 * Strip markdown fences and extract the first JSON object from text.
 */
function extractJSON(text) {
  const stripped = text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object in response');
  return JSON.parse(stripped.slice(start, end + 1));
}

/**
 * Normalize and validate level_data into an exact ROWS × COLS binary array.
 * Pads short rows/missing rows with zeros; trims extras. Throws only on
 * structural issues that can't be repaired (not an array, non-binary values).
 */
function validateLevelData(data) {
  if (!Array.isArray(data)) throw new Error('"level_data" is not an array');

  const emptyRow = () => Array(COLS).fill(0);

  // Normalize each row to exactly COLS values
  const normalized = data.map((row, r) => {
    if (!Array.isArray(row)) throw new Error(`Row ${r} is not an array`);
    const fixed = Array(COLS).fill(0);
    for (let c = 0; c < Math.min(row.length, COLS); c++) {
      const v = row[c];
      if (v !== 0 && v !== 1) throw new Error(`Row ${r} col ${c}: expected 0 or 1, got ${v}`);
      fixed[c] = v;
    }
    return fixed;
  });

  // Pad missing rows with empty rows; trim excess rows
  while (normalized.length < ROWS) normalized.push(emptyRow());
  if (normalized.length > ROWS) {
    normalized.splice(ROWS);
    console.warn(`[warn] Model returned ${data.length} rows; trimmed to ${ROWS}.`);
  } else if (data.length < ROWS) {
    console.warn(`[warn] Model returned ${data.length} rows; padded to ${ROWS} with empty rows.`);
  }

  return normalized;
}

/**
 * Convert an image buffer to a ROWS×COLS binary level grid using GPT-5.4-mini vision.
 * Retries up to MAX_RETRIES times if the model returns unparseable JSON.
 *
 * @param {Buffer} imageBuffer  Raw image bytes
 * @param {string} [apiKey]     OpenAI key — falls back to OPENAI_API_KEY env var
 * @returns {Promise<number[][]>}
 */
async function processLevelWithGPT5(imageBuffer, apiKey) {
  const key = apiKey || process.env.OPENAI_API_KEY;
  if (!key) throw new Error('No OpenAI API key. Set OPENAI_API_KEY in your environment.');

  const client = new OpenAI({ apiKey: key });

  const processedBuffer = await preprocessImage(imageBuffer);
  const base64 = processedBuffer.toString('base64');

  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 1) console.warn(`[retry ${attempt}/${MAX_RETRIES}] Previous attempt failed: ${lastError.message}`);

    const response = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: USER_PROMPT },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}`, detail: 'high' } },
          ],
        },
      ],
      max_completion_tokens: 8192,
      temperature: 0,
    });

    const text = response.choices?.[0]?.message?.content ?? '';
    console.log(`[debug attempt ${attempt}] Response preview:`, text.slice(0, 200));

    try {
      const obj = extractJSON(text);
      return validateLevelData(obj.level_data);
    } catch (e) {
      lastError = e;
    }
  }

  throw new Error(`Conversion failed after ${MAX_RETRIES} attempts. Last error: ${lastError.message}`);
}

module.exports = { processLevelWithGPT5, COLS, ROWS };
