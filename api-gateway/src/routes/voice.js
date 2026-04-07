/**
 * NaviSense API Gateway · Voice Routes
 */
const express = require("express");
const multer = require("multer");
const axios = require("axios");
const FormData = require("form-data");
const { verifyToken } = require("../middleware/auth");
const router = express.Router();
router.use(verifyToken);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const AI_URL = process.env.AI_SERVICE_URL || "http://localhost:8000";

router.post("/command", upload.single("audio"), async (req, res) => {
  const form = new FormData();
  if (req.file) form.append("audio", req.file.buffer, { filename: "command.wav", contentType: "audio/wav" });
  try {
    const r = await axios.post(`${AI_URL}/voice/command`, form, { headers: form.getHeaders(), timeout: 8000 });
    return res.json(r.data);
  } catch (err) {
    return res.status(502).json({ error: "Voice processing unavailable" });
  }
});

router.get("/state", async (req, res) => {
  try {
    const r = await axios.get(`${AI_URL}/voice/state`, { timeout: 2000 });
    return res.json(r.data);
  } catch {
    return res.status(502).json({ error: "Could not fetch state" });
  }
});

module.exports = router;
