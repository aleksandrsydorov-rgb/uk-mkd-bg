import { describe, expect, it } from 'vitest';
import {
  authCallbackFailureKey,
  exchangePkceCodeOnce,
  hasPkceFlowSlotCookie,
} from '@/lib/auth/callbackPkce';

describe('callback PKCE exchange', () => {
  it('exchanges one code only once', async () => {
    let calls = 0;
    const exchange = async () => {
      calls += 1;
      return { error: null };
    };
    const code = 'once-only';
    const [a, b] = await Promise.all([
      exchangePkceCodeOnce(exchange, code),
      exchangePkceCodeOnce(exchange, code),
    ]);
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    expect(calls).toBe(1);
  });

  it('detects a flow-slot cookie by name', () => {
    const slot = 'sb-local-auth-token-flow-' + 'a'.repeat(32) + '-code-verifier=hidden';
    expect(hasPkceFlowSlotCookie(`theme=1; ${slot}`)).toBe(true);
    expect(hasPkceFlowSlotCookie('sb-local-auth-token-code-verifier=hidden')).toBe(false);
    expect(hasPkceFlowSlotCookie('sb-local-auth-token-flows-code-verifier=hidden')).toBe(false);
    expect(hasPkceFlowSlotCookie('')).toBe(false);
  });

  it('maps a missing verifier to a same-browser or used-link message', () => {
    const missing = {
      name: 'AuthPKCECodeVerifierMissingError',
      code: 'pkce_code_verifier_not_found',
      message: 'PKCE code verifier not found in storage.',
    };
    expect(authCallbackFailureKey(missing, false)).toBe('authCallback.errVerifierMissing');
    expect(authCallbackFailureKey(missing, true)).toBe('authCallback.errLinkUsed');
    expect(authCallbackFailureKey({ code: 'flow_state_expired' }, false)).toBe(
      'authCallback.errLinkUsed',
    );
    expect(authCallbackFailureKey({ message: 'something else' }, false)).toBeNull();
  });
});
