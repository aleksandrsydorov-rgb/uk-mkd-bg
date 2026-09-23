export function ownerVisibleError(raw: unknown, fallback: string): string {
  const msg = raw instanceof Error ? raw.message : typeof raw === 'string' ? raw : '';
  if (!msg.trim()) return fallback;
  if (
    /PGRST|PostgREST|invalid api key|jwt|permission denied|schema cache|42P01|42703|could not find the function|row-level security|violates row-level|rpc_/i.test(
      msg,
    )
  ) {
    console.error(raw);
    return fallback;
  }
  return msg;
}
