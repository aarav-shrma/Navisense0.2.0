/**
 * NaviSense API Gateway · Auth Routes
 * Thin wrapper — actual auth is handled by Supabase client-side.
 * Gateway only validates tokens (see middleware/auth.js).
 */
const express = require("express");
const { supabase } = require("../db/supabase");
const router = express.Router();

// POST /auth/signup — create user + profile row
router.post("/signup", async (req, res) => {
  const { email, password, display_name } = req.body;
  if (!email || !password) return res.status(422).json({ error: "email and password required" });

  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) return res.status(400).json({ error: error.message });

  // Create profile row
  await supabase.from("profiles").insert({ id: data.user.id, display_name });

  return res.status(201).json({ user_id: data.user.id, message: "Signup successful. Check email to confirm." });
});

// POST /auth/login
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return res.status(401).json({ error: error.message });
  return res.json({ access_token: data.session.access_token, expires_in: data.session.expires_in });
});

module.exports = router;
