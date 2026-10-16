# Nutrition OS

A personal nutrition tracker with an AI coach. I built it to replace logging meals by hand and to get feedback on my eating in plain English instead of digging through numbers.

This is a personal learning project for a single user, not a commercial product.

Live app: https://nutrition-os-gray.vercel.app

## What it automates

**Meal logging from plain text, voice, or a photo.** I describe a meal, say it out loud, or snap a picture of the plate. Claude estimates the calories, protein, carbs, fat, and fiber and logs it to the right meal slot. Quick logs like water or coffee go to a smaller, cheaper model (Haiku) to keep costs down.

**Structured updates from AI replies.** Claude ends each reply with a small JSON block (meal, liquid, weight, or coach insight). The app reads that block, updates the day's totals, saves it, and hides it from the chat, so the AI's answer turns directly into tracked data.

**Proactive nudges.** At set times the app checks progress and nudges me once per day if something is behind, for example low protein by 1pm or low fiber by 6pm.

**Coach memory.** At the end of each day the AI saves patterns it noticed, and uses them in later days to give more personal advice.

## Features

* Macro bars for calories, protein, carbs, fat, and fiber, with a hard cap warning on carbs
* Hydration, coffee, and supplement (creatine) tracking
* Charts for calories, macros, fiber, water, and weight over 7, 14, or 30 days
* Protein and creatine streaks, weekly summary, and history search
* Editable targets and goal phase (cut, maintain, bulk)
* JSON export and import for backups

## How it's built and hosted

| Piece | Tool |
|---|---|
| App | React 18 and Vite |
| Charts | Recharts |
| AI | Anthropic API (Claude Sonnet for meals and photos, Haiku for quick logs) |
| Hosting and deploys | Vercel |
| API proxy | Vercel serverless function (`api/chat.js`) so the API key stays on the server |
| Cloud sync (optional) | Supabase (PostgreSQL) through `api/store.js` |
| Local storage | Browser localStorage, so the app still works without the database |
| Voice input | Web Speech API |

## Security

* In production the browser never sees the Anthropic API key. Requests go through `/api/chat`, which adds the key on the server.
* The Supabase service key is only used inside `/api/store` on the server.
* All keys are set as environment variables in Vercel, not in the code. `.env.example` has placeholder values only.

## Setup

```bash
npm install
cp .env.example .env.local   # add your Anthropic API key
npm run dev                  # runs at http://localhost:5173
```

To deploy, import the repo into Vercel and set these environment variables:

| Variable | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Used by `/api/chat` |
| `SUPABASE_URL` | No | Turns on cloud sync |
| `SUPABASE_SERVICE_KEY` | No | Server side key for `/api/store` |

If Supabase is not set up, `/api/store` does nothing and the app runs on localStorage alone.

## Default daily targets

Editable in Settings.

| Target | Default |
|---|---|
| Calories | 1700 to 1800 kcal |
| Protein | 165 to 175 g |
| Carbs | 110 to 120 g (hard cap) |
| Fat | 50 to 70 g |
| Fiber | 25 g or more |
| Water | 3 L |

## File structure

```
nutrition-os/
├── api/
│   ├── chat.js     serverless proxy to the Anthropic API
│   └── store.js    serverless Supabase sync
├── src/
│   ├── App.jsx     the app
│   └── main.jsx
├── index.html
├── package.json
├── vercel.json
└── .env.example
```
