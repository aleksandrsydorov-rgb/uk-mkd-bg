import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { FirstRunVisualShell } from './shell';

/** Dev-only visual fixture. Production responds 404. No auth bypass and no database. */
export default function FirstRunVisualPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <Suspense fallback={null}>
      <FirstRunVisualShell />
    </Suspense>
  );
}
