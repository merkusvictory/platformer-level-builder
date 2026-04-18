const axios = require('axios');
const { GRID_WIDTH, GRID_HEIGHT } = require('./config');

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4o';

const SYSTEM_PROMPT = `You are a precise image-to-grid converter for a 2-D platformer level builder.
Your only job is to analyse a pre-processed black-and-white photo of hand-drawn grid paper and output a JSON object — nothing else.

The image has been binarized: pencil shading is solid black, blank paper is white.

Output format — a single top-level JSON object, no markdown fences, no other text:
{
  "grid": [[...row 0 of ${GRID_WIDTH} values...], ..., [...row ${GRID_HEIGHT - 1}...]],
  "playerStart": {"row": <r>, "col": <c>} or null,
  "goal": {"row": <r>, "col": <c>} or null
}

Every row must have exactly ${GRID_WIDTH} values (0 or 1). There must be exactly ${GRID_HEIGHT} rows.`;

const USER_PROMPT = `Analyse this binarized grid-paper image using the following steps:

1. Identify the primary grid boundaries (the outer border of the drawn grid).
2. Divide the interior evenly into a ${GRID_WIDTH}-column × ${GRID_HEIGHT}-row grid.
3. Perform a cell-by-cell scan across all ${GRID_HEIGHT} rows and ${GRID_WIDTH} columns.
4. A cell is a Platform (1) if it contains significant black pixels or shading.
5. A cell is Empty (0) if it is mostly white.
6. If a cell contains a circle marker, set "playerStart" to that cell's row and col.
7. If a cell contains a star marker, set "goal" to that cell's row and col.

Return a valid JSON object with the structure: { "grid": [[0,1,0,...], [...]], "playerStart": ..., "goal": ... }`;

/**
 * Send the pre-processed image to GPT-4o Vision and return the raw response text.
 */
async function callVisionApi(base64Image, apiKey) {
  const response = await axios.post(
    OPENAI_API_URL,
    {
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: USER_PROMPT },
            {
              type: 'image_url',
              image_url: { url: `data:image/jpeg;base64,${base64Image}`, detail: 'high' },
            },
          ],
        },
      ],
      max_completion_tokens: 16384,
      temperature: 0,
    },
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      timeout: 60_000,
    }
  );

  const choice = response.data.choices?.[0];
  if (!choice) throw new Error('OpenAI returned no choices');
  return choice.message.content;
}

module.exports = { callVisionApi };
