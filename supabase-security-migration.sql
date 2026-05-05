-- ============================================================
-- MIGRATION SÉCURITÉ — StayHere Pointage
-- Phase 2 : Supabase Auth + RLS par identité
-- Phase 3 : Timestamps serveur via triggers
--
-- PRÉREQUIS dans Supabase Dashboard AVANT d'exécuter :
--   1. Auth → Settings → Email → désactiver "Confirm email"
--   2. Auth → Settings → Site URL → https://iwalid-stack.github.io/stayhere-pointage
--   3. Régénérer la clé anon : Settings → API → Regenerate anon key
--      puis mettre la nouvelle clé dans config.js LOCAL (jamais committé)
--
-- ORDRE D'EXÉCUTION :
--   1. Exécuter ce fichier complet dans SQL Editor de Supabase
--   2. Créer les utilisateurs Supabase Auth via le Dashboard (voir section MIGRATION)
--   3. Déployer les Edge Functions (dossier supabase/functions/)
-- ============================================================

-- ============================================================
-- SECTION 1 — TABLE DE PROFILS (liée à auth.users)
-- ============================================================

CREATE TABLE IF NOT EXISTS sh_user_profiles (
  id          UUID    PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username    TEXT    UNIQUE NOT NULL,
  nom         TEXT    NOT NULL DEFAULT '',
  role        TEXT    NOT NULL DEFAULT 'collaborateur'
              CHECK (role IN (
                'cluster_ops','juriste','responsable_financier',
                'kindness_ambassador','gouvernante_generale',
                'assistante_gouvernante','collaborateur'
              )),
  site_id     TEXT    REFERENCES sh_sites(id),
  employee_id TEXT    REFERENCES sh_employees(id),
  acces_horloge   BOOLEAN DEFAULT false,
  acces_principal BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE sh_user_profiles ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- SECTION 2 — FONCTIONS HELPER POUR RLS
-- ============================================================

-- Rôle de l'utilisateur courant
CREATE OR REPLACE FUNCTION sh_my_role()
RETURNS TEXT
LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  SELECT role FROM sh_user_profiles WHERE id = auth.uid()
$$;

-- Site de l'utilisateur courant
CREATE OR REPLACE FUNCTION sh_my_site()
RETURNS TEXT
LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  SELECT site_id FROM sh_user_profiles WHERE id = auth.uid()
$$;

-- Employee_id de l'utilisateur courant
CREATE OR REPLACE FUNCTION sh_my_emp()
RETURNS TEXT
LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  SELECT employee_id FROM sh_user_profiles WHERE id = auth.uid()
$$;

-- L'utilisateur est-il manager (accès multi-sites) ?
CREATE OR REPLACE FUNCTION sh_is_global()
RETURNS BOOLEAN
LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  SELECT sh_my_role() IN ('cluster_ops','juriste','responsable_financier')
$$;

-- L'utilisateur peut-il voir son équipe ?
CREATE OR REPLACE FUNCTION sh_is_manager()
RETURNS BOOLEAN
LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  SELECT sh_my_role() IN (
    'cluster_ops','juriste','responsable_financier',
    'kindness_ambassador','gouvernante_generale','assistante_gouvernante'
  )
$$;

-- ============================================================
-- SECTION 3 — TRIGGERS TIMESTAMPS SERVEUR (Phase 3)
-- Empêche la falsification des horodatages côté client
-- ============================================================

-- Fonction générique de mise à jour de updated_at
CREATE OR REPLACE FUNCTION sh_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Trigger sur sh_shifts pour forcer l'heure serveur lors d'une arrivée/départ
CREATE OR REPLACE FUNCTION sh_enforce_shift_timestamps()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Forcer created_at et updated_at côté serveur
  IF TG_OP = 'INSERT' THEN
    NEW.created_at = to_char(NOW() AT TIME ZONE 'Africa/Casablanca', 'YYYY-MM-DD"T"HH24:MI:SS');
    NEW.updated_at = NEW.created_at;
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.updated_at = to_char(NOW() AT TIME ZONE 'Africa/Casablanca', 'YYYY-MM-DD"T"HH24:MI:SS');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sh_shifts_timestamps ON sh_shifts;
CREATE TRIGGER sh_shifts_timestamps
  BEFORE INSERT OR UPDATE ON sh_shifts
  FOR EACH ROW EXECUTE FUNCTION sh_enforce_shift_timestamps();

-- Trigger sur sh_pointage pour forcer created_at/updated_at
CREATE OR REPLACE FUNCTION sh_enforce_pointage_timestamps()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at = to_char(NOW() AT TIME ZONE 'Africa/Casablanca', 'YYYY-MM-DD"T"HH24:MI:SS');
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.updated_at = to_char(NOW() AT TIME ZONE 'Africa/Casablanca', 'YYYY-MM-DD"T"HH24:MI:SS');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sh_pointage_timestamps ON sh_pointage;
CREATE TRIGGER sh_pointage_timestamps
  BEFORE INSERT OR UPDATE ON sh_pointage
  FOR EACH ROW EXECUTE FUNCTION sh_enforce_pointage_timestamps();

-- ============================================================
-- SECTION 4 — RLS : SUPPRESSION DES ANCIENNES POLITIQUES
-- ============================================================

DO $drop_policies$ DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'sh_user_profiles','sh_users','sh_sites','sh_affectations','sh_postes',
    'sh_roles','sh_employees','sh_holidays','sh_pointage','sh_schedules',
    'sh_shifts','sh_locks','sh_audit','sh_shift_change_requests',
    'sh_leave_requests','sh_leave_balances','sh_temp_assignments'
  ] LOOP
    BEGIN
      EXECUTE format('DROP POLICY IF EXISTS "anon_access" ON %I', tbl);
      EXECUTE format('DROP POLICY IF EXISTS "authenticated_read" ON %I', tbl);
      EXECUTE format('DROP POLICY IF EXISTS "manager_write" ON %I', tbl);
      EXECUTE format('DROP POLICY IF EXISTS "own_only" ON %I', tbl);
      EXECUTE format('DROP POLICY IF EXISTS "site_read" ON %I', tbl);
      EXECUTE format('DROP POLICY IF EXISTS "admin_write" ON %I', tbl);
      EXECUTE format('DROP POLICY IF EXISTS "employee_own" ON %I', tbl);
      EXECUTE format('DROP POLICY IF EXISTS "manager_or_own" ON %I', tbl);
    EXCEPTION WHEN undefined_table THEN NULL;
    END;
  END LOOP;
