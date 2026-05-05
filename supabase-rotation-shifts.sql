-- ============================================================
-- MIGRATION : Planning rotatif pour agents de réservation
-- À exécuter dans Supabase → SQL Editor
-- ============================================================

-- ── 1. Types de shifts (modèles réutilisables) ────────────────
CREATE TABLE IF NOT EXISTS sh_shift_types (
  id        TEXT PRIMARY KEY,
  nom       TEXT NOT NULL,
  heure_debut TEXT NOT NULL,  -- HH:MM (24h)
  heure_fin   TEXT NOT NULL,  -- HH:MM (24h), 00:00 = minuit
  couleur   TEXT DEFAULT '#3B82F6',
  actif     BOOLEAN DEFAULT TRUE,
  ordre     INTEGER DEFAULT 0
);

-- Insérer les 3 shifts de base
INSERT INTO sh_shift_types (id, nom, heure_debut, heure_fin, couleur, ordre) VALUES
  ('matin',      'Matin',       '09:00', '17:00', '#10B981', 1),
  ('apres-midi', 'Après-midi',  '11:00', '19:00', '#3B82F6', 2),
  ('soir',       'Soir',        '16:00', '00:00', '#8B5CF6', 3)
ON CONFLICT (id) DO UPDATE SET
  nom         = EXCLUDED.nom,
  heure_debut = EXCLUDED.heure_debut,
  heure_fin   = EXCLUDED.heure_fin,
  couleur     = EXCLUDED.couleur,
  ordre       = EXCLUDED.ordre;

-- ── 2. Planning hebdomadaire (jour par jour) ──────────────────
CREATE TABLE IF NOT EXISTS sh_weekly_schedule (
  id            TEXT PRIMARY KEY,
  employee_id   TEXT NOT NULL REFERENCES sh_employees(id) ON DELETE CASCADE,
  date          TEXT NOT NULL,        -- YYYY-MM-DD
  shift_type_id TEXT REFERENCES sh_shift_types(id),
  is_off        BOOLEAN DEFAULT FALSE,-- TRUE = jour de repos
  notes         TEXT,
  created_by    TEXT,
  updated_by    TEXT,
  updated_at    TEXT,
  UNIQUE(employee_id, date)
);

-- ── 3. Marqueur "rotation" sur les employés ───────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='sh_employees' AND column_name='has_rotation'
  ) THEN
    ALTER TABLE sh_employees ADD COLUMN has_rotation BOOLEAN DEFAULT FALSE;
  END IF;
END $$;

-- ── 4. Nouveau rôle cluster_revenue_manager ───────────────────
INSERT INTO sh_roles (id, nom, perms) VALUES (
  'cluster_revenue_manager',
  'Cluster Revenue Manager',
  '{
    "voir_tous_sites": true,
    "valider": false,
    "administrer": false,
    "verrouiller": false,
    "exporter": true,
    "voir_equipe": true,
    "voir_equipe_terrain": false,
    "saisir_restreint": false,
    "saisir_planning": false,
    "modifier_shifts_prevus": false,
    "gerer_rotation": true
  }'::jsonb
) ON CONFLICT (id) DO UPDATE SET
  nom   = EXCLUDED.nom,
  perms = EXCLUDED.perms;

-- Ajouter la permission gerer_rotation aux rôles existants
UPDATE sh_roles SET perms = perms || '{"gerer_rotation": true}'::jsonb
WHERE id = 'cluster_ops';

-- ── 5. RLS ────────────────────────────────────────────────────
ALTER TABLE sh_shift_types    ENABLE ROW LEVEL SECURITY;
ALTER TABLE sh_weekly_schedule ENABLE ROW LEVEL SECURITY;

-- Shift types : lecture par tous, écriture par admins/revenue
CREATE POLICY "read_shift_types" ON sh_shift_types
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "manage_shift_types" ON sh_shift_types
  FOR ALL TO authenticated
  USING (sh_my_role() IN ('cluster_ops', 'cluster_revenue_manager'))
  WITH CHECK (sh_my_role() IN ('cluster_ops', 'cluster_revenue_manager'));

-- Planning hebdo : lecture par tous, écriture par admins/revenue
CREATE POLICY "read_weekly_schedule" ON sh_weekly_schedule
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "manage_weekly_schedule" ON sh_weekly_schedule
  FOR ALL TO authenticated
  USING (sh_my_role() IN ('cluster_ops', 'cluster_revenue_manager'))
  WITH CHECK (sh_my_role() IN ('cluster_ops', 'cluster_revenue_manager'));

-- ── 6. Realtime ───────────────────────────────────────────────
DO $$ BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE sh_weekly_schedule;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- ── Vérification ─────────────────────────────────────────────
SELECT 'sh_shift_types' AS table_name, COUNT(*) FROM sh_shift_types
UNION ALL
SELECT 'sh_weekly_schedule', COUNT(*) FROM sh_weekly_schedule;
