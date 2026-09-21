'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AmadeusFullLogo, BrandMark } from '@/components/BrandMark';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { LoginScreen } from '@/components/LoginScreen';
import {
  AtmosphereCard,
  FacadeIllustration,
  LocationDiagram,
  PoolIllustration,
} from '@/components/home/ComplexVisuals';
import { useI18n } from '@/i18n/I18nProvider';
import { resolveAccess } from '@/lib/access';
import { normalizeEmail } from '@/lib/email';
import { createClient } from '@/lib/supabase/client';

function FacilityIcon({ kind }: { kind: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-8 w-8 text-accent" fill="none" stroke="currentColor" strokeWidth="1.5">
      {kind === 'pool' && <path d="M4 16c1.5 0 1.5-2 3-2s1.5 2 3 2 1.5-2 3-2 1.5 2 3 2 1.5-2 3-2M5 8h14M8 8V6m8 2V6" />}
      {kind === 'kids' && <circle cx="12" cy="8" r="3" />}
      {kind === 'kids' && <path d="M6 19c1-3 3.5-5 6-5s5 2 6 5" />}
      {kind === 'park' && <rect x="4" y="11" width="16" height="8" rx="1" />}
      {kind === 'park' && <path d="M7 11V8l5-3 5 3v3" />}
      {kind === 'lift' && <rect x="7" y="3" width="10" height="18" rx="1" />}
      {kind === 'lift' && <path d="M12 8v8M9 11l3-3 3 3M9 13l3 3 3-3" />}
      {kind === 'green' && <path d="M12 20c0-8 6-10 6-14a6 6 0 00-12 0c0 4 6 6 6 14z" />}
      {kind === 'access' && <rect x="5" y="11" width="14" height="10" rx="1" />}
      {kind === 'access' && <path d="M8 11V8a4 4 0 018 0v3" />}
      {kind === 'lounge' && <path d="M4 15h16v3H4zM6 15V10h12v5M8 10V8h8v2" />}
      {kind === 'service' && <circle cx="12" cy="12" r="3" />}
      {kind === 'service' && <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />}
    </svg>
  );
}

