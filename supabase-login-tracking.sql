-- ============================================================
-- MIGRATION : Suivi des connexions utilisateurs
-- À exécuter dans Supabase → SQL Editor
-- ============================================================

ALTER TABLE sh_users
  ADD COLUMN IF NOT EXISTS first_login_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_login_at  TIMESTAMPTZ;

-- Index pour trier/filtrer efficacement
CREATE INDEX IF NOT EXISTS idx_users_last_login ON sh_users(last_login_at);

SELECT 'Migration login tracking appliquée' AS status;
