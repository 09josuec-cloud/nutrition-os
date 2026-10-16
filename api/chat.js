import { checkPasscode } from "./_auth.js";

// Only the models the app actually uses, and a hard cap on output tokens,
// so the endpoint cannot be used for arbitrary or expensive requests.
const ALLOWED_MODELS = new Set(["claude-sonnet-4-20250514", "claude-haiku-4-5-20251001"]);
const MAX_TOKENS_CAP = 1500;
const MAX_MESSAGES = 40;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!checkPasscode(req, res)) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "API key not configured on server" });
  }

  const { model, max_tokens, system, messages } = req.body || {};
  if (!ALLOWED_MODELS.has(model)) {
    return res.status(400).json({ error: "Model not allowed" });
  }
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
    return res.status(400).json({ error: "Invalid messages" });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: Math.min(Number(max_tokens) || 1000, MAX_TOKENS_CAP),
        system: typeof system === "string" ? system : undefined,
        messages,
      }),
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: "Upstream request failed" });
  }
}
