/**
 * INV-6 — Approved Inventory opening commit via INV-2 RPCs only.
 * No finance side-effects. Per-row outcomes; no false full success.
 */

import type { ImportPreviewResult } from '@/lib/moduleCore/types';
import { inventoryOpeningMentionsFinance } from './opening';

export const INVENTORY_COMMIT_OUTCOMES = [
  'CREATED',
  'SKIPPED_EXISTING',
  'CONFLICT',
  'FAILED',
  'NOT_PROCESSED',
] as const;

export type InventoryCommitOutcome = (typeof INVENTORY_COMMIT_OUTCOMES)[number];

export type InventoryCommitRowResult = {
  rowNumber: number;
  matchKey: string;
  trackingType: string;
  outcome: InventoryCommitOutcome;
  detail: string;
  attempted: boolean;
  financeTouched: false;
};

export type InventoryCommitBatchResult = {
  rows: InventoryCommitRowResult[];
  createdCount: number;
  skippedExistingCount: number;
  conflictCount: number;
  failedCount: number;
  notProcessedCount: number;
  fullySuccessful: boolean;
  stoppedEarly: boolean;
  financeTouched: false;
};

export type InventoryOpeningImportFns = {
  /** Ensure category exists (by code); returns id. Optional — skip if not provided. */
  ensureCategory?: (args: {
    code: string;
    name: string;
  }) => Promise<{ ok: true; categoryId: string } | { ok: false; message: string }>;
  ensureLocation?: (args: {
    code: string;
    name: string;
  }) => Promise<{ ok: true; locationId: string } | { ok: false; message: string }>;
  /** Resolve existing rows so retries do not invent duplicates. */
  findAssetByNumber?: (
    inventoryNumber: string,
  ) => Promise<{ assetId: string; operationalStatus: string } | null>;
  findStockBySku?: (
    skuCode: string,
  ) => Promise<{ stockItemId: string; hasOpeningMovement: boolean } | null>;
  createDraftAsset: (args: {
    inventoryNumber: string;
    name: string;
    ownershipKind: string;
    categoryId: string | null;
    locationId: string | null;
    serialNumber: string | null;
    condition: string;
    estimatedValueEur: number | null;
    description: string | null;
    idempotencyKey: string;
  }) => Promise<{ ok: true; assetId: string } | { ok: false; message: string }>;
  activateAsset: (assetId: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  registerStockItem: (args: {
    skuCode: string;
    name: string;
    ownershipKind: string;
    unitCode: string;
    categoryId: string | null;
    defaultLocationId: string | null;
    estimatedUnitValueEur: number | null;
    description: string | null;
    idempotencyKey: string;
  }) => Promise<{ ok: true; stockItemId: string } | { ok: false; message: string }>;
  postOpeningMove: (args: {
    stockItemId: string;
    qty: number;
    locationId: string | null;
    reason: string | null;
    idempotencyKey: string;
  }) => Promise<{ ok: true } | { ok: false; message: string }>;
};

export function classifyInventoryOpeningCommitError(message: string): 'CONFLICT' | 'FAILED' {
  const msg = message.toLowerCase();
  if (
    msg.includes('conflict') ||
    msg.includes('23505') ||
    msg.includes('duplicate') ||
    msg.includes('already exists') ||
    msg.includes('unique')
  ) {
    return 'CONFLICT';
  }
  return 'FAILED';
}

function summarize(
  rows: InventoryCommitRowResult[],
  stoppedEarly: boolean,
): InventoryCommitBatchResult {
  const createdCount = rows.filter((r) => r.outcome === 'CREATED').length;
  const skippedExistingCount = rows.filter((r) => r.outcome === 'SKIPPED_EXISTING').length;
  const conflictCount = rows.filter((r) => r.outcome === 'CONFLICT').length;
  const failedCount = rows.filter((r) => r.outcome === 'FAILED').length;
  const notProcessedCount = rows.filter((r) => r.outcome === 'NOT_PROCESSED').length;
  const fullySuccessful =
    failedCount === 0 &&
    notProcessedCount === 0 &&
    conflictCount === 0 &&
    rows.every((r) => r.outcome === 'CREATED' || r.outcome === 'SKIPPED_EXISTING');
  return {
    rows,
    createdCount,
    skippedExistingCount,
    conflictCount,
    failedCount,
    notProcessedCount,
    fullySuccessful,
    stoppedEarly,
    financeTouched: false,
  };
}

export function inventoryCommitAuditPayload(batch: InventoryCommitBatchResult): Record<string, unknown> {
  return {
    kind: 'inventory_opening_commit',
    financeTouched: false,
    fullySuccessful: batch.fullySuccessful,
    createdCount: batch.createdCount,
    skippedExistingCount: batch.skippedExistingCount,
    conflictCount: batch.conflictCount,
    failedCount: batch.failedCount,
    notProcessedCount: batch.notProcessedCount,
    stoppedEarly: batch.stoppedEarly,
    rows: batch.rows,
  };
}

export function filterPreviewForInventoryRetry(
  preview: ImportPreviewResult,
  retryRowNumbers: Set<number>,
): ImportPreviewResult {
  const rows = preview.rows.filter((r) => retryRowNumbers.has(r.rowNumber));
  return {
    ...preview,
    rows,
    createCount: rows.filter((r) => r.operation === 'create').length,
    updateCount: rows.filter((r) => r.operation === 'update').length,
    skipCount: rows.filter((r) => r.operation === 'skip').length,
    errorCount: rows.filter((r) => r.operation === 'error').length,
  };
}

/** Outcomes that still need a write (after server reconciliation). */
export function unsavedInventoryCommitOutcomes(
  batch: InventoryCommitBatchResult,
): InventoryCommitRowResult[] {
  return batch.rows.filter(
    (r) =>
      r.outcome === 'FAILED' ||
      r.outcome === 'NOT_PROCESSED' ||
      r.outcome === 'CONFLICT',
  );
}

export function retryCandidatesFromInventoryBatch(
  batch: InventoryCommitBatchResult,
): number[] {
  // Only rows still unsaved after reconciliation — never re-drive CREATED/SKIPPED.
  return unsavedInventoryCommitOutcomes(batch).map((r) => r.rowNumber);
}

export type InventoryCommitUiSummary = {
  total: number;
  savedNow: number;
  alreadySaved: number;
  notSaved: number;
};

export function inventoryCommitUiSummary(
  batch: InventoryCommitBatchResult,
): InventoryCommitUiSummary {
  const savedNow = batch.createdCount;
  const alreadySaved = batch.skippedExistingCount;
  const notSaved = batch.failedCount + batch.notProcessedCount + batch.conflictCount;
  return {
    total: batch.rows.length,
    savedNow,
    alreadySaved,
    notSaved,
  };
}

/** Confirmed on-server rows (new + already present). Never use last-pass creates alone. */
export function inventoryCommitConfirmedSavedCount(
  batch: InventoryCommitBatchResult,
): number {
  return batch.createdCount + batch.skippedExistingCount;
}

/** Rebuild a batch result from an audit preview payload (module_import_batches.preview). */
export function inventoryCommitBatchFromAuditPreview(
  preview: Record<string, unknown> | null | undefined,
): InventoryCommitBatchResult | null {
  if (!preview || typeof preview !== 'object') return null;
  const rowsRaw = preview.rows;
  if (!Array.isArray(rowsRaw) || rowsRaw.length === 0) return null;
  const rows: InventoryCommitRowResult[] = [];
  for (const item of rowsRaw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const outcome = String(r.outcome ?? '');
    if (
      outcome !== 'CREATED' &&
      outcome !== 'SKIPPED_EXISTING' &&
      outcome !== 'CONFLICT' &&
      outcome !== 'FAILED' &&
      outcome !== 'NOT_PROCESSED'
    ) {
      continue;
    }
    rows.push({
      rowNumber: Number(r.rowNumber) || 0,
      matchKey: String(r.matchKey ?? ''),
      trackingType: String(r.trackingType ?? ''),
      outcome,
      detail: String(r.detail ?? ''),
      attempted: Boolean(r.attempted),
      financeTouched: false,
    });
  }
  if (rows.length === 0) return null;
  return summarize(rows, Boolean(preview.stoppedEarly));
}

export type InventoryServerPresence = {
  assetNumbers: Set<string>;
  /** sku → whether an OPENING movement already exists */
  stockBySku: Map<string, { stockItemId: string; hasOpeningMovement: boolean }>;
};

/**
 * Reconcile client batch outcomes with what is actually on the server.
 * Prevents treating a network/RPC message as proof that nothing was written.
 */
export function reconcileInventoryCommitWithServer(
  batch: InventoryCommitBatchResult,
  previewRows: Array<{
    rowNumber: number;
    matchKey?: string;
    data: Record<string, string>;
  }>,
  server: InventoryServerPresence,
): InventoryCommitBatchResult {
  const previewByRow = new Map(previewRows.map((r) => [r.rowNumber, r]));
  const rows: InventoryCommitRowResult[] = batch.rows.map((r) => {
    const preview = previewByRow.get(r.rowNumber);
    const tracking = r.trackingType || String(preview?.data.tracking_type ?? '');
    if (tracking === 'INDIVIDUAL_ASSET') {
      const num = String(
        preview?.data.inventory_number ?? r.matchKey ?? '',
      )
        .trim()
        .toLowerCase();
      const onServer = num ? [...server.assetNumbers].some((n) => n.toLowerCase() === num) : false;
      if (onServer && (r.outcome === 'FAILED' || r.outcome === 'NOT_PROCESSED' || r.outcome === 'CONFLICT')) {
        return {
          ...r,
          outcome: 'SKIPPED_EXISTING' as const,
          detail: 'reconciled_existing_asset',
          attempted: r.attempted,
        };
      }
      if (!onServer && r.outcome === 'CREATED') {
        return {
          ...r,
          outcome: 'FAILED' as const,
          detail: 'reconcile_missing_asset_after_create',
        };
      }
      return r;
    }
    if (tracking === 'QUANTITY_STOCK') {
      const sku = String(preview?.data.sku_code ?? r.matchKey ?? '')
        .trim()
        .toLowerCase();
      const stock = sku
        ? [...server.stockBySku.entries()].find(([k]) => k.toLowerCase() === sku)?.[1]
        : undefined;
      const openingQty = Number(String(preview?.data.opening_qty ?? '').trim());
      if (stock?.hasOpeningMovement || (stock && !(openingQty > 0))) {
        if (r.outcome === 'FAILED' || r.outcome === 'NOT_PROCESSED' || r.outcome === 'CONFLICT') {
          return {
            ...r,
            outcome: 'SKIPPED_EXISTING' as const,
            detail: 'reconciled_existing_stock',
            attempted: r.attempted,
          };
        }
      }
      if (stock && !stock.hasOpeningMovement && openingQty > 0) {
        // Item exists; opening still missing — keep retryable without re-registering as invent.
        if (r.outcome === 'CREATED') {
          return {
            ...r,
            outcome: 'FAILED' as const,
            detail: 'opening_move_missing',
          };
        }
        return {
          ...r,
          outcome: r.outcome === 'SKIPPED_EXISTING' ? 'FAILED' : r.outcome,
          detail: r.detail.includes('opening') ? r.detail : 'opening_move_missing',
        };
      }
      if (!stock && r.outcome === 'CREATED') {
        return {
          ...r,
          outcome: 'FAILED' as const,
          detail: 'reconcile_missing_stock_after_create',
        };
      }
    }
    return r;
  });
  return summarize(rows, false);
}

export function mergeInventoryCommitBatches(
  prior: InventoryCommitBatchResult,
  next: InventoryCommitBatchResult,
): InventoryCommitBatchResult {
  const byRow = new Map<number, InventoryCommitRowResult>();
  for (const r of prior.rows) byRow.set(r.rowNumber, r);
  for (const r of next.rows) byRow.set(r.rowNumber, r);
  return summarize([...byRow.values()].sort((a, b) => a.rowNumber - b.rowNumber), false);
}

export async function commitInventoryOpeningBatch(args: {
  preview: ImportPreviewResult;
  fns: InventoryOpeningImportFns;
  batchId: string | null;
  idempotencyKeyForRow: (rowNumber: number, kind: string) => string;
}): Promise<InventoryCommitBatchResult> {
  if (inventoryOpeningMentionsFinance(JSON.stringify(args.preview))) {
    return summarize(
      [
        {
          rowNumber: 0,
          matchKey: '',
          trackingType: '',
          outcome: 'FAILED',
          detail: 'finance_forbidden_in_preview',
          attempted: false,
          financeTouched: false,
        },
      ],
      true,
    );
  }

  const results: InventoryCommitRowResult[] = [];
  let stop = false;
  const categoryCache = new Map<string, string>();
  const locationCache = new Map<string, string>();

  for (const row of args.preview.rows) {
    const trackingType = String(row.data.tracking_type ?? '');
    const matchKey = String(row.matchKey ?? '');

    if (row.operation === 'skip') {
      results.push({
        rowNumber: row.rowNumber,
        matchKey,
        trackingType,
        outcome: 'SKIPPED_EXISTING',
        detail: 'preview_identical_or_opening_exists',
        attempted: false,
        financeTouched: false,
      });
      continue;
    }

    if (row.operation === 'error') {
      const isConflict = (row.data.preview_class ?? '') === 'CONFLICT';
      results.push({
        rowNumber: row.rowNumber,
        matchKey,
        trackingType,
        outcome: isConflict ? 'CONFLICT' : 'FAILED',
        detail: row.errors.join('; ') || 'preview_error',
        attempted: false,
        financeTouched: false,
      });
      continue;
    }

    if (row.operation !== 'create') continue;

    if (stop) {
      results.push({
        rowNumber: row.rowNumber,
        matchKey,
        trackingType,
        outcome: 'NOT_PROCESSED',
        detail: 'stopped_after_prior_failure',
        attempted: false,
        financeTouched: false,
      });
      continue;
    }

    const name = String(row.data.item_name ?? '').trim();
    const ownershipKind = String(row.data.ownership_kind ?? '').trim();
    let categoryId = String(row.data.category_id ?? '').trim() || null;
    let locationId = String(row.data.location_id ?? '').trim() || null;
    const notes = String(row.data.notes ?? '').trim() || null;
    const sourceRef = String(row.data.source_ref ?? '').trim();
    const description = [sourceRef ? `source_ref=${sourceRef}` : null, notes]
      .filter(Boolean)
      .join('; ') || null;
    const estimatedRaw = String(row.data.estimated_value_eur ?? '').trim();
    const estimatedValueEur = estimatedRaw ? Number(estimatedRaw) : null;

    if (row.data.will_create_category === 'true' && args.fns.ensureCategory) {
      const catName =
        String(row.data.category_label ?? '').trim() ||
        String(row.data.category_code ?? '').trim();
      const catCode = (
        String(row.data.catalog_code_category ?? '').trim() || catName.toLowerCase()
      ).toLowerCase();
      const cached = categoryCache.get(catCode);
      if (cached) {
        categoryId = cached;
      } else {
        const ensured = await args.fns.ensureCategory({ code: catCode, name: catName });
        if (!ensured.ok) {
          results.push({
            rowNumber: row.rowNumber,
            matchKey,
            trackingType,
            outcome: classifyInventoryOpeningCommitError(ensured.message),
            detail: ensured.message,
            attempted: true,
            financeTouched: false,
          });
          // Catalog ensure failure is shared — stop so retry can fix once.
          stop = true;
          continue;
        }
        categoryCache.set(catCode, ensured.categoryId);
        categoryId = ensured.categoryId;
      }
    }
    if (row.data.will_create_location === 'true' && args.fns.ensureLocation) {
      const locName =
        String(row.data.location_label ?? '').trim() ||
        String(row.data.location_code ?? '').trim();
      const locCode = (
        String(row.data.catalog_code_location ?? '').trim() || locName.toLowerCase()
      ).toLowerCase();
      const cached = locationCache.get(locCode);
      if (cached) {
        locationId = cached;
      } else {
        const ensured = await args.fns.ensureLocation({ code: locCode, name: locName });
        if (!ensured.ok) {
          results.push({
            rowNumber: row.rowNumber,
            matchKey,
            trackingType,
            outcome: classifyInventoryOpeningCommitError(ensured.message),
            detail: ensured.message,
            attempted: true,
            financeTouched: false,
          });
          stop = true;
          continue;
        }
        locationCache.set(locCode, ensured.locationId);
        locationId = ensured.locationId;
      }
    }

    if (trackingType === 'INDIVIDUAL_ASSET') {
      const inventoryNumber = String(row.data.inventory_number ?? '').trim();
      const serialNumber = String(row.data.serial_number ?? '').trim() || null;
      const condition = String(row.data.condition ?? 'good').trim() || 'good';
      const existing = args.fns.findAssetByNumber
        ? await args.fns.findAssetByNumber(inventoryNumber)
        : null;
      let assetId = existing?.assetId ?? null;
      if (!assetId) {
        const created = await args.fns.createDraftAsset({
          inventoryNumber,
          name,
          ownershipKind,
          categoryId,
          locationId,
          serialNumber,
          condition,
          estimatedValueEur: Number.isFinite(estimatedValueEur as number)
            ? (estimatedValueEur as number)
            : null,
          description,
          idempotencyKey: args.idempotencyKeyForRow(row.rowNumber, 'asset'),
        });
        if (!created.ok) {
          const outcome = classifyInventoryOpeningCommitError(created.message);
          // Race: another worker created the same number — reuse if present.
          if (outcome === 'CONFLICT' && args.fns.findAssetByNumber) {
            const again = await args.fns.findAssetByNumber(inventoryNumber);
            if (again) {
              assetId = again.assetId;
            } else {
              results.push({
                rowNumber: row.rowNumber,
                matchKey,
                trackingType,
                outcome,
                detail: created.message,
                attempted: true,
                financeTouched: false,
              });
              continue;
            }
          } else {
            results.push({
              rowNumber: row.rowNumber,
              matchKey,
              trackingType,
              outcome,
              detail: created.message,
              attempted: true,
              financeTouched: false,
            });
            if (outcome === 'FAILED') stop = true;
            continue;
          }
        } else {
          assetId = created.assetId;
        }
      }
      const needsActivate =
        !existing ||
        existing.operationalStatus === 'draft' ||
        !existing.operationalStatus;
      if (needsActivate && assetId) {
        const act = await args.fns.activateAsset(assetId);
        if (!act.ok) {
          results.push({
            rowNumber: row.rowNumber,
            matchKey,
            trackingType,
            outcome: classifyInventoryOpeningCommitError(act.message),
            detail: act.message,
            attempted: true,
            financeTouched: false,
          });
          stop = true;
          continue;
        }
      }
      results.push({
        rowNumber: row.rowNumber,
        matchKey,
        trackingType,
        outcome: existing && existing.operationalStatus !== 'draft' ? 'SKIPPED_EXISTING' : 'CREATED',
        detail:
          existing && existing.operationalStatus !== 'draft'
            ? 'asset_already_present'
            : 'asset_created_activated',
        attempted: true,
        financeTouched: false,
      });
      continue;
    }

    // QUANTITY_STOCK
    const skuCode = String(row.data.sku_code ?? '').trim();
    const unitCode = String(row.data.unit_code ?? '').trim();
    const openingQty = Number(String(row.data.opening_qty ?? '').trim());
    let existingStock = args.fns.findStockBySku
      ? await args.fns.findStockBySku(skuCode)
      : null;
    let stockItemId = existingStock?.stockItemId ?? null;
    let createdStockInThisPass = false;
    if (!stockItemId) {
      const registered = await args.fns.registerStockItem({
        skuCode,
        name,
        ownershipKind,
        unitCode,
        categoryId,
        defaultLocationId: locationId,
        estimatedUnitValueEur: Number.isFinite(estimatedValueEur as number)
          ? (estimatedValueEur as number)
          : null,
        description,
        idempotencyKey: args.idempotencyKeyForRow(row.rowNumber, 'sku'),
      });
      if (!registered.ok) {
        const outcome = classifyInventoryOpeningCommitError(registered.message);
        if (outcome === 'CONFLICT' && args.fns.findStockBySku) {
          const again = await args.fns.findStockBySku(skuCode);
          if (again) {
            stockItemId = again.stockItemId;
            existingStock = again;
          } else {
            results.push({
              rowNumber: row.rowNumber,
              matchKey,
              trackingType,
              outcome,
              detail: registered.message,
              attempted: true,
              financeTouched: false,
            });
            continue;
          }
        } else {
          results.push({
            rowNumber: row.rowNumber,
            matchKey,
            trackingType,
            outcome,
            detail: registered.message,
            attempted: true,
            financeTouched: false,
          });
          if (outcome === 'FAILED') stop = true;
          continue;
        }
      } else {
        stockItemId = registered.stockItemId;
        createdStockInThisPass = true;
      }
    }
    if (!(openingQty > 0)) {
      results.push({
        rowNumber: row.rowNumber,
        matchKey,
        trackingType,
        outcome: existingStock && !createdStockInThisPass ? 'SKIPPED_EXISTING' : 'CREATED',
        detail: 'sku_registered_zero_opening',
        attempted: true,
        financeTouched: false,
      });
      continue;
    }
    if (existingStock?.hasOpeningMovement) {
      results.push({
        rowNumber: row.rowNumber,
        matchKey,
        trackingType,
        outcome: 'SKIPPED_EXISTING',
        detail: 'opening_already_posted',
        attempted: false,
        financeTouched: false,
      });
      continue;
    }
    const moved = await args.fns.postOpeningMove({
      stockItemId: stockItemId!,
      qty: openingQty,
      locationId,
      reason: sourceRef ? `opening:${sourceRef}` : 'opening_import',
      idempotencyKey: args.idempotencyKeyForRow(row.rowNumber, 'opening'),
    });
    if (!moved.ok) {
      const outcome = classifyInventoryOpeningCommitError(moved.message);
      results.push({
        rowNumber: row.rowNumber,
        matchKey,
        trackingType,
        outcome,
        detail: moved.message,
        attempted: true,
        financeTouched: false,
      });
      if (outcome === 'FAILED') stop = true;
      continue;
    }
    results.push({
      rowNumber: row.rowNumber,
      matchKey,
      trackingType,
      outcome: 'CREATED',
      detail:
        existingStock && !createdStockInThisPass
          ? 'opening_posted_for_existing_sku'
          : 'sku_registered_opening_posted',
      attempted: true,
      financeTouched: false,
    });
  }

  return summarize(results, stop);
}

/** Deterministic UUID-shaped key for retry-safe idempotency (not a crypto UUID). */
export function inventoryOpeningIdempotencyKey(
  batchId: string,
  rowNumber: number,
  kind: string,
): string {
  const seed = `${batchId}:${rowNumber}:${kind}`;
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  // Force unsigned before hex — JS bitwise XOR is signed and can yield "-61c88647".
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  const a = hex(h);
  const b = hex(h ^ 0x9e3779b9);
  const c = hex(Math.imul(h, 2654435761));
  const d = hex(Math.imul(h, 2246822519));
  // RFC 4122 layout: 8-4-4-4-12 (Postgres uuid requires a full 12-digit final group).
  return `${a}-${b.slice(0, 4)}-4${b.slice(5, 8)}-a${c.slice(1, 4)}-${c.slice(4)}${d}`;
}
