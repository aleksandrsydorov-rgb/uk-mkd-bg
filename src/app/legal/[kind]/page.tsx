'use client';

import { useParams } from 'next/navigation';
import { LegalDocumentView } from '@/components/public/LegalDocumentView';
import { isPortalLegalSlug } from '@/lib/portalLegal/kinds';

export default function LegalKindPage() {
  const params = useParams<{ kind: string }>();
  const kind = params.kind ?? '';
  if (!isPortalLegalSlug(kind)) {
    return <LegalDocumentView slug="terms" revisionId="missing" />;
  }
  return <LegalDocumentView slug={kind} />;
}
