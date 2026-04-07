/**
 * NaviSense API Gateway · Detection Routes
 * ─────────────────────────────────────────
 * Proxies camera frames to the AI service's YOLO endpoint.
 * Auth is enforced; user preferences (alert distance) are injected.
 */
const express = require("express");
const multer = require("multer");
const axios = require("axios");
const FormData = require("form-data");
const { verifyToken } = require("../middleware/auth");
const { supabase } = require("../db/supabase");
const { logger } = require("../config/logger");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const AI_URL = process.env.AI_SERVICE_URL || "http://localhost:8000";

router.post("/frame", verifyToken, upload.single("frame"), async (req, res) => {
  /**
   * Forward a raw camera frame to YOLO and return detected obstacles.
   *
   * LATENCY NOTE: We use axios with a tight timeout (2 s).
   * If the AI service is overloaded (e.g., GPU memory pressure on the
   * RTX 3050), the timeout surfaces cleanly as HTTP 504 rather than
   * hanging the mobile client's UI thread.
   */
  if (!req.file) {
    return res.status(422).json({ error: "No frame file uploaded" });
  }

  // Fetch user preferences to contextualise the response (e.g., alert threshold)
  const { data: prefs } = await supabase
    .from("user_preferences")
    .select("obstacle_alert_distance, detection_frequency_ms")
    .eq("user_id", req.user.id)
    .single();

  const form = new FormData();
  form.append("frame", req.file.buffer, {
    filename: req.file.originalname || "frame.jpg",
    contentType: req.file.mimetype || "image/jpeg",
  });

  try {
    const aiResponse = await axios.post(`${AI_URL}/detect/frame`, form, {
      headers: form.getHeaders(),
      timeout: 2000,   // 2 s hard timeout — never block mobile UI
    });

    // Filter obstacles by user's preferred alert distance
    const alertDistance = prefs?.obstacle_alert_distance || "near";
    const filtered = aiResponse.data.obstacles.filter((o) =>
      alertDistance === "far" ? true
      : alertDistance === "medium" ? ["near", "medium"].includes(o.distance_hint)
      : o.distance_hint === "near"
    );

    return res.json({ ...aiResponse.data, obstacles: filtered });
  } catch (err) {
    if (err.code === "ECONNABORTED") {
      logger.warn("AI service detection timeout");
      return res.status(504).json({ error: "Detection timed out. Try again." });
    }
    logger.error(`AI service error: ${err.message}`);
    return res.status(502).json({ error: "AI service unavailable" });
  }
});

module.exports = router;
