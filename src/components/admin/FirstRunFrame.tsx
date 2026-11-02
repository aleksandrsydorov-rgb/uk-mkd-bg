'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  BadgeCheck,
  BookOpen,
  Building2,
  Check,
  ChevronDown,
  CircleDollarSign,
  Droplets,
  Gauge,
  House,
  Landmark,
  Receipt,
  Users,
  Wallet,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { FirstRunStageKey, FirstRunStageRow } from '@/lib/firstRun';
import styles from './FirstRunFrame.module.css';

const STAGE_ICON: Record<FirstRunStageKey, LucideIcon> = {
  welcome: House,
  complex_card: Building2,
  property_book: BookOpen,
  meters_select: Gauge,
  meters_water: Droplets,
  meters_electricity: Zap,
  support_fee_opening: CircleDollarSign,
  capital_repair_opening: Landmark,
  tariffs: Receipt,
  budget: Wallet,
  complete: BadgeCheck,
};

const ICON_CLASS: Record<FirstRunStageKey, string> = {
  welcome: 'text-teal-700',
  complex_card: 'text-teal-600',
  property_book: 'text-indigo-600',
  meters_select: 'text-amber-600',
  meters_water: 'text-sky-600',
  meters_electricity: 'text-yellow-600',
  support_fee_opening: 'text-emerald-600',
  capital_repair_opening: 'text-orange-700',
  tariffs: 'text-violet-600',
  budget: 'text-emerald-700',
  complete: 'text-teal-700',
};

type FrameProps = {
  t: (key: string) => string;
  stages: FirstRunStageKey[];
  stage: FirstRunStageKey;
  stageRows: FirstRunStageRow[] | undefined;
  stageLabel: (key: FirstRunStageKey) => string;
  /** Visual shell only. The wizard leaves the mobile list collapsed. */
  initialStepsOpen?: boolean;
  children: ReactNode;
};

function isStageComplete(key: FirstRunStageKey, rows: FirstRunStageRow[] | undefined): boolean {
  return rows?.some((row) => row.stage_key === key && row.status === 'complete') ?? false;
}

export function FirstRunFrame({ t, stages, stage, stageRows, stageLabel, initialStepsOpen = false, children }: FrameProps) {
  const [open, setOpen] = useState(initialStepsOpen);
  const index = Math.max(0, stages.indexOf(stage));
  const progress = t('admin.firstRunProgress')
    .replace('{n}', String(index + 1))
    .replace('{total}', String(stages.length));
  const CurrentIcon = STAGE_ICON[stage];
  const seenStage = useRef(stage);

  useEffect(() => {
    if (seenStage.current === stage) return;
    seenStage.current = stage;
    setOpen(false);
  }, [stage]);

  function renderStep(key: FirstRunStageKey) {
    const current = key === stage;
    const complete = isStageComplete(key, stageRows);
    const Icon = STAGE_ICON[key];
    return (
      <li
        key={key}
        className={`${styles.step} ${current ? styles.stepCurrent : ''}`}
        aria-current={current ? 'step' : undefined}
      >
        <Icon className={`${styles.stepIcon} ${ICON_CLASS[key]}`} aria-hidden="true" />
        <span className={styles.stepLabel}>{stageLabel(key)}</span>
        {complete ? (
          <>
            <Check className={styles.check} aria-hidden="true" />
            <span className={styles.srOnly}>{t('admin.firstRunStageDone')}</span>
          </>
        ) : null}
      </li>
    );
  }

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar} aria-label={t('admin.firstRunTitle')}>
        <div className={styles.panel}>
          <p className={styles.sideTitle}>{t('admin.firstRunTitle')}</p>
          <ol className={styles.steps} aria-label={t('admin.firstRunStepsToggle')}>
            {stages.map(renderStep)}
          </ol>
          <p className={styles.progress}>{progress}</p>
        </div>
      </aside>

      <div className={styles.work}>
        <div className={`${styles.panel} ${styles.mobile}`}>
          <button
            type="button"
            className={styles.mobileToggle}
            aria-expanded={open}
            aria-controls="first-run-step-list"
            onClick={() => setOpen((value) => !value)}
          >
            <CurrentIcon className={`${styles.stepIcon} ${ICON_CLASS[stage]}`} aria-hidden="true" />
            <span className={styles.mobileText}>
              <span className={styles.mobileCurrent}>{stageLabel(stage)}</span>
              <span className={styles.progress}>{progress}</span>
            </span>
            <ChevronDown className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`} aria-hidden="true" />
          </button>
          <ol
            id="first-run-step-list"
            className={`${styles.steps} ${styles.mobileList}`}
            aria-label={t('admin.firstRunStepsToggle')}
            hidden={!open}
          >
            {stages.map(renderStep)}
          </ol>
        </div>
        {children}
      </div>
    </div>
  );
}

const WELCOME_CARDS: Array<{
  title: string;
  hint: string;
  icon: LucideIcon;
  iconClass: string;
}> = [
  {
    title: 'admin.firstRunWelcomeCardComplex',
    hint: 'admin.firstRunWelcomeCardComplexHint',
    icon: Building2,
    iconClass: 'text-teal-700',
  },
  {
    title: 'admin.firstRunWelcomeCardOwners',
    hint: 'admin.firstRunWelcomeCardOwnersHint',
    icon: Users,
    iconClass: 'text-indigo-600',
  },
  {
    title: 'admin.firstRunWelcomeCardMeters',
    hint: 'admin.firstRunWelcomeCardMetersHint',
    icon: Gauge,
    iconClass: 'text-amber-600',
  },
  {
    title: 'admin.firstRunWelcomeCardFinance',
    hint: 'admin.firstRunWelcomeCardFinanceHint',
    icon: Wallet,
    iconClass: 'text-emerald-600',
  },
];

export function FirstRunWelcome({
  t,
  busy,
  onStart,
}: {
  t: (key: string) => string;
  busy: boolean;
  onStart: () => void;
}) {
  return (
    <section className={styles.welcome}>
      <h2 className={styles.welcomeTitle}>{t('admin.firstRunWelcomeTitle')}</h2>
      <p className={styles.welcomeBody}>{t('admin.firstRunWelcomeBody')}</p>
      <ul className={styles.cards}>
        {WELCOME_CARDS.map((card) => {
          const Icon = card.icon;
          return (
            <li key={card.title} className={styles.card}>
              <Icon className={`h-4 w-4 ${card.iconClass}`} aria-hidden="true" />
              <p className={styles.cardTitle}>{t(card.title)}</p>
              <p className={styles.cardHint}>{t(card.hint)}</p>
            </li>
          );
        })}
      </ul>
      <button type="button" className={styles.start} disabled={busy} onClick={onStart}>
        {busy ? t('admin.firstRunBusy') : t('admin.firstRunWelcomeStart')}
      </button>
    </section>
  );
}
