/**
 * auto-close-shifts — Edge Function Supabase
 *
 * Clôture automatiquement les shifts ouverts des jours précédents,
 * en respectant les shifts overnight (ex : 20h→08h le lendemain).
 *
 * Logique :
 *   - Pour chaque shift avec date < aujourd'hui, heure_arrivee non null, heure_depart null :
 *       • Shift NORMAL (fin > début en minutes) → clôture à heure_fin_prevue ou 23:59
 *       • Shift OVERNIGHT (fin < début, ex 20:00→08:00) dont date = hier :
 *           – Si heure actuelle Maroc < heure_fin_prevue → encore en cours, on ne touche pas
 *           – Si heure actuelle Maroc >= heure_fin_prevue → terminé, on clôture
 *       • Shift OVERNIGHT dont date < hier (2+ jours) → clôture dans tous les cas
 *
 * Cron Supabase Dashboard :
 *   Expression : 0 9 * * *   (09h00 UTC = 10h00 Maroc hiver / 11h00 été)
 *   → passe APRÈS la fin des shifts overnight (max 08h00)
 *   HTTP POST  : https://<project>.supabase.co/functions/v1/auto-close-shifts
 *   Header     : Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';

// ── Helpers timezone Maroc ──────────────────────────────────
function nowMaroc(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Africa/Casablanca' }).replace(' ', 'T');
}
function todayMaroc(): string { return nowMaroc().substring(0, 10); }
function timeMaroc(): string  { return nowMaroc().substring(11, 16); } // HH:MM

/** HH:MM → minutes depuis minuit */
function timeToMin(t: string): number {
  const [h, m] = (t || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Calcule durée en minutes entre arrivée et départ (gère passage minuit) */
function calcDuree(arrivee: string, depart: string, pauseMin = 0): number {
  let d = timeToMin(depart) - timeToMin(arrivee);
  if (d < 0) d += 1440; // passage minuit
  return Math.max(0, d - pauseMin);
}

/**
 * Détecte si un shift est overnight :
 * heure_fin_prevue (ou closeTime) < heure_arrivee en minutes
 * ex : arrivée 20:00, fin 08:00 → 480 < 1200 → overnight
 */
function isOvernight(arrivee: string, fin: string): boolean {
  return timeToMin(fin) < timeToMin(arrivee);
}

/**
 * Date du jour précédent (YYYY-MM-DD) en timezone Maroc.
 */
function yesterdayMaroc(): string {
  const ms = Date.now() - 24 * 3600 * 1000;
  return new Date(ms).toLocaleString('sv-SE', { timeZone: 'Africa/Casablanca' }).substring(0, 10);
}

// ── Handler ─────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  const cors = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  try {
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return Response.json({ error: 'Non autorisé' }, { status: 401, headers: cors });
    }

    const sbAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const today     = todayMaroc();
    const yesterday = yesterdayMaroc();
    const serverNow = nowMaroc();
    const currentTimeMin = timeToMin(timeMaroc()); // minutes depuis minuit

    // Tous les shifts ouverts des jours précédents
    const { data: openShifts, error: fetchErr } = await sbAdmin
      .from('sh_shifts')
      .select('*')
      .not('heure_arrivee', 'is', null)
      .is('heure_depart', null)
      .lt('date', today);

    if (fetchErr) throw fetchErr;

    if (!openShifts || openShifts.length === 0) {
      return Response.json({ ok: true, closed: 0, skipped: 0, message: 'Aucun shift ouvert à clôturer' }, { headers: cors });
    }

    const results = [];

    for (const shift of openShifts) {
      const closeTime: string = shift.heure_fin_prevue || '23:59';
      const overnight = isOvernight(shift.heure_arrivee, closeTime);

      // Shift overnight de la veille → vérifier que l'heure de fin est passée
      if (overnight && shift.date === yesterday) {
        const finMin = timeToMin(closeTime);
        if (currentTimeMin < finMin) {
          // Encore en cours (ex : il est 06h00, shift finit à 08h00)
          console.log(`Shift overnight ${shift.id} (${shift.date} ${shift.heure_arrivee}→${closeTime}) encore en cours — ignoré`);
          results.push({ id: shift.id, date: shift.date, status: 'skipped', reason: 'overnight en cours', heure_fin_prevue: closeTime });
          continue;
        }
        // Heure de fin passée → on clôture
      }
      // Pour un shift overnight de J-2 ou plus → clôture dans tous les cas
      // Pour un shift normal → clôture dans tous les cas

      const duree = calcDuree(shift.heure_arrivee, closeTime, shift.pause_minutes || 0);

      const { error: updErr } = await sbAdmin
        .from('sh_shifts')
        .update({
          heure_depart:  closeTime,
          duree_minutes: duree,
          updated_by:    'auto-close',
          updated_at:    serverNow,
        })
        .eq('id', shift.id);

      if (updErr) {
        console.error(`Erreur clôture shift ${shift.id}:`, updErr.message);
        results.push({ id: shift.id, date: shift.date, employee_id: shift.employee_id, status: 'error', error: updErr.message });
      } else {
        const type = overnight ? 'overnight' : 'normal';
        console.log(`[${type}] Shift ${shift.id} (${shift.date}) clôturé à ${closeTime}`);
        results.push({ id: shift.id, date: shift.date, employee_id: shift.employee_id, status: 'closed', type, heure_depart: closeTime, duree });
      }
    }

    const closed  = results.filter(r => r.status === 'closed').length;
    const skipped = results.filter(r => r.status === 'skipped').length;
    const errors  = results.filter(r => r.status === 'error').length;

    return Response.json({ ok: true, closed, skipped, errors, total: openShifts.length, details: results }, { headers: cors });

  } catch (err) {
    console.error('auto-close-shifts error:', err);
    return Response.json(
      { error: 'Erreur serveur', detail: err instanceof Error ? err.message : String(err) },
      { status: 500, headers: cors }
    );
  }
});
