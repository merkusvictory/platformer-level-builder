require('dotenv').config();
const fs = require('fs');
const { processLevelWithGPT5, COLS, ROWS } = require('./gpt5Pipeline');

/**
 * Full pipeline: imageBuffer → GPT-5.4-mini Vision → validated 2-D binary grid
 *
 * @param {Buffer} imageBuffer  Raw image bytes (JPEG, PNG, etc.)
 * @param {string} [apiKey]     OpenAI key — falls back to OPENAI_API_KEY env var
 */
async function processLevelImage(imageBuffer, apiKey) {
  console.log('[1/2] Pre-processing image and calling GPT-5.4-mini Vision…');
  const grid = await processLevelWithGPT5(imageBuffer, apiKey);

  console.log('[2/2] Validation passed.');
  return {
    width: COLS,
    height: ROWS,
    data: grid,
    playerStart: null,
    goal: null,
  };
}

/**
 * Convenience entry point: takes a file path instead of a buffer.
 */
async function convertPhotoToLevel(imagePath) {
  const imageBuffer = fs.readFileSync(imagePath);
  return processLevelImage(imageBuffer);
}

module.exports = { convertPhotoToLevel, processLevelImage };
