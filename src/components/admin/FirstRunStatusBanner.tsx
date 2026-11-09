'use client';

import type { ReactNode } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2 } from 'lucide-react';
import styles from './FirstRunStatusBanner.module.css';

export type FirstRunStatusTone = 'success' | 'error' | 'warning';

export function FirstRunStatusBanner({
  tone,
  title,
  detail,
  children,
}: {
  tone: FirstRunStatusTone;
  title: string;
  detail?: string | null;
  children?: ReactNode;
}) {
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'error' ? AlertCircle : AlertTriangle;
  const toneClass = tone === 'success' ? styles.success : tone === 'error' ? styles.error : styles.warning;
  return (
    <div className={`${styles.banner} ${toneClass}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon className={styles.icon} aria-hidden="true" />
      <div className={styles.body}>
        <p className={styles.title}>{title}</p>
        {detail ? <p className={styles.detail}>{detail}</p> : null}
        {children}
      </div>
    </div>
  );
}

export function FirstRunStatusStack({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <div className={styles.stack}>{children}</div>;
}
