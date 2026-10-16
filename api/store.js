import { checkPasscode } from "./_auth.js";

// Keys the app is allowed to read and write.
const KEY_PATTERN = /^(day-\d{4}-\d{2}-\d{2}|chat-\d{4}-\d{2}-\d{2}|nutrition-(history|weights|targets|goal|coach-memory))$/;

export default async function handler(req, res) {
  if (!checkPasscode(req, res)) return;

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    // Supabase not configured: silently no-op so the app still works with localStorage only
    return res.status(200).json(null);
  }

  const headers = {
    "Content-Type": "application/json",
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
  };
  const base = `${supabaseUrl}/rest/v1/nutrition_store`;

  try {
    if (req.method === "GET") {
      const { k } = req.query;
      if (!k || !KEY_PATTERN.test(k)) return res.status(400).json({ error: "Invalid key" });
      const r = await fetch(`${base}?key=eq.${encodeURIComponent(k)}&select=data`, { headers });
      const rows = await r.json();
      return res.status(200).json(rows[0]?.data ?? null);
    }

    if (req.method === "POST") {
      const { k, data } = req.body || {};
      if (!k || !KEY_PATTERN.test(k)) return res.status(400).json({ error: "Invalid key" });
      await fetch(base, {
        method: "POST",
        headers: { ...headers, Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({ key: k, data, updated_at: new Date().toISOString() }),
      });
      return res.status(200).json({ ok: true });
    }

    if (req.method === "DELETE") {
      // Only "wipe everything" is supported, which is what the Settings button sends.
      await fetch(`${base}?key=like.${encodeURIComponent("%")}`, { method: "DELETE", headers });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return res.status(500).json({ error: "Storage request failed" });
  }
}
