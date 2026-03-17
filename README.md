# aster-trader-board

Aster DEX leaderboard dashboard. Live top-gainer charts + top 10 traders, with timeframe switching (1h / 1d / 1w / 1m).

Built with Vanilla JS + Vercel serverless API routes as a CORS-free proxy layer.

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | Vanilla HTML / CSS / JS |
| Charts | Chart.js |
| Backend proxy | Vercel serverless functions (`/api/*`) |
| Hosting | Vercel |

---

## Project structure

```
aster-trader-board/
├── api/
│   ├── tickers.js       # Proxies fapi.asterdex.com/fapi/v1/ticker/24hr
│   ├── klines.js        # Proxies fapi.asterdex.com/fapi/v1/klines
│   └── leaderboard.js   # Probes known endpoints; falls back to simulated data
├── public/
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js
├── vercel.json
├── package.json
└── .gitignore
```

---

## Local dev

```bash
npm install
npm run dev        # starts vercel dev server at localhost:3000
```

Requires [Vercel CLI](https://vercel.com/docs/cli): `npm i -g vercel`

---

## Deploy to Vercel

```bash
vercel            # preview deploy
vercel --prod     # production deploy
```

Or connect the GitHub repo in the [Vercel dashboard](https://vercel.com/new) for automatic deploys on push.

---

## Connecting the real leaderboard

Aster's leaderboard is rendered client-side — the real data comes from an internal XHR call their frontend makes.

**To find it:**
1. Open `asterdex.com/en/trading-leaderboard` in Chrome DevTools
2. Go to **Network → Fetch/XHR**
3. Reload the page and look for a JSON response containing trader rankings
4. Copy that URL

**Then set it in Vercel:**

```bash
vercel env add ASTER_LEADERBOARD_URL
# paste the URL when prompted
```

The `/api/leaderboard.js` proxy will use this env var automatically. No code changes needed.

---

## Environment variables

| Variable | Purpose | Required |
|---|---|---|
| `ASTER_LEADERBOARD_URL` | Real leaderboard XHR endpoint once found | No (uses simulated fallback) |

Add them in Vercel dashboard → Project → Settings → Environment Variables.
