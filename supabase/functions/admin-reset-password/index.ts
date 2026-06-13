/**
 * admin-reset-password — Edge Function Supabase
 * Permet à un cluster_ops de réinitialiser le mot de passe d'un autre utilisateur
 * Utilise le service role key (jamais exposé au client)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req: Request) => {
  const cors = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  try {
    // ── 1. Vérifier que l'appelant est authentifié ────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return Response.json({ error: 'Non authentifié' }, { status: 401, headers: cors });
    }
    const userToken = authHeader.replace('Bearer ', '');

    const sbUser = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: `Bearer ${userToken}` } } }
    );

    const { data: { user }, error: authError } = await sbUser.auth.getUser();
    if (authError || !user) {
      return Response.json({ error: 'Token invalide' }, { status: 401, headers: cors });
    }

    // ── 2. Vérifier que l'appelant est cluster_ops ─────────────
    const sbAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: callerProfile } = await sbAdmin
      .from('sh_user_profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (callerProfile?.role !== 'cluster_ops') {
      return Response.json({ error: 'Accès refusé — rôle cluster_ops requis' }, { status: 403, headers: cors });
    }

    // ── 3. Parser la requête ──────────────────────────────────
    const { targetUsername, newPassword } = await req.json();
    if (!targetUsername || !newPassword) {
      return Response.json({ error: 'targetUsername et newPassword requis' }, { status: 400, headers: cors });
    }
    if (newPassword.length < 6) {
      return Response.json({ error: 'Le mot de passe doit contenir au moins 6 caractères' }, { status: 400, headers: cors });
    }

    // ── 4. Trouver l'utilisateur cible ────────────────────────
    const email = targetUsername.toLowerCase() + '@stayhere.internal';
    const { data: { users }, error: listErr } = await sbAdmin.auth.admin.listUsers();
    if (listErr) throw listErr;

    const targetUser = users.find(u => u.email === email);
    if (!targetUser) {
      return Response.json({ error: `Utilisateur '${targetUsername}' introuvable` }, { status: 404, headers: cors });
    }

    // ── 5. Mettre à jour le mot de passe via Admin API ────────
    const { error: updateErr } = await sbAdmin.auth.admin.updateUserById(
      targetUser.id,
      { password: newPassword }
    );
    if (updateErr) throw updateErr;

    return Response.json({ ok: true, message: `Mot de passe de ${targetUsername} réinitialisé` }, { headers: cors });

  } catch (err) {
    console.error('admin-reset-password error:', err);
    return Response.json(
      { error: 'Erreur serveur', detail: err instanceof Error ? err.message : String(err) },
      { status: 500, headers: cors }
    );
  }
});
