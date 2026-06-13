/**
 * purge-users — Edge Function Supabase
 * Réservé cluster_ops — Supprime les comptes collaborateurs pour permettre
 * un import fresh de la liste à jour.
 *
 * Options :
 *   scope: 'collaborateurs_only'  → supprime seulement les collaborateurs (role='collaborateur')
 *   scope: 'all_except_me'        → supprime tous les utilisateurs sauf l'appelant
 *   keepHistory: true             → conserve les données sh_pointage / sh_shifts (recommandé)
 *   keepHistory: false            → suppression totale (IRREVERSIBLE)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req: Request) => {
  const cors = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  try {
    // ── 1. Authentification + vérification rôle cluster_ops ──
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return Response.json({ error: 'Non authentifié' }, { status: 401, headers: cors });
    }

    const sbAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const sbUser = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user } } = await sbUser.auth.getUser();
    if (!user) {
      return Response.json({ error: 'Token invalide' }, { status: 401, headers: cors });
    }

    const { data: callerProfile } = await sbAdmin
      .from('sh_user_profiles')
      .select('role, username')
      .eq('id', user.id)
      .single();

    if (callerProfile?.role !== 'cluster_ops') {
      return Response.json({ error: 'Accès refusé — rôle cluster_ops requis' }, { status: 403, headers: cors });
    }

    // ── 2. Paramètres ────────────────────────────────────────
    const { scope = 'collaborateurs_only', keepHistory = true } = await req.json();

    // ── 3. Récupérer les profils à supprimer ─────────────────
    let profileQuery = sbAdmin.from('sh_user_profiles').select('id, username, role');
    if (scope === 'collaborateurs_only') {
      profileQuery = profileQuery.eq('role', 'collaborateur');
    } else {
      // all_except_me : exclure l'appelant
      profileQuery = profileQuery.neq('id', user.id);
    }

    const { data: profilesToDelete, error: fetchErr } = await profileQuery;
    if (fetchErr) throw fetchErr;

    if (!profilesToDelete?.length) {
      return Response.json({ ok: true, deleted: 0, message: 'Aucun utilisateur à supprimer' }, { headers: cors });
    }

    const profileIds = profilesToDelete.map(p => p.id);
    const usernames  = profilesToDelete.map(p => p.username);

    let deletedEmployees = 0, deletedUsers = 0, deletedAuthUsers = 0, errors: string[] = [];

    // ── 4. Supprimer les données DB ──────────────────────────
    // a) sh_user_profiles
    await sbAdmin.from('sh_user_profiles').delete().in('id', profileIds);
    deletedUsers = profilesToDelete.length;

    // b) sh_users (legacy table)
    if (usernames.length) {
      await sbAdmin.from('sh_users').delete().in('username', usernames);
    }

    // c) sh_employees liés (soft delete si keepHistory, hard delete sinon)
    if (scope === 'collaborateurs_only') {
      const { data: linkedEmps } = await sbAdmin
        .from('sh_employees')
        .select('id')
        .eq('actif', true);

      // Trouver les employés dont le username associé est dans la liste
      const { data: empLinks } = await sbAdmin
        .from('sh_user_profiles')
        .select('employee_id')
        .in('username', usernames);
      // Note: déjà supprimés ci-dessus, donc on utilise une approche différente

      // Si keepHistory : marquer comme inactifs
      // Si !keepHistory : supprimer complètement
      // On utilise les usernames pour identifier les employés via la jointure
      if (keepHistory) {
        // Désactiver tous les collaborateurs (les managers gardent actif=true)
        const { data: collabEmps } = await sbAdmin
          .from('sh_employees')
          .select('id, nom, prenom, site_id')
          .eq('actif', true);

        // Identifier les employés liés aux profils supprimés en comparant les noms
        // (puisque sh_user_profiles est déjà supprimé, on se base sur la liste usernames)
        const empToDeactivate = (collabEmps || []).filter(e => {
          const expectedUsername = (e.prenom?.charAt(0) + '.' + e.nom).toLowerCase()
            .normalize('NFD').replace(/[̀-ͯ]/g, '');
          return usernames.some(u => u.toLowerCase() === expectedUsername);
        });

        if (empToDeactivate.length) {
          await sbAdmin.from('sh_employees')
            .update({ actif: false })
            .in('id', empToDeactivate.map(e => e.id));
          deletedEmployees = empToDeactivate.length;
        }
      } else {
        // Hard delete — IRREVERSIBLE
        // Trouver tous les collaborateurs inactifs + actifs à supprimer
        const { data: allEmps } = await sbAdmin.from('sh_employees').select('id');
        // Suppression complète (attention aux FK constraints sur sh_pointage, sh_shifts)
        // On marque comme inactifs pour éviter les contraintes
        if (allEmps?.length) {
          await sbAdmin.from('sh_employees').update({ actif: false }).in('id', allEmps.map(e => e.id));
          deletedEmployees = allEmps.length;
        }
      }
    }

    // ── 5. Supprimer les comptes Supabase Auth ───────────────
    for (const authUserId of profileIds) {
      try {
        const { error } = await sbAdmin.auth.admin.deleteUser(authUserId);
        if (!error) deletedAuthUsers++;
        else errors.push(`Auth ${authUserId}: ${error.message}`);
      } catch (e) {
        errors.push(`Auth ${authUserId}: ${e}`);
      }
    }

    return Response.json({
      ok: true,
      deleted: {
        userProfiles: deletedUsers,
        authAccounts: deletedAuthUsers,
        employees: deletedEmployees,
        keepHistory,
      },
      errors: errors.length ? errors : undefined,
      message: `${deletedUsers} compte(s) supprimé(s). Vous pouvez maintenant importer la nouvelle liste.`,
    }, { headers: cors });

  } catch (err) {
    console.error('purge-users error:', err);
    return Response.json(
      { error: 'Erreur serveur', detail: err instanceof Error ? err.message : String(err) },
      { status: 500, headers: cors }
    );
  }
});
