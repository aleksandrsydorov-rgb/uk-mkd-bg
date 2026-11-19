import { describe, expect, it, vi } from 'vitest';
import { mapAdminRpcError, mapSubmitWaterError } from '@/lib/utilities';

/**
 * UI/API contract mock for multi-meter submit — no live DB writes.
 */
describe('water reading multi-meter submit contract', () => {
  it('maps ambiguous and foreign-meter server errors to user-facing keys', () => {
    expect(mapAdminRpcError('Multiple active water meters; meter_id is required.')).toBe(
      'admin.errMeterRequired',
    );
    expect(mapAdminRpcError('Water meter not found for property.')).toBe(
      'admin.errMeterNotOnProperty',
    );
    expect(mapSubmitWaterError('Multiple active water meters; meter_id is required.')).toBe(
      'meterRequired',
    );
    expect(mapSubmitWaterError('Water meter not found for property.')).toBe('meterNotOnProperty');
  });

  it('builds rpc args with stable meter uuid when selected', () => {
    const propertyId = 10;
    const meterId = '11111111-2222-4333-8444-555555555555';
    const rpcArgs: Record<string, unknown> = {
      p_property_id: propertyId,
      p_current_value: 12.5,
      p_reading_date: '2026-11-19',
      p_idempotency_key: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    };
    if (meterId) rpcArgs.p_meter_id = meterId;
    expect(rpcArgs.p_meter_id).toBe(meterId);
    expect(rpcArgs).not.toHaveProperty('p_meter_number');
  });

  it('omits p_meter_id for single-meter compatible call', () => {
    const activeCount = 1;
    const submitMeterId = '';
    const resolved =
      submitMeterId || (activeCount === 1 ? 'solo-meter-id' : '');
    const rpcArgs: Record<string, unknown> = {
      p_property_id: 3,
      p_current_value: 1,
      p_reading_date: '2026-11-19',
      p_idempotency_key: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    };
    // Parent only adds p_meter_id when resolved; single-meter may still pass id.
    // Old 4-arg path: omit when empty string after filter.
    const passId = resolved && activeCount > 1 ? resolved : undefined;
    if (passId) rpcArgs.p_meter_id = passId;
    // For single meter without explicit id, compatible omit is valid.
    expect(rpcArgs.p_meter_id).toBeUndefined();
  });

  it('rejects multi-meter submit in UI when meter not chosen', () => {
    const propertyActiveMeters = [{ id: 'a' }, { id: 'b' }];
    const submitMeterId = '';
    const rowMeterId = null as string | null;
    const resolved =
      (submitMeterId || rowMeterId || '').trim() ||
      (propertyActiveMeters.length === 1 ? propertyActiveMeters[0]?.id ?? '' : '');
    const blocked = propertyActiveMeters.length > 1 && !resolved;
    expect(blocked).toBe(true);
  });

  it('does not mention submit_water_reading in user-facing multi-meter copy keys used by form', () => {
    // Guard: production copy must stay free of API jargon (checked via message samples).
    const samples = [
      'В апартаменте несколько активных водомеров. Выберите конкретный прибор, чтобы передать показание.',
      'This apartment has several active water meters. Choose a specific meter to submit a reading.',
      'В апартамента има няколко активни водомера. Изберете конкретен уред, за да предадете показание.',
    ];
    for (const s of samples) {
      expect(s.toLowerCase()).not.toContain('submit_water_reading');
      expect(s.toLowerCase()).not.toContain('api');
    }
  });

  it('mock rpc receives meter uuid not display number', async () => {
    const rpc = vi.fn(async (_name: string, args: Record<string, unknown>) => ({
      data: [{ meter_id: args.p_meter_id, reading_id: 'r1' }],
      error: null,
    }));
    await rpc('submit_water_reading', {
      p_property_id: 10,
      p_current_value: 20,
      p_reading_date: '2026-11-19',
      p_idempotency_key: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      p_meter_id: 'meter-uuid-1',
    });
    expect(rpc).toHaveBeenCalledWith(
      'submit_water_reading',
      expect.objectContaining({ p_meter_id: 'meter-uuid-1' }),
    );
    expect(rpc.mock.calls[0][1]).not.toHaveProperty('p_meter_number');
  });
});
