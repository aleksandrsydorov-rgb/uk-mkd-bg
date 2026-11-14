'use client';

import Link from 'next/link';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { useI18n } from '@/i18n/I18nProvider';
import { OPERATOR_FACTS } from '@/lib/portalLegal/operatorFacts';

const LINKS = [
  ['/legal/operator', 'legal.linkContacts'],
  ['/legal/terms', 'legal.linkTerms'],
  ['/legal/privacy', 'legal.linkPrivacy'],
  ['/legal/cookies', 'legal.linkCookies'],
  ['/legal/house-rules', 'legal.linkRules'],
] as const;

export function PublicFooter({ cabinetHref = '#resident-login' }: { cabinetHref?: string }) {
  const { t } = useI18n();
  return (
    <footer className="home-foot">
      <div className="home-foot-inner">
        <nav className="home-foot-nav" aria-label={t('home.navTitle')}>
          <Link href="/" className="home-foot-nav-link">
            {t('home.footerNavHome')}
          </Link>
          <span className="home-foot-sep" aria-hidden="true" />
          <a href="/#infrastructure" className="home-foot-nav-link">
            {t('home.navFacilities')}
          </a>
          <span className="home-foot-sep" aria-hidden="true" />
          <a href="/#location" className="home-foot-nav-link">
            {t('home.navLocation')}
          </a>
          <span className="home-foot-sep" aria-hidden="true" />
          <Link href={cabinetHref} className="home-foot-nav-link">
            {t('home.personalCabinet')}
          </Link>
        </nav>
        <p className="legal-foot-identity">
          {t('legal.footerComplex')}
          <span> · {OPERATOR_FACTS.operatorName}</span>
        </p>
        <p className="legal-foot-identity legal-foot-identity-sub">{t('legal.footerOperator')}</p>
        <nav className="home-foot-extra" aria-label={t('legal.linkContacts')}>
          {LINKS.map(([href, key], index) => (
            <span key={href} className="home-foot-extra-item">
              {index > 0 ? <span className="home-foot-sep home-foot-sep-muted" aria-hidden="true" /> : null}
              <Link href={href} className="home-foot-nav-link">
                {t(key)}
              </Link>
            </span>
          ))}
        </nav>
        <div className="home-foot-bar">
          <p className="home-foot-copy">{t('home.footerCopy', { year: new Date().getFullYear() })}</p>
          <LanguageSwitcher variant="plain" />
          <button
            type="button"
            className="home-foot-top"
            aria-label={t('home.footerTop')}
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
              <path d="M12 19V6M6.5 11.5 12 6l5.5 5.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    </footer>
  );
}
