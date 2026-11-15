/**
 * Vote weight for a Book owner = apartment ideal parts × ownership share ÷ 100.
 * Share unknown → null (leave for clarification). Does not rewrite stored snapshots.
 */

const EPS = 0.01;

export function computeOwnerVoteWeightPercent(
  apartmentIdealPartsPercent: number | null | undefined,
  ownershipSharePercent: number | null | undefined,
): number | null {
  if (apartmentIdealPartsPercent == null || !Number.isFinite(apartmentIdealPartsPercent)) return null;
  if (ownershipSharePercent == null || !Number.isFinite(ownershipSharePercent)) return null;
  if (ownershipSharePercent <= 0) return null;
  return Math.round(((apartmentIdealPartsPercent * ownershipSharePercent) / 100) * 1e6) / 1e6;
}

/** True when a documented owner ideal-parts value diverges from the computed vote weight. */
export function ownerDocumentedIdealDiverges(
  documentedIdealPartsPercent: number | null | undefined,
  computedVoteWeightPercent: number | null | undefined,
  epsilon = EPS,
): boolean {
  if (documentedIdealPartsPercent == null || !Number.isFinite(documentedIdealPartsPercent)) {
    return false;
  }
  if (computedVoteWeightPercent == null || !Number.isFinite(computedVoteWeightPercent)) {
    return false;
  }
  return Math.abs(documentedIdealPartsPercent - computedVoteWeightPercent) > epsilon;
}

export function parseOptionalPercent(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const s = String(raw)
    .trim()
    .replace(/\u00a0/g, ' ')
    .replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
