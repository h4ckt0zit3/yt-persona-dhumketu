-- ============================================================
-- One-off migration: fix issues surfaced after the app rebuild
--   1. /api/personas auto-join needs a FK between personas and channels
--   2. service_role needs explicit SELECT on the channel_overview view
--   3. service_role missing grants on tables (varies by Supabase project age)
-- Safe to re-run.
-- ============================================================

-- ---- 1. FK so PostgREST can auto-resolve personas → channels ----
ALTER TABLE personas DROP CONSTRAINT IF EXISTS personas_channel_id_fkey;
ALTER TABLE personas
  ADD CONSTRAINT personas_channel_id_fkey
  FOREIGN KEY (channel_id) REFERENCES channels(channel_id) ON DELETE CASCADE;

-- ---- 2. Make sure service_role can touch everything it needs ----
-- Schema usage
GRANT USAGE ON SCHEMA public TO service_role;

-- All existing tables in public
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON ALL TABLES IN SCHEMA public TO service_role;

-- All existing sequences (uuid_generate_v4 doesn't need them, but other defaults might)
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- All existing functions (search_persona_knowledge etc.)
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- Default privileges so future tables/functions automatically grant to service_role
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO service_role;

-- ---- 3. Grant the dashboard view explicitly (views don't inherit) ----
GRANT SELECT ON channel_overview TO service_role, authenticated, anon;

-- ---- 4. Tell PostgREST to refresh its schema cache ----
NOTIFY pgrst, 'reload schema';
