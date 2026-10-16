import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, BarChart, Bar } from "recharts";

const API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY;
const API_ENDPOINT = import.meta.env.DEV
  ? "https://api.anthropic.com/v1/messages"
  : "/api/chat";

// Passcode for the serverless endpoints (production only). Asked once, saved on this device.
const PASSCODE_KEY = "nutrition-passcode";
let passcodePrompted = false;
const getPasscode = () => {
  let p = null;
  try { p = localStorage.getItem(PASSCODE_KEY); } catch {}
  if (!p && !passcodePrompted && typeof window !== "undefined") {
    passcodePrompted = true;
    p = window.prompt("Enter your Nutrition OS passcode") || "";
    if (p) { try { localStorage.setItem(PASSCODE_KEY, p); } catch {} }
  }
  return p || "";
};
const clearPasscode = () => { try { localStorage.removeItem(PASSCODE_KEY); } catch {} passcodePrompted = false; };
const authHeaders = () => ({ "x-app-passcode": getPasscode() });

// ─── DESIGN TOKENS ────────────────────────────────────────────────────────────
const C = {
  bg0: "#07090e",   // deepest
  bg1: "#0b0f1a",   // page
  bg2: "#0f1525",   // card
  bg3: "#141e32",   // raised / input
  bg4: "#1a2640",   // hover
  b0:  "#131f35",   // border subtle
  b1:  "#1c2e4c",   // border default
  b2:  "#284878",   // border active
  t0:  "#dceeff",   // text primary
  t1:  "#6e88b0",   // text secondary
  t2:  "#243550",   // text muted
  // Macros — colorblind-safe (works for deuteranopia, protanopia, tritanopia)
  cal:  "#38bdf8",  // sky blue
  prot: "#f97316",  // orange
  carb: "#fde047",  // yellow
  fat:  "#e879f9",  // fuchsia
  fib:  "#34d399",  // emerald
  wat:  "#60a5fa",  // blue
  // Status
  ok:   "#10b981",
  warn: "#f59e0b",
  err:  "#f43f5e",
  ai:   "#818cf8",  // indigo
};

// ─── DEFAULT TARGETS (overridable in Settings) ─────────────────────────────────
const DEFAULT_TARGETS = {
  calories: { min: 1700, max: 1800 },
  protein: { min: 165, max: 175 },
  carbs: { min: 110, max: 120 },
  fat: { min: 50, max: 70 },
  fiber: { min: 25, max: 30 },
  water_ml: 3000,
};

const DEFAULT_GOAL = {
  phase: "cut",
  description: "Fat loss while preserving muscle. Whole foods preferred. High protein early (50–70g). Carbs pre-workout.",
  weight_target_kg: null,
};

// ─── LOCAL FOOD DATABASE ────────────────────────────────────────────────────────
const FOOD_DB = {
  "egg whites": { per: "100g", calories: 52, protein: 11, carbs: 0.7, fat: 0.2, fiber: 0 },
  "whole eggs": { per: "100g", calories: 155, protein: 13, carbs: 1.1, fat: 11, fiber: 0 },
  "greek yogurt 0%": { per: "100g", calories: 59, protein: 10, carbs: 3.6, fat: 0.4, fiber: 0 },
  "greek yogurt 2%": { per: "100g", calories: 73, protein: 9.9, carbs: 3.9, fat: 1.9, fiber: 0 },
  "chicken breast cooked": { per: "100g", calories: 165, protein: 31, carbs: 0, fat: 3.6, fiber: 0 },
  "rice white cooked": { per: "100g", calories: 130, protein: 2.7, carbs: 28, fat: 0.3, fiber: 0.4 },
  "rice brown cooked": { per: "100g", calories: 112, protein: 2.6, carbs: 24, fat: 0.9, fiber: 1.8 },
  "oats dry": { per: "100g", calories: 389, protein: 16.9, carbs: 66, fat: 6.9, fiber: 10.6 },
  "banana": { per: "100g", calories: 89, protein: 1.1, carbs: 23, fat: 0.3, fiber: 2.6 },
  "almonds": { per: "100g", calories: 579, protein: 21, carbs: 22, fat: 50, fiber: 12.5 },
  "peanut butter": { per: "100g", calories: 588, protein: 25, carbs: 20, fat: 50, fiber: 6 },
  "olive oil": { per: "100g", calories: 884, protein: 0, carbs: 0, fat: 100, fiber: 0 },
  "salmon cooked": { per: "100g", calories: 208, protein: 22, carbs: 0, fat: 13, fiber: 0 },
  "broccoli cooked": { per: "100g", calories: 35, protein: 2.4, carbs: 7, fat: 0.4, fiber: 3.3 },
  "sweet potato cooked": { per: "100g", calories: 90, protein: 2, carbs: 21, fat: 0.1, fiber: 3.3 },
  "whey protein scoop": { per: "1 scoop (~30g)", calories: 120, protein: 24, carbs: 3, fat: 1.5, fiber: 0 },
};

const buildFoodDbText = () =>
  Object.entries(FOOD_DB)
    .map(([name, m]) => `- ${name} (${m.per}): ${m.calories}cal, P${m.protein}g, C${m.carbs}g, F${m.fat}g, fiber ${m.fiber}g`)
    .join("\n");

// ─── SYSTEM PROMPT ─────────────────────────────────────────────────────────────
const buildSystemPrompt = ({ targets, goal, coachMemory }) => `You are Josue's personal nutrition AI coach embedded in a dedicated tracking app.

CURRENT PHASE: ${goal.phase.toUpperCase()}
GOAL: ${goal.description}
${goal.weight_target_kg ? `Weight target: ${goal.weight_target_kg}kg` : ""}

JOSUE'S DAILY TARGETS:
- Calories: ${targets.calories.min}–${targets.calories.max} kcal
- Protein: ${targets.protein.min}–${targets.protein.max}g
- Carbs: ${targets.carbs.min}–${targets.carbs.max}g (HARD CAP at ${targets.carbs.max}g)
- Fat: ${targets.fat.min}–${targets.fat.max}g
- Fiber: ${targets.fiber.min}g+
- Water: ~${targets.water_ml}ml/day
- Coffee: no hard limit — count every cup. If Josue logs ≥4 coffees and water is under 1.5L, proactively advise drinking water. High coffee + low water = flag it.
- Creatine: 5g daily (dry scoop + water = supplement only, not macros)

LOCAL FOOD DATABASE (use these EXACT values for these foods — never guess):
${buildFoodDbText()}

For any food NOT in the database, use accurate USDA-style nutrition data.

${coachMemory ? `\nWHAT I'VE LEARNED ABOUT JOSUE (rolling memory across days):\n${coachMemory}\n` : ""}

SESSION DATA is provided as JSON in every message. Use it for all calculations.

════════════════════════════════════════
VISUAL LANGUAGE — apply to EVERY response
════════════════════════════════════════
- Use contextual emoji headers (🍽️ 🥑 ☕ 💧 ⚖️ 📊 👉 🎯 🗑️ 🤔 📅 ⚡)
- Bullet points (* item) for food items, indented (*   sub) for ingredients
- ⸻ dividers between sections
- 📊 SUMMARY or 📊 [section label] for data blocks
- 👉 for narrative sentences and advice
- 🎯 for goals and next steps
- Macro data: plain text, one per line, label left-aligned, value right:
    Calories   938 / 1,800 kcal
    Protein    107 / 175g
