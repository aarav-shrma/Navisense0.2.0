/**
 * NaviSense API Gateway · User & Preferences Routes
 */
const express = require("express");
const Joi = require("joi");
const { verifyToken } = require("../middleware/auth");
const { supabase } = require("../db/supabase");

const router = express.Router();
router.use(verifyToken);

const prefsSchema = Joi.object({
  tts_speed: Joi.number().min(0.5).max(2.0),
  tts_pitch: Joi.number(),
  tts_language: Joi.string(),
  audio_volume: Joi.number().integer().min(0).max(100),
  obstacle_alert_distance: Joi.string().valid("near", "medium", "far"),
  detection_frequency_ms: Joi.number().integer().min(100).max(5000),
  prefer_accessible_routes: Joi.boolean(),
  announce_cross_streets: Joi.boolean(),
  high_contrast_ui: Joi.boolean(),
  font_size: Joi.string().valid("medium", "large", "xlarge"),
});

// GET /users/me
router.get("/me", async (req, res) => {
  const { data, error } = await supabase
    .from("profiles")
    .select("*, user_preferences(*), saved_locations(*)")
    .eq("id", req.user.id)
    .single();
  if (error) return res.status(404).json({ error: "Profile not found" });
  return res.json(data);
});

// PATCH /users/preferences
router.patch("/preferences", async (req, res) => {
  const { error: validErr, value } = prefsSchema.validate(req.body);
  if (validErr) return res.status(422).json({ error: validErr.details[0].message });

  const { data, error } = await supabase
    .from("user_preferences")
    .upsert({ user_id: req.user.id, ...value }, { onConflict: "user_id" })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// POST /users/locations — save a bookmark
router.post("/locations", async (req, res) => {
  const { label, address, lat, lon, graph_node_id, is_favourite } = req.body;
  if (!label || lat == null || lon == null) {
    return res.status(422).json({ error: "label, lat, lon are required" });
  }
  const { data, error } = await supabase
    .from("saved_locations")
    .insert({ user_id: req.user.id, label, address, lat, lon, graph_node_id, is_favourite })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

module.exports = router;
