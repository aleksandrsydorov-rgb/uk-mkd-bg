import { Suspense } from 'react';
import { OwnerOnboardingScreen } from '@/components/account/OwnerOnboardingScreen';

export default function OwnerOnboardingPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted">…</div>}>
      <OwnerOnboardingScreen />
    </Suspense>
  );
}
