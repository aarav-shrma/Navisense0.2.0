/**
 * NaviSense API Gateway · Recognition Routes (proxy to AI service)
 */
const express = require("express");
const multer = require("multer");
const axios = require("axios");
const FormData = require("form-data");
const { verifyToken } = require("../middleware/auth");
const { logger } = require("../config/logger");

const router = express.Router();
router.use(verifyToken);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
const AI_URL = process.env.AI_SERVICE_URL || "http://localhost:8000";

async function proxyToAI(endpoint, file, extraFields = {}, timeout = 5000) {
  const form = new FormData();
  if (file) form.append(file.fieldname, file.buffer, { filename: file.originalname || "upload.jpg", contentType: file.mimetype });
  for (const [k, v] of Object.entries(extraFields)) form.append(k, v);
  try {
    const r = await axios.post(`${AI_URL}${endpoint}`, form, { headers: form.getHeaders(), timeout });
    return { data: r.data, error: null };
  } catch (err) {
    logger.warn(`AI proxy error [${endpoint}]: ${err.message}`);
    return { data: null, error: err.code === "ECONNABORTED" ? "AI service timeout" : "AI service error" };
  }
}

router.post("/face", upload.single("frame"), async (req, res) => {
  const { data, error } = await proxyToAI("/recognize/face", req.file, {}, 4000);
  if (error) return res.status(502).json({ error });
  return res.json(data);
});

router.post("/enroll", upload.single("image"), async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(422).json({ error: "name is required" });
  const { data, error } = await proxyToAI("/recognize/enroll", req.file, { name });
  if (error) return res.status(502).json({ error });
  return res.json(data);
});

router.post("/ocr", upload.single("frame"), async (req, res) => {
  const { data, error } = await proxyToAI("/recognize/ocr", req.file, {}, 6000);
  if (error) return res.status(502).json({ error });
  return res.json(data);
});

module.exports = router;
