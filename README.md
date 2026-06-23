# Daily Tracker

A minimal time + task tracker. A count-up timer with a target time logs every
work session; gaps between sessions show as **untracked** time so no part of the
day goes unaccounted for. Runs on Cloudflare Workers + KV.

## How it works

- Set a title and a target (default 25 min; ±5 / ±10 buttons). Press **Start** —
  the timer counts up from zero.
- At the target a browser notification + beep fires; the timer keeps running into
  overtime until you **Stop**.
- Each session becomes a log entry on the left. Gaps appear as untracked blocks.
- Any entry (including an untracked gap) can get a description.

## Stack

- Frontend: vanilla TypeScript + Vite (`src/`)
- Backend: one Cloudflare Worker serving static assets + `/api/*` (`worker/`)
- Storage: Cloudflare KV, one JSON blob per day (`log:{user}:{YYYY-MM-DD}`)
- Auth: bearer token compared against the `AUTH_TOKEN` secret

## Develop

```bash
npm install
npm run dev:web   # Vite only (UI, no API)
npm run dev       # wrangler dev (full Worker + assets + KV)
npm test
npm run typecheck
```

## Deploy

1. Create a KV namespace and put its id in `wrangler.jsonc`:
   ```bash
   npx wrangler kv namespace create TRACKER_KV
   ```
2. Set the access token secret:
   ```bash
   npx wrangler secret put AUTH_TOKEN
   ```
3. Deploy manually, or push to `main` (GitHub Actions):
   ```bash
   npm run deploy
   ```

For CI deploys, add repo secrets `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID`.

## Going multi-user later

Data keys are already namespaced by user id. To support multiple users, map
issued tokens to user ids in the Worker instead of comparing one shared token.