END $drop_policies$;

-- ============================================================
-- SECTION 5 — NOUVELLES POLITIQUES RLS PAR TABLE
-- ============================================================

-- ---- sh_user_profiles ----
-- Chaque user voit son propre profil ; cluster_ops et RH voient tout
CREATE POLICY "own_profile_read" ON sh_user_profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR sh_is_global());

CREATE POLICY "own_profile_update" ON sh_user_profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    -- Un collaborateur ne peut pas s'élever en rôle
    AND (role = (SELECT role FROM sh_user_profiles WHERE id = auth.uid()))
  );

CREATE POLICY "admin_manage_profiles" ON sh_user_profiles
  FOR ALL TO authenticated
  USING (sh_my_role() = 'cluster_ops')
  WITH CHECK (sh_my_role() = 'cluster_ops');

-- ---- sh_sites ----
-- Lecture pour tous ; écriture pour cluster_ops uniquement
CREATE POLICY "auth_read_sites" ON sh_sites
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "admin_write_sites" ON sh_sites
  FOR ALL TO authenticated
  USING (sh_my_role() = 'cluster_ops')
  WITH CHECK (sh_my_role() = 'cluster_ops');

-- ---- sh_affectations, sh_postes, sh_roles, sh_holidays ----
-- Données de référence : lecture seule pour tous, écriture pour admin
CREATE POLICY "auth_read" ON sh_affectations FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin_write" ON sh_affectations FOR ALL TO authenticated
  USING (sh_my_role() = 'cluster_ops') WITH CHECK (sh_my_role() = 'cluster_ops');

CREATE POLICY "auth_read" ON sh_postes FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin_write" ON sh_postes FOR ALL TO authenticated
  USING (sh_my_role() = 'cluster_ops') WITH CHECK (sh_my_role() = 'cluster_ops');

CREATE POLICY "auth_read" ON sh_roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin_write" ON sh_roles FOR ALL TO authenticated
  USING (sh_my_role() = 'cluster_ops') WITH CHECK (sh_my_role() = 'cluster_ops');

CREATE POLICY "auth_read" ON sh_holidays FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin_write" ON sh_holidays FOR ALL TO authenticated
  USING (sh_is_global()) WITH CHECK (sh_is_global());

-- ---- sh_employees ----
-- Lecture : même site ou global
-- Écriture : managers du site ou global
CREATE POLICY "site_read_employees" ON sh_employees
  FOR SELECT TO authenticated
  USING (
    sh_is_global()
    OR site_id = sh_my_site()
    -- un collaborateur voit son propre profil
    OR id = sh_my_emp()
  );

CREATE POLICY "manager_write_employees" ON sh_employees
  FOR ALL TO authenticated
  USING (sh_is_manager())
  WITH CHECK (sh_is_manager());

