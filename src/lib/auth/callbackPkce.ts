/**
 * One exchange per auth code for this page load.
 * React Strict Mode runs the callback effect twice; a second exchange finds
 * the verifier already removed and surfaces a false failure.
 */
const exchangeByCode = new Map<
  string,
  Promise<{ error: CallbackExchangeError | null }>
>();

export type CallbackExchangeError = {
  message?: string;
  code?: string;
  name?: string;
};

const USED_LINK_CODES = new Set([
  'flow_state_expired',
  'flow_state_not_found',
  'bad_code_verifier',
]);

export function exchangePkceCodeOnce(
  exchange: (code: string) => Promise<{ error: CallbackExchangeError | null }>,
  code: string,
): Promise<{ error: CallbackExchangeError | null }> {
  const existing = exchangeByCode.get(code);
  if (existing) return existing;
  const pending = exchange(code);
  exchangeByCode.set(code, pending);
  return pending;
}

/** True when this browser still has a PKCE flow slot cookie (name only). */
export function hasPkceFlowSlotCookie(cookieHeader: string): boolean {
  return cookieHeader.split(';').some((part) => {
    const name = part.split('=')[0]?.trim() ?? '';
    return /-flow-[0-9a-f]{32}-code-verifier(?:\.\d+)?$/i.test(name);
  });
}

export function authCallbackFailureKey(
  error: CallbackExchangeError,
  sameBrowserFlowSlot: boolean,
): 'authCallback.errVerifierMissing' | 'authCallback.errLinkUsed' | null {
  const name = error.name ?? '';
  const code = error.code ?? '';
  const message = error.message ?? '';
  const verifierMissing =
    name === 'AuthPKCECodeVerifierMissingError' ||
    code === 'pkce_code_verifier_not_found' ||
    message.startsWith('PKCE code verifier not found');
  if (verifierMissing) {
    return sameBrowserFlowSlot
      ? 'authCallback.errLinkUsed'
      : 'authCallback.errVerifierMissing';
  }
  if (USED_LINK_CODES.has(code)) return 'authCallback.errLinkUsed';
  return null;
}
