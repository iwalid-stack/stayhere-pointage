-- ============================================================
-- FIX : Ajouter cluster_revenue_manager à la contrainte CHECK
-- et corriger les politiques RLS pour les updates de profils
-- À exécuter dans Supabase → SQL Editor
-- ============================================================

-- 1. Supprimer l'ancienne contrainte CHECK sur le rôle
ALTER TABLE sh_user_profiles
  DROP CONSTRAINT IF EXISTS sh_user_profiles_role_check;

-- 2. Ajouter la nouvelle contrainte qui inclut cluster_revenue_manager
ALTER TABLE sh_user_profiles
  ADD CONSTRAINT sh_user_profiles_role_check
  CHECK (role IN (
    'cluster_ops',
    'cluster_revenue_manager',
    'juriste',
    'responsable_financier',
    'kindness_ambassador',
    'gouvernante_generale',
    'assistante_gouvernante',
    'collaborateur'
  ));

-- 3. S'assurer que RLS est activé sur sh_users aussi
ALTER TABLE sh_users ENABLE ROW LEVEL SECURITY;

-- 4. Recréer les policies sur sh_user_profiles pour éviter les conflits
DROP POLICY IF EXISTS "own_profile_update" ON sh_user_profiles;
DROP POLICY IF EXISTS "admin_manage_profiles" ON sh_user_profiles;

-- Politique : un user peut mettre à jour son propre profil (sauf le rôle)
CREATE POLICY "own_profile_update" ON sh_user_profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND (role = (SELECT role FROM sh_user_profiles WHERE id = auth.uid()))
  );

-- Politique : cluster_ops peut tout gérer
CREATE POLICY "admin_manage_profiles" ON sh_user_profiles
  FOR ALL TO authenticated
  USING (sh_my_role() IN ('cluster_ops'))
  WITH CHECK (sh_my_role() IN ('cluster_ops'));

-- 5. Vérification
SELECT conname, consrc FROM pg_constraint
WHERE conrelid = 'sh_user_profiles'::regclass AND contype = 'c';

SELECT 'Fix applied successfully' AS status;
