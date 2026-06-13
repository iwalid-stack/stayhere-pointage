// Origines autorisées : variable d'env ALLOWED_ORIGINS (virgule-séparées) ou domaine par défaut
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') || 'https://stayhere-pointage.vercel.app')
  .split(',').map((s: string) => s.trim()).filter(Boolean);

export function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') || '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}