-- ---- sh_schedules ----
CREATE POLICY "site_read_schedules" ON sh_schedules
  FOR SELECT TO authenticated
  USING (
    sh_is_global()
    OR employee_id IN (
      SELECT id FROM sh_employees WHERE site_id = sh_my_site()
    )
    OR employee_id = sh_my_emp()
  );

CREATE POLICY "manager_write_schedules" ON sh_schedules
  FOR ALL TO authenticated
  USING (sh_is_manager())
  WITH CHECK (sh_is_manager());

-- ---- sh_pointage ----
-- Lecture : même site ou global ou propre entrée
-- Écriture : managers ou collaborateur pour sa propre entrée (via clock-action Edge Function)
CREATE POLICY "site_read_pointage" ON sh_pointage
  FOR SELECT TO authenticated
  USING (
    sh_is_global()
    OR site_id = sh_my_site()
    OR employee_id = sh_my_emp()
  );

CREATE POLICY "manager_write_pointage" ON sh_pointage
  FOR ALL TO authenticated
  USING (sh_is_manager())
  WITH CHECK (sh_is_manager());

-- Collaborateurs : lecture de leur propre pointage uniquement
-- (l'écriture se fait via Edge Function clock-action avec service role)
CREATE POLICY "own_read_pointage" ON sh_pointage
  FOR SELECT TO authenticated
  USING (employee_id = sh_my_emp());

-- ---- sh_shifts ----
-- Structure identique à sh_pointage
CREATE POLICY "site_read_shifts" ON sh_shifts
  FOR SELECT TO authenticated
  USING (
    sh_is_global()
    OR site_id = sh_my_site()
    OR employee_id = sh_my_emp()
  );

CREATE POLICY "manager_write_shifts" ON sh_shifts
  FOR ALL TO authenticated
  USING (sh_is_manager())
  WITH CHECK (sh_is_manager());

CREATE POLICY "own_read_shifts" ON sh_shifts
  FOR SELECT TO authenticated
  USING (employee_id = sh_my_emp());

-- ---- sh_locks ----
CREATE POLICY "site_read_locks" ON sh_locks
  FOR SELECT TO authenticated
  USING (sh_is_global() OR site_id = sh_my_site());

CREATE POLICY "admin_write_locks" ON sh_locks
  FOR ALL TO authenticated
  USING (sh_is_global())
  WITH CHECK (sh_is_global());

-- ---- sh_audit ----
CREATE POLICY "site_read_audit" ON sh_audit
  FOR SELECT TO authenticated
  USING (sh_is_global() OR site_id = sh_my_site());

CREATE POLICY "auth_insert_audit" ON sh_audit
  FOR INSERT TO authenticated
  WITH CHECK (true);  -- tout utilisateur auth peut insérer un log d'audit

-- ---- sh_shift_change_requests ----
CREATE POLICY "site_read_change_req" ON sh_shift_change_requests
  FOR SELECT TO authenticated
  USING (
    sh_is_global()
    OR site_id = sh_my_site()
    OR employee_id = sh_my_emp()
  );

CREATE POLICY "own_insert_change_req" ON sh_shift_change_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    -- collaborateur pour lui-même, ou manager
    (employee_id = sh_my_emp() AND sh_my_role() = 'collaborateur')
    OR sh_is_manager()
  );

CREATE POLICY "manager_update_change_req" ON sh_shift_change_requests
  FOR UPDATE TO authenticated
  USING (sh_is_manager())
  WITH CHECK (sh_is_manager());

-- ---- sh_leave_requests ----
DO $$ BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name='sh_leave_requests') THEN

    EXECUTE $pol$
      CREATE POLICY "site_read_leave" ON sh_leave_requests
        FOR SELECT TO authenticated
        USING (
          (SELECT sh_is_global()) OR site_id = (SELECT sh_my_site())
          OR employee_id = (SELECT sh_my_emp())
        );
      CREATE POLICY "own_insert_leave" ON sh_leave_requests
        FOR INSERT TO authenticated
        WITH CHECK (
          employee_id = (SELECT sh_my_emp()) OR (SELECT sh_is_manager())
        );
      CREATE POLICY "manager_manage_leave" ON sh_leave_requests
        FOR ALL TO authenticated
        USING ((SELECT sh_is_manager()))
        WITH CHECK ((SELECT sh_is_manager()));
    $pol$;

  END IF;
END $$;

-- ---- sh_leave_balances ----
DO $$ BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name='sh_leave_balances') THEN

    EXECUTE $pol$
      CREATE POLICY "site_read_balance" ON sh_leave_balances
        FOR SELECT TO authenticated
        USING (
          (SELECT sh_is_global()) OR site_id = (SELECT sh_my_site())
          OR employee_id = (SELECT sh_my_emp())
        );
      CREATE POLICY "manager_write_balance" ON sh_leave_balances
        FOR ALL TO authenticated
        USING ((SELECT sh_is_manager()))
        WITH CHECK ((SELECT sh_is_manager()));
    $pol$;

  END IF;
