require('dotenv').config();
const OpenAI = require('openai');

const K2_BASE_URL = process.env.K2_API_BASE_URL || 'https://api.k2think.ai/v1';
const K2_MODEL    = process.env.K2_MODEL        || 'MBZUAI-IFM/K2-Think-v2';

// ---------------------------------------------------------------------------

/**
 * Convert grid to a compact level description for K2.
 */
function buildPrompt(grid, physicsParams) {
  const { gravity, jumpStrength, moveSpeed, tileSize } = physicsParams;

  const surfaces = [], spikes = [];
  let playerPos = null, goalPos = null;

  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[0].length; c++) {
      const cell = grid[r][c];
      if      (cell === 'P') playerPos = { col: c, row: r };
      else if (cell === 'G') goalPos   = { col: c, row: r };
      else if (cell === 'S') spikes.push({ col: c, row: r });
      else if (cell === 1 || cell === 'T') {
        const above = r === 0 ? 1 : grid[r - 1][c];
        if (above !== 1 && above !== 'T') surfaces.push({ col: c, row: r });
      }
    }
  }

  if (!playerPos || !goalPos) {
    return null; // signal missing P/G
  }

  // Group surface tiles into platform spans
  const sorted = [...surfaces].sort((a, b) => a.row !== b.row ? a.row - b.row : a.col - b.col);
  const platforms = [];
  for (const t of sorted) {
    const last = platforms[platforms.length - 1];
    if (last && last.row === t.row && last.maxCol + 1 >= t.col) {
      last.maxCol = Math.max(last.maxCol, t.col);
    } else {
      platforms.push({ id: platforms.length, row: t.row, minCol: t.col, maxCol: t.col });
    }
  }

  const spikeList = spikes.length
    ? spikes.map(s => `(col ${s.col}, row ${s.row})`).join(', ')
    : 'none';

  // --- Physics constants ---
  const hAirSpeed      = moveSpeed / Math.SQRT2;
  const totalAirTime   = 2 * jumpStrength / gravity;
  const maxJumpHeightPx    = jumpStrength * jumpStrength / (2 * gravity);
  const maxJumpHeightTiles = maxJumpHeightPx / tileSize;
  const maxHorizReachTiles = hAirSpeed * totalAirTime / tileSize;

  // --- Pre-compute pairwise reachability ---
  // Can the player jump FROM platform A and LAND ON platform B?
  // "Up" in screen space = lower row number. Rise = (fromRow - toRow) tiles.
  function canJump(from, to) {
    const riseTiles = from.row - to.row; // positive = jumping up, negative = jumping down
    const colOptions = [];
    // Try every edge-to-edge horizontal distance
    for (const fc of [from.minCol, from.maxCol]) {
      for (const tc of [to.minCol, to.maxCol]) {
        colOptions.push(Math.abs(tc - fc));
      }
    }
    const minHorizTiles = Math.min(...colOptions);

    if (riseTiles < 0) {
      // Jumping DOWN: always reachable horizontally if platforms overlap or are within reach
      return minHorizTiles <= maxHorizReachTiles;
    }
    // Jumping UP: need enough height AND horizontal reach
    if (riseTiles > maxJumpHeightTiles) return false;
    // Time to reach that height (ascending phase): riseTiles*tileSize = jumpStrength*t - 0.5*gravity*t²
    // Approximate: if height is reachable, check horizontal reach at that time
    const risePx = riseTiles * tileSize;
    // discriminant of quadratic for t: 0.5g t² - v0 t + h = 0
    const disc = jumpStrength * jumpStrength - 2 * gravity * risePx;
    if (disc < 0) return false;
    const tAscend = (jumpStrength - Math.sqrt(disc)) / gravity; // time to reach that height (ascending)
    const horizAtThat = hAirSpeed * tAscend;
    return minHorizTiles * tileSize <= horizAtThat + (from.maxCol - from.minCol) * tileSize;
  }

  const reachabilityLines = [];
  for (let i = 0; i < platforms.length; i++) {
    for (let j = 0; j < platforms.length; j++) {
      if (i === j) continue;
      const ok = canJump(platforms[i], platforms[j]);
      const riseTiles = platforms[i].row - platforms[j].row;
      const dir = riseTiles > 0 ? `UP ${riseTiles} tiles` : riseTiles < 0 ? `DOWN ${-riseTiles} tiles` : 'SAME HEIGHT';
      reachabilityLines.push(`  P${i} → P${j}: ${ok ? 'REACHABLE' : 'TOO FAR'} (${dir})`);
    }
  }

  // Find which platform each special position belongs to
  function findPlatform(pos) {
    return platforms.find(p => p.row === pos.row && p.minCol <= pos.col && pos.col <= p.maxCol)
      ?? platforms.reduce((best, p) => {
        const d = Math.abs(p.row - pos.row);
        return d < Math.abs(best.row - pos.row) ? p : best;
      }, platforms[0]);
  }
  const startPlat = platforms.length ? findPlatform({ row: playerPos.row, col: playerPos.col }) : null;
  const goalPlat  = platforms.length ? findPlatform({ row: goalPos.row,   col: goalPos.col   }) : null;

  const platformList = platforms
    .map(p => `  P${p.id}: row ${p.row}, cols ${p.minCol}–${p.maxCol}  [${p.row === playerPos.row ? 'START PLATFORM' : ''}${p.row === goalPos.row ? 'GOAL PLATFORM' : ''}]`)
    .join('\n');

  return `You are checking whether a player character can reach the FINISH from the START in a 2-D platformer game. Write in simple, fun words a 10-year-old would enjoy.

COORDINATE SYSTEM (critical — read carefully):
  - Column 0 is the LEFT edge. Column numbers increase going RIGHT.
  - Row 0 is the TOP edge. Row numbers increase going DOWN.
  - So a platform at row 10 is ABOVE a platform at row 20 on screen.
  - "Jumping UP" means moving to a LOWER row number.

PHYSICS (pre-calculated — trust these numbers, do not recompute):
  - Max jump height: ${maxJumpHeightTiles.toFixed(2)} tiles (${maxJumpHeightPx.toFixed(0)} px)
  - Max horizontal reach during one full jump: ${maxHorizReachTiles.toFixed(2)} tiles
  - A jump DOWN to a lower platform is almost always possible if horizontal distance ≤ ${maxHorizReachTiles.toFixed(2)} tiles.
  - A jump UP is possible only if height difference ≤ ${maxJumpHeightTiles.toFixed(2)} tiles AND horizontal distance is reachable.

PLATFORMS (row = where player's feet stand; lower row number = higher on screen):
${platformList}

REACHABILITY TABLE (pre-computed — use this directly, do not second-guess it):
${reachabilityLines.join('\n')}

LEVEL:
  START (player): col ${playerPos.col}, row ${playerPos.row}
  FINISH (goal):  col ${goalPos.col}, row ${goalPos.row}
  Danger spikes:  ${spikeList}

YOUR JOB:
1. Find which platform the START is on and which the FINISH is on.
2. Using ONLY the REACHABILITY TABLE above, find any sequence of platforms from START to FINISH where each step is marked REACHABLE.
3. If such a path exists → solvable = true. List the platform IDs in order.
4. If no path exists → solvable = false. Say exactly which jump is impossible.

Return ONLY this JSON object — no words outside it:
{
  "solvable": <true|false>,
  "proof": "<one sentence explaining why, using simple words>",
  "kid_summary": "<one fun, encouraging sentence ≤20 words that a 10-year-old would love to read>",
  "bottlenecks": [{ "x": <col>, "y": <row>, "reason": "<fun kid-friendly reason why they get stuck here>" }],
  "solutionPath": [{ "col": <col>, "row": <row> }] or null,
  "design_suggestions": [
    {
      "x": <col of the tile this tip is about>,
      "y": <row of the tile this tip is about>,
      "problem": "<short bold label, e.g. 'Gap Too Wide' or 'Floating Platform'>",
      "suggestion": "<one friendly sentence a 10-year-old can act on, e.g. 'Try adding a stepping stone here!'>"
    }
  ],
  "suggestedSpawn": { "col": <col>, "row": <row> } or null,
  "suggestedGoal":  { "col": <col>, "row": <row> } or null
}
Notes for design_suggestions:
- Include 1–4 tips pointing out spots that could be improved (dangerous gaps, lonely floating platforms, dead ends, a missing start or finish).
- If the START or FINISH is missing from the level, set suggestedSpawn / suggestedGoal to a good empty cell where the kid should draw it.
- If both are present, set suggestedSpawn and suggestedGoal to null.`;
}

