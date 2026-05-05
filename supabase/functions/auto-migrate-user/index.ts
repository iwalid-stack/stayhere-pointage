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
import { corsHeaders } from '../_shared/cors.ts';

// SHA-256 côté Deno (identique à crypto.subtle dans le browser)
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
    const { username, password } = await req.json();

    if (!username || !password) {
      return Response.json({ error: 'username et password requis' }, { status: 400, headers: corsHeaders });
    }

    // ── Client admin (service role, jamais exposé au client) ──
    const sbAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // ── 1. Valider contre sh_users (legacy SHA-256) ───────────
    const hash = await sha256(password);

    const { data: legacyUser, error: legacyErr } = await sbAdmin
      .from('sh_users')
      .select('*')
      .eq('username', username.toLowerCase())
      .eq('password_hash', hash)
      .maybeSingle();

    if (legacyErr || !legacyUser) {
      // Mauvais mot de passe OU utilisateur inexistant
      return Response.json(
        { error: 'Identifiant ou mot de passe incorrect.' },
        { status: 401, headers: corsHeaders }
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
        email_confirm: true,  // pas d'email de confirmation
        user_metadata: { username: legacyUser.username, nom: legacyUser.nom },
      });

      if (createErr) {
        console.error('Erreur création Auth user:', createErr);
        return Response.json({ error: 'Erreur lors de la migration du compte.' }, { status: 500, headers: corsHeaders });
      }

      // ── 4. Créer sh_user_profiles ────────────────────────────
      const { error: profileErr } = await sbAdmin.from('sh_user_profiles').upsert({
        id: newAuthUser.user.id,
        username: legacyUser.username,
        nom: legacyUser.nom,
        role: legacyUser.role,
        site_id: legacyUser.site_id || null,
        employee_id: legacyUser.employee_id || null,
        acces_horloge: legacyUser.acces_horloge ?? true,
        acces_principal: legacyUser.acces_principal ?? true,
      }, { onConflict: 'id' });

      if (profileErr) {
        console.error('Erreur création profil:', profileErr);
        // Nettoyage : supprimer le compte Auth créé
        await sbAdmin.auth.admin.deleteUser(newAuthUser.user.id);
        return Response.json({ error: 'Erreur lors de la création du profil.' }, { status: 500, headers: corsHeaders });
      }
    }

    // ── 5. Créer une session Supabase Auth pour l'utilisateur ──
    // On signe avec le client anon pour obtenir un vrai token de session
    const sbAnon = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!
    );

    const { data: signInData, error: signInErr } = await sbAnon.auth.signInWithPassword({
      email,
      password,
    });

    if (signInErr || !signInData?.session) {
      return Response.json({ error: 'Erreur lors de la connexion après migration.' }, { status: 500, headers: corsHeaders });
    }

    // ── 6. Retourner le profil + la session ───────────────────
    const { data: profile } = await sbAdmin
      .from('sh_user_profiles')
      .select('*')
      .eq('id', signInData.user.id)
      .single();

    return Response.json({
      ok: true,
      migrated: !alreadyExists,
      session: signInData.session,
      profile,
    }, { headers: corsHeaders });

  } catch (err) {
    console.error('auto-migrate-user error:', err);
    return Response.json(
      { error: 'Erreur serveur', detail: err instanceof Error ? err.message : String(err) },
      { status: 500, headers: corsHeaders }
    );
  }
});
