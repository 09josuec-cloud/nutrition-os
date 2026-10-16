import { timingSafeEqual } from "node:crypto";

// Shared passcode check for the serverless endpoints.
// Files starting with "_" are not deployed as routes by Vercel.
// Fails closed: if APP_PASSCODE is not set, every request is refused.
export function checkPasscode(req, res) {
  const expected = process.env.APP_PASSCODE;
  if (!expected) {
    res.status(503).json({ error: "Server passcode not configured" });
    return false;
  }
  const given = Buffer.from(String(req.headers["x-app-passcode"] || ""));
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}