END $$;

-- ---- sh_temp_assignments ----
DO $$ BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name='sh_temp_assignments') THEN

    EXECUTE $pol$
      CREATE POLICY "auth_read_temp" ON sh_temp_assignments
        FOR SELECT TO authenticated USING (true);
      CREATE POLICY "manager_write_temp" ON sh_temp_assignments
        FOR ALL TO authenticated
        USING ((SELECT sh_is_manager()))
        WITH CHECK ((SELECT sh_is_manager()));
    $pol$;

  END IF;
END $$;

-- ---- sh_users (table legacy — conservée pour référence, accès restreint) ----
-- Après migration complète vers sh_user_profiles, cette table peut être supprimée
CREATE POLICY "admin_only_users" ON sh_users
  FOR ALL TO authenticated
  USING (sh_my_role() = 'cluster_ops')
  WITH CHECK (sh_my_role() = 'cluster_ops');

-- ============================================================
-- SECTION 6 — MIGRATION DES UTILISATEURS EXISTANTS
--
-- INSTRUCTIONS (à faire manuellement via Supabase Dashboard) :
--
-- 1. Pour chaque utilisateur dans sh_users, créer un compte Auth :
--    Dashboard → Authentication → Users → Invite User
--    Email    : {username}@stayhere.internal
--    (les emails ne seront pas envoyés car la confirmation est désactivée)
--
-- 2. Après création, récupérer l'UUID généré et insérer dans sh_user_profiles :
--    (remplacer les UUID par ceux générés par Supabase)
--
-- EXEMPLE (adapter avec les vrais UUID de votre projet) :
-- INSERT INTO sh_user_profiles (id, username, nom, role, site_id, acces_principal, acces_horloge)
-- SELECT
--   au.id,
--   su.username,
--   su.nom,
--   su.role,
--   su.site_id,
--   COALESCE(su.acces_principal, true),
--   COALESCE(su.acces_horloge, true)
-- FROM auth.users au
-- JOIN sh_users su ON su.username || '@stayhere.internal' = au.email
-- ON CONFLICT (id) DO UPDATE SET
--   username = EXCLUDED.username,
--   nom      = EXCLUDED.nom,
--   role     = EXCLUDED.role,
--   site_id  = EXCLUDED.site_id;
--
-- 3. Pour les collaborateurs (employee_id liés) :
-- UPDATE sh_user_profiles p
-- SET employee_id = u.employee_id
-- FROM sh_users u
-- WHERE u.username || '@stayhere.internal' = (
--   SELECT email FROM auth.users WHERE id = p.id
-- );
--
-- ============================================================

-- Vue de vérification pour s'assurer que la migration est complète
CREATE OR REPLACE VIEW sh_migration_check AS
SELECT
  su.username,
  su.role,
  su.site_id,
  CASE WHEN au.id IS NOT NULL THEN '✅ Auth créé' ELSE '❌ Auth manquant' END AS auth_status,
  CASE WHEN sp.id IS NOT NULL THEN '✅ Profil créé' ELSE '❌ Profil manquant' END AS profile_status
FROM sh_users su
LEFT JOIN auth.users au ON au.email = su.username || '@stayhere.internal'
LEFT JOIN sh_user_profiles sp ON sp.id = au.id
ORDER BY su.role, su.username;

-- ============================================================
-- SECTION 7 — CONTRAINTES DB SUPPLÉMENTAIRES (protection données)
-- ============================================================

-- Empêcher un type de pointage invalide
DO $$ BEGIN
  BEGIN
    ALTER TABLE sh_pointage ADD CONSTRAINT sh_pointage_type_valid
      CHECK (type IN (
        'travaille','double','off','maladie','conge','recup',
        'depart','absence','at','ferie','aj','nvrecru','standby','mise_a_pied'
      ));
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- Empêcher des dates de shift incohérentes (dans la même journée)
DO $$ BEGIN
  BEGIN
    ALTER TABLE sh_shifts ADD CONSTRAINT sh_shifts_date_valid
      CHECK (date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- ============================================================
-- SECTION 8 — RÉALTIME pour sh_user_profiles
-- ============================================================
DO $$ BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE sh_user_profiles;
  EXCEPTION WHEN others THEN NULL;
  END;
END $$;

-- ============================================================
-- FIN DE LA MIGRATION
-- Vérifier avec : SELECT * FROM sh_migration_check;
-- ============================================================
