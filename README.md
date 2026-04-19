# HopIt

Turn a hand-drawn sketch into a playable platformer level in seconds — powered by Gemini Vision AI.

## What it does

1. **Sketch** a platformer level on grid paper using simple symbols
2. **Upload** a photo or capture it with your camera
3. **Gemini 2.5 Flash** reads platforms, spikes, coins, goal, and spawn from the image
4. **Play** the generated level instantly in the browser
5. **Edit** live — paint and erase tiles directly on the canvas
6. **Verify** with K2 Think AI for solvability analysis and design suggestions
7. **Hard Mode** — Gemini remixes your level with walkers, saws, crumble tiles, and more

## Drawing symbols

| Draw this | Means |
|-----------|-------|
| Filled / shaded rectangle | Platform tile |
| Triangle △ | Spike (instant death) |
| Circle ○ | Player spawn |
| Star ★ | Goal (finish) |

## Project structure

```
platformer-level-builder/
├── backend/                        # Node.js / Express API (port 3000)
│   ├── server.js                   # 3 API routes: /upload /verify /api/levels/hard-mode
│   ├── index.js                    # CLI: node index.js <image>
│   ├── .env                        # API keys (never committed)
│   ├── .env.example                # Key reference
│   ├── render.yaml                 # Render deployment config
│   └── src/
│       ├── geminiPipeline.js       # Gemini Vision → level JSON
│       ├── levelConverter.js       # Pipeline orchestration
│       ├── verificationEngine.js   # BFS + K2 Think solvability stream
│       ├── hardModeEngine.js       # Deterministic hard mode + Claude fallback
│       ├── agents/hardModeAgent.js # Gemini hard-mode agent
│       └── config.js               # Grid dimensions (50×35)
└── frontend/                       # React + Vite app (port 5173)
    ├── vite.config.js              # Dev proxy → localhost:3000
    ├── vercel.json                 # SPA rewrite for Vercel
    └── src/
        ├── pages/
        │   ├── Upload.jsx          # Upload, camera, demo picker
        │   ├── Processing.jsx      # Upload progress + spinner
        │   └── Play.jsx            # Full game engine (canvas, physics, AI, editor)
        ├── data/demoLevels.js      # 5 built-in demo levels
        └── components/bits/        # Aurora, SplitText, StarBorder
```

## Local development

### Prerequisites

- Node.js 18+
- [Gemini API key](https://aistudio.google.com/app/apikey)
- K2 Think API key (optional — for solvability analysis)
- Anthropic API key (optional — Claude Haiku hard-mode fallback)

### Setup

```bash
# Backend
cd backend
cp .env.example .env      # fill in your API keys
npm install
node server.js            # runs on port 3000

# Frontend (separate terminal)
cd frontend
npm install
npm run dev               # runs on port 5173
```

Open [http://localhost:5173](http://localhost:5173). The Vite dev server proxies `/upload`, `/verify`, and `/api` to the backend automatically.

### Backend environment variables (`backend/.env`)

```env
GEMINI_API_KEY=           # required — image → level conversion
K2_API_KEY=               # optional — solvability verification
K2_API_BASE_URL=https://api.k2think.ai/v1
ANTHROPIC_API_KEY=        # optional — Claude Haiku hard-mode fallback
FRONTEND_URL=             # production only — your Vercel URL (for CORS)
```

## Deployment

**Frontend → Vercel**

| Setting | Value |
|---------|-------|
| Root directory | `frontend` |
| Build command | `npm run build` |
| Output directory | `dist` |
| Env variable | `VITE_API_URL` = your Render backend URL |

**Backend → Render**

| Setting | Value |
|---------|-------|
| Root directory | `backend` |
| Build command | `npm install` |
| Start command | `node server.js` |
| Env variables | Same as `backend/.env.example` + `FRONTEND_URL` = your Vercel URL |

> Deploy Render first → copy its URL → paste into Vercel's `VITE_API_URL` → deploy Vercel → copy its URL → paste into Render's `FRONTEND_URL` → redeploy Render.

## API

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/upload` | Multipart image → level JSON |
| `POST` | `/verify` | SSE stream — BFS + K2 Think solvability verdict |
| `POST` | `/api/levels/hard-mode` | Gemini hard-mode remix (deterministic fallback) |

## Tile reference

| Value | Tile |
|-------|------|
| `0` / `""` | Empty |
| `"T"` / `1` | Platform |
| `"S"` | Spike |
| `"C"` | Coin |
| `"G"` | Goal |
| `"P"` | Player spawn |
| `"W"` | Walker enemy |
| `"F"` | Flyer enemy |
| `"Z"` | Saw blade |
| `"B"` | Crumble platform |
| `"J"` | Spring |

## Controls

| Key | Action |
|-----|--------|
| Arrow keys / WASD | Move |
| Space / Up / W | Jump |
| R | Respawn |

**Edit mode** (click ✏ EDIT): click/drag to paint, right-click to erase, Ctrl+Z to undo.

## Tech stack

**Frontend** — React 19, Vite 8, Tailwind CSS 4, Framer Motion, HTML5 Canvas

**Backend** — Node.js, Express 5, Multer, Sharp

**AI** — Gemini 2.5 Flash (vision + hard mode), K2 Think V2 (solvability), Claude Haiku (fallback)