export default function HomePage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [cabinetHref, setCabinetHref] = useState('#resident-login');
  const { t } = useI18n();
  const router = useRouter();
  const [supabase] = useState(() => createClient());

  const nav = [
    { label: t('home.navAbout'), href: '#about' },
    { label: t('home.navFacilities'), href: '#facilities' },
    { label: t('home.navLocation'), href: '#location' },
    { label: t('home.navResidents'), href: '#residents' },
  ];

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getUser();
      const authenticatedEmail = normalizeEmail(data.user?.email ?? '');
      if (!authenticatedEmail) {
        if (!cancelled) setCabinetHref('#resident-login');
        return;
      }
      try {
        const access = await resolveAccess(authenticatedEmail, supabase);
        if (cancelled) return;
        if (access.isStaff) setCabinetHref('/admin');
        else if (access.isOwner) setCabinetHref('/account');
        else setCabinetHref('#resident-login');
      } catch {
        if (!cancelled) setCabinetHref('#resident-login');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    const nextEmail = normalizeEmail(email);
    if (!nextEmail || !password) return;
    setLoginLoading(true);
    setLoginError('');
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: nextEmail,
        password,
      });
      if (error) {
        setLoginError(error.message);
        return;
      }
      const authenticatedEmail = normalizeEmail(data.user?.email ?? '');
      if (!authenticatedEmail) {
        setLoginError('No email on authenticated user');
        return;
      }
      const access = await resolveAccess(authenticatedEmail, supabase);
      router.replace(access.isStaff ? '/admin' : '/account');
    } catch (err: unknown) {
      setLoginError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setLoginLoading(false);
    }
  }

  const cabinetLabel =
    cabinetHref === '/account' || cabinetHref === '/admin'
      ? t('home.openAccount')
      : t('home.personalCabinet');

  const facts = [
    { title: t('home.factFloors'), hint: t('home.factFloorsHint') },
    { title: t('home.factAct'), hint: t('home.factActHint') },
    { title: t('home.factLift'), hint: t('home.factLiftHint') },
    { title: t('home.factYear'), hint: t('home.factYearHint') },
    { title: t('home.factBeach'), hint: t('home.factBeachHint') },
  ];

  const facilities = [
    { label: t('home.facPool'), icon: 'pool' },
    { label: t('home.facKids'), icon: 'kids' },
    { label: t('home.facParking'), icon: 'park' },
    { label: t('home.facLift'), icon: 'lift' },
    { label: t('home.facGreen'), icon: 'green' },
    { label: t('home.facAccess'), icon: 'access' },
    { label: t('home.facLounge'), icon: 'lounge' },
    { label: t('home.facService'), icon: 'service' },
  ];

  const places = [
    { title: t('home.locBeach'), hint: t('home.locBeachHint') },
    { title: t('home.locShops'), hint: t('home.locNear') },
    { title: t('home.locCafe'), hint: t('home.locNear') },
    { title: t('home.locTransport'), hint: t('home.locNear') },
    { title: t('home.locNessebar'), hint: t('home.locNessebarHint') },
  ];

  return (
    <div className="min-h-screen bg-home text-foreground">
      <header
        className={`sticky top-0 z-40 transition-colors duration-300 ${
          scrolled ? 'border-b border-border bg-surface shadow-card' : 'border-b border-transparent bg-home/80 backdrop-blur-md'
        }`}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <BrandMark compact showTagline={false} />
          <nav className="hidden items-center gap-1 lg:flex">
            {nav.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-2 text-sm text-secondary transition hover:bg-hover hover:text-foreground"
              >
                {item.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-1.5">
            <div className="hidden sm:block">
              <LanguageSwitcher compact />
            </div>
            <a
              href={cabinetHref}
              className="inline-flex min-h-10 items-center rounded-[10px] bg-accent px-3 py-2 text-sm font-semibold text-white hover:bg-accent-hover"
            >
              {cabinetLabel}
            </a>
            <button
              type="button"
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border lg:hidden"
              aria-label={t('common.menu')}
              onClick={() => setMenuOpen((v) => !v)}
            >
              {menuOpen ? '✕' : '☰'}
            </button>
          </div>
        </div>
        {menuOpen && (
          <div className="border-t border-border bg-surface px-4 py-3 lg:hidden">
            <div className="mb-2 sm:hidden">
              <LanguageSwitcher compact />
            </div>
            {nav.map((item) => (
              <a
                key={item.href}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                className="block rounded-lg px-3 py-2.5 text-sm text-secondary hover:bg-hover"
              >
                {item.label}
              </a>
            ))}
          </div>
        )}
      </header>

      <section className="mx-auto grid min-h-[80vh] max-w-6xl items-center gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[0.45fr_0.55fr] lg:py-16">
        <div className="home-fade">
          <p className="text-xs font-medium tracking-[0.14em] text-sea">{t('home.eyebrow')}</p>
          <h1 className="mt-3 font-bold leading-[0.92] tracking-[0.02em] text-[42px] sm:text-6xl lg:text-[72px]">
            AMADEUS
            <span className="mt-1 block text-accent">11</span>
          </h1>
          <p className="mt-5 max-w-md text-lg leading-relaxed text-secondary">{t('home.heroSubtitle')}</p>
          <p className="mt-2 max-w-md text-[15px] leading-relaxed text-muted">{t('home.heroLead')}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <a
              href={cabinetHref}
              className="inline-flex min-h-11 items-center justify-center rounded-[10px] bg-accent px-5 text-sm font-semibold text-white hover:bg-accent-hover"
            >
              {cabinetLabel}
            </a>
            <a
              href="#about"
              className="inline-flex min-h-11 items-center justify-center rounded-[10px] border border-border-strong bg-surface px-5 text-sm font-medium text-foreground hover:bg-hover"
            >
              {t('home.ctaAbout')}
            </a>
          </div>
        </div>
        <div className="home-fade">
          <FacadeIllustration caption={t('brand.name')} place={t('home.aboutCaptionPlace')} />
        </div>
      </section>

      <section className="border-y border-border bg-surface">
        <div className="mx-auto grid max-w-6xl gap-px bg-border px-0 sm:grid-cols-2 lg:grid-cols-5">
          {facts.map((item) => (
            <div key={item.title} className="bg-surface px-5 py-5">
              <div className="text-sm font-semibold">{item.title}</div>
              <div className="mt-1 text-sm text-muted">{item.hint}</div>
            </div>
          ))}
        </div>
      </section>

      <section id="about" className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:items-center">
        <div>
          <h2 className="text-3xl font-semibold tracking-tight">{t('home.aboutTitle')}</h2>
          <p className="mt-4 max-w-xl text-[16px] leading-[1.7] text-secondary">{t('home.aboutP1')}</p>
          <p className="mt-4 max-w-xl text-[16px] leading-[1.7] text-secondary">{t('home.aboutP2')}</p>
        </div>
        <FacadeIllustration caption={t('brand.name')} place={t('home.aboutCaptionPlace')} />
      </section>

      <section id="facilities" className="bg-surface-warm">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="text-3xl font-semibold tracking-tight">{t('home.facilitiesTitle')}</h2>
          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {facilities.map((item) => (
              <div key={item.label} className="rounded-[16px] border border-border bg-surface px-4 py-4 shadow-card">
                <FacilityIcon kind={item.icon} />
                <div className="mt-3 text-[16px] font-medium">{item.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2">
        <PoolIllustration />
        <div>
          <h2 className="text-3xl font-semibold tracking-tight">{t('home.poolTitle')}</h2>
          <p className="mt-4 max-w-xl text-[16px] leading-[1.7] text-secondary">{t('home.poolText')}</p>
        </div>
      </section>

      <section className="bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="text-3xl font-semibold tracking-tight">{t('home.atmosphereTitle')}</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <AtmosphereCard title={t('home.atmCourtyard')} variant="yard" />
            <AtmosphereCard title={t('home.atmPool')} variant="pool" />
            <AtmosphereCard title={t('home.atmGrounds')} variant="grounds" />
            <AtmosphereCard title={t('home.atmFacade')} variant="facade" />
          </div>
        </div>
      </section>

      <section id="location" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="text-3xl font-semibold tracking-tight">{t('home.locationTitle')}</h2>
        <p className="mt-2 text-xl text-secondary">{t('home.locationHeading')}</p>
        <p className="mt-4 max-w-2xl text-[16px] leading-[1.7] text-secondary">{t('home.locationText')}</p>
        <div className="mt-8 grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
          <div className="grid gap-3 sm:grid-cols-2">
            {places.map((item) => (
              <div key={item.title} className="rounded-[16px] border border-border bg-surface px-4 py-4 shadow-card">
                <div className="font-medium">{item.title}</div>
                <div className="mt-1 text-sm text-muted">{item.hint}</div>
              </div>
            ))}
          </div>
          <LocationDiagram
            sunny={t('home.mapSunny')}
            sea={t('home.mapSea')}
            nessebar={t('home.mapNessebar')}
            hint={t('home.mapHint')}
          />
        </div>
      </section>

      <section id="residents" className="bg-surface-warm">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-semibold tracking-tight">{t('home.residentsTitle')}</h2>
            <p className="mt-4 text-[16px] leading-[1.7] text-secondary">{t('home.residentsText')}</p>
            <a
              href={cabinetHref}
              className="mt-6 inline-flex min-h-11 items-center rounded-[10px] bg-accent px-5 text-sm font-semibold text-white hover:bg-accent-hover"
            >
              {cabinetLabel}
            </a>
          </div>
        </div>
      </section>

      <section id="resident-login" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <LoginScreen
          embedded
          email={email}
          onEmailChange={setEmail}
          password={password}
          onPasswordChange={setPassword}
          loginError={loginError}
          loginLoading={loginLoading}
          onSubmit={handleLogin}
        />
      </section>

      <footer className="border-t border-border bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <AmadeusFullLogo />
              <p className="mt-2 text-sm text-secondary">{t('home.footerPlace')}</p>
            </div>
            <ul className="space-y-1.5 text-sm text-secondary">
              {nav.map((item) => (
                <li key={item.href}>
                  <a href={item.href} className="hover:text-foreground">
                    {item.label}
                  </a>
                </li>
              ))}
              <li>
                <a href={cabinetHref} className="hover:text-foreground">
                  {t('home.personalCabinet')}
                </a>
              </li>
            </ul>
            <div>
              <LanguageSwitcher />
            </div>
          </div>
          <p className="mt-8 border-t border-border pt-4 text-xs text-muted">
            © {new Date().getFullYear()} {t('brand.name')}
          </p>
        </div>
      </footer>
    </div>
  );
}
