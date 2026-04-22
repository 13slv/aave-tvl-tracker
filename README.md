# Aave V3 TVL — KelpDAO hack impact

Public dashboard showing Aave V3 TVL across all chains and assets around the
April 18, 2026 KelpDAO / LayerZero bridge exploit.

Data source: DefiLlama (`/protocol/aave-v3`), refreshed hourly via Next.js
ISR (`export const revalidate = 3600`).

## Local development

```bash
npm install
npm run dev
# open http://localhost:3000
```

First request takes ~8 seconds because it fetches ~34MB from DefiLlama.
Subsequent requests within an hour are cached.

## Deploy to Vercel

**One-time setup:**

1. Create a free GitHub account: https://github.com/signup
2. Create a free Vercel account: https://vercel.com/signup → "Continue with GitHub"
3. Optional: install GitHub CLI for one-liner deploy
   (`brew install gh` or see https://cli.github.com)

**Deploy via GitHub CLI (easiest):**

```bash
# from inside aave-tvl-tracker/
gh auth login
gh repo create aave-tvl-tracker --public --push --source=.
```

**Or deploy manually:**

```bash
git add -A && git commit -m "initial"
# create a new empty repo on github.com, then:
git remote add origin https://github.com/<YOUR_USERNAME>/aave-tvl-tracker.git
git branch -M main
git push -u origin main
```

**Then on Vercel:**

1. Go to https://vercel.com/new
2. Click "Import" next to your `aave-tvl-tracker` repo
3. Leave all defaults (Next.js detected automatically)
4. Click "Deploy"
5. After ~60 seconds you get a public URL like
   `https://aave-tvl-tracker-<hash>.vercel.app` — share it with anyone.

Future pushes to `main` auto-deploy.

## Structure

```
app/
  layout.tsx         root layout
  page.tsx           server component, fetches data, renders dashboard
lib/
  tvl.ts             DefiLlama fetcher + aggregator
components/
  TvlDashboard.tsx   client wrapper with chain/asset toggle
  TvlTable.tsx       per-row table
  TvlChart.tsx       recharts line chart
```

## Notes on caching

The raw DefiLlama response is ~34MB, above Vercel's 2MB fetch-cache limit, so
we rely on page-level ISR instead. Each serverless instance re-downloads the
full response at most once per hour. For higher traffic, proxy DefiLlama
through a small KV / Upstash cache.
