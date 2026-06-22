/**
 * auto-absence — Edge Function Supabase
 *
 * Marque automatiquement les absences côté serveur.
 * Appelée par pg_cron toutes les heures (pas de dépendance à un utilisateur connecté).
 *
 * Logique :
 *   - Pour chaque employé actif ayant un shift prévu aujourd'hui
 *   - Si maintenant > heure_debut_prevue + 2h ET pas d'arrivée pointée
 *   - ET pas de statut explicite (off/conge/recup/maladie/absence/at)
 *   → Marquer absence avec created_by = 'auto_système'
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';

const ABSENCE_DELAY_MIN = 120;
const SKIP_TYPES = ['off', 'conge', 'recup', 'maladie', 'absence', 'at', 'double'];

function todayMaroc(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Africa/Casablanca' }).substring(0, 10);
}

function nowMinMaroc(): number {
  const s = new Date().toLocaleString('sv-SE', { timeZone: 'Africa/Casablanca' });
  const [, time] = s.split(' ');
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
}

Deno.serve(async (req: Request) => {
  const cors = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  // Vérifier le secret interne pour éviter les appels non autorisés
  const authHeader = req.headers.get('authorization') || '';
  const cronSecret = Deno.env.get('CRON_SECRET') || '';
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: 'Non autorisé' }, { status: 401, headers: cors });
  }

  const sbAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const today = todayMaroc();
  const nowMin = nowMinMaroc();

  // Récupérer tous les employés actifs
  const { data: employees } = await sbAdmin
    .from('sh_employees')
    .select('id, site_id, actif')
    .eq('actif', true);

  if (!employees?.length) return Response.json({ ok: true, marked: 0 }, { headers: cors });

  // Récupérer les pointages du jour
  const { data: pointages } = await sbAdmin
    .from('sh_pointage')
    .select('employee_id, type')
    .eq('date', today);

  // Récupérer les shifts du jour
  const { data: shifts } = await sbAdmin
    .from('sh_shifts')
    .select('employee_id, heure_arrivee, heure_debut_prevue')
    .eq('date', today);

  // Récupérer les horaires de base
  const { data: schedules } = await sbAdmin
    .from('sh_schedules')
    .select('employee_id, heure_debut');

  const ptgMap = new Map((pointages || []).map(p => [p.employee_id, p.type]));
  const shiftMap = new Map((shifts || []).map(s => [s.employee_id, s]));
  const schedMap = new Map((schedules || []).map(s => [s.employee_id, s]));

  let marked = 0;
  const toInsert = [];
  const toUpdate = [];

  for (const emp of employees) {
    const existingType = ptgMap.get(emp.id);
    if (existingType && SKIP_TYPES.includes(existingType)) continue;

    const shift = shiftMap.get(emp.id);
    if (shift?.heure_arrivee) continue; // déjà pointé

    // Heure prévue : sh_shifts priorité, sinon sh_schedules
    const plannedStart = shift?.heure_debut_prevue || schedMap.get(emp.id)?.heure_debut;
    if (!plannedStart) continue;

    const [ph, pm] = plannedStart.split(':').map(Number);
    if (nowMin < ph * 60 + pm + ABSENCE_DELAY_MIN) continue;

    marked++;
    if (existingType) {
      // Mettre à jour l'entrée existante
      toUpdate.push(emp.id);
    } else {
      // Créer une nouvelle entrée
      toInsert.push({
        id: uid(),
        employee_id: emp.id,
        site_id: emp.site_id,
        date: today,
        type: 'absence',
        notes: 'Absence auto – non pointé (2h)',
        created_by: 'auto_système',
        created_at: new Date().toISOString(),
        updated_by: null,
        updated_at: null,
      });
    }
  }

  if (toInsert.length > 0) {
    await sbAdmin.from('sh_pointage').insert(toInsert);
  }

  for (const empId of toUpdate) {
    await sbAdmin.from('sh_pointage')
      .update({ type: 'absence', notes: 'Absence auto – non pointé (2h)', updated_by: 'auto_système', updated_at: new Date().toISOString() })
      .eq('employee_id', empId)
      .eq('date', today);
  }

  console.log(`[auto-absence] ${today} — ${marked} absences marquées`);
  return Response.json({ ok: true, date: today, marked }, { headers: cors });
});
