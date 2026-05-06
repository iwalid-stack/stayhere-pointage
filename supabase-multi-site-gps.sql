-- ============================================================
-- MIGRATION : Multi-site GPS pour collaborateurs tournants
-- À exécuter dans Supabase → SQL Editor
-- ============================================================

-- Ajouter la colonne sites_secondaires sur sh_employees
-- Tableau d'IDs de sites supplémentaires autorisés pour le pointage GPS
ALTER TABLE sh_employees
  ADD COLUMN IF NOT EXISTS sites_secondaires TEXT[] DEFAULT '{}';

-- Index GIN pour les recherches sur le tableau
CREATE INDEX IF NOT EXISTS idx_employees_sites_secondaires
  ON sh_employees USING GIN (sites_secondaires);

-- Vérification
SELECT id, nom, prenom, site_id, sites_secondaires
FROM sh_employees
WHERE sites_secondaires != '{}'
LIMIT 10;

SELECT 'Migration multi-site GPS appliquée' AS status;
