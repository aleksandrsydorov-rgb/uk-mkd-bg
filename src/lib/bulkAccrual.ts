export type BulkAccrualSummary = {
  total: number;
  created: number;
  skipped_existing: number;
  not_applied: number;
};

export function readBulkAccrualSummary(data: unknown): BulkAccrualSummary | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') return null;
  const source = row as Record<string, unknown>;
  const total = Number(source.total);
  const created = Number(source.created);
  const skipped = Number(source.skipped_existing);
  const notApplied = Number(source.not_applied ?? 0);
  if (![total, created, skipped, notApplied].every((value) => Number.isFinite(value))) return null;
  return {
    total,
    created,
    skipped_existing: skipped,
    not_applied: notApplied,
  };
}
