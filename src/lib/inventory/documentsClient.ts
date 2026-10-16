/**
 * INV-3/4 — Client document upload + signed URL helpers.
 * Never uses service_role. Signed URLs only after Storage RLS allows SELECT.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import {
  INV3_BUCKET,
  INV3_MAX_BYTES,
  buildInventoryDocumentPath,
  inventoryMimeAllowed,
  inventorySafeFilename,
  type INV3_SCOPES,
} from './inv3Documents';
import { inventoryRpc } from './admin';

export { INV3_BUCKET, INV3_MAX_BYTES };

export class InventoryDocumentValidationError extends Error {
  readonly reason: 'type' | 'size' | 'path';

  constructor(reason: 'type' | 'size' | 'path') {
    super(`inventory_doc_${reason}`);
    this.name = 'InventoryDocumentValidationError';
    this.reason = reason;
  }
}

export function inventoryExtensionFromFile(file: File): string {
  const name = file.name || '';
  const dot = name.lastIndexOf('.');
  const raw = (dot >= 0 ? name.slice(dot + 1) : '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (raw === 'jpeg') return 'jpg';
  if (
    [
      'jpg',
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
    ].includes(raw)
  ) {
    return raw;
  }
  const mime = file.type.toLowerCase();
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'application/pdf') return 'pdf';
  return 'bin';
}

export async function createInventorySignedUrl(
  supabase: SupabaseClient<Database>,
  storagePath: string,
  expiresIn = 600,
): Promise<string | null> {
  const path = storagePath.trim();
  if (!path || path.includes('..') || path.startsWith('http')) return null;
  const { data, error } = await supabase.storage
    .from(INV3_BUCKET)
    .createSignedUrl(path, expiresIn);
  if (error) return null;
  return data?.signedUrl ?? null;
}

export async function uploadAndRegisterInventoryDocument(args: {
  supabase: SupabaseClient<Database>;
  file: File;
  scope: (typeof INV3_SCOPES)[number];
  targetId: string;
  title: string;
  docKind: string;
  installKey?: string;
  sessionItemRowVersion?: number | null;
  note?: string | null;
}): Promise<{ documentId: string; storagePath: string }> {
  const mime = (args.file.type || '').toLowerCase().split(';')[0].trim();
  if (!inventoryMimeAllowed(mime)) {
    throw new InventoryDocumentValidationError('type');
  }
  if (args.file.size > INV3_MAX_BYTES) {
    throw new InventoryDocumentValidationError('size');
  }
  const ext = inventoryExtensionFromFile(args.file);
  if (ext === 'bin') throw new InventoryDocumentValidationError('type');

  const fileId = crypto.randomUUID();
  const installKey = (args.installKey ?? 'default').toLowerCase();

  const { data: built, error: buildErr } = await inventoryRpc<string>(
    args.supabase,
    'inventory_build_document_path',
    {
      p_scope: args.scope,
      p_target_id: args.targetId,
      p_file_id: fileId,
      p_extension: ext,
    },
  );
  const storagePath =
    built ??
    buildInventoryDocumentPath({
      installKey,
      scope: args.scope,
      targetId: args.targetId,
      fileId,
      extension: ext,
    });
  if (buildErr && !built) {
    throw new Error(buildErr.message);
  }

  const { error: upErr } = await args.supabase.storage
    .from(INV3_BUCKET)
    .upload(storagePath, args.file, { upsert: false, contentType: mime });
  if (upErr) throw upErr;

  const targets = {
    p_asset_id: args.scope === 'asset' ? args.targetId : null,
    p_stock_item_id: args.scope === 'stock' ? args.targetId : null,
    p_session_item_id: args.scope === 'session-item' ? args.targetId : null,
    p_maintenance_event_id: args.scope === 'maintenance' ? args.targetId : null,
  };

  const { data: doc, error: regErr } = await inventoryRpc<{ id: string }>(
    args.supabase,
    'inventory_register_document',
    {
      p_storage_path: storagePath,
      p_title: args.title.trim() || inventorySafeFilename(args.file.name),
      p_doc_kind: args.docKind,
      p_mime_type: mime,
      p_byte_size: args.file.size,
      p_original_filename: inventorySafeFilename(args.file.name),
      ...targets,
      p_session_item_row_version: args.sessionItemRowVersion ?? null,
      p_note: args.note ?? null,
    },
  );
  if (regErr || !doc?.id) {
    throw new Error(regErr?.message ?? 'register_failed');
  }
  return { documentId: String(doc.id), storagePath };
}