- NO bold (**text**), NO markdown headers (## or ###), NO pipe tables
- NO "DAILY TOTALS:", NO "STATUS:", NO "VS TARGETS:", NO "Subtotal:"
- Write naturally — feel like a smart coach, not a spreadsheet

════════════════════════════════════════
BEHAVIORS
════════════════════════════════════════

0. NO ACTIVE DAY (context shows no_active_day: true):
- No UPDATE sentinels at all
- Brief, friendly: one line saying no active day, tell him to say "New Day"
- Can still answer questions, show history, give advice

1. NEW DAY:
📅 [Weekday, Month Date] — let's go

👉 [one motivating line referencing yesterday's data if available]

🎯 Today's targets
Calories   ${targets.calories.min}–${targets.calories.max} kcal
Protein    ${targets.protein.min}–${targets.protein.max}g
Water      ${(targets.water_ml/1000).toFixed(1)}L
Creatine   ✗ not done yet

Creatine done already?

2. MEAL LOGGING — only when Josue clearly reports eating something now or just ate.
Clear signals: "I had", "I ate", "I just had", "I'm eating", "just finished", food name with no qualifier.
CRITICAL: when in doubt → PLANNING mode (2b). Never guess and log.

Format:
🍽️ [Meal name]

* [item] — [weight if known]
* [item] — [weight if known]
  * [sub-ingredient]
  * [sub-ingredient]

⸻

📊 [X]/10 · [one-line reason]

Calories   +[x] → [day total] / ${targets.calories.max} kcal
Protein    +[x] → [day total] / ${targets.protein.max}g
Carbs      +[x] → [day total] / ${targets.carbs.max}g
Fat        +[x] → [day total] / ${targets.fat.max}g
Fiber      +[x] → [day total] / ${targets.fiber.min}g

👉 [one sharp coaching note — what to focus on next]
MACRO_UPDATE:{"calories":X,"protein":X,"carbs":X,"fat":X,"fiber":X,"meal_name":"brief name","tag":"breakfast|lunch|dinner|snack|preworkout|postworkout"}

2b. PLANNING / HYPOTHETICAL — user is thinking, NOT logging yet.
Triggers: "what if I have X", "thinking of X", "could I eat X", "would X work", "should I have X",
"planning to eat X", "X for dinner?", "what should I eat", "what fits", "help me hit protein", "what's left"

Format:
🤔 [Food / meal name]

* [item] — [weight]
* [item] — [weight]

⸻

📊 If you eat this

Calories   +[x] → [projected] / ${targets.calories.max} kcal  [flag if close/over]
Protein    +[x] → [projected] / ${targets.protein.max}g
Carbs      +[x] → [projected] / ${targets.carbs.max}g  [⚠️ if near cap]
Fat        +[x] → [projected] / ${targets.fat.max}g
Fiber      +[x] → [projected] / ${targets.fiber.min}g

👉 [fits or concern + one coaching note]
Say "log it" when you eat it.
(NO MACRO_UPDATE — planning only)

2c. CONFIRM AND LOG — user confirms a planned meal.
Triggers: "log it", "add it", "add that", "yes", "go ahead", "log that", any clear confirmation after 2b.
- Look back at last planned meal, log it exactly
- Short confirmation + updated totals only, no full re-explanation
- Include MACRO_UPDATE

2d. REMOVE A LOGGED MEAL — user wants to undo something.
Triggers (read intent broadly, not just exact phrases):
"remove X", "delete X", "take off X", "undo that", "actually no", "wait no", "I didn't eat X",
"remove that", "take that off", "I didn't have that", "remove the last one", "actually don't log that",
"remove this actually", "oops", "cancel that", "that was wrong", "scratch that"
- If unclear, ask: "Remove [most recent meal]?"
- When confirmed or clear:

🗑️ Removed: [meal name]

−[cal] cal · −[x]g protein · −[x]g carbs · −[x]g fat

📊 Day now
Calories   [new total] / ${targets.calories.max} kcal
Protein    [new total] / ${targets.protein.max}g

MACRO_REMOVE:{"meal_name":"exact name","calories":X,"protein":X,"carbs":X,"fat":X,"fiber":X}

3. LIQUID LOGGING (water, coffee, energy drink, sparkling water, creatine):

Format:
[☕ or 💧 or ⚡] [what was logged]

Water      [total] / ${targets.water_ml} ml
Coffee     [count] cups
Creatine   [✓ or ✗]

LIQUID_UPDATE:{"water_ml":X,"coffee":true/false,"creatine":true/false}
(only include changed fields, water_ml is additive)

4. WEIGHT LOG:

⚖️ [x] kg logged

[trend vs recent weights: e.g. "down 0.3kg from last week — cut is working"]
WEIGHT_UPDATE:{"weight_kg":X}

5. RATE MY DAY / END OF DAY ("rate my day", "how did I do", "full macros", "day summary"):
Use the FOOD LOG format (behavior 6) + append rating and coaching at the end:

⸻

⚡ [X]/10 — [one sentence overall assessment]

🎯 Focus for tomorrow
* [specific action 1]
* [specific action 2]
COACH_INSIGHT:{"insight":"one sentence pattern to remember"}

6. FOOD LOG + COACHING ("what have I eaten", "today's log", "what did I eat", "show my meals", "what's logged"):
ALWAYS include the food log AND the rating AND coaching advice — never just list without insight.

🧾 FOOD LOG · [Weekday, Month Date]

☕ Drinks
* [drink] — [amount if known]
* [drink]

⸻

[emoji] [Meal group — Breakfast / Snack / Lunch / Dinner / Late]
* [item] — [weight or quantity]
  * [sub-ingredient]
  * [sub-ingredient]
* [item]

⸻

[repeat for each meal group]

⸻

📊 Summary

👉 [2 sentences: eating pattern + what stood out — e.g. "Late heavy meal, low protein until dinner. Fat came in high from the carne asada."]

Calories   [x] / ${targets.calories.max} kcal
Protein    [x] / ${targets.protein.max}g
Carbs      [x] / ${targets.carbs.max}g
Fat        [x] / ${targets.fat.max}g
Fiber      [x] / ${targets.fiber.min}g
Water      [x] / ${(targets.water_ml/1000).toFixed(1)}L
Creatine   [✓ or ✗]

⸻

⚡ [X]/10 — [one sentence]

🎯 What to focus on next
* [specific advice 1]
* [specific advice 2]

Rules: group drinks at top, group by meal timing, use contextual emojis, reconstruct ingredients from conversation history, ⸻ between every group.

7. HISTORY ("last week", "weekly summary", "how was [day]"):
Use visual language — emoji headers per day/week, bullet trends, 👉 for patterns. No pipe tables.

8. SMART COACHING (proactive flags mid-day):
- Carbs > 80g before noon → warn
- Protein < 80g by 1pm → urgency
- Fiber < 15g by 6pm → suggest specific foods
- Calories < 1500 by 7pm → flag undereating
- Water < 1500ml by 3pm → push hydration
- 4+ coffees + water < 1500ml → dehydration warning

9. PHOTO MEAL LOG (image provided):
- Identify all visible items, estimate portions from visual cues + any context given
- State confidence (high / medium / low)
- Use MEAL LOGGING format (behavior 2) — full breakdown + MACRO_UPDATE

CRITICAL: Always include MACRO_UPDATE, LIQUID_UPDATE, WEIGHT_UPDATE, or COACH_INSIGHT when applicable. Use accurate USDA-level nutrition data.`;

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const getTodayKey = () => new Date().toISOString().split("T")[0];
const getTodayDate = () => new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
const getHourNow = () => new Date().getHours();

const initDay = () => ({
  date: getTodayDate(),
  dateKey: getTodayKey(),
  totals: { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 },
  meals: [],
  water_ml: 0,
  coffee_count: 0,
  creatine_done: false,
});

const CLOUD_KEYS = new Set(["nutrition-history", "nutrition-weights", "nutrition-targets", "nutrition-goal", "nutrition-coach-memory"]);
const store = {
  get: (key) => { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; } },
  set: (key, val) => {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
    if (CLOUD_KEYS.has(key) || key.startsWith("day-") || key.startsWith("chat-")) {
      if (!import.meta.env.DEV) fetch("/api/store", { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ k: key, data: val }) }).catch(() => {});
    }
  },
};
const cloudGet = async (key) => {
  if (import.meta.env.DEV) return null;
  try { const r = await fetch(`/api/store?k=${encodeURIComponent(key)}`, { headers: authHeaders() }); return r.ok ? r.json() : null; } catch { return null; }
};

const bucketFromHour = (h) => {
  if (h < 11) return "breakfast";
  if (h < 15) return "lunch";
  if (h < 20) return "dinner";
  return "late";
};
const bucketLabel = { breakfast: "🌅 Breakfast", lunch: "☀️ Lunch", dinner: "🌙 Dinner", late: "🌃 Late", snack: "🍎 Snack", preworkout: "💪 Pre-workout", postworkout: "🔥 Post-workout" };

const computeStreaks = (history, targets) => {
  const sorted = Object.entries(history).sort((a, b) => b[0].localeCompare(a[0]));
  let proteinStreak = 0, creatineStreak = 0, calStreak = 0;
  for (const [, d] of sorted) { if ((d.totals?.protein || 0) >= targets.protein.min) proteinStreak++; else break; }
  for (const [, d] of sorted) { if (d.creatine_done) creatineStreak++; else break; }
  for (const [, d] of sorted) { const c = d.totals?.calories || 0; if (c >= targets.calories.min && c <= targets.calories.max + 50) calStreak++; else break; }
  const last7 = sorted.slice(0, 7);
  const adherence = {
    protein: last7.filter(([, d]) => (d.totals?.protein || 0) >= targets.protein.min).length,
    carbsCap: last7.filter(([, d]) => (d.totals?.carbs || 0) <= targets.carbs.max).length,
    creatine: last7.filter(([, d]) => d.creatine_done).length,
    water: last7.filter(([, d]) => (d.water_ml || 0) >= targets.water_ml).length,
    days: last7.length,
  };
  return { proteinStreak, creatineStreak, calStreak, adherence };
};

// ─── COMPONENTS ───────────────────────────────────────────────────────────────

function MacroBar({ label, current, min, max, unit, color, delta, hardCap }) {
  const pct = Math.min((current / (max || 1)) * 100, 100);
  const over = current > max;
  const inRange = current >= min && current <= max;
  const warning = hardCap && (current / max) > 0.85 && !over;
  const capHit = hardCap && current >= max;
  const barColor = (capHit || over) ? C.err : warning ? C.warn : inRange ? color : C.warn;

  return (
    <div style={{ marginBottom: "16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "7px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
          <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: barColor, boxShadow: `0 0 6px ${barColor}90`, flexShrink: 0 }} />
          <span style={{ fontSize: "11px", fontFamily: "monospace", color: capHit ? C.err : C.t1, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: "500" }}>
            {label}{capHit && " ⚠"}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: "1px" }}>
          <span style={{ fontSize: "15px", fontFamily: "monospace", fontWeight: "700", color: (over || capHit) ? C.err : color, lineHeight: 1 }}>
            {Math.round(current)}
          </span>
          <span style={{ fontSize: "11px", fontFamily: "monospace", color: C.t2 }}>/{max}{unit}</span>
          {(delta > 0) && <span style={{ marginLeft: "6px", fontSize: "11px", color: C.ok, animation: "fadeOut 2.2s forwards" }}>+{Math.round(delta)}</span>}
          {(delta < 0) && <span style={{ marginLeft: "6px", fontSize: "11px", color: C.err, animation: "fadeOut 2.2s forwards" }}>{Math.round(delta)}</span>}
        </div>
      </div>
      <div style={{ height: "7px", background: C.bg0, borderRadius: "4px", overflow: "hidden" }}>
        <div style={{
          height: "100%",
          width: `${pct}%`,
          background: `linear-gradient(90deg, ${barColor}bb, ${barColor})`,
          borderRadius: "4px",
          transition: "width 0.55s cubic-bezier(0.4,0,0.2,1)",
          boxShadow: pct > 8 ? `0 0 10px ${barColor}55` : "none",
          animation: capHit ? "capPulse 1.5s infinite" : "none",
        }} />
      </div>
    </div>
  );
}

function WaterDrop({ filled }) {
  return (
    <div style={{
      width: "12px", height: "16px",
      borderRadius: "50% 50% 50% 50% / 40% 40% 60% 60%",
      background: filled ? C.wat : C.bg0,
      border: filled ? "none" : `1px solid ${C.b0}`,
      transition: "all 0.3s",
      boxShadow: filled ? `0 0 6px ${C.wat}60` : "none",
      flexShrink: 0,
    }} />
  );
}

function Toast({ toasts }) {
  return (
    <div style={{ position: "fixed", top: "20px", right: "20px", zIndex: 100, display: "flex", flexDirection: "column", gap: "8px", pointerEvents: "none" }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          padding: "10px 16px", borderRadius: "10px",
          background: t.type === "warn" ? "#1f0a00" : "#001f10",
          border: `1px solid ${t.type === "warn" ? C.warn + "60" : C.ok + "60"}`,
          color: t.type === "warn" ? C.warn : C.ok,
          fontSize: "13px", fontFamily: "monospace", fontWeight: "500",
          animation: "toastIn 0.3s ease forwards",
          boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
          backdropFilter: "blur(8px)",
        }}>{t.text}</div>
      ))}
    </div>
  );
}

function Modal({ open, onClose, title, children, wide }) {
  if (!open) return null;
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 80, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px", backdropFilter: "blur(4px)" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: C.bg2, border: `1px solid ${C.b1}`, borderRadius: "16px", padding: "24px", maxWidth: wide ? "900px" : "520px", width: "100%", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 24px 60px rgba(0,0,0,0.6)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
          <div style={{ fontSize: "16px", fontWeight: "700", color: C.t0, letterSpacing: "-0.01em" }}>{title}</div>
          <button onClick={onClose} style={{ background: C.bg3, border: `1px solid ${C.b0}`, color: C.t1, width: "32px", height: "32px", borderRadius: "8px", cursor: "pointer", fontSize: "16px", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ChartsView({ history, targets, weights }) {
  const [range, setRange] = useState(7);
  const data = useMemo(() => {
    const sorted = Object.entries(history).sort((a, b) => a[0].localeCompare(b[0])).slice(-range);
    return sorted.map(([key, d]) => ({
      date: new Date(key + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      calories: Math.round(d.totals?.calories || 0),
      protein: Math.round(d.totals?.protein || 0),
      carbs: Math.round(d.totals?.carbs || 0),
      fat: Math.round(d.totals?.fat || 0),
      fiber: Math.round(d.totals?.fiber || 0),
      water: Math.round((d.water_ml || 0) / 100) / 10,
    }));
  }, [history, range]);

  const weightData = useMemo(() => {
    const sorted = Object.entries(weights || {}).sort((a, b) => a[0].localeCompare(b[0])).slice(-range);
    return sorted.map(([key, w]) => ({
      date: new Date(key + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      weight: w,
    }));
  }, [weights, history, range]);

  const tooltipStyle = { background: C.bg2, border: `1px solid ${C.b1}`, borderRadius: "8px", fontSize: "12px", color: C.t0 };
  const axisStyle = { fontSize: 11, fontFamily: "monospace", fill: C.t1 };

  const Section = ({ label, children }) => (
    <div style={{ marginBottom: "28px" }}>
      <div style={{ fontSize: "11px", color: C.t1, marginBottom: "10px", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.1em" }}>{label}</div>
      {children}
    </div>
  );

  return (
    <div>
      <div style={{ display: "flex", gap: "8px", marginBottom: "24px" }}>
        {[7, 14, 30].map(r => (
          <button key={r} onClick={() => setRange(r)} style={{ padding: "7px 16px", borderRadius: "8px", border: `1px solid ${range === r ? C.b2 : C.b0}`, background: range === r ? C.bg4 : "transparent", color: range === r ? C.t0 : C.t1, fontSize: "12px", fontFamily: "monospace", cursor: "pointer", fontWeight: range === r ? "600" : "400" }}>{r}d</button>
        ))}
      </div>
      <Section label="Calories">
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={data}>
            <CartesianGrid stroke={C.b0} strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={axisStyle} />
            <YAxis tick={axisStyle} />
            <Tooltip contentStyle={tooltipStyle} />
            <ReferenceLine y={targets.calories.min} stroke={C.cal} strokeDasharray="3 3" strokeOpacity={0.5} />
            <ReferenceLine y={targets.calories.max} stroke={C.cal} strokeDasharray="3 3" strokeOpacity={0.5} />
            <Line type="monotone" dataKey="calories" stroke={C.cal} strokeWidth={2.5} dot={{ r: 3, fill: C.cal }} />
          </LineChart>
        </ResponsiveContainer>
      </Section>
      <Section label="Protein / Carbs / Fat">
        <ResponsiveContainer width="100%" height={190}>
          <LineChart data={data}>
            <CartesianGrid stroke={C.b0} strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={axisStyle} />
            <YAxis tick={axisStyle} />
            <Tooltip contentStyle={tooltipStyle} />
            <Line type="monotone" dataKey="protein" stroke={C.prot} strokeWidth={2.5} dot={{ r: 2, fill: C.prot }} />
            <Line type="monotone" dataKey="carbs" stroke={C.carb} strokeWidth={2.5} dot={{ r: 2, fill: C.carb }} />
            <Line type="monotone" dataKey="fat" stroke={C.fat} strokeWidth={2.5} dot={{ r: 2, fill: C.fat }} />
            <ReferenceLine y={targets.carbs.max} stroke={C.carb} strokeDasharray="3 3" strokeOpacity={0.5} />
          </LineChart>
        </ResponsiveContainer>
      </Section>
      <Section label="Fiber & Water (L)">
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={data}>
            <CartesianGrid stroke={C.b0} strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={axisStyle} />
            <YAxis tick={axisStyle} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="fiber" fill={C.fib} radius={[3,3,0,0]} />
            <Bar dataKey="water" fill={C.wat} radius={[3,3,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </Section>
      {weightData.length > 0 && (
        <Section label="Weight (kg)">
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={weightData}>
              <CartesianGrid stroke={C.b0} strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={axisStyle} />
              <YAxis tick={axisStyle} domain={["dataMin - 1", "dataMax + 1"]} />
              <Tooltip contentStyle={tooltipStyle} />
              <Line type="monotone" dataKey="weight" stroke={C.ai} strokeWidth={2.5} dot={{ r: 4, fill: C.ai }} />
            </LineChart>
          </ResponsiveContainer>
        </Section>
      )}
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [dayData, setDayData] = useState(() => store.get(`day-${getTodayKey()}`) || null);
  const [history, setHistory] = useState(() => store.get("nutrition-history") || {});
  const [messages, setMessages] = useState(() => store.get(`chat-${getTodayKey()}`) || []);
  const [weights, setWeights] = useState(() => store.get("nutrition-weights") || {});
  const [targets, setTargets] = useState(() => store.get("nutrition-targets") || DEFAULT_TARGETS);
  const [goal, setGoal] = useState(() => store.get("nutrition-goal") || DEFAULT_GOAL);
  const [coachMemory, setCoachMemory] = useState(() => store.get("nutrition-coach-memory") || "");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chartsOpen, setChartsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [weeklyOpen, setWeeklyOpen] = useState(false);
  const [mealDetail, setMealDetail] = useState(null);
  const [historySearch, setHistorySearch] = useState("");
  const [toasts, setToasts] = useState([]);
  const [delta, setDelta] = useState({});
  const [listening, setListening] = useState(false);
  const [nextMealTag, setNextMealTag] = useState(null);
  const [proactiveSent, setProactiveSent] = useState(() => store.get(`nudge-${getTodayKey()}`) || {});
  const [pendingImage, setPendingImage] = useState(null);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const recognitionRef = useRef(null);
  const imageFileRef = useRef(null);
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  // Cloud sync on mount — fetch cloud data and merge with local (cloud wins for history/weights)
  useEffect(() => {
    if (import.meta.env.DEV) return;
    const sync = async () => {
      const [cloudHist, cloudWeights, cloudDay, cloudMem] = await Promise.all([
        cloudGet("nutrition-history"),
        cloudGet("nutrition-weights"),
        cloudGet(`day-${getTodayKey()}`),
        cloudGet("nutrition-coach-memory"),
      ]);
      if (cloudHist && Object.keys(cloudHist).length > 0) {
        setHistory(h => { const merged = { ...cloudHist, ...h }; store.get("nutrition-history") || store.set("nutrition-history", merged); return merged; });
      }
      if (cloudWeights && Object.keys(cloudWeights).length > 0) {
        setWeights(w => { const merged = { ...cloudWeights, ...w }; return merged; });
      }
      if (cloudDay && !store.get(`day-${getTodayKey()}`)) {
        setDayData(cloudDay);
        store.set(`day-${getTodayKey()}`, cloudDay);
      }
      if (cloudMem && !store.get("nutrition-coach-memory")) {
        setCoachMemory(cloudMem);
        store.set("nutrition-coach-memory", cloudMem);
      }
    };
    sync();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pushToast = (text, type = "ok") => {
    const id = Date.now() + Math.random();
    setToasts(ts => [...ts, { id, text, type }]);
    setTimeout(() => setToasts(ts => ts.filter(t => t.id !== id)), 2500);
  };

  const saveAll = useCallback((day, msgs, hist, w, mem) => {
    if (day) {
      store.set(`day-${day.dateKey}`, day);
      const updatedHist = { ...hist, [day.dateKey]: { date: day.date, totals: day.totals, water_ml: day.water_ml, creatine_done: day.creatine_done, coffee_count: day.coffee_count, meals: day.meals } };
      store.set("nutrition-history", updatedHist);
      setHistory(updatedHist);
    }
    const msgsForStorage = msgs.map(m => m.image ? { ...m, image: undefined } : m);
    store.set(`chat-${getTodayKey()}`, msgsForStorage);
    if (w) store.set("nutrition-weights", w);
    if (mem !== undefined) store.set("nutrition-coach-memory", mem);
  }, []);

  const buildContext = (day) => ({
    today: day ? { ...day } : { no_active_day: true },
    targets, goal,
    current_time: new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
    current_hour: getHourNow(),
    date: getTodayDate(),
    recent_history: Object.entries(history).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 7).map(([k, v]) => ({ dateKey: k, date: v.date, totals: v.totals, water_ml: v.water_ml, creatine: v.creatine_done })),
    recent_weights: Object.entries(weights).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 14).map(([k, w]) => ({ dateKey: k, weight_kg: w })),
    next_meal_tag: nextMealTag,
  });

  const isTrivialLiquid = (text) => {
    const t = text.toLowerCase().trim();
    return /^(water|coffee|sparkling|creatine|cr|h2o)(\s|$)/.test(t) || /^\d+\s*(ml|oz|cup|cups|l)$/.test(t);
  };

  const parseUpdates = (text, day) => {
    if (!day) return { updated: null, macroDelta: {}, liquidDelta: null, weight: null, mealLogged: null, insight: null, mealRemoved: null };
    const updated = { ...day, totals: { ...day.totals }, meals: [...(day.meals || [])] };
    const macroDelta = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
    const m = text.match(/MACRO_UPDATE:\s*(\{[\s\S]*?\})/);
    let mealLogged = null;
    if (m) {
      try {
        const d = JSON.parse(m[1]);
        macroDelta.calories = d.calories || 0; macroDelta.protein = d.protein || 0;
        macroDelta.carbs = d.carbs || 0; macroDelta.fat = d.fat || 0; macroDelta.fiber = d.fiber || 0;
        updated.totals.calories = Math.round((updated.totals.calories || 0) + macroDelta.calories);
        updated.totals.protein  = Math.round((updated.totals.protein  || 0) + macroDelta.protein);
        updated.totals.carbs    = Math.round((updated.totals.carbs    || 0) + macroDelta.carbs);
        updated.totals.fat      = Math.round((updated.totals.fat      || 0) + macroDelta.fat);
        updated.totals.fiber    = Math.round((updated.totals.fiber    || 0) + macroDelta.fiber);
        if (d.meal_name) {
          const tag = nextMealTag || d.tag || bucketFromHour(getHourNow());
          mealLogged = { name: d.meal_name, macros: d, time: new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }), tag, ts: Date.now() };
          updated.meals.push(mealLogged);
        }
      } catch {}
    }
    let liquidDelta = null;
    const l = text.match(/LIQUID_UPDATE:\s*(\{[\s\S]*?\})/);
    if (l) {
      try {
        const d = JSON.parse(l[1]);
        if (d.water_ml) updated.water_ml = (updated.water_ml || 0) + d.water_ml;
        if (d.coffee) updated.coffee_count = (updated.coffee_count || 0) + 1;
        if (d.creatine) updated.creatine_done = true;
        liquidDelta = d;
      } catch {}
    }
    let weight = null;
    const w = text.match(/WEIGHT_UPDATE:\s*(\{[\s\S]*?\})/);
    if (w) { try { const d = JSON.parse(w[1]); if (d.weight_kg) weight = d.weight_kg; } catch {} }
    let insight = null;
    const ci = text.match(/COACH_INSIGHT:\s*(\{[\s\S]*?\})/);
    if (ci) { try { const d = JSON.parse(ci[1]); if (d.insight) insight = d.insight; } catch {} }
    let mealRemoved = null;
    const mr = text.match(/MACRO_REMOVE:\s*(\{[\s\S]*?\})/);
    if (mr) {
      try {
        const d = JSON.parse(mr[1]);
        const nameLower = (d.meal_name || "").toLowerCase();
        const idx = [...updated.meals].map((m, i) => ({ m, i })).reverse().find(({ m }) => m.name?.toLowerCase().includes(nameLower))?.i;
        if (idx !== undefined) {
          const removed = updated.meals[idx];
          updated.meals = updated.meals.filter((_, i) => i !== idx);
          const sub = (key) => Math.max(0, Math.round((updated.totals[key] || 0) - (d[key] || removed.macros?.[key] || 0)));
          updated.totals.calories = sub("calories"); updated.totals.protein = sub("protein");
          updated.totals.carbs = sub("carbs"); updated.totals.fat = sub("fat"); updated.totals.fiber = sub("fiber");
          mealRemoved = removed;
        }
      } catch {}
    }
    return { updated, macroDelta, liquidDelta, weight, mealLogged, insight, mealRemoved };
  };

  const cleanText = (t) => t
    .replace(/MACRO_UPDATE:\s*\{[\s\S]*?\}/g, "")
    .replace(/MACRO_REMOVE:\s*\{[\s\S]*?\}/g, "")
    .replace(/LIQUID_UPDATE:\s*\{[\s\S]*?\}/g, "")
    .replace(/WEIGHT_UPDATE:\s*\{[\s\S]*?\}/g, "")
    .replace(/COACH_INSIGHT:\s*\{[\s\S]*?\}/g, "")
    .trim();

  const sendMessage = async (userText, opts = {}) => {
    const trimmed = (userText || "").trim();
    const hasImage = !!opts.image;
    if ((!trimmed && !hasImage) || loading) return;

    const isNewDay = /^new day$/i.test(trimmed);
    let currentDay = isNewDay ? initDay() : dayData;
    if (isNewDay) setDayData(currentDay);

    const userMsg = { type: "user", text: trimmed, hidden: opts.hidden, image: opts.image?.dataUrl };
    const newMsgs = [...messages, userMsg];
    setMessages(newMsgs);
    setInput("");
    if (hasImage) setPendingImage(null);
    setLoading(true);
    if (sidebarOpen && isMobile) setSidebarOpen(false);

    const apiHistory = messages.slice(-16).filter(m => !m.hidden).map(m => ({
      role: m.type === "user" ? "user" : "assistant",
      content: m.type === "user" ? (m.image ? `[Photo logged${m.text ? ` — context: ${m.text}` : ""}]` : m.text) : (m.raw || m.text),
    }));

    const selectedModel = (isTrivialLiquid(trimmed) && !isNewDay && !hasImage)
      ? "claude-haiku-4-5-20251001" : "claude-sonnet-4-20250514";

    const contextSuffix = `\n\n[CONTEXT: ${JSON.stringify(buildContext(currentDay))}]`;
    const currentContent = hasImage
      ? [
          { type: "image", source: { type: "base64", media_type: opts.image.mediaType, data: opts.image.data } },
          { type: "text", text: `Analyze this food photo and log it as a meal${trimmed ? `. User context: ${trimmed}` : ""}${contextSuffix}` },
        ]
      : `${trimmed}${contextSuffix}`;

    try {
      const res = await fetch(API_ENDPOINT, {
        method: "POST",
        headers: import.meta.env.DEV
          ? { "Content-Type": "application/json", "x-api-key": API_KEY, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" }
          : { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ model: selectedModel, max_tokens: 1000, system: buildSystemPrompt({ targets, goal, coachMemory }), messages: [...apiHistory, { role: "user", content: currentContent }] }),
      });
      if (res.status === 401) clearPasscode();
      const data = await res.json();
      const rawText = data.content?.[0]?.text || (res.status === 401 ? "Wrong or missing passcode. Send your message again and enter the passcode when asked." : "Something went wrong.");
      const displayText = cleanText(rawText);
      const { updated, macroDelta, liquidDelta, weight, mealLogged, insight, mealRemoved } = parseUpdates(rawText, currentDay);

      if (updated) setDayData(updated);

      if (macroDelta.calories) {
        pushToast(`+${Math.round(macroDelta.calories)}cal · P+${Math.round(macroDelta.protein)} C+${Math.round(macroDelta.carbs)} F+${Math.round(macroDelta.fat)}`);
        setDelta({ calories: macroDelta.calories, protein: macroDelta.protein, carbs: macroDelta.carbs, fat: macroDelta.fat, fiber: macroDelta.fiber });
        setTimeout(() => setDelta({}), 2200);
        if (updated.totals.carbs >= targets.carbs.max) pushToast(`⚠ Carb cap hit: ${updated.totals.carbs}g`, "warn");
      }
      if (liquidDelta) {
        const parts = [];
        if (liquidDelta.water_ml) parts.push(`+${liquidDelta.water_ml}ml`);
        if (liquidDelta.coffee) parts.push("☕");
        if (liquidDelta.creatine) parts.push("creatine ✓");
        if (parts.length) pushToast(parts.join(" · "));
      }
      if (weight) {
        const w2 = { ...weights, [getTodayKey()]: weight };
        setWeights(w2); store.set("nutrition-weights", w2);
        pushToast(`Weight: ${weight}kg`);
      }
      let mem = coachMemory;
      if (insight) {
        const lines = (coachMemory || "").split("\n").filter(Boolean);
        const newLine = `- ${insight}`;
        if (!lines.includes(newLine)) lines.unshift(newLine);
        mem = lines.slice(0, 8).join("\n");
        setCoachMemory(mem);
      }
      if (mealRemoved) {
        pushToast(`Removed: ${mealRemoved.name} (−${mealRemoved.macros?.calories || 0}cal)`, "warn");
        setDelta({ calories: -(mealRemoved.macros?.calories || 0), protein: -(mealRemoved.macros?.protein || 0), carbs: -(mealRemoved.macros?.carbs || 0), fat: -(mealRemoved.macros?.fat || 0), fiber: -(mealRemoved.macros?.fiber || 0) });
        setTimeout(() => setDelta({}), 2200);
      }
      if (mealLogged && nextMealTag) setNextMealTag(null);

      const aiMsg = { type: "ai", text: displayText, raw: rawText, mealRef: mealLogged ? mealLogged.ts : null };
      const finalMsgs = [...newMsgs, aiMsg];
      setMessages(finalMsgs);
      saveAll(updated, finalMsgs, history, weights, mem);
    } catch (err) {
      setMessages([...newMsgs, { type: "ai", text: `Error: ${err.message}` }]);
    }
    setLoading(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  // ─── PROACTIVE NUDGES ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!dayData) return;
    const hr = getHourNow();
    const totals = dayData.totals || {};
    const sent = proactiveSent;
    const fire = (key, msg) => {
      if (sent[key]) return;
      const next = { ...sent, [key]: true };
      setProactiveSent(next);
      store.set(`nudge-${getTodayKey()}`, next);
      sendMessage(`[PROACTIVE NUDGE TRIGGER: ${msg}] Give Josue a sharp 1-2 sentence nudge based on his current state.`, { hidden: true });
    };
    if (hr >= 13 && (totals.protein || 0) < 80) fire("protein-mid", "Protein under 80g by 1pm");
    if (hr >= 18 && (totals.fiber || 0) < 15) fire("fiber-eve", "Fiber under 15g by 6pm");
    if (hr >= 19 && (totals.calories || 0) < 1500) fire("cal-low", "Calories under 1500 by 7pm");
    if (hr >= 15 && (dayData.water_ml || 0) < 1500) fire("water-aft", "Water under 1.5L by 3pm");
    if (hr >= 21 && (totals.carbs || 0) < targets.carbs.min) fire("carbs-low", "Carbs below min by 9pm");
    if ((dayData.coffee_count || 0) >= 4 && (dayData.water_ml || 0) < 1500) fire("coffee-water", `${dayData.coffee_count} coffees but under 1.5L water — dehydration risk`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayData?.totals?.protein, dayData?.totals?.fiber, dayData?.totals?.calories, dayData?.water_ml, dayData?.coffee_count]);

  // ─── VOICE + IMAGE ───────────────────────────────────────────────────────────
  const startVoice = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { pushToast("Voice not supported", "warn"); return; }
    const r = new SR();
    r.lang = "en-US"; r.continuous = false; r.interimResults = false;
    r.onresult = (e) => {
      const t = e.results[0][0].transcript?.trim();
      if (!t) { setListening(false); return; }
      setInput(t); setListening(false);
      setTimeout(() => sendMessage(t), 200);
    };
    r.onerror = () => { setListening(false); pushToast("Voice error", "warn"); };
    r.onend = () => setListening(false);
    recognitionRef.current = r; r.start(); setListening(true);
  };
  const stopVoice = () => { recognitionRef.current?.stop(); setListening(false); };

  const handleImageFile = (file) => {
    if (!file || !file.type.startsWith("image/")) return;
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const MAX = 1024;
      let w = img.width, h = img.height;
      if (w > MAX || h > MAX) { if (w > h) { h = Math.round(h * MAX / w); w = MAX; } else { w = Math.round(w * MAX / h); h = MAX; } }
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
      URL.revokeObjectURL(url);
      setPendingImage({ dataUrl, data: dataUrl.split(",")[1], mediaType: "image/jpeg" });
    };
    img.src = url;
  };

  // ─── EXPORT / IMPORT ─────────────────────────────────────────────────────────
  const exportData = () => {
    const blob = new Blob([JSON.stringify({ version: 2, exported_at: new Date().toISOString(), history, weights, targets, goal, coachMemory, today: dayData }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `nutrition-os-backup-${getTodayKey()}.json`; a.click();
    URL.revokeObjectURL(url); pushToast("Backup downloaded");
  };
  const importData = (file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (data.history) { setHistory(data.history); store.set("nutrition-history", data.history); }
        if (data.weights) { setWeights(data.weights); store.set("nutrition-weights", data.weights); }
        if (data.targets) { setTargets(data.targets); store.set("nutrition-targets", data.targets); }
        if (data.goal) { setGoal(data.goal); store.set("nutrition-goal", data.goal); }
        if (data.coachMemory) { setCoachMemory(data.coachMemory); store.set("nutrition-coach-memory", data.coachMemory); }
        pushToast("Import successful");
      } catch (err) { pushToast(`Import failed: ${err.message}`, "warn"); }
    };
    reader.readAsText(file);
  };

  // ─── REPORT GENERATION ───────────────────────────────────────────────────────
  const generateReport = (period) => {
    const allDays = Object.entries(history).sort((a, b) => a[0].localeCompare(b[0]));
    const now = new Date();
    let filtered, periodLabel;
    if (period === "7") {
      const cutoff = new Date(now - 7 * 86400000).toISOString().split("T")[0];
      filtered = allDays.filter(([k]) => k >= cutoff);
      periodLabel = "Last 7 Days";
    } else if (period === "30") {
      const cutoff = new Date(now - 30 * 86400000).toISOString().split("T")[0];
      filtered = allDays.filter(([k]) => k >= cutoff);
      periodLabel = "Last 30 Days";
    } else {
      filtered = allDays;
      periodLabel = "All Time";
    }
    filtered = filtered.slice().reverse();
    if (!filtered.length) { pushToast("No data for this period", "warn"); return; }

    const days = filtered.length;
    const avg = (fn) => Math.round(filtered.reduce((s, [, d]) => s + (fn(d) || 0), 0) / days);
    const avgCal = avg(d => d.totals?.calories);
    const avgProt = avg(d => d.totals?.protein);
    const avgWater = avg(d => d.water_ml);
    const proteinHits = filtered.filter(([, d]) => (d.totals?.protein || 0) >= targets.protein.min).length;
    const waterHits = filtered.filter(([, d]) => (d.water_ml || 0) >= targets.water_ml).length;
    const creatineHits = filtered.filter(([, d]) => d.creatine_done).length;
    const calHits = filtered.filter(([, d]) => { const c = d.totals?.calories || 0; return c >= targets.calories.min && c <= targets.calories.max + 100; }).length;

    const bar = (val, max, color) => {
      const pct = Math.min(100, Math.round((val / max) * 100));
      return `<div style="height:7px;background:#f0f0f0;border-radius:4px;overflow:hidden;margin-bottom:3px"><div style="width:${pct}%;height:100%;background:${color};border-radius:4px"></div></div>`;
    };

    const dayRows = filtered.map(([dateKey, day]) => {
      const w = weights[dateKey];
      const meals = (day.meals || []);
      const mealRows = meals.length ? meals.map(m =>
        `<tr><td style="padding:5px 0;color:#444;font-size:13px">${m.tag ? `<span style="font-size:10px;color:#aaa;margin-right:6px;text-transform:uppercase">${m.tag}</span>` : ""}${m.name || "—"}</td>
         <td style="text-align:right;font-size:12px;color:#888;white-space:nowrap">${m.macros?.calories || 0} cal &nbsp; P${m.macros?.protein || 0} &nbsp; C${m.macros?.carbs || 0} &nbsp; F${m.macros?.fat || 0}</td></tr>`
      ).join("") : `<tr><td colspan="2" style="color:#ccc;font-size:12px;padding:6px 0">No meals logged</td></tr>`;

      return `
      <div style="border:1px solid #e8ecf4;border-radius:14px;padding:20px 24px;margin-bottom:14px;page-break-inside:avoid">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px">
          <div>
            <div style="font-size:15px;font-weight:700;color:#0f1525">${day.date || dateKey}</div>
            ${w ? `<div style="font-size:12px;color:#888;margin-top:2px">⚖️ ${w} kg</div>` : ""}
          </div>
          <div style="text-align:right">
            <div style="font-size:22px;font-weight:800;color:#38bdf8">${Math.round(day.totals?.calories || 0)}</div>
            <div style="font-size:11px;color:#aaa">kcal</div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:16px">
          ${[["Protein", day.totals?.protein || 0, targets.protein.max, "#f97316", "g"],
             ["Carbs",   day.totals?.carbs   || 0, targets.carbs.max,   "#fde047", "g"],
             ["Fat",     day.totals?.fat     || 0, targets.fat.max,     "#e879f9", "g"],
             ["Fiber",   day.totals?.fiber   || 0, targets.fiber.min,   "#34d399", "g"],
             ["Water",   Math.round((day.water_ml || 0) / 100) / 10, targets.water_ml / 1000, "#60a5fa", "L"]
          ].map(([label, val, max, color, unit]) => `
            <div style="text-align:center">
              ${bar(val, max, color)}
              <div style="font-size:13px;font-weight:700;color:#1a1a2e">${val}${unit}</div>
              <div style="font-size:10px;color:#aaa;text-transform:uppercase;letter-spacing:0.05em">${label}</div>
            </div>`).join("")}
        </div>
        <div style="border-top:1px solid #f0f3f8;padding-top:12px">
          <table style="width:100%;border-collapse:collapse">${mealRows}</table>
        </div>
        <div style="display:flex;gap:14px;margin-top:10px;padding-top:10px;border-top:1px solid #f8f8f8;font-size:11px;color:#bbb">
          <span>💧 ${Math.round((day.water_ml || 0) / 100) / 10}L water</span>
          ${day.coffee_count ? `<span>☕ ${day.coffee_count} coffee</span>` : ""}
          <span style="color:${day.creatine_done ? "#10b981" : "#ddd"}">${day.creatine_done ? "✓" : "✗"} creatine</span>
        </div>
      </div>`;
    }).join("");

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Nutrition Report · ${periodLabel}</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; background: #f7f9fc; color: #1a1a2e; }
      .page { max-width: 780px; margin: 0 auto; padding: 40px 32px; }
      @media print { body { background: white; } .page { padding: 24px; } .no-print { display: none; } }
    </style></head><body>
    <div class="page">
      <div style="border-bottom:3px solid #0f1525;padding-bottom:20px;margin-bottom:32px;display:flex;justify-content:space-between;align-items:flex-end">
        <div>
          <div style="font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#888;margin-bottom:6px">Nutrition OS</div>
          <div style="font-size:30px;font-weight:800;color:#0f1525">Nutrition Report</div>
          <div style="font-size:13px;color:#888;margin-top:4px">${periodLabel} &nbsp;·&nbsp; Generated ${now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:11px;color:#aaa">Phase</div>
          <div style="font-size:14px;font-weight:700;color:#0f1525;text-transform:capitalize">${goal.phase}</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:32px">
        ${[
          ["Days Tracked",     days,                                      ""],
          ["Avg Calories",     avgCal,                                    "kcal"],
          ["Avg Protein",      avgProt + "g",                             "/ ${targets.protein.max}g target"],
          ["Avg Water",        (Math.round(avgWater / 100) / 10) + "L",  "/ ${(targets.water_ml/1000).toFixed(1)}L target"],
        ].map(([label, val, sub]) => `
          <div style="background:white;border:1px solid #e8ecf4;border-radius:14px;padding:18px;text-align:center">
            <div style="font-size:26px;font-weight:800;color:#0f1525">${val}</div>
            ${sub ? `<div style="font-size:11px;color:#aaa;margin-top:2px">${sub}</div>` : ""}
            <div style="font-size:10px;color:#bbb;text-transform:uppercase;letter-spacing:0.08em;margin-top:6px">${label}</div>
          </div>`).join("")}
      </div>

      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:36px">
        ${[
          ["Calorie Target Hit",  calHits,     days, "#38bdf8"],
          ["Protein Goal Hit",    proteinHits, days, "#f97316"],
          ["Water Goal Hit",      waterHits,   days, "#60a5fa"],
        ].map(([label, hits, total, color]) => {
          const pct = total ? Math.round(hits / total * 100) : 0;
          return `
          <div style="background:white;border:1px solid #e8ecf4;border-radius:14px;padding:18px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:0.06em">${label}</div>
              <div style="font-size:14px;font-weight:700;color:${color}">${pct}%</div>
            </div>
            <div style="height:7px;background:#f0f0f0;border-radius:4px;overflow:hidden">
              <div style="width:${pct}%;height:100%;background:${color};border-radius:4px"></div>
            </div>
            <div style="font-size:11px;color:#bbb;margin-top:6px">${hits} / ${total} days</div>
          </div>`;
        }).join("")}
      </div>

      <div style="font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#888;margin-bottom:16px;font-weight:600">Daily Log</div>
      ${dayRows}

      <div style="text-align:center;margin-top:32px;padding-top:20px;border-top:1px solid #e8ecf4;font-size:11px;color:#ccc">
        Generated by Nutrition OS &nbsp;·&nbsp; nutrition-os-gray.vercel.app
      </div>
    </div>
    <script>window.addEventListener("load", () => window.print())</script>
    </body></html>`;

    const w2 = window.open("", "_blank");
    if (w2) { w2.document.write(html); w2.document.close(); }
    else pushToast("Allow pop-ups to generate report", "warn");
  };

  // ─── DERIVED STATE ────────────────────────────────────────────────────────────
  const totals = dayData?.totals || { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
  const drops = Array.from({ length: 10 }, (_, i) => i < Math.round(Math.min(((dayData?.water_ml || 0) / targets.water_ml) * 100, 100) / 10));
  const histDays = useMemo(() => {
    const all = Object.entries(history).sort((a, b) => b[0].localeCompare(a[0]));
    if (!historySearch.trim()) return all.slice(0, 14);
    const q = historySearch.toLowerCase();
    return all.filter(([key, day]) => key.includes(q) || (day.date || "").toLowerCase().includes(q) || (day.meals || []).some(m => (m.name || "").toLowerCase().includes(q)));
  }, [history, historySearch]);
  const stats = useMemo(() => computeStreaks(history, targets), [history, targets]);
  const groupedMeals = useMemo(() => {
    const groups = {};
    (dayData?.meals || []).forEach(m => { const tag = m.tag || "snack"; if (!groups[tag]) groups[tag] = []; groups[tag].push(m); });
    return groups;
  }, [dayData?.meals]);

  const exampleChips = ["New Day", "Egg whites 200g + Greek yogurt 150g", "Water 500ml", "Coffee black", "Creatine done", "Weight 78", "Rate my day"];

  const SectionDivider = () => (
    <div style={{ height: "1px", background: `linear-gradient(90deg, transparent, ${C.b1}, transparent)`, margin: "2px 0" }} />
  );

  const SectionLabel = ({ children }) => (
    <div style={{ fontSize: "10px", fontFamily: "monospace", color: C.t2, letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: "14px", fontWeight: "600" }}>
      {children}
    </div>
  );

  // ─── SIDEBAR ─────────────────────────────────────────────────────────────────
  const Sidebar = () => (
    <div style={{ width: isMobile ? "100%" : "260px", minWidth: isMobile ? "unset" : "260px", background: C.bg1, borderRight: isMobile ? "none" : `1px solid ${C.b0}`, display: "flex", flexDirection: "column", padding: "22px 18px", gap: "20px", overflowY: "auto", height: isMobile ? "100%" : "auto" }}>

      {/* Header */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
          <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: C.ai, boxShadow: `0 0 8px ${C.ai}` }} />
          <span style={{ fontSize: "10px", fontFamily: "monospace", color: C.t2, letterSpacing: "0.15em", textTransform: "uppercase" }}>Nutrition OS · {goal.phase}</span>
        </div>
        <div style={{ fontSize: "22px", fontWeight: "800", color: C.t0, letterSpacing: "-0.03em" }}>Josue</div>
        <div style={{ fontSize: "11px", color: C.t1, fontFamily: "monospace", marginTop: "3px" }}>{getTodayDate()}</div>
      </div>

      <SectionDivider />

      {/* Macros */}
      <div>
        <SectionLabel>Today's Macros</SectionLabel>
        <MacroBar label="Calories" current={totals.calories} min={targets.calories.min} max={targets.calories.max} unit="" color={C.cal} delta={delta.calories} />
        <MacroBar label="Protein"  current={totals.protein}  min={targets.protein.min}  max={targets.protein.max}  unit="g" color={C.prot} delta={delta.protein} />
        <MacroBar label="Carbs"    current={totals.carbs}    min={targets.carbs.min}    max={targets.carbs.max}    unit="g" color={C.carb} delta={delta.carbs} hardCap />
        <MacroBar label="Fat"      current={totals.fat}      min={targets.fat.min}      max={targets.fat.max}      unit="g" color={C.fat}  delta={delta.fat} />
        <MacroBar label="Fiber"    current={totals.fiber}    min={targets.fiber.min}    max={targets.fiber.max}    unit="g" color={C.fib}  delta={delta.fiber} />
      </div>

      <SectionDivider />

      {/* Hydration */}
      <div>
        <SectionLabel>Hydration</SectionLabel>
        <div style={{ display: "flex", gap: "5px", flexWrap: "wrap", marginBottom: "8px" }}>
          {drops.map((f, i) => <WaterDrop key={i} filled={f} />)}
        </div>
        <div style={{ fontSize: "13px", fontFamily: "monospace", color: C.wat, fontWeight: "600" }}>
          {((dayData?.water_ml || 0) / 1000).toFixed(1)}L
          <span style={{ color: C.t2, fontWeight: "400" }}> / {(targets.water_ml / 1000).toFixed(1)}L</span>
        </div>
      </div>

      {/* Supplements */}
      <div>
        <SectionLabel>Supplements</SectionLabel>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
          <div style={{ width: "9px", height: "9px", borderRadius: "50%", background: dayData?.creatine_done ? C.ok : "transparent", border: `2px solid ${dayData?.creatine_done ? C.ok : C.b1}`, boxShadow: dayData?.creatine_done ? `0 0 8px ${C.ok}60` : "none", transition: "all 0.3s", flexShrink: 0 }} />
          <span style={{ fontSize: "13px", color: dayData?.creatine_done ? C.ok : C.t1, fontWeight: dayData?.creatine_done ? "600" : "400" }}>Creatine 5g</span>
        </div>
        <div style={{ fontSize: "13px", fontFamily: "monospace" }}>
          <span style={{ fontSize: "15px" }}>☕</span>
          <span style={{ color: C.t0, fontWeight: "600", marginLeft: "6px" }}>{dayData?.coffee_count || 0}</span>
          <span style={{ color: C.t2 }}> cups</span>
        </div>
      </div>

      {/* Streaks */}
      {(stats.proteinStreak > 0 || stats.creatineStreak > 0) && (
        <>
          <SectionDivider />
          <div>
            <SectionLabel>Streaks</SectionLabel>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "10px" }}>
              <div style={{ background: C.bg2, border: `1px solid ${C.b0}`, borderRadius: "10px", padding: "10px 12px" }}>
                <div style={{ fontSize: "20px", color: C.prot, fontWeight: "800", lineHeight: 1 }}>{stats.proteinStreak}<span style={{ fontSize: "14px" }}>🔥</span></div>
                <div style={{ fontSize: "10px", color: C.t1, fontFamily: "monospace", marginTop: "4px", textTransform: "uppercase", letterSpacing: "0.08em" }}>protein</div>
              </div>
              <div style={{ background: C.bg2, border: `1px solid ${C.b0}`, borderRadius: "10px", padding: "10px 12px" }}>
                <div style={{ fontSize: "20px", color: C.ok, fontWeight: "800", lineHeight: 1 }}>{stats.creatineStreak}<span style={{ fontSize: "14px" }}>🔥</span></div>
                <div style={{ fontSize: "10px", color: C.t1, fontFamily: "monospace", marginTop: "4px", textTransform: "uppercase", letterSpacing: "0.08em" }}>creatine</div>
              </div>
            </div>
            <div style={{ fontSize: "11px", color: C.t1, fontFamily: "monospace" }}>
              7d: P{stats.adherence.protein}/{stats.adherence.days} · Cap{stats.adherence.carbsCap}/{stats.adherence.days} · H₂O{stats.adherence.water}/{stats.adherence.days}
            </div>
          </div>
        </>
      )}

      {/* Meals Today */}
      {dayData?.meals?.length > 0 && (
        <>
          <SectionDivider />
          <div>
            <SectionLabel>Meals Today</SectionLabel>
            {["breakfast","lunch","preworkout","postworkout","dinner","snack","late"].filter(b => groupedMeals[b]).map(bucket => (
              <div key={bucket} style={{ marginBottom: "14px" }}>
                <div style={{ fontSize: "10px", color: C.t1, fontFamily: "monospace", letterSpacing: "0.08em", marginBottom: "6px" }}>{bucketLabel[bucket]}</div>
                {groupedMeals[bucket].map((m, i) => (
                  <div key={i} onClick={() => setMealDetail(m)} style={{ marginBottom: "6px", cursor: "pointer", padding: "8px 10px", borderRadius: "8px", border: `1px solid transparent`, background: C.bg2, transition: "all 0.15s" }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = C.b1; e.currentTarget.style.background = C.bg3; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = "transparent"; e.currentTarget.style.background = C.bg2; }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "2px" }}>
                      <span style={{ fontSize: "11px", color: C.t1 }}>{m.time}</span>
                      <span style={{ fontSize: "12px", fontFamily: "monospace", color: C.cal, fontWeight: "600" }}>{m.macros?.calories}cal</span>
                    </div>
                    <div style={{ fontSize: "13px", color: C.t0, fontWeight: "500", marginBottom: "3px" }}>{m.name}</div>
                    <div style={{ fontSize: "11px", fontFamily: "monospace", color: C.t1 }}>
                      <span style={{ color: C.prot }}>P{m.macros?.protein}g</span>
                      <span style={{ color: C.t2 }}> · </span>
                      <span style={{ color: C.carb }}>C{m.macros?.carbs}g</span>
                      <span style={{ color: C.t2 }}> · </span>
                      <span style={{ color: C.fat }}>F{m.macros?.fat}g</span>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}

      {/* History */}
      <SectionDivider />
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
          <SectionLabel>History</SectionLabel>
          <div style={{ display: "flex", gap: "6px", marginBottom: "14px" }}>
            <button onClick={() => setChartsOpen(true)} style={{ background: C.bg2, border: `1px solid ${C.b0}`, color: C.t1, fontSize: "12px", padding: "4px 10px", borderRadius: "7px", cursor: "pointer" }}>📈</button>
            <button onClick={() => setWeeklyOpen(true)} style={{ background: C.bg2, border: `1px solid ${C.b0}`, color: C.t1, fontSize: "12px", padding: "4px 10px", borderRadius: "7px", cursor: "pointer" }}>📋</button>
          </div>
        </div>
        <input
          value={historySearch}
          onChange={e => setHistorySearch(e.target.value)}
          placeholder="search meals or dates…"
          style={{ width: "100%", padding: "8px 12px", marginBottom: "10px", background: C.bg2, border: `1px solid ${C.b0}`, borderRadius: "8px", color: C.t0, fontSize: "12px", fontFamily: "monospace" }}
        />
        {histDays.length === 0 && <div style={{ fontSize: "12px", color: C.t2, fontStyle: "italic" }}>No matches</div>}
        {histDays.map(([key, day]) => {
          const isToday = key === getTodayKey();
          return (
            <div key={key} onClick={() => !isToday && sendMessage(`Show me my data for ${day.date}`)}
              style={{ padding: "8px 10px", borderRadius: "8px", marginBottom: "4px", cursor: isToday ? "default" : "pointer", background: isToday ? C.bg3 : "transparent", border: `1px solid ${isToday ? C.b1 : "transparent"}`, transition: "all 0.15s" }}
              onMouseEnter={e => { if (!isToday) { e.currentTarget.style.background = C.bg2; e.currentTarget.style.borderColor = C.b0; } }}
              onMouseLeave={e => { if (!isToday) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "transparent"; } }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "2px" }}>
                <span style={{ fontSize: "12px", color: isToday ? C.cal : C.t1, fontWeight: isToday ? "600" : "400" }}>
                  {isToday ? "Today" : new Date(key + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                </span>
                <span style={{ fontSize: "12px", fontFamily: "monospace", color: C.t0, fontWeight: "600" }}>{Math.round(day.totals?.calories || 0)}</span>
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <span style={{ fontSize: "10px", fontFamily: "monospace", color: C.prot }}>P{Math.round(day.totals?.protein || 0)}</span>
                <span style={{ fontSize: "10px", fontFamily: "monospace", color: C.carb }}>C{Math.round(day.totals?.carbs || 0)}</span>
                <span style={{ fontSize: "10px", fontFamily: "monospace", color: C.fat }}>F{Math.round(day.totals?.fat || 0)}</span>
                {day.creatine_done && <span style={{ fontSize: "10px", color: C.ok }}>●CR</span>}
                {weights[key] && <span style={{ fontSize: "10px", color: C.ai }}>⚖{weights[key]}</span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Quick actions */}
      <div style={{ marginTop: "auto", paddingTop: "8px" }}>
        <SectionLabel>Quick</SectionLabel>
        {[["New Day","New Day"],["Rate my day","Rate my day"],["Weekly summary","Weekly summary"]].map(([label, cmd]) => (
          <button key={cmd} onClick={() => { sendMessage(cmd); if (isMobile) setSidebarOpen(false); }}
            style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 12px", marginBottom: "5px", background: C.bg2, border: `1px solid ${C.b0}`, borderRadius: "9px", color: C.t1, fontSize: "13px", cursor: "pointer", fontFamily: "monospace", transition: "all 0.15s" }}
            onMouseEnter={e => { e.currentTarget.style.background = C.bg3; e.currentTarget.style.color = C.t0; }}
            onMouseLeave={e => { e.currentTarget.style.background = C.bg2; e.currentTarget.style.color = C.t1; }}>
            {label}
          </button>
        ))}
        <div style={{ marginTop: "10px" }}>
          <div style={{ fontSize: "10px", fontFamily: "monospace", color: C.t2, letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: "8px", fontWeight: "600" }}>Export Report</div>
          <div style={{ display: "flex", gap: "6px" }}>
            {[["7d", "7"], ["30d", "30"], ["All", "all"]].map(([label, period]) => (
              <button key={period} onClick={() => generateReport(period)}
                style={{ flex: 1, padding: "8px 4px", background: C.bg2, border: `1px solid ${C.b1}`, borderRadius: "8px", color: C.t1, fontSize: "12px", cursor: "pointer", fontFamily: "monospace", fontWeight: "600", transition: "all 0.15s" }}
                onMouseEnter={e => { e.currentTarget.style.background = C.ai; e.currentTarget.style.color = "#fff"; e.currentTarget.style.borderColor = C.ai; }}
                onMouseLeave={e => { e.currentTarget.style.background = C.bg2; e.currentTarget.style.color = C.t1; e.currentTarget.style.borderColor = C.b1; }}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <button onClick={() => setSettingsOpen(true)}
          style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 12px", marginTop: "10px", background: C.bg2, border: `1px solid ${C.b0}`, borderRadius: "9px", color: C.t1, fontSize: "13px", cursor: "pointer", fontFamily: "monospace" }}
          onMouseEnter={e => { e.currentTarget.style.background = C.bg3; e.currentTarget.style.color = C.t0; }}
          onMouseLeave={e => { e.currentTarget.style.background = C.bg2; e.currentTarget.style.color = C.t1; }}>
          ⚙ Settings
        </button>
      </div>
    </div>
  );

  // ─── RENDER ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ height: "100dvh", background: C.bg1, display: "flex", fontFamily: "-apple-system, 'SF Pro Display', system-ui, sans-serif", color: C.t0, overflow: "hidden", position: "relative" }}>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { overflow: hidden; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: ${C.b1}; border-radius: 2px; }
        ::-webkit-scrollbar-track { background: transparent; }
        textarea:focus, input:focus { outline: none; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.25} }
        @keyframes capPulse { 0%,100%{box-shadow:0 0 8px ${C.err}aa} 50%{box-shadow:0 0 18px ${C.err}} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes fadeOut { 0%{opacity:1} 65%{opacity:1} 100%{opacity:0} }
        @keyframes toastIn { from{opacity:0;transform:translateX(16px)} to{opacity:1;transform:translateX(0)} }
        @keyframes listenPulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.18)} }
        .msg-in { animation: fadeUp 0.22s ease forwards; }
        .action-btn:hover { opacity: 0.75; }
        .chip-btn { transition: all 0.15s; }
        .chip-btn:hover { background: ${C.bg4} !important; border-color: ${C.b2} !important; color: ${C.t0} !important; }
      `}</style>

      <Toast toasts={toasts} />

      {/* Mobile sidebar overlay */}
      {isMobile && sidebarOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex" }}>
          <div style={{ width: "280px", background: C.bg1, overflowY: "auto" }}><Sidebar /></div>
          <div style={{ flex: 1, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(2px)" }} onClick={() => setSidebarOpen(false)} />
        </div>
      )}

      {/* Desktop sidebar */}
      {!isMobile && <Sidebar />}

      {/* Main chat */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>

        {/* Header */}
        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.b0}`, display: "flex", alignItems: "center", gap: "14px", background: C.bg1 }}>
          {isMobile && (
            <button className="action-btn" onClick={() => setSidebarOpen(true)} style={{ background: C.bg2, border: `1px solid ${C.b0}`, color: C.t1, width: "38px", height: "38px", borderRadius: "10px", cursor: "pointer", fontSize: "16px", display: "flex", alignItems: "center", justifyContent: "center" }}>☰</button>
          )}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "16px", fontWeight: "700", color: C.t0, letterSpacing: "-0.01em" }}>Nutrition Coach</div>
            <div style={{ fontSize: "12px", color: C.t2, fontFamily: "monospace", marginTop: "1px" }}>
              {dayData ? "Active · auto-saved" : "Say 'New Day' to start tracking"}
            </div>
          </div>
          <div style={{ padding: "5px 14px", borderRadius: "20px", background: dayData ? "#051510" : C.bg2, border: `1px solid ${dayData ? C.ok + "50" : C.b0}`, fontSize: "11px", fontFamily: "monospace", color: dayData ? C.ok : C.t2, fontWeight: "600", letterSpacing: "0.05em" }}>
            {dayData ? "● ACTIVE" : "○ INACTIVE"}
          </div>
        </div>

        {/* Mobile macro strip */}
        {isMobile && dayData && (
          <div style={{ display: "flex", gap: "8px", padding: "10px 14px", borderBottom: `1px solid ${C.b0}`, overflowX: "auto", background: C.bg2 }}>
            {[
              ["CAL", totals.calories, targets.calories.max, C.cal],
              ["PRO", totals.protein,  targets.protein.max,  C.prot],
              ["CRB", totals.carbs,    targets.carbs.max,    C.carb],
              ["FAT", totals.fat,      targets.fat.max,      C.fat],
              ["FIB", totals.fiber,    targets.fiber.min,    C.fib],
              ["H₂O", `${((dayData.water_ml||0)/1000).toFixed(1)}L`, `${(targets.water_ml/1000).toFixed(1)}L`, C.wat],
            ].map(([label, cur, max, color]) => (
              <div key={label} style={{ flexShrink: 0, padding: "6px 12px", borderRadius: "8px", background: C.bg1, border: `1px solid ${C.b0}` }}>
                <div style={{ fontSize: "9px", fontFamily: "monospace", color: C.t2, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "2px" }}>{label}</div>
                <div style={{ fontSize: "13px", fontFamily: "monospace", fontWeight: "700" }}>
                  <span style={{ color }}>{typeof cur === "number" ? Math.round(cur) : cur}</span>
                  <span style={{ color: C.t2, fontSize: "10px", fontWeight: "400" }}>/{max}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Messages */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 16px", display: "flex", flexDirection: "column", gap: "14px" }}>
          {messages.length === 0 && (
            <div style={{ textAlign: "center", padding: "48px 24px 0" }}>
              <div style={{ fontSize: "40px", marginBottom: "14px" }}>🥗</div>
              {Object.keys(history).length === 0 && !dayData ? (
                <>
                  <div style={{ fontSize: "16px", color: C.t0, fontWeight: "600", marginBottom: "6px" }}>No data found</div>
                  <div style={{ fontSize: "13px", color: C.t1, marginBottom: "20px" }}>Switching from Safari? Import your backup first.</div>
                  <label style={{ display: "inline-block", padding: "11px 22px", background: C.bg4, border: `1px solid ${C.b2}`, borderRadius: "10px", color: C.t0, cursor: "pointer", fontSize: "14px", fontWeight: "600", marginBottom: "28px" }}>
                    ↑ Import Backup
                    <input type="file" accept="application/json" onChange={e => e.target.files[0] && importData(e.target.files[0])} style={{ display: "none" }} />
                  </label>
                  <div style={{ fontSize: "12px", color: C.t2, fontFamily: "monospace", marginBottom: "14px" }}>— or start fresh —</div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: "15px", color: C.t1, marginBottom: "6px" }}>{Object.keys(history).length > 0 ? `${Object.keys(history).length} days logged` : "Ready to track"}</div>
                  <div style={{ fontSize: "12px", color: C.t2, fontFamily: "monospace", marginBottom: "22px" }}>Try one of these:</div>
                </>
              )}
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "center", maxWidth: "520px", margin: "0 auto" }}>
                {exampleChips.map(c => (
                  <button key={c} className="chip-btn" onClick={() => sendMessage(c)} style={{ padding: "8px 14px", borderRadius: "20px", background: C.bg2, border: `1px solid ${C.b1}`, color: C.t1, fontSize: "13px", cursor: "pointer" }}>{c}</button>
                ))}
              </div>
            </div>
          )}

          {messages.filter(m => !m.hidden).map((msg, i) => (
            <div key={i} className="msg-in" style={{ display: "flex", justifyContent: msg.type === "user" ? "flex-end" : "flex-start", gap: "10px", alignItems: "flex-start" }}>
              {msg.type === "ai" && (
                <div style={{ width: "30px", height: "30px", borderRadius: "10px", background: C.bg2, border: `1px solid ${C.b1}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px", flexShrink: 0, marginTop: "2px", boxShadow: `0 0 12px ${C.ai}20` }}>⚡</div>
              )}
              <div style={{ maxWidth: msg.type === "user" ? "78%" : "88%", padding: msg.image ? "6px" : msg.type === "user" ? "11px 16px" : "13px 16px", borderRadius: msg.type === "user" ? "18px 18px 5px 18px" : "5px 18px 18px 18px", background: msg.type === "user" ? C.bg4 : C.bg2, border: `1px solid ${msg.type === "user" ? C.b2 : C.b0}`, fontSize: "15px", lineHeight: "1.65", color: msg.type === "user" ? C.t0 : C.t0, whiteSpace: "pre-wrap", wordBreak: "break-word", overflow: "hidden" }}>
                {msg.image && <img src={msg.image} alt="Food" style={{ display: "block", maxWidth: "260px", width: "100%", borderRadius: msg.text ? "10px 10px 0 0" : "10px" }} />}
                {msg.text && <div style={{ padding: msg.image ? "8px 10px 10px" : "0", color: msg.type === "user" ? "#c8deff" : C.t0 }}>{msg.text}</div>}
              </div>
            </div>
          ))}

          {loading && (
            <div className="msg-in" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <div style={{ width: "30px", height: "30px", borderRadius: "10px", background: C.bg2, border: `1px solid ${C.b1}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px" }}>⚡</div>
              <div style={{ display: "flex", gap: "5px", padding: "10px 14px", background: C.bg2, border: `1px solid ${C.b0}`, borderRadius: "5px 18px 18px 18px" }}>
                {[0,1,2].map(i => <div key={i} style={{ width: "5px", height: "5px", borderRadius: "50%", background: C.ai, animation: `pulse 1.3s ${i*0.22}s infinite` }} />)}
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Quick chips */}
        <div style={{ padding: "0 14px 10px", display: "flex", gap: "7px", overflowX: "auto" }}>
          {[
            ["☕ Coffee", "Coffee black"],
            ["💧 500ml", "Water 500ml"],
            ["💧 1L", "Water 1000ml"],
            ["💪 Creatine", "Creatine dry scoop done"],
            ["⚖ Weight", "__weight__"],
            [nextMealTag === "preworkout" ? "✓ Pre" : "🏋 Pre", "__pre__"],
            [nextMealTag === "postworkout" ? "✓ Post" : "🔥 Post", "__post__"],
          ].map(([label, cmd]) => (
            <button key={label} className="chip-btn" onClick={() => {
              if (cmd === "__weight__") {
                const w = prompt("Weight (kg)?");
                const n = parseFloat(w);
                if (w && !isNaN(n) && n > 0) sendMessage(`Weight ${n}`);
                else if (w) pushToast("Enter a valid number like 78.5", "warn");
              } else if (cmd === "__pre__") {
                setNextMealTag(nextMealTag === "preworkout" ? null : "preworkout");
              } else if (cmd === "__post__") {
                setNextMealTag(nextMealTag === "postworkout" ? null : "postworkout");
              } else {
                sendMessage(cmd);
              }
            }} style={{ flexShrink: 0, padding: "7px 14px", borderRadius: "20px", background: C.bg2, border: `1px solid ${C.b1}`, color: C.t1, fontSize: "12px", cursor: "pointer", whiteSpace: "nowrap", fontWeight: "500" }}>{label}</button>
          ))}
        </div>

        {/* Input */}
        <div style={{ padding: "0 16px 22px", borderTop: `1px solid ${C.b0}`, paddingTop: "14px" }}>
          {nextMealTag && (
            <div style={{ fontSize: "11px", color: C.carb, fontFamily: "monospace", marginBottom: "8px", fontWeight: "600" }}>
              Next meal → {bucketLabel[nextMealTag]}
            </div>
          )}
          <input ref={imageFileRef} type="file" accept="image/*" onChange={e => { handleImageFile(e.target.files[0]); e.target.value = ""; }} style={{ display: "none" }} />
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", background: C.bg2, border: `1.5px solid ${pendingImage ? C.b2 : C.b0}`, borderRadius: "16px", padding: "10px 12px", transition: "border-color 0.2s" }}>
            {pendingImage && (
              <div style={{ position: "relative", alignSelf: "flex-start" }}>
                <img src={pendingImage.dataUrl} alt="Preview" style={{ maxHeight: "140px", maxWidth: "220px", borderRadius: "10px", display: "block" }} />
                <button onClick={() => setPendingImage(null)} style={{ position: "absolute", top: "5px", right: "5px", width: "22px", height: "22px", borderRadius: "50%", background: "rgba(0,0,0,0.8)", border: "none", color: "#fff", cursor: "pointer", fontSize: "11px", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
              </div>
            )}
            <div style={{ display: "flex", gap: "8px", alignItems: "flex-end" }}>
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !loading) { e.preventDefault(); sendMessage(input, pendingImage ? { image: pendingImage } : {}); } }}
                placeholder={pendingImage ? "Add context: weight, portion… (optional)" : "Log meal, water, coffee — or say 'New Day'…"}
                rows={1}
                style={{ flex: 1, background: "transparent", border: "none", resize: "none", color: C.t0, fontSize: "16px", lineHeight: "1.5", maxHeight: "110px", fontFamily: "inherit", overflow: "auto" }}
                onInput={e => { e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 110) + "px"; }}
              />
              <button className="action-btn" onClick={() => imageFileRef.current?.click()} title="Add photo" style={{ width: "38px", height: "38px", borderRadius: "10px", background: pendingImage ? C.bg4 : "transparent", border: `1.5px solid ${pendingImage ? C.b2 : C.b0}`, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "17px", flexShrink: 0 }}>📷</button>
              <button className="action-btn" onClick={listening ? stopVoice : startVoice} style={{ width: "38px", height: "38px", borderRadius: "10px", background: listening ? "#3a0808" : "transparent", border: `1.5px solid ${listening ? C.err : C.b0}`, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: listening ? "#fca5a5" : C.t1, fontSize: "16px", flexShrink: 0, animation: listening ? "listenPulse 1s infinite" : "none" }}>🎤</button>
              <button className="action-btn" onClick={() => sendMessage(input, pendingImage ? { image: pendingImage } : {})} disabled={loading || (!input.trim() && !pendingImage)}
                style={{ width: "38px", height: "38px", borderRadius: "10px", background: (input.trim() || pendingImage) && !loading ? C.b2 : "transparent", border: `1.5px solid ${(input.trim() || pendingImage) && !loading ? C.b2 : C.b0}`, cursor: (input.trim() || pendingImage) && !loading ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", color: C.t0, fontSize: "17px", transition: "all 0.15s", flexShrink: 0 }}>↑</button>
            </div>
          </div>
        </div>
      </div>

      {/* Charts modal */}
      <Modal open={chartsOpen} onClose={() => setChartsOpen(false)} title="Trends" wide>
        <ChartsView history={history} targets={targets} weights={weights} />
      </Modal>

      {/* Weekly summary */}
      <Modal open={weeklyOpen} onClose={() => setWeeklyOpen(false)} title="Weekly Summary">
        <div style={{ fontSize: "13px", color: C.t1, lineHeight: 1.7 }}>
          <div style={{ marginBottom: "16px" }}>
            <div style={{ fontSize: "11px", color: C.t2, fontFamily: "monospace", marginBottom: "10px", textTransform: "uppercase", letterSpacing: "0.1em" }}>Last 7 Days</div>
            {(() => {
              const last7 = Object.entries(history).sort((a,b)=>b[0].localeCompare(a[0])).slice(0,7).map(([,d])=>d);
              if (last7.length === 0) return <div style={{ color: C.t2 }}>No data yet</div>;
              const avg = (key) => Math.round(last7.reduce((s,d)=>s+(d.totals?.[key]||0),0) / last7.length);
              const avgWater = Math.round(last7.reduce((s,d)=>s+(d.water_ml||0),0) / last7.length);
              return (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", fontFamily: "monospace", fontSize: "13px" }}>
                  <div>Avg cal: <span style={{ color: C.cal, fontWeight: "700" }}>{avg("calories")}</span></div>
                  <div>Avg P: <span style={{ color: C.prot, fontWeight: "700" }}>{avg("protein")}g</span></div>
                  <div>Avg C: <span style={{ color: C.carb, fontWeight: "700" }}>{avg("carbs")}g</span></div>
                  <div>Avg F: <span style={{ color: C.fat, fontWeight: "700" }}>{avg("fat")}g</span></div>
                  <div>Avg fiber: <span style={{ color: C.fib, fontWeight: "700" }}>{avg("fiber")}g</span></div>
                  <div>Avg H₂O: <span style={{ color: C.wat, fontWeight: "700" }}>{(avgWater/1000).toFixed(1)}L</span></div>
                </div>
              );
            })()}
          </div>
          <div style={{ marginTop: "20px" }}>
            <div style={{ fontSize: "11px", color: C.t2, fontFamily: "monospace", marginBottom: "10px", textTransform: "uppercase", letterSpacing: "0.1em" }}>Adherence ({stats.adherence.days}d)</div>
            <div style={{ fontFamily: "monospace", fontSize: "13px", lineHeight: 2 }}>
              <div>Protein min: <span style={{ color: C.prot, fontWeight: "700" }}>{stats.adherence.protein}/{stats.adherence.days}</span></div>
              <div>Carb cap: <span style={{ color: C.carb, fontWeight: "700" }}>{stats.adherence.carbsCap}/{stats.adherence.days}</span></div>
              <div>Creatine: <span style={{ color: C.ok, fontWeight: "700" }}>{stats.adherence.creatine}/{stats.adherence.days}</span></div>
              <div>Water: <span style={{ color: C.wat, fontWeight: "700" }}>{stats.adherence.water}/{stats.adherence.days}</span></div>
            </div>
          </div>
          <button onClick={() => { setWeeklyOpen(false); sendMessage("Give me a coaching weekly summary based on the last 7 days."); }}
            style={{ marginTop: "20px", padding: "10px 18px", background: C.bg4, border: `1px solid ${C.b2}`, borderRadius: "10px", color: C.t0, cursor: "pointer", fontSize: "13px", fontWeight: "600" }}>
            Ask coach for analysis
          </button>
        </div>
      </Modal>

      {/* Settings */}
      <Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Settings">
        <div style={{ fontSize: "13px", color: C.t1 }}>
          <div style={{ marginBottom: "20px" }}>
            <div style={{ fontSize: "11px", color: C.t2, fontFamily: "monospace", marginBottom: "10px", textTransform: "uppercase", letterSpacing: "0.1em" }}>Phase</div>
            <div style={{ display: "flex", gap: "8px" }}>
              {["cut","maintain","bulk"].map(p => (
                <button key={p} onClick={() => { const g = { ...goal, phase: p }; setGoal(g); store.set("nutrition-goal", g); }}
                  style={{ padding: "8px 16px", borderRadius: "9px", border: `1.5px solid ${goal.phase === p ? C.b2 : C.b0}`, background: goal.phase === p ? C.bg4 : "transparent", color: goal.phase === p ? C.t0 : C.t1, fontSize: "12px", cursor: "pointer", fontFamily: "monospace", textTransform: "uppercase", fontWeight: goal.phase === p ? "700" : "400" }}>{p}</button>
              ))}
            </div>
          </div>
          <div style={{ marginBottom: "20px" }}>
            <div style={{ fontSize: "11px", color: C.t2, fontFamily: "monospace", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.1em" }}>Goal Description</div>
            <textarea value={goal.description} onChange={e => { const g = { ...goal, description: e.target.value }; setGoal(g); store.set("nutrition-goal", g); }}
              style={{ width: "100%", padding: "10px 12px", background: C.bg3, border: `1px solid ${C.b1}`, borderRadius: "9px", color: C.t0, fontSize: "13px", fontFamily: "inherit", minHeight: "70px", resize: "vertical" }} />
          </div>
          <div style={{ marginBottom: "20px" }}>
            <div style={{ fontSize: "11px", color: C.t2, fontFamily: "monospace", marginBottom: "10px", textTransform: "uppercase", letterSpacing: "0.1em" }}>Targets</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              {Object.entries({calories:"cal",protein:"P",carbs:"C",fat:"F",fiber:"fib"}).map(([k, label]) => (
                <div key={k} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", fontFamily: "monospace" }}>
                  <span style={{ width: "30px", color: C.t1, fontWeight: "600" }}>{label}</span>
                  <input type="number" value={targets[k].min} onChange={e => { const t = { ...targets, [k]: { ...targets[k], min: Number(e.target.value) } }; setTargets(t); store.set("nutrition-targets", t); }}
                    style={{ width: "62px", padding: "6px 8px", background: C.bg3, border: `1px solid ${C.b1}`, borderRadius: "7px", color: C.t0, fontSize: "12px", fontFamily: "monospace" }} />
                  <span style={{ color: C.t2 }}>–</span>
                  <input type="number" value={targets[k].max} onChange={e => { const t = { ...targets, [k]: { ...targets[k], max: Number(e.target.value) } }; setTargets(t); store.set("nutrition-targets", t); }}
                    style={{ width: "62px", padding: "6px 8px", background: C.bg3, border: `1px solid ${C.b1}`, borderRadius: "7px", color: C.t0, fontSize: "12px", fontFamily: "monospace" }} />
                </div>
              ))}
            </div>
          </div>
          <div style={{ marginBottom: "20px" }}>
            <div style={{ fontSize: "11px", color: C.t2, fontFamily: "monospace", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.1em" }}>Coach Memory</div>
            <textarea value={coachMemory} onChange={e => { setCoachMemory(e.target.value); store.set("nutrition-coach-memory", e.target.value); }}
              placeholder="Patterns the coach has learned about you…"
              style={{ width: "100%", padding: "10px 12px", background: C.bg3, border: `1px solid ${C.b1}`, borderRadius: "9px", color: C.t0, fontSize: "12px", fontFamily: "monospace", minHeight: "90px", resize: "vertical" }} />
          </div>
          <div style={{ display: "flex", gap: "10px", marginTop: "24px", flexWrap: "wrap" }}>
            <button onClick={exportData} style={{ padding: "9px 16px", background: C.bg4, border: `1px solid ${C.b2}`, borderRadius: "9px", color: C.t0, cursor: "pointer", fontSize: "13px", fontWeight: "600" }}>↓ Export JSON</button>
            <label style={{ padding: "9px 16px", background: C.bg4, border: `1px solid ${C.b2}`, borderRadius: "9px", color: C.t0, cursor: "pointer", fontSize: "13px", fontWeight: "600" }}>
              ↑ Import JSON
              <input type="file" accept="application/json" onChange={e => e.target.files[0] && importData(e.target.files[0])} style={{ display: "none" }} />
            </label>
            <button onClick={() => { if (confirm("Reset all settings to defaults?")) { setTargets(DEFAULT_TARGETS); setGoal(DEFAULT_GOAL); store.set("nutrition-targets", DEFAULT_TARGETS); store.set("nutrition-goal", DEFAULT_GOAL); } }}
              style={{ padding: "9px 16px", background: "transparent", border: `1px solid ${C.b0}`, borderRadius: "9px", color: C.t2, cursor: "pointer", fontSize: "13px" }}>Reset defaults</button>
            <button onClick={() => { if (confirm("Delete ALL days, history, and chat? This cannot be undone.")) {
              const keys = Object.keys(localStorage).filter(k => k.startsWith("day-") || k.startsWith("chat-") || k.startsWith("nudge-") || ["nutrition-history","nutrition-weights","nutrition-coach-memory"].includes(k));
              keys.forEach(k => localStorage.removeItem(k));
              setHistory({}); setWeights({}); setDayData(null); setMessages([]); setCoachMemory(""); setProactiveSent({});
              if (!import.meta.env.DEV) fetch("/api/store", { method: "DELETE", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ pattern: "%" }) }).catch(() => {});
              pushToast("All data wiped — fresh start"); setSettingsOpen(false);
            }}} style={{ padding: "9px 16px", background: "transparent", border: `1px solid ${C.err}`, borderRadius: "9px", color: C.err, cursor: "pointer", fontSize: "13px" }}>Wipe all data</button>
          </div>
        </div>
      </Modal>

      {/* Meal detail */}
      <Modal open={!!mealDetail} onClose={() => setMealDetail(null)} title={mealDetail?.name || "Meal"}>
        {mealDetail && (() => {
          const linked = messages.find(m => m.mealRef === mealDetail.ts);
          return (
            <div style={{ fontSize: "13px", color: C.t1, lineHeight: 1.6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "14px", fontFamily: "monospace", fontSize: "12px", color: C.t1 }}>
                <span>{mealDetail.time} · {bucketLabel[mealDetail.tag] || mealDetail.tag}</span>
                <span style={{ color: C.cal, fontWeight: "700", fontSize: "16px" }}>{mealDetail.macros?.calories} cal</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "10px", marginBottom: "20px" }}>
                <div style={{ background: C.bg3, borderRadius: "9px", padding: "10px", textAlign: "center" }}>
                  <div style={{ fontSize: "18px", fontWeight: "800", color: C.prot }}>{mealDetail.macros?.protein}g</div>
                  <div style={{ fontSize: "10px", color: C.t2, fontFamily: "monospace", marginTop: "2px" }}>PROTEIN</div>
                </div>
                <div style={{ background: C.bg3, borderRadius: "9px", padding: "10px", textAlign: "center" }}>
                  <div style={{ fontSize: "18px", fontWeight: "800", color: C.carb }}>{mealDetail.macros?.carbs}g</div>
                  <div style={{ fontSize: "10px", color: C.t2, fontFamily: "monospace", marginTop: "2px" }}>CARBS</div>
                </div>
                <div style={{ background: C.bg3, borderRadius: "9px", padding: "10px", textAlign: "center" }}>
                  <div style={{ fontSize: "18px", fontWeight: "800", color: C.fat }}>{mealDetail.macros?.fat}g</div>
                  <div style={{ fontSize: "10px", color: C.t2, fontFamily: "monospace", marginTop: "2px" }}>FAT</div>
                </div>
                <div style={{ background: C.bg3, borderRadius: "9px", padding: "10px", textAlign: "center" }}>
                  <div style={{ fontSize: "18px", fontWeight: "800", color: C.fib }}>{mealDetail.macros?.fiber}g</div>
                  <div style={{ fontSize: "10px", color: C.t2, fontFamily: "monospace", marginTop: "2px" }}>FIBER</div>
                </div>
              </div>
              {linked && (
                <>
                  <div style={{ fontSize: "11px", color: C.t2, fontFamily: "monospace", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.1em" }}>Coach Notes</div>
                  <div style={{ background: C.bg3, border: `1px solid ${C.b0}`, borderRadius: "10px", padding: "14px", whiteSpace: "pre-wrap", fontSize: "13px", color: C.t1, lineHeight: 1.65 }}>{linked.text}</div>
                </>
              )}
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}
