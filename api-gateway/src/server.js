/**
 * NaviSense API Gateway · Express Server
 * ──────────────────────────────────────
 * Responsibilities:
 *   • Authentication via Supabase JWT
 *   • User profile & preferences management (Supabase Postgres)
 *   • Proxies vision/voice requests to the Python AI microservice
 *   • Rate-limiting to protect the AI service from thundering-herd on mobile reconnects
 */
require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const compression = require("compression");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");

const { logger } = require("./config/logger");
const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const detectRoutes = require("./routes/detect");
const recognizeRoutes = require("./routes/recognize");
const voiceRoutes = require("./routes/voice");
const navigateRoutes = require("./routes/navigate");

const app = express();
const PORT = process.env.API_GATEWAY_PORT || 3001;

// ── Security middleware ─────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: "*" }));   // tighten in production: origin: [mobile app domain]
app.use(compression());

// ── Request logging ─────────────────────────────────────────
app.use(morgan("combined", { stream: { write: (msg) => logger.info(msg.trim()) } }));

// ── Body parsing ────────────────────────────────────────────
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// ── Rate limiting ───────────────────────────────────────────
// LATENCY NOTE: Generous limits for detection (frequent frames) vs auth (rare).
const frameRateLimiter = rateLimit({
  windowMs: 1000,         // 1 second window
  max: 10,                // max 10 frames/sec per IP — matches ~30fps with batching
  message: { error: "Frame rate limit exceeded. Reduce camera polling frequency." },
  standardHeaders: true,
});

const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 20,
  message: { error: "Too many auth attempts. Try again in 15 minutes." },
});

// ── Routes ──────────────────────────────────────────────────
app.use("/auth",     authRateLimiter, authRoutes);
app.use("/users",    userRoutes);
app.use("/detect",   frameRateLimiter, detectRoutes);
app.use("/recognize", frameRateLimiter, recognizeRoutes);
app.use("/voice",    voiceRoutes);
app.use("/navigate", navigateRoutes);

// ── Health check ────────────────────────────────────────────
app.get("/health", (req, res) => res.json({ status: "ok", service: "api-gateway" }));

// ── Global error handler ────────────────────────────────────
// ERROR HANDLING: Catch all unhandled errors so the gateway never returns
// a raw stack trace to the mobile client — only sanitised JSON error objects.
app.use((err, req, res, _next) => {
  logger.error(`Unhandled error: ${err.message}`, { stack: err.stack });
  const status = err.status || 500;
  res.status(status).json({
    error: status >= 500 ? "Internal server error" : err.message,
    code: err.code || "UNKNOWN_ERROR",
  });
});

// ── Start ───────────────────────────────────────────────────
app.listen(PORT, () => {
  logger.info(`NaviSense API Gateway running on port ${PORT}`);
});

module.exports = app;
