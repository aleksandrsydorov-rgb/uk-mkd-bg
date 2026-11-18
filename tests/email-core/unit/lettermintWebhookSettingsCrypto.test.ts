import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  decryptProviderToken,
  encryptProviderToken,
  parseEmailSettingsEncryptionKey,
} from '@/lib/email/settingsCrypto';
import {
  normalizeLettermintEventType,
  verifyLettermintWebhookSignature,
} from '@/lib/email/lettermintWebhook';

describe('settingsCrypto', () => {
  const keyHex = 'a'.repeat(64);

  it('round-trips a project token', () => {
    const env = { EMAIL_SETTINGS_ENCRYPTION_KEY: keyHex };
    const cipher = encryptProviderToken('lm_test_token_value', env);
    expect(cipher.startsWith('v1.')).toBe(true);
    expect(decryptProviderToken(cipher, env)).toBe('lm_test_token_value');
    expect(parseEmailSettingsEncryptionKey(keyHex)?.length).toBe(32);
  });
});

describe('lettermintWebhook', () => {
  const secret = 'whsec_test_secret';
  const body = '{"id":"evt_1","event":"message.delivered","data":{"message_id":"msg_9"}}';

  function sign(raw: string, t: number) {
    const v1 = createHmac('sha256', secret).update(`${t}.${raw}`, 'utf8').digest('hex');
    return { signature: `t=${t},v1=${v1}`, delivery: String(t) };
  }

  it('accepts a valid signed delivery event', () => {
    const t = Math.floor(Date.now() / 1000);
    const { signature, delivery } = sign(body, t);
    const verified = verifyLettermintWebhookSignature({
      rawBody: body,
      secret,
      nowSec: t,
      headers: {
        'X-Lettermint-Signature': signature,
        'X-Lettermint-Delivery': delivery,
        'X-Lettermint-Event': 'message.delivered',
      },
    });
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.eventType).toBe('delivered');
      expect(verified.messageId).toBe('msg_9');
      expect(verified.eventId).toBe('evt_1');
    }
  });

  it('rejects a bad signature', () => {
    const t = Math.floor(Date.now() / 1000);
    const verified = verifyLettermintWebhookSignature({
      rawBody: body,
      secret,
      nowSec: t,
      headers: {
        'X-Lettermint-Signature': `t=${t},v1=deadbeef`,
        'X-Lettermint-Delivery': String(t),
      },
    });
    expect(verified.ok).toBe(false);
  });

  it('normalizes bounce events', () => {
    expect(normalizeLettermintEventType('message.hard_bounced')).toBe('bounced');
  });
});
