'use client';

import { I18nProvider } from '@/i18n/I18nProvider';
import type { ReactNode } from 'react';

export function Providers({ children }: { children: ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>;
}