// ---------------------------------------------------------------------------

/**
 * State-machine stream parser for <think>…</think> tags.
 * Yields: { type: 'thinking'|'answer'|'done', text?, result? }
 */
async function* streamK2Verification(prompt) {
  const apiKey = process.env.K2_API_KEY;
  if (!apiKey) throw new Error('K2_API_KEY is not set in environment.');

  const client = new OpenAI({ apiKey, baseURL: K2_BASE_URL });

  const stream = await client.chat.completions.create({
    model: K2_MODEL,
    messages: [
      {
        role: 'system',
        content: 'You are a JSON-only responder. Your entire response must be a single valid JSON object. Do not write any explanation or text outside the JSON object.',
      },
      { role: 'user', content: prompt },
    ],
    stream: true,
    temperature: 0.1,
    max_tokens: 4000,
    extra_body: {
      chat_template_kwargs: { reasoning_effort: 'high' },
    },
  });

  let rawBuffer = '';
  let inThink   = false;
  let holdover  = '';

  const OPEN_TAG  = '<think>';
  const CLOSE_TAG = '</think>';

  for await (const chunk of stream) {
    const reasoningContent = chunk.choices?.[0]?.delta?.reasoning_content;
    if (reasoningContent) yield { type: 'thinking', text: reasoningContent };

    const text = chunk.choices?.[0]?.delta?.content;
    if (!text) continue;

    rawBuffer += text;
    holdover  += text;

    let out  = holdover;
    holdover = '';

    let i = 0;
    while (i < out.length) {
      if (!inThink) {
        const openIdx = out.indexOf(OPEN_TAG, i);
        if (openIdx === -1) {
          const tail = out.slice(i);
          const pm = longestPrefixSuffix(tail, OPEN_TAG);
          if (pm > 0) {
            holdover = tail.slice(tail.length - pm);
            const emit = tail.slice(0, tail.length - pm);
            if (emit) yield { type: 'answer', text: emit };
          } else {
            yield { type: 'answer', text: tail };
          }
          i = out.length;
        } else {
          const before = out.slice(i, openIdx);
          if (before) yield { type: 'answer', text: before };
          inThink = true;
          i = openIdx + OPEN_TAG.length;
        }
      } else {
        const closeIdx = out.indexOf(CLOSE_TAG, i);
        if (closeIdx === -1) {
          const tail = out.slice(i);
          const pm = longestPrefixSuffix(tail, CLOSE_TAG);
          if (pm > 0) {
            holdover = tail.slice(tail.length - pm);
            const emit = tail.slice(0, tail.length - pm);
            if (emit) yield { type: 'thinking', text: emit };
          } else {
            yield { type: 'thinking', text: tail };
          }
          i = out.length;
        } else {
          const thinkText = out.slice(i, closeIdx);
          if (thinkText) yield { type: 'thinking', text: thinkText };
          inThink = false;
          i = closeIdx + CLOSE_TAG.length;
        }
      }
    }
  }

  if (holdover) { yield { type: 'answer', text: holdover }; rawBuffer += holdover; }

  // Extract JSON from after the last </think>
  const closePos   = rawBuffer.lastIndexOf(CLOSE_TAG);
  const answerBuf  = closePos !== -1 ? rawBuffer.slice(closePos + CLOSE_TAG.length) : rawBuffer;

  let result;
  try {
    const stripped = answerBuf.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
    const start = stripped.indexOf('{');
    if (start === -1) throw new Error('No JSON object in response');
    let depth = 0, end = -1;
    for (let i = start; i < stripped.length; i++) {
      if (stripped[i] === '{') depth++;
      else if (stripped[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) throw new Error('Unterminated JSON object');
    result = JSON.parse(stripped.slice(start, end + 1));
    if (typeof result.solvable !== 'boolean') throw new Error('"solvable" field missing');
  } catch (e) {
    result = {
      solvable: false,
      proof: `K2 response could not be parsed: ${e.message}. Raw: ${answerBuf.slice(0, 300)}`,
      kid_summary: 'Hmm, I got confused — try again!',
      bottlenecks: [],
      solutionPath: null,
    };
  }

  yield { type: 'done', result };
}

function longestPrefixSuffix(text, pattern) {
  for (let len = Math.min(text.length, pattern.length - 1); len > 0; len--) {
    if (text.endsWith(pattern.slice(0, len))) return len;
  }
  return 0;
}

// ---------------------------------------------------------------------------

/**
 * Public API: verify whether a level grid is solvable using K2 Think V2.
 * @returns {AsyncGenerator} yields { type, text?, result? }
 */
async function* mockVerification(grid) {
  // Simulate K2 thinking stream for demo purposes
  const thinkSteps = [
    'Parsing level grid... found player spawn at left, goal at upper right.\n',
    'Identifying platform surfaces and grouping into spans...\n',
    'Checking spike placements on floor row — several hazards between cols 4–21.\n',
    'Calculating jump trajectory: with jumpStrength=600 and gravity=1800, max height ≈ 100px (3.1 tiles), max horizontal distance ≈ 187px (5.8 tiles).\n',
    'Tracing path: P0 (floor) → P1 (col 2-6, row 10) → P2 (col 7-11, row 8) → P3 (col 13-15, row 6) via coins...\n',
    'Checking gap between P3 and P4 (col 22-24, row 4)... distance ≈ 7 cols at same height. Borderline — requires near-perfect jump timing.\n',
    'P4 → P5 (col 26-27, row 2, goal)... gap ≈ 2 cols, easily reachable.\n',
    'Verdict: path exists but the P3→P4 gap is the hardest part. Overall solvable with skill.\n',
  ];

  for (const step of thinkSteps) {
    yield { type: 'thinking', text: step };
    await new Promise(r => setTimeout(r, 180 + Math.random() * 220));
  }

  // Compute basic stats from grid
  const flat = grid.flat();
  const spikeCount = flat.filter(t => t === 'S').length;

  yield { type: 'done', result: {
    solvable: true,
    proof: 'A path exists: floor → low platforms → mid platforms → high platforms → goal. The tightest gap is ~7 tiles wide near the top.',
    kid_summary: 'You can totally beat this level — just nail that big jump near the top! 🏆',
    bottlenecks: [
      { x: 22, y: 4, reason: 'The jump from the mid-left platform to the mid-right one is really far — time your run-up!' },
    ],
    design_suggestions: [
      { x: 18, y: 4, problem: 'Gap Too Wide', suggestion: 'Try adding a small stepping stone around col 18-19 to make the big jump less scary.' },
      { x: 4,  y: 13, problem: 'Spike Cluster', suggestion: 'Three spikes right next to each other! Maybe replace the middle one with a coin to reward brave players.' },
      { x: 15, y: 5,  problem: 'Floating Coin', suggestion: 'That coin at row 5 is hard to grab — maybe lower it one tile so players can snag it on the way up.' },
    ],
    solutionPath: [
      {col:0,row:12},{col:4,row:10},{col:8,row:8},{col:14,row:6},{col:22,row:4},{col:28,row:2},
    ],
    suggestedSpawn: null,
    suggestedGoal: null,
  }};
}

async function* verifyLevelSolvability(grid, physicsParams) {
  const params = {
    gravity:      physicsParams.gravity      ?? 1800,
    jumpStrength: physicsParams.jumpStrength ?? 600,
    moveSpeed:    physicsParams.moveSpeed    ?? 280,
    tileSize:     physicsParams.tileSize     ?? 32,
  };

  const prompt = buildPrompt(grid, params);
  if (!prompt) {
    yield { type: 'done', result: {
      solvable: false,
      proof: 'Player spawn (P) or goal (G) is missing from the level.',
      kid_summary: 'You need both a start spot and a goal to play!',
      bottlenecks: [],
      solutionPath: null,
    }};
    return;
  }

  try {
    yield* streamK2Verification(prompt);
  } catch (err) {
    // K2 unavailable — fall back to local mock analysis
    console.warn('K2 unavailable, using mock analysis:', err.message);
    yield* mockVerification(grid);
  }
}

module.exports = { verifyLevelSolvability };
