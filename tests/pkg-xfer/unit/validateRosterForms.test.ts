import { describe, expect, it } from 'vitest';
import {
  formsToTargetOwners,
  validateRosterForms,
  targetOwnersToForms,
} from '@/lib/ownershipChange';
import { ownerForm, sharedTwoOwners } from '../helpers/rosterFixtures';

describe('PKG-XFER unit · ownership roster validation (Packages 1–2)', () => {
  it('1→1: sole owner 100% / full ideals passes', () => {
    const forms = [
      ownerForm({
        email: 'xfer.auto.sole@example.com',
        ownership_share_percent: '100',
        ideal_parts_percent: '1.75',
      }),
    ];
    const v = validateRosterForms(forms, 1.75);
    expect(v.ok).toBe(true);
    expect(v.shareSum).toBe(100);
    expect(v.idealSum).toBeCloseTo(1.75, 6);
  });

  it('1→many: shares sum 100 and ideals match property', () => {
    const { forms, propertyIdeal } = sharedTwoOwners({
      shareA: '70',
      shareB: '30',
      idealA: '0.7',
      idealB: '0.3',
      propertyIdeal: 1,
    });
    const v = validateRosterForms(forms, propertyIdeal);
    expect(v.ok).toBe(true);
    expect(v.errors).toEqual([]);
  });

  it('many→many: 40/60 roster mirrors Package 1 CP5 target', () => {
    const { forms, propertyIdeal } = sharedTwoOwners();
    const v = validateRosterForms(forms, propertyIdeal);
    expect(v.ok).toBe(true);
    expect(v.shareSum).toBe(100);
    expect(v.idealSum).toBeCloseTo(1, 6);
  });

  it('partial transfer retaining existing owner: three-way 50/30/20', () => {
    const forms = [
      ownerForm({
        email: 'xfer.auto.keep@example.com',
        ownership_share_percent: '50',
        ideal_parts_percent: '0.5',
      }),
      ownerForm({
        email: 'xfer.auto.new1@example.com',
        ownership_share_percent: '30',
        ideal_parts_percent: '0.3',
      }),
      ownerForm({
        email: 'xfer.auto.new2@example.com',
        ownership_share_percent: '20',
        ideal_parts_percent: '0.2',
      }),
    ];
    expect(validateRosterForms(forms, 1).ok).toBe(true);
  });

  it('rejects share total ≠ 100%', () => {
    const { forms } = sharedTwoOwners({ shareA: '40', shareB: '50' });
    const v = validateRosterForms(forms, 1);
    expect(v.ok).toBe(false);
    expect(v.errors).toContain('share_total');
  });

  it('rejects ideal parts total mismatch vs property', () => {
    const { forms } = sharedTwoOwners({ idealA: '0.4', idealB: '0.5', propertyIdeal: 1 });
    const v = validateRosterForms(forms, 1);
    expect(v.ok).toBe(false);
    expect(v.errors).toContain('ideal_total');
  });

  it('rejects missing natural-person name and bad email', () => {
    const forms = [
      ownerForm({
        email: 'not-an-email',
        first_name: '',
        last_name: '',
        ownership_share_percent: '100',
        ideal_parts_percent: '1',
      }),
    ];
    const v = validateRosterForms(forms, 1);
    expect(v.ok).toBe(false);
    expect(v.errors).toEqual(expect.arrayContaining(['email', 'name']));
  });

  it('legal entity requires entity_name', () => {
    const forms = [
      ownerForm({
        email: 'co@example.com',
        entity_kind: 'legal_entity',
        entity_name: '',
        ownership_share_percent: '100',
        ideal_parts_percent: '1',
      }),
    ];
    const v = validateRosterForms(forms, 1);
    expect(v.ok).toBe(false);
    expect(v.errors).toContain('entity_name');
  });

  it('formsToTargetOwners normalizes email and legal entity fields', () => {
    const forms = [
      ownerForm({
        email: '  Co@Example.COM ',
        entity_kind: 'legal_entity',
        entity_name: '  Acme EOOD ',
        eik_bulstat: '123456789',
        ownership_share_percent: '100',
        ideal_parts_percent: '2',
      }),
    ];
    const targets = formsToTargetOwners(forms);
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      entity_kind: 'legal_entity',
      entity_name: 'Acme EOOD',
      eik_bulstat: '123456789',
      email: 'co@example.com',
      ownership_share_percent: 100,
      ideal_parts_percent: 2,
    });
  });

  it('targetOwnersToForms round-trip preserves shares', () => {
    const { forms } = sharedTwoOwners();
    const targets = formsToTargetOwners(forms);
    const back = targetOwnersToForms(targets);
    const v = validateRosterForms(back, 1);
    expect(v.ok).toBe(true);
  });
});
