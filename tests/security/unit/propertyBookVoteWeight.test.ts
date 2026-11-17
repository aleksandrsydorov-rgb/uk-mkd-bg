import { describe, expect, it } from 'vitest';
import { PROPERTY_BOOK_OWNERS_SPEC } from '@/lib/importTemplates/specs/propertyBook';
import { templateColumns } from '@/lib/importTemplates/workbook';
import {
  computeOwnerVoteWeightPercent,
  ownerDocumentedIdealDiverges,
} from '@/lib/propertyBookVoteWeight';

describe('property book owner vote weight', () => {
  it('computes apartment ideal × share ÷ 100 (2% × 60/40 → 1.2 / 0.8)', () => {
    expect(computeOwnerVoteWeightPercent(2, 60)).toBe(1.2);
    expect(computeOwnerVoteWeightPercent(2, 40)).toBe(0.8);
    expect(computeOwnerVoteWeightPercent(2, 100)).toBe(2);
  });

  it('leaves weight for clarification when share is unknown', () => {
    expect(computeOwnerVoteWeightPercent(2, null)).toBeNull();
    expect(computeOwnerVoteWeightPercent(2, undefined)).toBeNull();
    expect(computeOwnerVoteWeightPercent(null, 60)).toBeNull();
  });

  it('detects documented vs computed divergence', () => {
    expect(ownerDocumentedIdealDiverges(1.0, 1.2)).toBe(true);
    expect(ownerDocumentedIdealDiverges(1.2, 1.2)).toBe(false);
    expect(ownerDocumentedIdealDiverges(null, 1.2)).toBe(false);
  });

  it('omits count/kind/share/ideal from owners download but keeps legacy columns for parse', () => {
    const cols = templateColumns(PROPERTY_BOOK_OWNERS_SPEC);
    expect(cols.some((c) => c.key === 'ideal_parts_percent')).toBe(false);
    expect(cols.some((c) => c.key === 'ownership_share_percent')).toBe(false);
    expect(cols.some((c) => c.key === 'ownership_type')).toBe(false);
    expect(cols.some((c) => c.key === 'entity_kind')).toBe(false);
    for (const key of [
      'ideal_parts_percent',
      'ownership_share_percent',
      'ownership_type',
      'entity_kind',
    ] as const) {
      expect(PROPERTY_BOOK_OWNERS_SPEC.columns.find((c) => c.key === key)?.includeInTemplate).toBe(
        false,
      );
    }
  });
});
