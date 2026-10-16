# Nutrition OS

Personal nutrition tracker with an AI coach. Single user (Josue). Data lives in localStorage, with optional cloud sync through Supabase.

Live: https://nutrition-os-gray.vercel.app

## Stack

- React 18 + Vite
- Recharts for trend graphs
- Anthropic API: Sonnet 4 for meals and photos, Haiku 4.5 for quick liquid logs
- Vercel serverless functions (`/api/chat` proxies Claude so the key stays on the server, `/api/store` syncs data to Supabase)
- Supabase (PostgreSQL), optional
- Web Speech API for voice input

## Setup

```bash
npm install
cp .env.example .env.local
# edit .env.local and paste your Anthropic API key
npm run dev
```

The app runs at `http://localhost:5173`.

## Deploy to Vercel

First time:
```bash
npx vercel
```
Walk through the prompts to link/create a project. Then for production:
```bash
npx vercel --prod
```

If you've already linked the project (have a `.vercel/` folder) or use Git integration:
```bash
git add -A && git commit -m "your message" && git push
```

**Important:** in Vercel, go to Project, Settings, Environment Variables and set:

| Variable | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Used by `/api/chat` on the server |
| `SUPABASE_URL` | No | Enables cloud sync via `/api/store` |
| `SUPABASE_SERVICE_KEY` | No | Server side Supabase key for `/api/store` |

In local dev (`npm run dev`) the app calls the Anthropic API directly with `VITE_ANTHROPIC_API_KEY` from `.env.local`. In production it goes through `/api/chat`, so the key is never shipped to the browser. If Supabase is not configured, `/api/store` quietly does nothing and the app runs on localStorage alone.

## Daily Targets (defaults — editable in Settings)

- Calories: 1700–1800 kcal
- Protein: 165–175g
- Carbs: 110–120g (hard cap)
- Fat: 50–70g
- Fiber: 25g+
- Water: 3L
- Coffee: 1–2/day
- Creatine: 5g daily

## How it works

The app sends your meal text + a snapshot of session data (today's totals, recent history, weights, goal phase, coach memory) to Claude. The system prompt instructs Claude to end every relevant response with one of these inline JSON sentinels:

- `MACRO_UPDATE:{...}` — meal logged
- `LIQUID_UPDATE:{...}` — water/coffee/creatine
- `WEIGHT_UPDATE:{...}` — weight entry
- `COACH_INSIGHT:{...}` — end-of-day pattern memory

The frontend parses these out, updates local state, persists to localStorage, and strips them from what's shown to you.

## Features

**Tracking**
- Animated macro bars with overshoot indicators and hard-cap pulse for carbs
- Hydration drops, supplement dots, coffee counter
- Meals grouped by breakfast / lunch / pre-workout / post-workout / dinner / snack / late
- Per-meal modal with original AI rating (tap any meal in sidebar)

**History & analytics**
- Charts for calories, P/C/F, fiber+water, weight (7 / 14 / 30 day toggle)
- Protein and creatine streaks + 7-day adherence stats
- Weekly summary modal with averages
- History search by date or meal name
- JSON export/import for backup

**AI coach**
- Cross-day rolling memory ("what I've learned about Josue")
- Proactive time-based nudges (low protein at 1pm, low fiber at 6pm, etc. — once per day each)
- Local food database for staples (egg whites, Greek yogurt, oats, chicken, etc.)
- Pre/post-workout meal tagging
- Editable phase: cut / maintain / bulk
- Voice input via SpeechRecognition
- Photo meal logging: snap a picture of a plate and Claude estimates the macros

## File structure

```
nutrition-os/
├── README.md
├── index.html
├── package.json
├── vite.config.js
├── vercel.json
├── .env.example
├── .gitignore
├── package-lock.json
├── api/
│   ├── chat.js      # serverless proxy to the Anthropic API
│   └── store.js     # serverless Supabase sync
└── src/
    ├── main.jsx
    └── App.jsx
```

## localStorage keys

- `day-YYYY-MM-DD` — full day record (meals, totals, water, etc.)
- `chat-YYYY-MM-DD` — conversation history for that day
- `nutrition-history` — rollup of all days
- `nutrition-weights` — daily weight log
- `nutrition-targets` — your editable targets
- `nutrition-goal` — phase + goal description
- `nutrition-coach-memory` — AI's rolling memory
- `nudge-YYYY-MM-DD` — which proactive nudges have already fired today

To wipe everything: `localStorage.clear()` in DevTools console.
