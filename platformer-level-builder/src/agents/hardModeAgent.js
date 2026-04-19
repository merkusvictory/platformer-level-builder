'use strict';

const { ChatOpenAI } = require('@langchain/openai');
const { z }          = require('zod');

// ---------------------------------------------------------------------------
// Zod schema for the structured output from Kimi K2
// ---------------------------------------------------------------------------
const ChangeSchema = z.object({
  type:      z.string(),
  location:  z.object({ x: z.number().int(), y: z.number().int() }),
  diagnosis: z.string(),
  reason:    z.string(),
});

const HardModeOutputSchema = z.object({
  level:               z.any(),
  changes:             z.array(ChangeSchema),
  difficulty_estimate: z.number().min(1).max(10),
});

// Tiles the agent must never overwrite
const PROTECTED = new Set(['P', 'G']);

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `You are a level designer for a grid-based 2D platformer. You receive an EASY level (grid tiles at integer x,y) and TELEMETRY from how a specific player played it. You output a HARDER level tailored to that player.

You must reason in THREE PHASES before writing any tiles. Do not skip phases. Do not merge them.

PHASE 1: DIAGNOSE THE PLAYER.
From the telemetry, identify 2 to 4 concrete facts about this player. Each fact must cite a number.
Examples of real diagnoses:
- "Player died 4 of 5 times at x=12, y=8. This is a single jump the player cannot land."
- "Player's jumpsPerSecond is 2.8, above the 1.5 average. Player spams jump instead of timing it."
- "Player collected 12 of 12 coins and idled 0ms. Player is a completionist who explores every tile."
- "Player reached goal in 18s with 0 deaths. Player is skilled and bored."
Bad diagnoses (do not do these):
- "Player is bad" (no number)
- "Player needs a challenge" (vague)
- "Player died a lot" (where? why?)

PHASE 2: PLAN 3 TO 5 INTERVENTIONS.
Each intervention must name:
- The diagnosis it addresses (from Phase 1).
- The exact grid location (x, y) or small region it targets.
- The tile type it uses and why that tile type specifically.
Rules for interventions:
- An intervention must CHANGE player behavior, not just kill them. "Add a saw at x=5" is weak. "Add a saw at x=5 that forces the player to wait for the moving_platform cycle before jumping" is strong.
- At least ONE intervention must exploit a PATTERN in how they played, not just where they died. Jump-spammers get crumble tiles (punishes mashing). Completionists get coins behind enemies (tempts them into danger). Speedrunners get moving platforms with timing windows (forces patience).
- Do NOT stack 5 hazards in the same 3x3 region. Spread interventions across the level.
- Preserve spawn tile and goal tile exactly. Do not move them. Do not block them.

PHASE 3: BUILD THE LEVEL.
Emit the full level JSON. Start from the EASY level's grid and apply your interventions. Keep the map dimensions identical. Do not remove existing platforms unless an intervention explicitly replaces one (e.g., swapping a solid tile for a crumble).

OUTPUT SCHEMA (required):
{
  "level": { ...same shape as input level, with modifications... },
  "changes": [
    {
      "type": "added_enemy_walker" | "added_enemy_flyer" | "added_saw" | "added_spring" | "replaced_with_crumble" | "added_moving_platform" | "moved_coin" | "added_spike",
      "location": { "x": int, "y": int },
      "diagnosis": "<the Phase 1 fact this addresses, verbatim>",
      "reason": "<one sentence, plain English, what this tile forces the player to do differently>"
    }
  ],
  "difficulty_estimate": <integer 1-10>
}

HARD CONSTRAINTS:
- The level must be beatable. Walk through it mentally. If you added a gap wider than 4 tiles with no platform, you failed.
- Target 2 to 3x difficulty, not 10x. A player who finished Easy in 18s should finish Hard in 40 to 60s, not never.
- changes.length MUST equal the number of interventions from Phase 2. No ghost changes, no missing ones.
- Every entry in changes.reason must explain player behavior change, not just what was added. "Added saw" is wrong. "Saw forces the player to jump on the rising edge of the platform cycle" is right.

If telemetry is sparse (player quit in under 5 seconds, zero deaths, zero jumps), diagnose that itself: the player bounced. Respond with interventions that add curiosity hooks (visible coins behind a new hazard) rather than raw difficulty.`;

