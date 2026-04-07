/**
 * NaviSense API Gateway · Navigation Routes
 */
const express = require("express");
const axios = require("axios");
const { verifyToken } = require("../middleware/auth");
const router = express.Router();
router.use(verifyToken);
const AI_URL = process.env.AI_SERVICE_URL || "http://localhost:8000";

router.post("/path", async (req, res) => {
  try {
    const r = await axios.post(`${AI_URL}/navigate/path`, req.body, { timeout: 5000 });
    return res.json(r.data);
  } catch (err) {
    return res.status(err.response?.status || 502).json({ error: err.response?.data?.detail || "Navigation unavailable" });
  }
});

module.exports = router;
