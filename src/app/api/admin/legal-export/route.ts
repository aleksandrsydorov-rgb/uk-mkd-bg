import { NextResponse } from 'next/server';
import { csvLine } from '@/lib/portalLegal/csv';
import { legalAdminServerCall } from '@/lib/portalLegal/adminServer';

export const dynamic = 'force-dynamic';

const KINDS = new Set(['portal_terms', 'privacy', 'cookies', 'house_rules', 'operator_contacts']);
const ACTIONS = new Set(['accept_terms', 'ack_privacy', 'ack_house_rules']);

function optional(value: string | null, allowed?: Set<string>) {
  const text = (value ?? '').trim();
  if (!text) return null;
  if (allowed && !allowed.has(text)) return undefined;
  return text;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const kind = optional(url.searchParams.get('kind'), KINDS);
  const action = optional(url.searchParams.get('action'), ACTIONS);
  const revision = optional(url.searchParams.get('revision'));
  const from = optional(url.searchParams.get('from'));
  const to = optional(url.searchParams.get('to'));
  const query = (url.searchParams.get('q') ?? '').slice(0, 120);
  if (kind === undefined || action === undefined) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }
  if (revision && !/^[0-9a-f-]{36}$/i.test(revision)) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }
  if ((from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) || (to && !/^\d{4}-\d{2}-\d{2}$/.test(to))) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }

  const result = await legalAdminServerCall('portal_legal_admin_acknowledgements', {
    p_query: query,
    p_kind: kind,
    p_revision_id: revision,
    p_action: action,
    p_from: from,
    p_to: to,
  });
  if (!result.ok) return NextResponse.json({ error: 'forbidden' }, { status: result.status });
  const rows = Array.isArray(result.data) ? result.data : [];
  const header = csvLine([
    'owner_email',
    'apartments',
    'document_kind',
    'revision_number',
    'revision_id',
    'action',
    'statement_text',
    'ui_locale',
    'document_locale',
    'confirmed_at',
    'body_sha256',
  ]);
  const lines = rows.map((row) => {
    const item = row as Record<string, unknown>;
    const apartments = Array.isArray(item.apartments) ? item.apartments.join(' ') : '';
    return csvLine([
      item.owner_email,
      apartments,
      item.document_kind,
      item.revision_number,
      item.revision_id,
      item.action,
      item.statement_text,
      item.ui_locale,
      item.document_locale,
      item.confirmed_at,
      item.body_sha256,
    ]);
  });
  const body = `\uFEFF${[header, ...lines].join('\n')}\n`;
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="legal-acknowledgements.csv"',
      'Cache-Control': 'private, no-store',
    },
  });
}
