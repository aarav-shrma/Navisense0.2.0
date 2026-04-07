/**
 * NaviSense API Gateway · Auth Middleware
 * ────────────────────────────────────────
 * Validates Supabase-issued JWTs on every protected route.
 * The mobile client sends: Authorization: Bearer <supabase_jwt>
 */
const { supabase } = require("../db/supabase");
const { logger } = require("../config/logger");

/**
 * verifyToken — Express middleware
 *
 * ERROR HANDLING: Expired / tampered tokens return 401 immediately.
 * Network latency to Supabase is ≈ 20–80 ms — cache validated tokens
 * in Redis (TTL = token expiry) to avoid a Supabase round-trip on every frame.
 */
async function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or malformed Authorization header" });
  }

  const token = authHeader.split(" ")[1];
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }
    req.user = data.user;   // attach user to request context
    next();
  } catch (err) {
    logger.error(`Token verification error: ${err.message}`);
    return res.status(500).json({ error: "Authentication service unavailable" });
  }
}

module.exports = { verifyToken };
