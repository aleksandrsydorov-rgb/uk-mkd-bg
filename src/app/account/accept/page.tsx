'use client';

import { Suspense } from 'react';
import { PortalAcceptanceScreen } from '@/components/public/PortalAcceptanceScreen';

export default function AccountAcceptPage() {
  return (
    <Suspense fallback={null}>
      <PortalAcceptanceScreen />
    </Suspense>
  );
}
