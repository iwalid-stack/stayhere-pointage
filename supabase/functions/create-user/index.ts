/**
 * create-user — Edge Function Supabase
 *
 * Crée un compte utilisateur complet :
 *   1. Vérifie que l'appelant est authentifié avec le rôle cluster_ops
 *   2. Crée le compte Supabase Auth (email = username@stayhere.internal)
 *   3. Crée sh_user_profiles
 *   4. Insère dans sh_users (legacy, pour compatibilité auto-migrate)
 *
 * Appelée depuis l'app admin lors de l'import Excel ou de la création manuelle.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

// SHA-256 côté Deno
async function sha256(str: string): Promise<string> {
  const buf = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ── 1. Vérifier que l'appelant est authentifié ────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return Response.json({ error: 'Non authentifié' }, { status: 401, headers: corsHeaders });
    }
    const userToken = authHeader.replace('Bearer ', '');

    const sbAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Vérifier le token de l'appelant
    const { data: { user: caller }, error: authErr } = await sbAdmin.auth.getUser(userToken);
    if (authErr || !caller) {
      return Response.json({ error: 'Token invalide' }, { status: 401, headers: corsHeaders });
    }

    // ── 2. Vérifier que l'appelant est cluster_ops ─────────────
    const { data: callerProfile } = await sbAdmin
      .from('sh_user_profiles')
      .select('role')
      .eq('id', caller.id)
      .single();

    if (callerProfile?.role !== 'cluster_ops') {
      return Response.json({ error: 'Accès refusé — rôle cluster_ops requis' }, { status: 403, headers: corsHeaders });
    }

    // ── 3. Parser la requête ──────────────────────────────────
    const {
      id: clientId,
      username,
      password,
      nom,
      role = 'collaborateur',
      site_id = null,
      employee_id = null,
      acces_horloge = true,
      acces_principal = false,
    } = await req.json();

    if (!username || !password || !nom) {
      return Response.json({ error: 'username, password et nom requis' }, { status: 400, headers: corsHeaders });
    }

    const email = username.toLowerCase() + '@stayhere.internal';

    // ── 4. Vérifier si le compte Auth existe déjà ─────────────
    const { data: { users: existingUsers } } = await sbAdmin.auth.admin.listUsers({ perPage: 1000 });
    const existingUser = existingUsers.find(u => u.email === email);

    let authUserId: string;

    if (existingUser) {
      // Compte déjà créé — mettre à jour le mot de passe
      authUserId = existingUser.id;
      await sbAdmin.auth.admin.updateUserById(authUserId, { password });
    } else {
      // ── 5. Créer le compte Supabase Auth ────────────────────
      const { data: newUser, error: createErr } = await sbAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { username: username.toLowerCase(), nom },
      });

      if (createErr) {
        console.error('Erreur création Auth:', createErr);
        return Response.json({ error: 'Erreur création compte Auth: ' + createErr.message }, { status: 500, headers: corsHeaders });
      }
      authUserId = newUser.user.id;
    }

    // ── 6. Créer / mettre à jour sh_user_profiles ─────────────
    const { error: profileErr } = await sbAdmin.from('sh_user_profiles').upsert({
      id: authUserId,
      username: username.toLowerCase(),
      nom,
      role,
      site_id: site_id || null,
      employee_id: employee_id || null,
      acces_horloge: acces_horloge !== false,
      acces_principal: acces_principal === true,
    }, { onConflict: 'id' });

    if (profileErr) {
      console.error('Erreur profil:', profileErr);
      // Nettoyer si c'est un nouveau compte
      if (!existingUser) await sbAdmin.auth.admin.deleteUser(authUserId);
      return Response.json({ error: 'Erreur création profil: ' + profileErr.message }, { status: 500, headers: corsHeaders });
    }

    // ── 7. Insérer / mettre à jour sh_users (legacy) ──────────
    const password_hash = await sha256(password);
    const legacyId = clientId || authUserId; // utiliser l'id fourni par le client ou l'UUID Auth

    await sbAdmin.from('sh_users').upsert({
      id: legacyId,
      username: username.toLowerCase(),
      password_hash,
      nom,
      role,
      site_id: site_id || null,
      employee_id: employee_id || null,
      acces_horloge: acces_horloge !== false,
      acces_principal: acces_principal === true,
    }, { onConflict: 'username' });
    // Note : on ignore les erreurs de sh_users car ce n'est plus la source de vérité

    return Response.json({
      ok: true,
      user_id: authUserId,
      created: !existingUser,
    }, { headers: corsHeaders });

  } catch (err) {
    console.error('create-user error:', err);
    return Response.json(
      { error: 'Erreur serveur', detail: err instanceof Error ? err.message : String(err) },
      { status: 500, headers: corsHeaders }
    );
  }
});
