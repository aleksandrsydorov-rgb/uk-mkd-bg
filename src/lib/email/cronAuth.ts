/**
 * Authorization for Vercel Cron → Email Core worker.
 * Vercel injects Authorization: Bearer $CRON_SECRET automatically.
 * Never place CRON_SECRET or EMAIL_WORKER_SECRET in vercel.json / client code.
 */

type EnvProbe = Record<string, string | undefined>;

function bearerFromRequest(request: Request): string {
  const auth = request.headers.get('authorization') ?? '';
  if (auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  return (request.headers.get('x-email-worker-secret') ?? '').trim();
}

/**
 * Accept either Vercel CRON_SECRET or ops EMAIL_WORKER_SECRET.
 * Cron path must never be callable anonymously.
 */
export function assertCronAuthorized(
  request: Request,
  env: EnvProbe = process.env as EnvProbe
): { ok: true; via: 'cron' | 'worker' } | { ok: false; status: number; error: string } {
  const cronSecret = (env.CRON_SECRET ?? '').trim();
  const workerSecret = (env.EMAIL_WORKER_SECRET ?? '').trim();
  if (!cronSecret && !workerSecret) {
    return { ok: false, status: 503, error: 'cron_secret_not_configured' };
  }

  const provided = bearerFromRequest(request);
  if (!provided) {
    return { ok: false, status: 401, error: 'unauthorized' };
  }
  if (cronSecret && provided === cronSecret) {
    return { ok: true, via: 'cron' };
  }
  if (workerSecret && provided === workerSecret) {
    return { ok: true, via: 'worker' };
  }
  return { ok: false, status: 401, error: 'unauthorized' };
}

/** Hobby plan: one daily cron (06:00 UTC). Pro may use every-5-minutes with approval. */
export const EMAIL_CRON_HOBBY_SLOTS_UTC = ['0 6 * * *'] as const;

export const EMAIL_CRON_PRO_RECOMMENDED = '*/5 * * * *';
