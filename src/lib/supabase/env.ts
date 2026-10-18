/**
 * Resolve Supabase URL/keys for server vs browser.
 *
 * NEXT_PUBLIC_* must be referenced as literal `process.env.NEXT_PUBLIC_*`
 * property accesses so Next.js can inline them into the client bundle at
 * image build time. Dynamic `env[name]` / `env.NEXT_PUBLIC_*` via a passed
 * ProcessEnv object is NOT replaced and leaves the browser misconfigured.
 *
 * Server/runtime may override the URL with SUPABASE_URL so a container can
 * reach host-published local Supabase via host.docker.internal while the
 * browser still talks to 127.0.0.1.
 */

function publicSupabaseUrl(): string {
  return (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim().replace(/\/$/, '');
}

function publicAnonKey(): string {
  return (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();
}

function serverSupabaseUrlOverride(): string {
  return (process.env.SUPABASE_URL ?? '').trim().replace(/\/$/, '');
}

export function getSupabasePublicUrl(): string {
  const serverUrl = serverSupabaseUrlOverride();
  // Prefer server override only on the server (never expose SUPABASE_URL to client bundles).
  if (typeof window === 'undefined' && serverUrl) return serverUrl;
  return publicSupabaseUrl();
}

export function getSupabaseAnonKey(): string {
  return publicAnonKey();
}

export function assertSupabasePublicEnv(): {
  url: string;
  anonKey: string;
} {
  const url = getSupabasePublicUrl();
  const anonKey = getSupabaseAnonKey();
  if (!url || !anonKey) {
    throw new Error(
      'Missing Supabase configuration: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY' +
        (typeof window === 'undefined'
          ? ' (optional server override: SUPABASE_URL for container→host DB)'
          : ''),
    );
  }
  return { url, anonKey };
}
