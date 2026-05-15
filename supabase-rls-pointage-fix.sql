-- ============================================================
-- FIX RLS — Entrées de pointage qui disparaissent après rechargement
-- ============================================================
-- Problème :
--   La politique "site_read_pointage" appelle sh_is_global() qui appelle sh_my_role().
--   Si auth.uid() retourne NULL (session expirée, JWT mal configuré) ou si la fonction
--   STABLE est mal mise en cache par Postgres, sh_is_global() peut retourner FALSE pour
--   un cluster_ops → toutes les entrées d'autres sites disparaissent au rechargement.
--
-- Diagnostic : exécuter d'abord ces requêtes pour vérifier l'état actuel
-- ============================================================

-- DIAGNOSTIC 1 : Voir tous les profils et leurs rôles/sites
SELECT id, username, role, site_id, employee_id, acces_principal
FROM sh_user_profiles
ORDER BY role, username;

-- DIAGNOSTIC 2 : Compter les entrées de pointage par site
SELECT site_id, COUNT(*) as nb_entries
FROM sh_pointage
GROUP BY site_id
ORDER BY nb_entries DESC;

-- DIAGNOSTIC 3 : Vérifier les politiques actives sur sh_pointage
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'sh_pointage'
ORDER BY policyname;

-- ============================================================
-- FIX 1 : Recréer les fonctions helper SANS STABLE
-- (STABLE permet à Postgres de mettre en cache le résultat dans une transaction,
--  ce qui peut poser problème si auth.uid() change ou si la fonction a un bug subtil)
-- ============================================================

CREATE OR REPLACE FUNCTION sh_my_role()
RETURNS TEXT
LANGUAGE SQL SECURITY DEFINER AS $$
  SELECT role FROM sh_user_profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION sh_my_site()
RETURNS TEXT
LANGUAGE SQL SECURITY DEFINER AS $$
  SELECT site_id FROM sh_user_profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION sh_my_emp()
RETURNS TEXT
LANGUAGE SQL SECURITY DEFINER AS $$
  SELECT employee_id FROM sh_user_profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION sh_is_global()
RETURNS BOOLEAN
LANGUAGE SQL SECURITY DEFINER AS $$
  SELECT COALESCE(
    (SELECT role FROM sh_user_profiles WHERE id = auth.uid())
      IN ('cluster_ops', 'juriste', 'responsable_financier'),
    false
  )
$$;

CREATE OR REPLACE FUNCTION sh_is_manager()
RETURNS BOOLEAN
LANGUAGE SQL SECURITY DEFINER AS $$
  SELECT COALESCE(
    (SELECT role FROM sh_user_profiles WHERE id = auth.uid())
      IN (
        'cluster_ops', 'juriste', 'responsable_financier',
        'kindness_ambassador', 'gouvernante_generale', 'assistante_gouvernante'
      ),
    false
  )
$$;

-- ============================================================
-- FIX 2 : Recréer la politique SELECT de sh_pointage
-- en utilisant des checks inline (sans appeler sh_is_global())
-- → Plus fiable, moins dépendant du bon fonctionnement des fonctions helper
-- ============================================================

DROP POLICY IF EXISTS "site_read_pointage" ON sh_pointage;
DROP POLICY IF EXISTS "own_read_pointage" ON sh_pointage;

-- Nouvelle politique unifiée — cohérente avec manager_write_pointage :
-- La politique d'ÉCRITURE autorise tous les managers à écrire SANS restriction de site.
-- La politique de LECTURE doit être identique sinon les entrées disparaissent au rechargement.
--
-- • Tous les managers (cluster_ops, juriste, KA, gouvernante, etc.) voient TOUT le pointage
--   → Cohérent avec le fait qu'ils peuvent tous écrire partout
-- • Les collaborateurs voient uniquement leur propre pointage
CREATE POLICY "site_read_pointage" ON sh_pointage
  FOR SELECT TO authenticated
  USING (
    -- Tous les managers autorisés à saisir du pointage peuvent aussi le lire
    -- (même liste que manager_write_pointage)
    (SELECT role FROM sh_user_profiles WHERE id = auth.uid())
      IN (
        'cluster_ops', 'juriste', 'responsable_financier',
        'kindness_ambassador', 'gouvernante_generale', 'assistante_gouvernante'
      )
    -- Collaborateurs : leur propre pointage uniquement
    OR employee_id = (SELECT employee_id FROM sh_user_profiles WHERE id = auth.uid())
  );

-- ============================================================
-- FIX 3 : Même correction pour sh_shifts (même problème potentiel)
-- ============================================================

DROP POLICY IF EXISTS "site_read_shifts" ON sh_shifts;
DROP POLICY IF EXISTS "own_read_shifts" ON sh_shifts;

-- Même logique que pointage : managers voient tous les shifts, collaborateurs les leurs
CREATE POLICY "site_read_shifts" ON sh_shifts
  FOR SELECT TO authenticated
  USING (
    (SELECT role FROM sh_user_profiles WHERE id = auth.uid())
      IN (
        'cluster_ops', 'juriste', 'responsable_financier',
        'kindness_ambassador', 'gouvernante_generale', 'assistante_gouvernante'
      )
    OR employee_id = (SELECT employee_id FROM sh_user_profiles WHERE id = auth.uid())
  );

-- ============================================================
-- FIX 4 : Même correction pour sh_employees
-- ============================================================

DROP POLICY IF EXISTS "site_read_employees" ON sh_employees;

CREATE POLICY "site_read_employees" ON sh_employees
  FOR SELECT TO authenticated
  USING (
    (SELECT role FROM sh_user_profiles WHERE id = auth.uid())
      IN ('cluster_ops', 'juriste', 'responsable_financier')
    OR site_id = (SELECT site_id FROM sh_user_profiles WHERE id = auth.uid())
    OR id = (SELECT employee_id FROM sh_user_profiles WHERE id = auth.uid())
  );

-- ============================================================
-- FIX 5 : Vérification finale
-- Après avoir exécuté ce script, vérifier avec :
-- ============================================================

-- Vérifier les nouvelles politiques
SELECT policyname, cmd, qual
FROM pg_policies
WHERE tablename IN ('sh_pointage', 'sh_shifts', 'sh_employees')
ORDER BY tablename, policyname;

-- Tester sh_is_global() avec l'utilisateur courant (à exécuter en étant connecté)
-- SELECT sh_is_global(), sh_my_role(), sh_my_site();
