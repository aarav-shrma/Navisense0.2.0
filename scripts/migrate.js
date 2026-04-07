/**
 * NaviSense · Database Migration Script
 * Run: node scripts/migrate.js
 *
 * Applies the SQL schema to the connected Supabase / Postgres instance.
 * Safe to run multiple times (all statements use IF NOT EXISTS).
 */
require("dotenv").config({ path: "../.env" });
const { createClient } = require("@supabase/supabase-js");
const { SCHEMA_SQL } = require("../api-gateway/src/db/supabase");

async function main() {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  console.log("🚀 Running NaviSense DB migrations...");

  const statements = SCHEMA_SQL
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const sql of statements) {
    const { error } = await supabase.rpc("exec", { query: sql + ";" });
    if (error) {
      console.error("❌ Migration failed:", error.message);
      console.error("   SQL:", sql.slice(0, 120));
      process.exit(1);
    }
  }

  console.log("✅ Migrations complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
