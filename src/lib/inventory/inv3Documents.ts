/**
 * INV-3 — Inventory documents / storage contract (pure helpers).
 */

export const INV3_MIGRATION =
  'supabase/migrations/20261102120000_inv3_inventory_documents_storage.sql';

export const INV3_BUCKET = 'inventory-documents';

export const INV3_MAX_BYTES = 20 * 1024 * 1024; // 20 MiB

export const INV3_ALLOWED_MIME = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'image/bmp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
] as const;

export const INV3_DOC_KINDS = [
  'photo',
  'finding_photo',
  'purchase',
  'manual',
  'warranty',
  'assignment_act',
  'transfer_act',
  'maintenance',
  'write_off_act',
  'invoice',
  'act',
  'other',
] as const;

export const INV3_SCOPES = ['asset', 'stock', 'session-item', 'maintenance'] as const;

export const INV3_EXTENSIONS = [
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'heic',
  'heif',
  'bmp',
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'txt',
] as const;

export const INV3_RPCS = [
  'inventory_build_document_path',
  'inventory_register_document',
  'inventory_archive_document',
  'inventory_supersede_document',
  'inventory_list_documents_for_asset',
  'inventory_list_documents_for_session_item',
  'can_upload_inventory_document',
  'can_read_inventory_document',
  'inventory_object_name_ok',
  'inventory_document_mime_allowed',
  'inventory_safe_filename',
] as const;

const PATH_RE =
  /^inventory\/[a-z0-9_-]+\/(asset|stock|session-item|maintenance)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|gif|heic|heif|bmp|pdf|doc|docx|xls|xlsx|txt)$/;

export function inventoryObjectNameOk(path: string): boolean {
  if (!path || path.includes('..')) return false;
  return PATH_RE.test(path);
}

export function buildInventoryDocumentPath(args: {
  installKey: string;
  scope: (typeof INV3_SCOPES)[number];
  targetId: string;
  fileId: string;
  extension: string;
}): string {
  const ext = args.extension.toLowerCase().replace(/^\./, '');
  return `inventory/${args.installKey.toLowerCase()}/${args.scope}/${args.targetId}/${args.fileId}.${ext}`;
}

export function inventoryMimeAllowed(mime: string): boolean {
  return (INV3_ALLOWED_MIME as readonly string[]).includes(mime.toLowerCase().trim());
}

export function inventoryFileSizeOk(bytes: number): boolean {
  return Number.isFinite(bytes) && bytes >= 0 && bytes <= INV3_MAX_BYTES;
}

export function inventorySafeFilename(name: string): string {
  let v = name.trim();
  if (!v) return 'file';
  v = v.replace(/[\\/]+/g, '_');
  v = v.replace(/[^\w.\- ()[\]]+/g, '_');
  v = v.slice(0, 180);
  if (v === '.' || v === '..' || !v) return 'file';
  return v;
}

/** Concurrent finding photos: unique file UUID ⇒ no overwrite. */
export function concurrentFindingPhotosDoNotCollide(
  paths: ReadonlyArray<string>,
): boolean {
  return new Set(paths).size === paths.length && paths.every(inventoryObjectNameOk);
}

export type Inv3MigrationAnalysis = {
  hasBucket: boolean;
  bucketIsPrivate: boolean;
  hasPathHelpers: boolean;
  hasRegisterRpc: boolean;
  hasArchiveSupersede: boolean;
  hasStoragePolicies: boolean;
  noPublicUrls: boolean;
  noFinanceSideEffects: boolean;
  moduleNotAutoEnabled: boolean;
  missingRpcs: string[];
};

export function analyzeInv3MigrationSql(sql: string): Inv3MigrationAnalysis {
  const missingRpcs = INV3_RPCS.filter((r) => !sql.includes(`function public.${r}`));
  return {
    hasBucket: sql.includes("'inventory-documents'"),
    bucketIsPrivate: /inventory-documents[\s\S]{0,200}false/i.test(sql),
    hasPathHelpers:
      sql.includes('inventory_object_name_ok') &&
      sql.includes('inventory_build_document_path'),
    hasRegisterRpc: sql.includes('inventory_register_document'),
    hasArchiveSupersede:
      sql.includes('inventory_archive_document') &&
      sql.includes('inventory_supersede_document'),
    hasStoragePolicies:
      sql.includes('inventory_documents_storage_select') &&
      sql.includes('inventory_documents_storage_insert'),
    noPublicUrls:
      /Private bucket only/i.test(sql) &&
      /signed URLs after auth/i.test(sql) &&
      !/insert\s+into\s+storage\.buckets[\s\S]{0,80}public\s*,\s*true/i.test(sql) &&
      sql.includes("public = false"),
    noFinanceSideEffects:
      !/insert\s+into\s+public\.uk_expenses\b/i.test(sql) &&
      !/insert\s+into\s+public\.support_fee/i.test(sql) &&
      !/charge_support_fee/i.test(sql),
    moduleNotAutoEnabled:
      !/update\s+public\.building_modules[\s\S]{0,200}enabled\s*=\s*true/i.test(sql) &&
      /implemented\s*=\s*false/i.test(sql),
    missingRpcs,
  };
}
