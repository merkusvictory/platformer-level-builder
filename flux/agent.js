'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const hardModeAgent = require('../src/agents/hardModeAgent');

const BACKEND_URL  = (process.env.BACKEND_URL  || 'http://localhost:3000').replace(/\/$/, '');
const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');

// Matches: bare IDs (abc123), "remix abc123", full play URLs
const LEVEL_ID_RE = /(?:play\/|remix\s+)?([a-z0-9]{4,12})(?:[^a-z0-9]|$)/i;

// Synthetic telemetry for a bored completionist who did not actually play.
// Nudges the agent toward interesting changes rather than trivial spike spam.
const DEFAULT_TELEMETRY = {
  deaths:         0,
  deathPoints:    [],
  jumps:          0,
  coinsCollected: 0,
  coinsTotal:     0,
  reachedGoal:    true,
  idleTime:       0,
  pathSampled:    [],
  startTime:      Date.now(),
  endTime:        Date.now() + 30000,
};

function nonce() {
  return Math.random().toString(36).slice(2, 6);
}

module.exports = {
  async invoke({ message }) {
    try {
      const match = LEVEL_ID_RE.exec(message.trim());
      if (!match) {
        return 'Send me a level ID or a play URL and I will remix it. Example: remix abc123';
      }

      const levelId = match[1].toLowerCase();

      // Fetch the original level from the backend store
      const fetchRes = await fetch(`${BACKEND_URL}/api/levels/${levelId}`);
      if (!fetchRes.ok) {
        return `Couldn't find level ${levelId}. Double-check the ID.`;
      }
      const level = await fetchRes.json();

      // Build the level shape expected by hardModeAgent
      const levelInput = {
        data:        level.data,
        width:       level.width  || (level.data[0]?.length ?? 0),
        height:      level.height || level.data.length,
        playerStart: level.playerStart || null,
        goal:        level.goal        || null,
      };

      // Run the hard mode agent
      const result = await hardModeAgent.invoke({
        level:      levelInput,
        telemetry:  DEFAULT_TELEMETRY,
        difficulty: 'medium',
      });

      // Save the remixed level
      const newLevelId = `${levelId}-hard-${nonce()}`;
      const saveRes = await fetch(`${BACKEND_URL}/api/levels`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          ...result.level,
          title: `${level.title || levelId} (Hard Remix)`,
        }),
      });

      let finalId = newLevelId;
      if (saveRes.ok) {
        const saved = await saveRes.json();
        finalId = saved.id || newLevelId;
      }

      const playUrl   = `${FRONTEND_URL}/play/${finalId}`;
      const topChange = result.changes?.[0]?.description || 'new hazards added';
      const difficulty = result.difficulty_estimate ?? '?';

      return `Hard version ready: ${playUrl}\n\nDifficulty: ${difficulty}/10\nWhat changed: ${topChange}`;

    } catch (err) {
      console.error('[flux/agent] error:', err);
      return 'Something broke on my end. Try again in a sec.';
    }
  },
};
