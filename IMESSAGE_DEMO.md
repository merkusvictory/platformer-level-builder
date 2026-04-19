# iMessage Hard Mode Bot (Photon Flux)

Text your level ID to the bot and get back a harder AI-remixed version with a playable link.
This uses Photon's Flux CLI to deploy a LangChain-style agent to iMessage.

---

## Setup

### 1. Start the backend (must be running and reachable)

```bash
node server.js
```

### 2. Log in to Flux (one time per machine)

```bash
npm run flux:login
```

The terminal will show a phone number. Text a code to that number to verify your account.
Follow exactly what the CLI output says, the number is shown there, not hardcoded anywhere.

### 3. Run the bot

Local (for testing):

```bash
npm run flux:dev
```

Production (stays alive, responds to real iMessages):

```bash
npm run flux:prod
```

---

## Sending a Level to the Bot

First, the level must exist in the server-side store. Levels uploaded via the web app are stored in
the browser's localStorage. To make a level available to the bot, save it via the API:

```bash
curl -X POST http://localhost:3000/api/levels \
  -H "Content-Type: application/json" \
  -d @level_output.json
# Returns: { "id": "abc123" }
```

Then text any of these to the bot:

```
abc123
remix abc123
http://localhost:5173/play/abc123
```

The bot replies:

```
Hard version ready: http://localhost:5173/play/xyz789

Difficulty: 8/10
What changed: Added walker enemy at col 12, row 3 because the path was wide open.
```

Open the URL on any device to play the remixed level.

---

## Troubleshooting

**No reply comes back.**
- Check that `npm run flux:prod` (or `flux:dev`) is still running in a terminal.
- Check that BACKEND_URL in .env is reachable from the machine running Flux. Test with:
  `curl $BACKEND_URL/api/levels/test`
- Check server logs for errors from hardModeAgent (K2_API_KEY must be set in .env).
- Confirm the level ID is real by fetching it: `curl $BACKEND_URL/api/levels/<id>`

**"Couldn't find level" reply.**
- The level ID was not saved server-side. See the curl command above to save it first.

**"Something broke on my end" reply.**
- Check the terminal running Flux for the real error logged by `console.error`.
- Most common cause: K2_API_KEY missing or expired, or BACKEND_URL not reachable.
