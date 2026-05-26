/**
 * clock-action — Edge Function Supabase
 * Phase 3 : Validation serveur du pointage
 *
 * Remplace les appels directs à sh_shifts depuis le browser.
 * Avantages :
 *   - Géofence validée côté serveur (impossible à spoofer)
 *   - Timestamps générés par le serveur (non falsifiables)
 *   - Service role key jamais exposée au client
 *
 * Usage :
 *   POST /functions/v1/clock-action
 *   Authorization: Bearer <supabase_jwt>
 *   Body: { action: 'start'|'stop'|'pause'|'resume', latitude?, longitude? }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

// ── Haversine (côté serveur) ────────────────────────────────
function haversineDistance(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371000;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Heure locale Maroc ──────────────────────────────────────
function nowMaroc(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Africa/Casablanca' }).replace(' ', 'T');
}
function todayMaroc(): string {
  return nowMaroc().substring(0, 10);
}
function yesterdayMaroc(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toLocaleString('sv-SE', { timeZone: 'Africa/Casablanca' }).substring(0, 10);
}
function timeMaroc(): string {
  return nowMaroc().substring(11, 16);
}

// ── Convertit HH:MM en minutes depuis minuit ───────────────
function timeToMin(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

// ── Vérifie si l'heure actuelle est dans la fenêtre d'un shift ──
// Gère les shifts overnight (ex : Soir 16:00 → 00:00)
// Fenêtre : 30 min avant le début jusqu'à la fin du shift
function isInShiftWindow(currentTime: string, debut: string, fin: string): boolean {
  const now     = timeToMin(currentTime);
  const start   = timeToMin(debut);
  const end     = fin === '00:00' ? 24 * 60 : timeToMin(fin); // minuit = 1440
  const windowStart = start - 30;  // peut pointer 30 min avant

  if (end > start) {
    // Shift normal (pas overnight)
    return now >= windowStart && now < end;
  } else {
    // Shift overnight (ex 16:00 → 00:00 → next day)
    return now >= windowStart || now < end;
  }
}

// ── Handler principal ───────────────────────────────────────
Deno.serve(async (req: Request) => {

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ── 1. Authentification JWT ──────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return Response.json({ error: 'Non authentifié' }, { status: 401, headers: corsHeaders });
    }
    const userToken = authHeader.replace('Bearer ', '');

    // Client avec le token de l'utilisateur (pour valider son identité)
    const sbUser = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: `Bearer ${userToken}` } } }
    );

    // Client avec le service role key (pour écrire en base avec les privileges)
    const sbAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Vérifier que le token est valide
    const { data: { user }, error: authError } = await sbUser.auth.getUser();
    if (authError || !user) {
      return Response.json({ error: 'Token invalide' }, { status: 401, headers: corsHeaders });
    }

    // ── 2. Récupérer le profil utilisateur ───────────────────
    const { data: profile, error: profError } = await sbAdmin
      .from('sh_user_profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (profError || !profile) {
      return Response.json({ error: 'Profil utilisateur introuvable' }, { status: 403, headers: corsHeaders });
    }

    if (!profile.acces_horloge) {
      return Response.json({ error: 'Accès à l\'horloge non autorisé' }, { status: 403, headers: corsHeaders });
    }

    const empId = profile.employee_id;
    if (!empId) {
      return Response.json({ error: 'Aucun employé lié à ce compte' }, { status: 403, headers: corsHeaders });
    }

    // ── 3. Parser le body de la requête ─────────────────────
    const body = await req.json();
    const { action, latitude, longitude } = body;

    if (!['start', 'stop', 'pause', 'resume'].includes(action)) {
      return Response.json({ error: 'Action invalide' }, { status: 400, headers: corsHeaders });
    }

    // ── 4. Récupérer le site effectif (avec détachement temp) ─
    const today = todayMaroc();

    // Vérifier si détachement temporaire actif
    const { data: tempAssign } = await sbAdmin
      .from('sh_temp_assignments')
      .select('site_id_temp')
      .eq('employee_id', empId)
      .lte('date_debut', today)
      .gte('date_fin', today)
      .is('ended_at', null)
      .maybeSingle();

    const { data: employee } = await sbAdmin
      .from('sh_employees')
      .select('site_id, pointage_horaire, has_rotation, require_gps, sites_secondaires')
      .eq('id', empId)
      .single();

    if (!employee) {
      return Response.json({ error: 'Employé introuvable' }, { status: 404, headers: corsHeaders });
    }

    const effectiveSiteId = tempAssign?.site_id_temp ?? employee.site_id;

    // ── 5. Vérifier le planning (jour OFF = blocage) ──────────
    const { data: planning } = await sbAdmin
      .from('sh_pointage')
      .select('type')
      .eq('employee_id', empId)
      .eq('date', today)
      .maybeSingle();

    if (planning?.type === 'off') {
      return Response.json(
        { error: 'Jour de repos — pointage impossible' },
        { status: 403, headers: corsHeaders }
      );
    }

    // ── 5b. Planning rotatif : validation fenêtre horaire ────
    let rotationShiftDebut: string | null = null;
    let rotationShiftFin: string | null   = null;

    if (employee.has_rotation && action === 'start') {
      // Récupérer le shift prévu pour aujourd'hui depuis sh_weekly_schedule
      const { data: weeklyEntry } = await sbAdmin
        .from('sh_weekly_schedule')
        .select('shift_type_id, is_off')
        .eq('employee_id', empId)
        .eq('date', today)
        .maybeSingle();

      if (weeklyEntry?.is_off) {
        return Response.json(
          { error: 'Jour de repos selon votre planning. Pointage impossible.' },
          { status: 403, headers: corsHeaders }
        );
      }

      if (weeklyEntry?.shift_type_id) {
        // Cas normal : sh_weekly_schedule a un type de shift
        const { data: shiftType } = await sbAdmin
          .from('sh_shift_types')
          .select('nom, heure_debut, heure_fin')
          .eq('id', weeklyEntry.shift_type_id)
          .single();

        if (shiftType) {
          const currentTime = timeMaroc();
          if (!isInShiftWindow(currentTime, shiftType.heure_debut, shiftType.heure_fin)) {
            const finLabel = shiftType.heure_fin === '00:00' ? '00:00' : shiftType.heure_fin;
            return Response.json(
              {
                error: `Hors de votre fenêtre de pointage. Shift ${shiftType.nom} : ${shiftType.heure_debut}–${finLabel}. Vous pouvez pointer à partir de ${String(Math.floor((timeToMin(shiftType.heure_debut) - 30) / 60) % 24).padStart(2,'0')}:${String((timeToMin(shiftType.heure_debut) - 30) % 60).padStart(2,'0')}.`,
              },
              { status: 403, headers: corsHeaders }
            );
          }
          rotationShiftDebut = shiftType.heure_debut;
          rotationShiftFin   = shiftType.heure_fin;
        }
      } else if (!weeklyEntry) {
        // Pas de sh_weekly_schedule → fallback : chercher un shift pré-rempli dans sh_shifts
        // (créé par la synchro de la page Shifts rotatifs)
        const { data: plannedShift } = await sbAdmin
          .from('sh_shifts')
          .select('heure_debut_prevue, heure_fin_prevue')
          .eq('employee_id', empId)
          .eq('date', today)
          .is('heure_arrivee', null)
          .maybeSingle();

        if (plannedShift?.heure_debut_prevue) {
          // Utiliser les horaires du shift pré-rempli pour la validation de fenêtre
          const currentTime = timeMaroc();
          const debut = plannedShift.heure_debut_prevue;
          const fin   = plannedShift.heure_fin_prevue || '23:59';
          if (!isInShiftWindow(currentTime, debut, fin)) {
            return Response.json(
              { error: `Hors de votre fenêtre de pointage. Shift prévu : ${debut}–${fin}.` },
              { status: 403, headers: corsHeaders }
            );
          }
          rotationShiftDebut = debut;
          rotationShiftFin   = fin;
        } else {
          return Response.json(
            { error: 'Aucun shift programmé pour aujourd\'hui. Contactez votre responsable.' },
            { status: 403, headers: corsHeaders }
          );
        }
      }
      // Si weeklyEntry existe mais sans shift_type_id ni is_off → on laisse pointer librement
    }

    // ── 6. Vérification géofence SERVEUR ─────────────────────
    // Ignorée si l'employé est en télétravail (require_gps === false)
    // Pour les collaborateurs multi-sites, on vérifie contre TOUS leurs sites autorisés.
    // Le premier site dans le rayon devient le site effectif du shift.
    let matchedSiteId: string | null = null; // site GPS validé (peut différer du site principal)

    if (employee.require_gps !== false) {
      // Construire la liste des sites à vérifier :
      // Si détachement actif → uniquement le site de détachement
      // Sinon → site principal + sites secondaires
      const sitesToCheck: string[] = tempAssign?.site_id_temp
        ? [tempAssign.site_id_temp]
        : [
            ...(employee.site_id ? [employee.site_id] : []),
            ...(Array.isArray(employee.sites_secondaires) ? employee.sites_secondaires : []),
          ];

      if (sitesToCheck.length > 0) {
        if (latitude == null || longitude == null) {
          return Response.json(
            { error: 'Position GPS requise pour pointer' },
            { status: 400, headers: corsHeaders }
          );
        }

        // Charger les coordonnées de tous les sites à vérifier en une seule requête
        const { data: sitesData } = await sbAdmin
          .from('sh_sites')
          .select('id, nom, latitude, longitude, geofence_radius')
          .in('id', sitesToCheck);

        // Chercher le site le plus proche dans le rayon autorisé
        let closestDist = Infinity;
        let closestSite: { id: string; nom: string; geofence_radius: number } | null = null;

        for (const site of sitesData ?? []) {
          if (!site.latitude || !site.longitude) continue;
          const dist = haversineDistance(
            Number(latitude), Number(longitude),
            Number(site.latitude), Number(site.longitude)
          );
          const radius = (site.geofence_radius != null ? Number(site.geofence_radius) : 0) || 100;
          if (dist <= radius && dist < closestDist) {
            closestDist = dist;
            closestSite = site;
          }
        }

        if (!closestSite) {
          // Calculer la distance minimale pour le message d'erreur
          let minDist = Infinity;
          let minRadius = 50;
          for (const site of sitesData ?? []) {
            if (!site.latitude || !site.longitude) continue;
            const dist = haversineDistance(
              Number(latitude), Number(longitude),
              Number(site.latitude), Number(site.longitude)
            );
            const siteRadius = (site.geofence_radius != null ? Number(site.geofence_radius) : 0) || 100;
          if (dist < minDist) { minDist = dist; minRadius = siteRadius; }
          }
          const siteCount = sitesToCheck.length;
          const msg = siteCount > 1
            ? `Vous n'êtes sur aucun de vos ${siteCount} sites autorisés. Site le plus proche : ${Math.round(minDist)}m (rayon autorisé : ${minRadius}m).`
            : `Vous êtes à ${Math.round(minDist)}m de votre site. Rapprochez-vous à moins de ${minRadius}m pour pointer.`;
          return Response.json(
            { error: msg, distanceMeters: Math.round(minDist), radiusMeters: minRadius },
            { status: 403, headers: corsHeaders }
          );
        }

        matchedSiteId = closestSite.id;
      }
    }

    // ── 7a. Auto-clôture des shifts ouverts des jours précédents ──
    // Quand un collaborateur démarre un nouveau shift, on clôture tous ses
    // shifts ouverts des jours précédents.
    //
    // CAS OVERNIGHT (ex 20h→08h) : si le shift d'hier n'a pas encore atteint
    // son heure de fin (il est 06h00, fin prévue 08h00), on le clôture quand
    // même à l'heure actuelle car le collaborateur démarre explicitement un
    // nouveau shift — cela signifie qu'il est disponible.
    if (action === 'start') {
      const { data: staleShifts } = await sbAdmin
        .from('sh_shifts')
        .select('*')
        .eq('employee_id', empId)
        .not('heure_arrivee', 'is', null)
        .is('heure_depart', null)
        .lt('date', today); // jours STRICTEMENT antérieurs

      for (const stale of staleShifts ?? []) {
        const finPrevue = stale.heure_fin_prevue || null;
        // Détecter shift overnight : heure_fin_prevue < heure_arrivee en minutes
        const isOvernightStale = finPrevue
          ? timeToMin(finPrevue) < timeToMin(stale.heure_arrivee)
          : false;

        // Pour un shift overnight dont la fin est prévue dans le futur,
        // on clôture à l'heure actuelle (collaborateur pointe explicitement un nouveau shift)
        // Pour les autres cas, on clôture à heure_fin_prevue ou '23:59'
        const currentTime = timeMaroc();
        let closeTime: string;
        if (isOvernightStale && finPrevue && timeToMin(currentTime) < timeToMin(finPrevue)) {
          closeTime = currentTime; // encore en cours théoriquement, on coupe maintenant
        } else {
          closeTime = finPrevue || '23:59';
        }

        const [ah, am] = stale.heure_arrivee.split(':').map(Number);
        const [dh, dm] = closeTime.split(':').map(Number);
        let dureeMin = (dh * 60 + dm) - (ah * 60 + am);
        if (dureeMin < 0) dureeMin += 1440;
        dureeMin = Math.max(0, dureeMin - (stale.pause_minutes || 0));

        await sbAdmin
          .from('sh_shifts')
          .update({
            heure_depart:  closeTime,
            duree_minutes: dureeMin,
            updated_by:    'auto-close',
            updated_at:    nowMaroc(),
          })
          .eq('id', stale.id);

        console.log(`Auto-clôture shift ${stale.id} (${stale.date} ${stale.heure_arrivee}→${closeTime}${isOvernightStale ? ' [overnight]' : ''})`);
      }
    }

    // ── 7b. Récupérer le shift du jour (+ shift overnight d'hier) ─
    const { data: shiftTodayData } = await sbAdmin
      .from('sh_shifts')
      .select('*')
      .eq('employee_id', empId)
      .eq('date', today)
      .maybeSingle();

    // Pour les shifts overnight (ex: 20h→08h) : si pas de shift actif aujourd'hui,
    // on cherche un shift ouvert d'hier (heure_arrivee définie, pas de heure_depart).
    // Cela évite qu'à minuit l'agent ne puisse plus pointer la sortie de son shift de nuit.
    let existingShift = shiftTodayData;
    let shiftDate = today; // date du shift actif, utilisée pour les mises à jour
    if (!shiftTodayData?.heure_arrivee && action !== 'start') {
      const yesterday = yesterdayMaroc();
      const { data: overnightShift } = await sbAdmin
        .from('sh_shifts')
        .select('*')
        .eq('employee_id', empId)
        .eq('date', yesterday)
        .not('heure_arrivee', 'is', null)
        .is('heure_depart', null)
        .maybeSingle();
      if (overnightShift) {
        existingShift = overnightShift;
        shiftDate = yesterday;
      }
    }

    const serverTime = timeMaroc();    // HH:MM — généré côté serveur
    const serverNow  = nowMaroc();     // ISO datetime — généré côté serveur

    // ── 8. Exécuter l'action ─────────────────────────────────
    let result: Record<string, unknown>;

    if (action === 'start') {
      if (existingShift?.heure_arrivee) {
        return Response.json({ error: 'Shift déjà démarré' }, { status: 409, headers: corsHeaders });
      }

      // Utiliser le site GPS validé si disponible, sinon le site effectif (détachement ou principal)
      const shiftSiteId = matchedSiteId ?? effectiveSiteId;

      const shiftData: Record<string, unknown> = {
        id: `sh_${empId}_${today}`,
        employee_id: empId,
        site_id: shiftSiteId,
        date: today,
        heure_arrivee: serverTime,    // ← timestamp serveur
        created_by: profile.username,
        created_at: serverNow,        // ← timestamp serveur
        updated_by: profile.username,
        updated_at: serverNow,
      };
      // Renseigner les horaires prévus si shift rotatif
      if (rotationShiftDebut) shiftData.heure_debut_prevue = rotationShiftDebut;
      if (rotationShiftFin)   shiftData.heure_fin_prevue   = rotationShiftFin;

      const { data, error } = await sbAdmin
        .from('sh_shifts')
        .upsert(shiftData, { onConflict: 'employee_id,date' })
        .select()
        .single();

      if (error) throw error;
      result = { shift: data, serverTime };

    } else if (action === 'stop') {
      if (!existingShift?.heure_arrivee) {
        return Response.json({ error: 'Aucun shift en cours' }, { status: 409, headers: corsHeaders });
      }

      // Calculer durée en minutes
      const [ah, am] = existingShift.heure_arrivee.split(':').map(Number);
      const [dh, dm] = serverTime.split(':').map(Number);
      let dureeMin = (dh * 60 + dm) - (ah * 60 + am);
      if (dureeMin < 0) dureeMin += 1440; // passage minuit
      dureeMin -= (existingShift.pause_minutes || 0);

      // Calculer retard
      let retardMin = 0;
      if (existingShift.heure_debut_prevue) {
        const [ph, pm] = existingShift.heure_debut_prevue.split(':').map(Number);
        retardMin = Math.max(0, (ah * 60 + am) - (ph * 60 + pm));
      }

      const { data, error } = await sbAdmin
        .from('sh_shifts')
        .update({
          heure_depart: serverTime,   // ← timestamp serveur
          duree_minutes: dureeMin,
          retard_minutes: retardMin,
          updated_by: profile.username,
          updated_at: serverNow,      // ← timestamp serveur
        })
        .eq('employee_id', empId)
        .eq('date', shiftDate)        // ← shiftDate gère les shifts overnight
        .select()
        .single();

      if (error) throw error;
      result = { shift: data, serverTime, dureeMinutes: dureeMin };

    } else if (action === 'pause') {
      if (!existingShift?.heure_arrivee || existingShift?.heure_depart) {
        return Response.json({ error: 'Impossible de mettre en pause' }, { status: 409, headers: corsHeaders });
      }

      // Stocker l'heure de début de pause dans updated_at (réutilisé temporairement)
      const { data, error } = await sbAdmin
        .from('sh_shifts')
        .update({
          updated_by: `pause:${serverTime}`,  // convention pour stocker heure pause
          updated_at: serverNow,
        })
        .eq('employee_id', empId)
        .eq('date', shiftDate)        // ← shiftDate gère les shifts overnight
        .select()
        .single();

      if (error) throw error;
      result = { shift: data, serverTime };

    } else { // resume
      if (!existingShift) {
        return Response.json({ error: 'Aucun shift en cours' }, { status: 409, headers: corsHeaders });
      }

      // Calculer durée de pause
      let pauseAdd = 0;
      if (existingShift.updated_by?.startsWith('pause:')) {
        const pauseStart = existingShift.updated_by.replace('pause:', '');
        const [ph, pm] = pauseStart.split(':').map(Number);
        const [rh, rm] = serverTime.split(':').map(Number);
        pauseAdd = Math.max(0, (rh * 60 + rm) - (ph * 60 + pm));
      }

      const { data, error } = await sbAdmin
        .from('sh_shifts')
        .update({
          pause_minutes: (existingShift.pause_minutes || 0) + pauseAdd,
          updated_by: profile.username,
          updated_at: serverNow,
        })
        .eq('employee_id', empId)
        .eq('date', shiftDate)        // ← shiftDate gère les shifts overnight
        .select()
        .single();

      if (error) throw error;
      result = { shift: data, serverTime, pauseMinutes: (existingShift.pause_minutes || 0) + pauseAdd };
    }

    return Response.json({ ok: true, ...result }, { headers: corsHeaders });

  } catch (err) {
    console.error('clock-action error:', err);
    return Response.json(
      { error: 'Erreur serveur', detail: err instanceof Error ? err.message : String(err) },
      { status: 500, headers: corsHeaders }
    );
  }
});