const DIFFICULTY_INSTRUCTIONS = {
  light:  `DIFFICULTY OVERRIDE: Target only a MILD increase (1.3x). Limit to 2-3 interventions. difficulty_estimate 4-6.`,
  medium: `DIFFICULTY OVERRIDE: Target a MODERATE increase (2x). Use 4-5 interventions. difficulty_estimate 6-8.`,
  brutal: `DIFFICULTY OVERRIDE: Target a BRUTAL increase (3x+). Use 5 interventions, all high-impact. difficulty_estimate 8-10.`,
};

function buildSystemPrompt(difficulty) {
  const diffInstr = DIFFICULTY_INSTRUCTIONS[difficulty] || DIFFICULTY_INSTRUCTIONS.medium;
  return `${SYSTEM_PROMPT}\n\n${diffInstr}`;
}

// ---------------------------------------------------------------------------
// Strip prose/code-fence wrappers from model output before JSON.parse
// ---------------------------------------------------------------------------
function stripToJson(raw) {
  const stripped = raw.replace(/^```[a-z]*\n?/im, '').replace(/```\s*$/m, '').trim();
  const start = stripped.indexOf('{');
  const end   = stripped.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object found in model output');
  return stripped.slice(start, end + 1);
}

// ---------------------------------------------------------------------------
// Build a concise telemetry summary for the prompt
// ---------------------------------------------------------------------------
function summarizeTelemetry(telemetry) {
  const t = telemetry || {};
  const deathsByZone = {};
  for (const dp of (t.deathPoints || [])) {
    const key = `col ${dp.col}, row ${dp.row}`;
    deathsByZone[key] = (deathsByZone[key] || 0) + 1;
  }
  const hotspots = Object.entries(deathsByZone)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k, v]) => `${k} (${v} death${v > 1 ? 's' : ''})`);

  const elapsed = t.endTime && t.startTime ? ((t.endTime - t.startTime) / 1000).toFixed(1) : 'unknown';

  return [
    `Total deaths: ${t.deaths || 0}`,
    `Death hotspots: ${hotspots.length ? hotspots.join(', ') : 'none'}`,
    `Jumps: ${t.jumps || 0}`,
    `Coins collected: ${t.coinsCollected || 0} / ${t.coinsTotal || 0}`,
    `Idle time: ${(t.idleTime || 0).toFixed(1)}s`,
    `Time played: ${elapsed}s`,
    `Reached goal: ${t.reachedGoal ? 'yes' : 'no'}`,
    `Path samples (col,row): ${(t.pathSampled || []).slice(0, 20).map(p => `(${p.col},${p.row})`).join(' ')}`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Invoke with up to 2 retries, stripping fences and validating schema each time
// ---------------------------------------------------------------------------
async function invokeWithRetry(model, messages, retries = 2) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // withStructuredOutput may not be supported by all OpenAI-compat endpoints.
      // Use raw invoke + manual parse for maximum compatibility.
      const result = await model.invoke(messages);
      const raw    = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
      const jsonStr = stripToJson(raw);
      const parsed  = JSON.parse(jsonStr);
      return HardModeOutputSchema.parse(parsed);
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        console.warn(`[hardModeAgent] attempt ${attempt + 1} failed: ${err.message} — retrying`);
      }
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
async function invoke({ level, telemetry, difficulty = 'medium' }) {
  const model = new ChatOpenAI({
    apiKey: process.env.LLM_API_KEY || process.env.K2_API_KEY,
    model:  process.env.LLM_MODEL   || 'kimi-k2-0905-preview',
    configuration: {
      baseURL: process.env.LLM_BASE_URL || 'https://api.moonshot.ai/v1',
    },
    temperature: 0.7,
    maxTokens:   2048,
  });

  const telemetrySummary = summarizeTelemetry(telemetry);
  const gridStr = JSON.stringify(level.data);

  const messages = [
    { role: 'system', content: buildSystemPrompt(difficulty) },
    {
      role: 'user',
      content: `Level grid (${level.height || level.data.length} rows x ${level.width || (level.data[0]?.length ?? 0)} cols):\n${gridStr}\n\nPlayer telemetry:\n${telemetrySummary}\n\nRemix this level to be harder, targeting the weaknesses above.`,
    },
  ];

  const output = await invokeWithRetry(model, messages, 2);

  // Model returns the full modified level grid directly
  const newData = output.level?.data ?? output.level;
  const newGrid = Array.isArray(newData) ? newData : level.data.map(r => r.slice());

  return {
    level: {
      data:        newGrid,
      width:       level.width  || (newGrid[0]?.length ?? 0),
      height:      level.height || newGrid.length,
      playerStart: level.playerStart || null,
      goal:        level.goal        || null,
    },
    changes:             output.changes,
    difficulty_estimate: output.difficulty_estimate,
  };
}

module.exports = { invoke };
