import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import {
  BUILDING_DOCUMENTS_BUCKET,
  MAX_BUILDING_DOCUMENT_BYTES,
  buildPrivateStoragePath,
} from '@/lib/buildingDocuments';
import { htmlToPdfBlob, looksLikePdf } from '@/lib/pdfDownload';

export type ExtractRow = Database['public']['Tables']['property_book_extracts']['Row'];

async function attachExtractPdfViaTrustedApi(options: {
  extractId: number;
  buildingDocumentId: string;
}): Promise<{ ok: true; pdf_sha256?: string; result?: unknown }> {
  const res = await fetch('/api/ownership/attach-extract-pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({
      extractId: options.extractId,
      buildingDocumentId: options.buildingDocumentId,
    }),
  });
  const payload = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    pdf_sha256?: string;
    result?: unknown;
  };
  if (!res.ok || !payload.ok) {
    throw new Error(payload.error || `attach_failed_${res.status}`);
  }
  return { ok: true, pdf_sha256: payload.pdf_sha256, result: payload.result };
}

export async function generateAndAttachPropertyBookPdfs(options: {
  supabase: SupabaseClient<Database>;
  propertyId: number;
  sessionEmail: string | null;
  locales?: string[];
}): Promise<{
  ok: true;
  linked_group_id: string;
  base_number: string;
  attached: Array<{ extract_id: number; locale: string; has_pdf: boolean; storage_path: string }>;
}> {
  const { supabase, propertyId, sessionEmail } = options;
  const locales = options.locales ?? ['bg', 'ru', 'en'];

  const { data, error } = await supabase.rpc('owner_generate_property_book_extract', {
    p_property_id: propertyId,
    p_locales: locales,
  });
  if (error) throw error;
  const result = data as {
    ok?: boolean;
    linked_group_id?: string;
    base_number?: string;
    extract_ids?: number[];
  };
  const ids = result.extract_ids ?? [];
  if (!ids.length) throw new Error('No extract ids returned');

  const attached: Array<{
    extract_id: number;
    locale: string;
    has_pdf: boolean;
    storage_path: string;
  }> = [];

  for (const id of ids) {
    const { data: frozen, error: getErr } = await supabase.rpc('owner_get_property_book_extract', {
      p_extract_id: id,
    });
    if (getErr) throw getErr;
    const row = frozen as {
      id: number;
      locale: string;
      extract_number: string;
      content_html: string;
      has_pdf?: boolean;
      storage_path?: string | null;
      building_document_id?: string | null;
    };
    if (row.has_pdf) {
      attached.push({
        extract_id: id,
        locale: row.locale,
        has_pdf: true,
        storage_path: row.storage_path ?? '',
      });
      continue;
    }

    // Retry path: extract exists, prior upload may have a draft document already bound by title.
    // Always upload a fresh private object for this attach attempt; abandoned drafts stay private.
    const blob = await htmlToPdfBlob(row.content_html);
    const bytes = await blob.arrayBuffer();
    if (!looksLikePdf(bytes)) {
      throw new Error(`PDF magic bytes missing for extract ${row.extract_number}`);
    }
    if (blob.size > MAX_BUILDING_DOCUMENT_BYTES) {
      throw new Error('PDF too large');
    }

    const file = new File([blob], `${row.extract_number}.pdf`, { type: 'application/pdf' });
    const built = buildPrivateStoragePath({
      scopeId: crypto.randomUUID(),
      file,
      folder: 'documents',
    });
    if (!built.ok) throw new Error('storage path failed');

    const up = await supabase.storage
      .from(BUILDING_DOCUMENTS_BUCKET)
      .upload(built.storagePath, file, { upsert: false, contentType: 'application/pdf' });
    if (up.error) throw up.error;

    const { error: docErr } = await supabase.from('building_documents').insert({
      id: built.objectId,
      category: 'other',
      title: `Property Book extract ${row.extract_number}`,
      storage_path: built.storagePath,
      mime_type: 'application/pdf',
      file_size: file.size,
      status: 'draft',
      created_by_email: sessionEmail,
    });
    if (docErr) {
      await supabase.storage.from(BUILDING_DOCUMENTS_BUCKET).remove([built.storagePath]);
      throw docErr;
    }

    try {
      // Server downloads private object, checks %PDF magic + SHA; client checksum not trusted.
      await attachExtractPdfViaTrustedApi({
        extractId: id,
        buildingDocumentId: built.objectId,
      });
    } catch (attachErr) {
      // Keep storage + document for retry (partial failure: upload ok, attach failed).
      // Extract remains has_pdf=false. Caller may retry attach for the same extract id.
      throw attachErr;
    }

    attached.push({
      extract_id: id,
      locale: row.locale,
      has_pdf: true,
      storage_path: built.storagePath,
    });
  }

  return {
    ok: true,
    linked_group_id: String(result.linked_group_id ?? ''),
    base_number: String(result.base_number ?? ''),
    attached,
  };
}

export async function downloadAttachedExtractPdf(options: {
  supabase: SupabaseClient<Database>;
  extractId: number;
  filename?: string;
}) {
  const { data, error } = await options.supabase.rpc('owner_get_property_book_extract', {
    p_extract_id: options.extractId,
  });
  if (error) throw error;
  const row = data as {
    has_pdf?: boolean;
    storage_path?: string | null;
    extract_number?: string;
    content_html?: string;
  };
  if (!row.has_pdf || !row.storage_path) {
    throw new Error('PDF_NOT_ATTACHED');
  }
  const { data: file, error: dlErr } = await options.supabase.storage
    .from(BUILDING_DOCUMENTS_BUCKET)
    .download(row.storage_path);
  if (dlErr || !file) throw dlErr ?? new Error('download failed');
  const bytes = await file.arrayBuffer();
  if (!looksLikePdf(bytes)) throw new Error('Stored file is not a PDF');
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = options.filename ?? `${row.extract_number ?? 'extract'}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
