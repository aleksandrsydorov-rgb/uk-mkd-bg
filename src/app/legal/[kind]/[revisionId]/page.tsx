'use client';

import { useParams } from 'next/navigation';
import { LegalDocumentView } from '@/components/public/LegalDocumentView';
import { isPortalLegalSlug } from '@/lib/portalLegal/kinds';

export default function LegalRevisionPage() {
  const params = useParams<{ kind: string; revisionId: string }>();
  const kind = params.kind ?? '';
  if (!isPortalLegalSlug(kind)) {
    return <LegalDocumentView slug="terms" revisionId="missing" />;
  }
  return <LegalDocumentView slug={kind} revisionId={params.revisionId} />;
}
