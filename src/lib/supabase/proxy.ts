import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { Database } from '@/lib/database.types';
import { assertSupabasePublicEnv } from '@/lib/supabase/env';
import { isJwtSignatureUnverifiableError } from '@/lib/auth/jwtAuthErrors';

/**
 * Refresh + verify the Auth session on each matched request.
 *
 * Prefer getClaims() (local JWKS verify for ES256). On unverifiable JWT /
 * JWKS kid mismatch responses from Auth, fall back to getUser() (server
 * verify) and clear an unusable cookie session so invite/callback can
 * establish a fresh one. Never skips signature verification.
 */
export async function updateSession(request: NextRequest) {
  const { url, anonKey } = assertSupabasePublicEnv();

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, options);
        });
      },
    },
  });

  const { error: claimsError } = await supabase.auth.getClaims();
  if (claimsError) {
    const { error: userError } = await supabase.auth.getUser();
    const combined = `${claimsError.message}\n${userError?.message ?? ''}`;
    if (userError && isJwtSignatureUnverifiableError(combined)) {
      // Unusable session cookie (e.g. kid not in JWKS / stale signing key).
      await supabase.auth.signOut();
    }
  }

  return supabaseResponse;
}
