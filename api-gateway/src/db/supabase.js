/**
 * NaviSense · Supabase Client & Database Schema
 * ─────────────────────────────────────────────
 * Tables:
 *   profiles             — extended user data linked to auth.users
 *   user_preferences     — accessibility & app settings per user
 *   saved_locations      — bookmarked destinations (graph node references)
 *   facial_embeddings    — serialised KDTree-ready embedding vectors per user
 *   navigation_history   — audit trail of routes taken
 */
const { createClient } = require("@supabase/supabase-js");
const { logger } = require("../config/logger");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY  // service role bypasses RLS for backend ops
);

module.exports = { supabase };


// ════════════════════════════════════════════════════════════
//  DATABASE SCHEMA  (run via: node scripts/migrate.js)
//  Or paste into the Supabase SQL editor.
// ════════════════════════════════════════════════════════════
const SCHEMA_SQL = `
-- ── Enable pgcrypto for UUID generation ─────────────────────
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── profiles ────────────────────────────────────────────────
-- One row per authenticated user (FK to Supabase auth.users).
CREATE TABLE IF NOT EXISTS profiles (
  id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name    TEXT,
  phone           TEXT,
  emergency_contact_name  TEXT,
  emergency_contact_phone TEXT,
  created_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at      TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- ── user_preferences ────────────────────────────────────────
-- Stores accessibility and UX settings.
CREATE TABLE IF NOT EXISTS user_preferences (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,

  -- Audio feedback
  tts_speed       FLOAT DEFAULT 1.0 CHECK (tts_speed BETWEEN 0.5 AND 2.0),
  tts_pitch       FLOAT DEFAULT 1.0,
  tts_language    TEXT DEFAULT 'en-IN',
  audio_volume    INT DEFAULT 80 CHECK (audio_volume BETWEEN 0 AND 100),

  -- Detection settings
  obstacle_alert_distance TEXT DEFAULT 'near',   -- 'near' | 'medium' | 'far'
  detection_frequency_ms  INT DEFAULT 500,        -- how often to send frames

  -- Navigation
  prefer_accessible_routes BOOLEAN DEFAULT TRUE,
  announce_cross_streets   BOOLEAN DEFAULT TRUE,

  -- UI
  high_contrast_ui  BOOLEAN DEFAULT TRUE,
  font_size         TEXT DEFAULT 'large',          -- 'medium' | 'large' | 'xlarge'

  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- ── saved_locations ──────────────────────────────────────────
-- Bookmarked destinations with graph node references.
CREATE TABLE IF NOT EXISTS saved_locations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES profiles(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,              -- "Home", "Work", "Dr. Mehta's Clinic"
  address     TEXT,
  lat         DOUBLE PRECISION NOT NULL,
  lon         DOUBLE PRECISION NOT NULL,
  graph_node_id TEXT,                     -- references the A* graph node
  is_favourite  BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT now() NOT NULL,

  UNIQUE (user_id, label)
);
CREATE INDEX IF NOT EXISTS idx_saved_locations_user ON saved_locations(user_id);

-- ── facial_embeddings ────────────────────────────────────────
-- Serialised 512-dim FaceNet embedding vectors for recognition.
-- In production: use pgvector extension for native vector operations.
--   ALTER TABLE facial_embeddings ADD COLUMN vec vector(512);
--   CREATE INDEX ON facial_embeddings USING ivfflat (vec vector_cosine_ops);
CREATE TABLE IF NOT EXISTS facial_embeddings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES profiles(id) ON DELETE CASCADE,
  contact_name  TEXT NOT NULL,            -- "Priya Sharma", "Dad"
  embedding     JSONB NOT NULL,           -- serialised float32[] — 512 values
  photo_url     TEXT,                     -- reference photo stored in Supabase Storage
  enrolled_at   TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at    TIMESTAMPTZ DEFAULT now() NOT NULL,

  UNIQUE (user_id, contact_name)
);
CREATE INDEX IF NOT EXISTS idx_embeddings_user ON facial_embeddings(user_id);

-- ── navigation_history ───────────────────────────────────────
-- Audit trail of completed navigations (analytics + debugging).
CREATE TABLE IF NOT EXISTS navigation_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES profiles(id) ON DELETE CASCADE,
  start_label   TEXT,
  goal_label    TEXT,
  start_node_id TEXT,
  goal_node_id  TEXT,
  distance_m    FLOAT,
  duration_s    INT,
  completed     BOOLEAN DEFAULT FALSE,
  started_at    TIMESTAMPTZ DEFAULT now() NOT NULL,
  ended_at      TIMESTAMPTZ
);

-- ── Row Level Security ───────────────────────────────────────
-- Users can only read/write their own rows.
ALTER TABLE profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences    ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_locations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE facial_embeddings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE navigation_history  ENABLE ROW LEVEL SECURITY;

-- RLS policies (apply to anon / authenticated roles)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'user_own_profile') THEN
    CREATE POLICY user_own_profile ON profiles
      USING (auth.uid() = id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'user_own_preferences') THEN
    CREATE POLICY user_own_preferences ON user_preferences
      USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'user_own_locations') THEN
    CREATE POLICY user_own_locations ON saved_locations
      USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'user_own_embeddings') THEN
    CREATE POLICY user_own_embeddings ON facial_embeddings
      USING (auth.uid() = user_id);
  END IF;
END $$;

-- ── Trigger: auto-update updated_at ─────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE OR REPLACE TRIGGER set_updated_at_profiles
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER set_updated_at_preferences
  BEFORE UPDATE ON user_preferences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
`;

/**
 * Run schema migrations programmatically.
 * Called from scripts/migrate.js or on first container boot.
 */
async function runMigrations() {
  logger.info("Running NaviSense DB migrations...");
  const { error } = await supabase.rpc("exec_sql", { sql: SCHEMA_SQL }).single();
  if (error) {
    logger.error("Migration failed:", error.message);
    throw error;
  }
  logger.info("Migrations completed successfully.");
}

module.exports = { supabase, runMigrations, SCHEMA_SQL };
