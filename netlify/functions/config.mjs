// Hands the browser the Supabase project URL and public (anon) key from the
// site's environment variables. Both are meant to be public: row level
// security in the database keeps each user's data private.
//
// Works with the names the Netlify Supabase extension sets, or with
// SUPABASE_URL / SUPABASE_ANON_KEY added by hand.

const first = (names) => names.map((n) => process.env[n]).find((v) => v && v.trim())?.trim();

// The extension's "database URL" may be a postgres:// connection string;
// the project's https URL can be rebuilt from its project ref.
export function projectUrl(value) {
  if (!value) return null;
  if (/^https?:\/\//.test(value)) return value.replace(/\/+$/, '');
  const ref = /db\.([a-z0-9]+)\.supabase\.co/.exec(value)?.[1] ?? /postgres\.([a-z0-9]+)[:@]/.exec(value)?.[1];
  return ref ? `https://${ref}.supabase.co` : null;
}

export default async () => {
  const url = projectUrl(first(['SUPABASE_URL', 'SUPABASE_DATABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'VITE_SUPABASE_URL', 'PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_DATABASE_URL', 'VITE_SUPABASE_DATABASE_URL']));
  const anonKey = first(['SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY', 'PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY']);
  return new Response(JSON.stringify({ url, anonKey }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
};

export const config = { path: '/config.json' };
