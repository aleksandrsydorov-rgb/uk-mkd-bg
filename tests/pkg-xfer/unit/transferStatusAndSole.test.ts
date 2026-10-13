import { describe, expect, it } from 'vitest';
import { listingStatus, soleTargetOwner, transferStatusClass } from '@/lib/ownership';
import { OWNERSHIP_CHANGE_REASONS } from '@/lib/ownershipChange';

describe('PKG-XFER unit · transfer status / sole helper / reasons', () => {
  it('maps listing status aliases', () => {
    expect(listingStatus('на продаже')).toBe('на продаже');
    expect(listingStatus('for_sale')).toBe('на продаже');
    expect(listingStatus('в собственности')).toBe('в собственности');
    expect(listingStatus(null)).toBe('в собственности');
  });

  it('transferStatusClass covers lifecycle statuses (submit/approve/reject/cancel)', () => {
    expect(transferStatusClass('ожидает')).toBe('text-warning');
    expect(transferStatusClass('утверждена')).toBe('text-success');
    expect(transferStatusClass('отклонена')).toBe('text-danger');
    expect(transferStatusClass('отменена')).toBe('text-muted');
  });

  it('soleTargetOwner builds 100% natural person with normalized email', () => {
    const o = soleTargetOwner({
      name: 'Test Owner Three',
      email: '  Xfer.Auto@Example.com ',
      idealPartsPercent: 1.25,
    });
    expect(o).toMatchObject({
      entity_kind: 'natural_person',
      first_name: 'Test',
      last_name: 'Owner Three',
      email: 'xfer.auto@example.com',
      ownership_share_percent: 100,
      ideal_parts_percent: 1.25,
    });
  });

  it('ownership change reasons include sale, inheritance, correction, partial', () => {
    expect(OWNERSHIP_CHANGE_REASONS).toEqual(
      expect.arrayContaining([
        'sale',
        'donation',
        'partial_transfer',
        'inheritance',
        'correction',
        'other',
      ])
    );
  });
});
