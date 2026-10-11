import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { BUILDING_DOCUMENTS_BUCKET } from '@/lib/buildingDocuments';
import { looksLikePdf, sha256HexOfBlob } from '@/lib/pdfDownload';

export const runtime = 'nodejs';

type Body = {
  extractId?: number;
  buildingDocumentId?: string;
};

/**
 * Trusted server path for Property Book extract PDF attachment.
 * Downloads the private storage object with the caller's session,
 * verifies %PDF magic + SHA-256, then calls owner_verify_and_attach_extract_pdf.
 * No public URLs. Does not trust client-supplied checksums as authenticity proof.
 */
export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const extractId = Number(body.extractId);
  const buildingDocumentId = String(body.buildingDocumentId ?? '').trim();
  if (!Number.isFinite(extractId) || extractId <= 0 || !buildingDocumentId) {
    return NextResponse.json({ error: 'invalid_args' }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { data: doc, error: docErr } = await supabase
    .from('building_documents')
    .select('id, storage_path, mime_type, title, created_by_email')
    .eq('id', buildingDocumentId)
    .maybeSingle();
  if (docErr || !doc?.storage_path) {
    return NextResponse.json({ error: 'document_not_found' }, { status: 404 });
  }

  const { data: file, error: dlErr } = await supabase.storage
    .from(BUILDING_DOCUMENTS_BUCKET)
    .download(doc.storage_path);
  if (dlErr || !file) {
    return NextResponse.json({ error: 'storage_download_failed' }, { status: 404 });
  }

  const bytes = await file.arrayBuffer();
  if (!looksLikePdf(bytes)) {
    return NextResponse.json({ error: 'not_a_pdf' }, { status: 422 });
  }

  const sha = await sha256HexOfBlob(new Blob([bytes]));

  const { data, error } = await supabase.rpc('owner_verify_and_attach_extract_pdf', {
    p_extract_id: extractId,
    p_building_document_id: buildingDocumentId,
    p_pdf_sha256: sha,
    p_magic_ok: true,
  });

  if (error) {
    return NextResponse.json(
      { error: error.message, code: error.code ?? null },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true, result: data, pdf_sha256: sha });
}
