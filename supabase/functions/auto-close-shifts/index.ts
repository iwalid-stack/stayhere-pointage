/**
 * auto-close-shifts — Edge Function Supabase
 *
 * Clôture automatiquement les shifts ouverts des jours précédents.
 * À appeler via un cron Supabase (ex : tous les jours à 02h00 Maroc).
 *
 * Peut aussi être appelée manuellement depuis l'admin (avec Bearer token admin).
 *
 * Logique :
 *   - Cherche tous les sh_shifts avec heure_arrivee non null et heure_depart null
 *     dont la date est STRICTEMENT antérieure à aujourd'hui (heure Maroc)
 *   - Les clôture avec heure_depart = heure_fin_prevue ?? '23:59'
 *   - Calcule duree_minutes correctement
 *   - Marque updated_by = 'auto-close'
 *
 * Usage cron Supabase Dashboard :
 *   Schedule → New cron job
 *   Expression : 0 2 * * *   (02h00 UTC = 02h00-03h00 Maroc selon heure d'été)
 *   HTTP POST  : https://<project>.supabase.co/functions/v1/auto-close-shifts
 *   Header     : Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

function nowMaroc(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Africa/Casablanca' }).replace(' ', 'T');
}
function todayMaroc(): string {
  return nowMaroc().substring(0, 10);
}

/** HH:MM → minutes depuis minuit */
function timeToMin(t: string): number {
  const [h, m] = (t || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Calcule durée en minutes entre arrivée et départ (gère passage minuit) */
function calcDuree(arrivee: string, depart: string, pauseMin: number = 0): number {
  let d = timeToMin(depart) - timeToMin(arrivee);
  if (d < 0) d += 1440; // passage minuit
  return Math.max(0, d - pauseMin);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Accepte soit le service role key directement, soit un token admin
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return Response.json({ error: 'Non autorisé' }, { status: 401, headers: corsHeaders });
    }

    const sbAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const today = todayMaroc();
    const serverNow = nowMaroc();

    // Récupérer tous les shifts ouverts des jours précédents
    const { data: openShifts, error: fetchErr } = await sbAdmin
      .from('sh_shifts')
      .select('*')
      .not('heure_arrivee', 'is', null)
      .is('heure_depart', null)
      .lt('date', today); // date strictement antérieure à aujourd'hui

    if (fetchErr) throw fetchErr;

    if (!openShifts || openShifts.length === 0) {
      return Response.json(
        { ok: true, closed: 0, message: 'Aucun shift ouvert à clôturer' },
        { headers: corsHeaders }
      );
    }

    // Clôturer chaque shift
    const results = [];
    for (const shift of openShifts) {
      // Heure de clôture = heure_fin_prevue si disponible, sinon '23:59'
      const closeTime: string = shift.heure_fin_prevue || '23:59';
      const duree = calcDuree(shift.heure_arrivee, closeTime, shift.pause_minutes || 0);

      const { error: updErr } = await sbAdmin
        .from('sh_shifts')
        .update({
          heure_depart: closeTime,
          duree_minutes: duree,
          updated_by: 'auto-close',
          updated_at: serverNow,
        })
        .eq('id', shift.id);

      if (updErr) {
        console.error(`Erreur clôture shift ${shift.id}:`, updErr.message);
        results.push({ id: shift.id, date: shift.date, employee_id: shift.employee_id, status: 'error', error: updErr.message });
      } else {
        console.log(`Shift ${shift.id} (${shift.date}) clôturé à ${closeTime}`);
        results.push({ id: shift.id, date: shift.date, employee_id: shift.employee_id, status: 'closed', heure_depart: closeTime, duree });
      }
    }

    const closed = results.filter(r => r.status === 'closed').length;
    const errors = results.filter(r => r.status === 'error').length;

    return Response.json(
      { ok: true, closed, errors, total: openShifts.length, details: results },
      { headers: corsHeaders }
    );

  } catch (err) {
    console.error('auto-close-shifts error:', err);
    return Response.json(
      { error: 'Erreur serveur', detail: err instanceof Error ? err.message : String(err) },
      { status: 500, headers: corsHeaders }
    );
  }
});
