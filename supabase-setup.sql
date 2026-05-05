-- ============================================================
-- StayHere Pointage — Configuration Supabase
-- Copier-coller ENTIÈREMENT dans SQL Editor de votre projet Supabase
-- ============================================================

-- Extension pour le hachage des mots de passe
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---- TABLES ----

CREATE TABLE IF NOT EXISTS sh_users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  nom TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('cluster_ops','juriste','responsable_financier','kindness_ambassador')),
  site_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sh_sites (
  id TEXT PRIMARY KEY,
  nom TEXT NOT NULL,
  ville TEXT NOT NULL,
  actif BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS sh_affectations (
  nom TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS sh_postes (
  nom TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS sh_roles (
  id TEXT PRIMARY KEY,
  nom TEXT NOT NULL UNIQUE,
  voir_tous_sites BOOLEAN DEFAULT FALSE,
  valider BOOLEAN DEFAULT FALSE,
  administrer BOOLEAN DEFAULT FALSE,
  verrouiller BOOLEAN DEFAULT FALSE,
  exporter BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS sh_employees (
  id TEXT PRIMARY KEY,
  imm TEXT,
  nom TEXT NOT NULL,
  prenom TEXT NOT NULL,
  poste TEXT NOT NULL,
  site_id TEXT REFERENCES sh_sites(id),
  affectation TEXT,
  actif BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS sh_holidays (
  date TEXT PRIMARY KEY,
  nom TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sh_pointage (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES sh_employees(id),
  site_id TEXT NOT NULL REFERENCES sh_sites(id),
  date TEXT NOT NULL,
  type TEXT NOT NULL,
  notes TEXT DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT,
  validated BOOLEAN DEFAULT FALSE,
  validated_by TEXT,
  validated_at TEXT,
  UNIQUE(employee_id, date)
);

CREATE TABLE IF NOT EXISTS sh_schedules (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL UNIQUE REFERENCES sh_employees(id),
  heure_debut TEXT NOT NULL,
  heure_fin TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sh_shifts (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES sh_employees(id),
  site_id TEXT NOT NULL REFERENCES sh_sites(id),
  date TEXT NOT NULL,
  heure_arrivee TEXT,
  heure_depart TEXT,
  heure_debut_prevue TEXT,
  heure_fin_prevue TEXT,
  retard_minutes INTEGER DEFAULT 0,
  duree_minutes INTEGER DEFAULT 0,
  validated_by_ka TEXT,
  validated_at_ka TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT,
  UNIQUE(employee_id, date)
);

CREATE TABLE IF NOT EXISTS sh_locks (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  site_id TEXT NOT NULL REFERENCES sh_sites(id),
  year_month TEXT NOT NULL,
  locked_by TEXT NOT NULL,
  locked_at TEXT NOT NULL,
  UNIQUE(site_id, year_month)
);

CREATE TABLE IF NOT EXISTS sh_audit (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  entry_id TEXT,
  username TEXT NOT NULL,
  site_id TEXT,
  old_value JSONB,
  new_value JSONB,
  created_at TEXT NOT NULL
);

-- ---- SÉCURITÉ (Row Level Security) ----
-- Accès autorisé via la clé anon (sécurité gérée par l'application)

ALTER TABLE sh_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sh_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE sh_affectations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sh_postes ENABLE ROW LEVEL SECURITY;
ALTER TABLE sh_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE sh_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE sh_holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE sh_pointage ENABLE ROW LEVEL SECURITY;
ALTER TABLE sh_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE sh_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sh_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE sh_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_access" ON sh_users FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_access" ON sh_sites FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_access" ON sh_affectations FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_access" ON sh_postes FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_access" ON sh_roles FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_access" ON sh_employees FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_access" ON sh_holidays FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_access" ON sh_pointage FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_access" ON sh_schedules FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_access" ON sh_shifts FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_access" ON sh_locks FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_access" ON sh_audit FOR ALL TO anon USING (true) WITH CHECK (true);

-- ---- TEMPS RÉEL ----
ALTER PUBLICATION supabase_realtime ADD TABLE sh_pointage;
ALTER PUBLICATION supabase_realtime ADD TABLE sh_shifts;
ALTER PUBLICATION supabase_realtime ADD TABLE sh_audit;
ALTER PUBLICATION supabase_realtime ADD TABLE sh_locks;

-- ---- DONNÉES INITIALES ----

-- Sites
INSERT INTO sh_sites (id, nom, ville, actif) VALUES
  ('site_casa',   'Casablanca',    'Casablanca', true),
  ('site_rabat',  'Rabat',         'Rabat',      true),
  ('site_agadir', 'Agadir',        'Agadir',     true),
  ('site_office', 'Office / Siège','Casablanca', true)
ON CONFLICT (id) DO NOTHING;

-- Affectations (villes + quartiers/résidences)
INSERT INTO sh_affectations (nom) VALUES
  ('Casablanca'),('Rabat'),('Agadir'),
  ('Gauthier 1'),('Gauthier 2'),('Gauthier 3'),
  ('Maarif'),('Cil'),('Palmier'),('Oasis'),
  ('Agdal 1'),('Agdal 2'),('Agdal 3'),('Agdal 4'),
  ('Hassan'),('Hay Riad')
ON CONFLICT (nom) DO NOTHING;

-- Postes / Fonctions
INSERT INTO sh_postes (nom) VALUES
  ('Kindness Ambassador'),
  ('Kindness Host'),
  ('Femme de chambre'),
  ('Technicien'),
  ('Valet'),
  ('Coursier'),
  ('Jardinier'),
  ('Réceptionniste'),
  ('Manager de site')
ON CONFLICT (nom) DO NOTHING;

-- Jours fériés Maroc 2026
INSERT INTO sh_holidays (date, nom) VALUES
  ('2026-01-01', 'Nouvel An'),
  ('2026-01-11', 'Manifeste de l''Indépendance'),
  ('2026-03-03', 'Fête du Trône'),
  ('2026-05-01', 'Fête du Travail'),
  ('2026-07-30', 'Fête du Trône'),
  ('2026-08-14', 'Allégeance Oued Eddahab'),
  ('2026-08-20', 'Révolution du Roi'),
  ('2026-08-21', 'Fête de la Jeunesse'),
  ('2026-11-06', 'Marche Verte'),
  ('2026-11-18', 'Fête de l''Indépendance')
ON CONFLICT (date) DO NOTHING;

-- Utilisateurs (mots de passe hachés SHA-256 via pgcrypto)
-- admin        → mot de passe: stayhere2024
-- juriste      → mot de passe: juriste2024
-- finance      → mot de passe: finance2024
-- ka_casa      → mot de passe: ka2024
-- ka_rabat     → mot de passe: ka2024
-- ka_agadir    → mot de passe: ka2024
-- CHANGEZ CES MOTS DE PASSE DEPUIS L'APPLICATION APRÈS LE PREMIER LOGIN

INSERT INTO sh_users (id, username, password_hash, nom, role, site_id) VALUES
  ('u1', 'admin',     encode(digest('stayhere2024', 'sha256'), 'hex'), 'Cluster Ops Manager',   'cluster_ops',            null),
  ('u2', 'juriste',   encode(digest('juriste2024',  'sha256'), 'hex'), 'Juriste',               'juriste',                null),
  ('u3', 'finance',   encode(digest('finance2024',  'sha256'), 'hex'), 'Responsable Financier', 'responsable_financier',  null),
  ('u4', 'ka_casa',   encode(digest('ka2024',       'sha256'), 'hex'), 'KA Casablanca',         'kindness_ambassador',    'site_casa'),
  ('u5', 'ka_rabat',  encode(digest('ka2024',       'sha256'), 'hex'), 'KA Rabat',              'kindness_ambassador',    'site_rabat'),
  ('u6', 'ka_agadir', encode(digest('ka2024',       'sha256'), 'hex'), 'KA Agadir',             'kindness_ambassador',    'site_agadir')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- MIGRATIONS — Script complet et sécurisé
-- Peut être exécuté plusieurs fois sans erreur
-- ============================================================

DO $migration$
BEGIN

  -- ---- 1. COLONNES SUR sh_employees ----
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sh_employees' AND column_name='pointage_horaire') THEN
    ALTER TABLE sh_employees ADD COLUMN pointage_horaire BOOLEAN DEFAULT TRUE;
  END IF;

  -- ---- 2. COLONNES SUR sh_shifts ----
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sh_shifts' AND column_name='pause_minutes') THEN
    ALTER TABLE sh_shifts ADD COLUMN pause_minutes INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sh_shifts' AND column_name='heure_arrivee_2') THEN
    ALTER TABLE sh_shifts ADD COLUMN heure_arrivee_2 TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sh_shifts' AND column_name='heure_depart_2') THEN
    ALTER TABLE sh_shifts ADD COLUMN heure_depart_2 TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sh_shifts' AND column_name='retard_minutes_2') THEN
    ALTER TABLE sh_shifts ADD COLUMN retard_minutes_2 INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sh_shifts' AND column_name='duree_minutes_2') THEN
    ALTER TABLE sh_shifts ADD COLUMN duree_minutes_2 INTEGER DEFAULT 0;
  END IF;

  -- ---- 3. COLONNES SUR sh_users ----
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sh_users' AND column_name='acces_principal') THEN
    ALTER TABLE sh_users ADD COLUMN acces_principal BOOLEAN DEFAULT TRUE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sh_users' AND column_name='acces_horloge') THEN
    ALTER TABLE sh_users ADD COLUMN acces_horloge BOOLEAN DEFAULT TRUE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sh_users' AND column_name='employee_id') THEN
    ALTER TABLE sh_users ADD COLUMN employee_id TEXT;
  END IF;

  -- ---- 4. COLONNES SUR sh_roles ----
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sh_roles' AND column_name='voir_equipe') THEN
    ALTER TABLE sh_roles ADD COLUMN voir_equipe BOOLEAN DEFAULT FALSE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sh_roles' AND column_name='voir_equipe_terrain') THEN
    ALTER TABLE sh_roles ADD COLUMN voir_equipe_terrain BOOLEAN DEFAULT FALSE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sh_roles' AND column_name='saisir_restreint') THEN
    ALTER TABLE sh_roles ADD COLUMN saisir_restreint BOOLEAN DEFAULT FALSE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sh_roles' AND column_name='saisir_planning') THEN
    ALTER TABLE sh_roles ADD COLUMN saisir_planning BOOLEAN DEFAULT FALSE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sh_roles' AND column_name='modifier_shifts_prevus') THEN
    ALTER TABLE sh_roles ADD COLUMN modifier_shifts_prevus BOOLEAN DEFAULT FALSE;
  END IF;

  -- ---- 5. REALTIME — ajout sécurisé (ignore si déjà présent) ----
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE sh_users;
  EXCEPTION WHEN others THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE sh_employees;
  EXCEPTION WHEN others THEN NULL;
  END;

END $migration$;

-- ---- 6. RÔLES — upsert complet sur id, sans toucher à nom ----
-- On supprime puis recrée uniquement si absent, sinon on met à jour les permissions

-- Rôles système
INSERT INTO sh_roles (id, nom, voir_tous_sites, voir_equipe, voir_equipe_terrain, valider, administrer, verrouiller, exporter, saisir_restreint, saisir_planning, modifier_shifts_prevus)
VALUES
  ('cluster_ops',           'Cluster Ops Manager',   true,  true,  true,  true,  true,  true,  true,  true,  true,  true),
  ('juriste',               'Juriste',               true,  true,  true,  true,  true,  false, true,  true,  false, false),
  ('responsable_financier', 'Responsable Financier', true,  true,  true,  true,  true,  false, true,  true,  false, false),
  ('kindness_ambassador',   'Kindness Ambassador',   false, true,  true,  false, false, false, false, false, true,  true),
  ('gouvernante_generale',  'Gouvernante Générale',  false, false, true,  false, false, false, false, false, true,  true),
  ('assistante_gouvernante','Assistante Gouvernante',false, false, true,  false, false, false, false, false, true,  true),
  ('collaborateur',         'Collaborateur',         false, false, false, false, false, false, false, false, false, false)
ON CONFLICT (id) DO UPDATE SET
  voir_tous_sites        = EXCLUDED.voir_tous_sites,
  voir_equipe            = EXCLUDED.voir_equipe,
  voir_equipe_terrain    = EXCLUDED.voir_equipe_terrain,
  valider                = EXCLUDED.valider,
  administrer            = EXCLUDED.administrer,
  verrouiller            = EXCLUDED.verrouiller,
  exporter               = EXCLUDED.exporter,
  saisir_restreint       = EXCLUDED.saisir_restreint,
  saisir_planning        = EXCLUDED.saisir_planning,
  modifier_shifts_prevus = EXCLUDED.modifier_shifts_prevus;

-- ============================================================
-- DEMANDES DE MODIFICATION DE SHIFT
-- ============================================================

CREATE TABLE IF NOT EXISTS sh_shift_change_requests (
  id TEXT PRIMARY KEY,
  shift_id TEXT REFERENCES sh_shifts(id),
  employee_id TEXT NOT NULL REFERENCES sh_employees(id),
  site_id TEXT NOT NULL REFERENCES sh_sites(id),
  date TEXT NOT NULL,
  -- Valeurs demandées
  heure_arrivee TEXT,
  heure_depart TEXT,
  heure_arrivee_2 TEXT,
  heure_depart_2 TEXT,
  heure_debut_prevue TEXT,
  heure_fin_prevue TEXT,
  -- Si le shift n'existe pas encore (KA veut créer depuis l'app principale)
  create_if_missing BOOLEAN DEFAULT FALSE,
  reason TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected')),
  requested_by TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  approved_by TEXT,
  approved_at TEXT,
  rejected_by TEXT,
  rejected_at TEXT,
  rejection_reason TEXT
);

ALTER TABLE sh_shift_change_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_access" ON sh_shift_change_requests FOR ALL TO anon USING (true) WITH CHECK (true);

DO $$ BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE sh_shift_change_requests; EXCEPTION WHEN others THEN NULL; END;
END $$;

-- ============================================================
-- CONGÉS & RÉCUPÉRATION — Nouvelles tables
-- ============================================================

CREATE TABLE IF NOT EXISTS sh_leave_requests (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES sh_employees(id),
  site_id TEXT NOT NULL REFERENCES sh_sites(id),
  type TEXT NOT NULL CHECK (type IN ('cp', 'recup')),
  date_debut TEXT NOT NULL,
  date_fin TEXT NOT NULL,
  nb_jours NUMERIC NOT NULL DEFAULT 0,
  notes TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending_ka'
    CHECK (status IN ('pending_ka','pending_admin','approved','rejected')),
  validated_by_ka TEXT,
  validated_at_ka TEXT,
  ka_notes TEXT,
  validated_by_admin TEXT,
  validated_at_admin TEXT,
  admin_notes TEXT,
  rejected_by TEXT,
  rejected_at TEXT,
  rejection_reason TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS sh_leave_balances (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL UNIQUE REFERENCES sh_employees(id),
  cp_initial NUMERIC DEFAULT 0,
  recup_initial NUMERIC DEFAULT 0,
  date_reference TEXT,
  updated_by TEXT,
  updated_at TEXT
);

-- RLS
ALTER TABLE sh_leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE sh_leave_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_access" ON sh_leave_requests FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_access" ON sh_leave_balances FOR ALL TO anon USING (true) WITH CHECK (true);

-- Realtime
DO $$ BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE sh_leave_requests; EXCEPTION WHEN others THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE sh_leave_balances; EXCEPTION WHEN others THEN NULL; END;
END $$;

-- ============================================================
-- GÉOLOCALISATION DES SITES
-- Ajouter les colonnes GPS à sh_sites pour le géofencing
-- ============================================================

DO $geo$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sh_sites' AND column_name='latitude') THEN
    ALTER TABLE sh_sites ADD COLUMN latitude NUMERIC;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sh_sites' AND column_name='longitude') THEN
    ALTER TABLE sh_sites ADD COLUMN longitude NUMERIC;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sh_sites' AND column_name='geofence_radius') THEN
    ALTER TABLE sh_sites ADD COLUMN geofence_radius INTEGER DEFAULT 50;
  END IF;
END $geo$;

-- ============================================================
-- AFFECTATIONS TEMPORAIRES
-- Permet de détacher momentanément un collaborateur vers un autre site
-- ============================================================

CREATE TABLE IF NOT EXISTS sh_temp_assignments (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES sh_employees(id),
  site_id_origin TEXT NOT NULL REFERENCES sh_sites(id),  -- site habituel
  site_id_temp TEXT NOT NULL REFERENCES sh_sites(id),    -- site de détachement
  date_debut TEXT NOT NULL,
  date_fin TEXT NOT NULL,
  reason TEXT DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  ended_at TEXT,      -- renseigné si terminé avant date_fin
  ended_by TEXT
);

ALTER TABLE sh_temp_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_access" ON sh_temp_assignments;
CREATE POLICY "anon_access" ON sh_temp_assignments FOR ALL TO anon USING (true) WITH CHECK (true);

DO $$ BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE sh_temp_assignments; EXCEPTION WHEN others THEN NULL; END;
END $$;

-- ============================================================
-- FIN DU SCRIPT — Cliquez sur RUN
-- ============================================================
