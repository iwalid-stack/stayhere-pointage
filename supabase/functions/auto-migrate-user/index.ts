/**
 * auto-migrate-user — Edge Function Supabase
 *
 * Migration silencieuse lors du premier login d'un utilisateur.
 * Appelée uniquement quand signInWithPassword() échoue (= utilisateur pas encore migré).
 *
 * Flux :
 *   1. Valide username + password contre sh_users (SHA-256 legacy)
 *   2. Si valide → crée le compte Supabase Auth (username@stayhere.internal)
 *   3. Crée sh_user_profiles avec les données de sh_users
 *   4. Retourne une session Supabase Auth utilisable immédiatement
 *
 * Après ce premier passage, tous les logins suivants passent directement
 * par SB.auth.signInWithPassword() sans passer ici.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';

const MAX_ATTEMPTS = 5;
const WINDOW_MINUTES = 15;

async function sha256(str: string): Promise<string> {
  const buf = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Comparaison en temps constant pour éviter les timing attacks
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  let result = 0;
  for (let i = 0; i < aBytes.length; i++) result |= aBytes[i] ^ bBytes[i];
  return result === 0;
}

Deno.serve(async (req: Request) => {
  const cors = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  try {
    const { username, password } = await req.json();

    if (!username || !password) {
      return Response.json({ error: 'username et password requis' }, { status: 400, headers: cors });
    }

    const sbAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // ── Rate limiting : max 5 tentatives échouées par 15 min ──
    const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();
    const { count } = await sbAdmin
      .from('sh_auth_attempts')
      .select('*', { count: 'exact', head: true })
      .eq('username', username.toLowerCase())
      .eq('success', false)
      .gte('created_at', windowStart);

    if ((count ?? 0) >= MAX_ATTEMPTS) {
      return Response.json(
        { error: 'Trop de tentatives. Réessayez dans 15 minutes.' },
        { status: 429, headers: cors }
      );
    }

    // ── 1. Récupérer l'utilisateur legacy (sans filtrer sur le hash) ──
    const { data: legacyUser, error: legacyErr } = await sbAdmin
      .from('sh_users')
      .select('*')
      .eq('username', username.toLowerCase())
      .maybeSingle();

    // Calcul du hash dans tous les cas (évite early-return timing leak)
    const hash = await sha256(password);
    const hashRef = legacyUser?.password_hash ?? '0'.repeat(64);
    const passwordOk = !legacyErr && !!legacyUser && timingSafeEqual(hash, hashRef);

    // Enregistrer la tentative
    await sbAdmin.from('sh_auth_attempts').insert({
      username: username.toLowerCase(),
      success: passwordOk,
    });

    if (!passwordOk) {
      return Response.json(
        { error: 'Identifiant ou mot de passe incorrect.' },
        { status: 401, headers: cors }
      );
    }

    // ── 2. Vérifier si le compte Auth existe déjà ─────────────
    const email = username.toLowerCase() + '@stayhere.internal';
    const { data: { users: existingUsers } } = await sbAdmin.auth.admin.listUsers();
    const alreadyExists = existingUsers.some(u => u.email === email);

    if (!alreadyExists) {
      // ── 3. Créer le compte Supabase Auth ────────────────────
      const { data: newAuthUser, error: createErr } = await sbAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { username: legacyUser!.username, nom: legacyUser!.nom },
      });

      if (createErr) {
        return Response.json({ error: 'Erreur lors de la migration du compte.' }, { status: 500, headers: cors });
      }

      // ── 4. Créer sh_user_profiles ────────────────────────────
      const { error: profileErr } = await sbAdmin.from('sh_user_profiles').upsert({
        id: newAuthUser.user.id,
        username: legacyUser!.username,
        nom: legacyUser!.nom,
        role: legacyUser!.role,
        site_id: legacyUser!.site_id || null,
        employee_id: legacyUser!.employee_id || null,
        acces_horloge: legacyUser!.acces_horloge ?? true,
        acces_principal: legacyUser!.acces_principal ?? true,
      }, { onConflict: 'id' });

      if (profileErr) {
        await sbAdmin.auth.admin.deleteUser(newAuthUser.user.id);
        return Response.json({ error: 'Erreur lors de la création du profil.' }, { status: 500, headers: cors });
      }
    }

    // ── 5. Créer une session Supabase Auth ─────────────────────
    const sbAnon = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!
    );

    const { data: signInData, error: signInErr } = await sbAnon.auth.signInWithPassword({ email, password });

    if (signInErr || !signInData?.session) {
      return Response.json({ error: 'Erreur lors de la connexion après migration.' }, { status: 500, headers: cors });
    }

    const { data: profile } = await sbAdmin
      .from('sh_user_profiles')
      .select('*')
      .eq('id', signInData.user.id)
      .single();

    return Response.json({ ok: true, migrated: !alreadyExists, session: signInData.session, profile }, { headers: cors });

  } catch (err) {
    const isDev = Deno.env.get('DEBUG') === 'true';
    if (isDev) console.error('auto-migrate-user error:', err);
    return Response.json(
      { error: 'Erreur serveur' },
      { status: 500, headers: cors }
    );
  }
});
