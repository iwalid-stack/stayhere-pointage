/**
 * Génère config.js à partir des variables d'environnement Vercel
 * Exécuté au moment du build — config.js n'est jamais dans le repo
 */
const fs = require('fs');

const url     = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.error('❌ Variables manquantes : SUPABASE_URL et/ou SUPABASE_ANON_KEY');
  console.error('   Configurez-les dans Vercel → Settings → Environment Variables');
  process.exit(1);
}

fs.writeFileSync('config.js', `// Généré automatiquement au build — ne pas modifier
window.SUPABASE_CONFIG = {
  url: '${url}',
  anonKey: '${anonKey}'
};
`);

console.log('✅ config.js généré avec succès');
