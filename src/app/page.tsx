'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { LoginScreen } from '@/components/LoginScreen';
import { LocationDiagram } from '@/components/home/ComplexVisuals';
import { useI18n } from '@/i18n/I18nProvider';
import { resolveAccess } from '@/lib/access';
import { normalizeEmail } from '@/lib/email';
import { createClient } from '@/lib/supabase/client';

function HeroPhoto({ placement }: { placement: 'desktop' | 'mobile' }) {
  const frame =
    placement === 'desktop'
      ? 'home-hero-arch home-hero-photo-desktop relative hidden w-full overflow-hidden lg:block'
      : 'home-hero-arch relative h-[260px] w-full overflow-hidden sm:h-[300px] lg:hidden';
  return (
    <div className={frame}>
      <Image
        src="/complex/amadeus11-hero.jpg"
        alt="AMADEUS 11"
        fill
        priority={placement === 'desktop'}
        sizes="(max-width: 1024px) 100vw, 58vw"
        className="object-cover object-[48%_62%]"
      />
    </div>
  );
}

function HeroFactIcon({ kind }: { kind: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="home-facts-icon"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === 'floors' && (
        <>
          <path d="M6 21V6.2c0-.66.54-1.2 1.2-1.2h9.6c.66 0 1.2.54 1.2 1.2V21" />
          <path d="M4.5 21h15" />
          <rect x="8.2" y="8" width="2.3" height="2.3" rx="0.25" />
          <rect x="13.5" y="8" width="2.3" height="2.3" rx="0.25" />
          <rect x="8.2" y="12" width="2.3" height="2.3" rx="0.25" />
          <rect x="13.5" y="12" width="2.3" height="2.3" rx="0.25" />
          <rect x="8.2" y="16" width="2.3" height="2.3" rx="0.25" />
          <rect x="13.5" y="16" width="2.3" height="2.3" rx="0.25" />
        </>
      )}
      {kind === 'act' && (
        <>
          <path d="M8 3.8h6.2L18.2 8v12.2H8z" />
          <path d="M14.2 3.8V8h3.9" />
          <path d="M10.2 14.1l1.6 1.6 3.1-3.2" />
        </>
      )}
      {kind === 'lift' && (
        <>
          <rect x="6.4" y="3.5" width="11.2" height="17" rx="1.2" />
          <path d="M12 8.1v7.8" />
          <path d="M9.6 10.4 12 8.1l2.4 2.3" />
          <path d="M9.6 13.6 12 15.9l2.4-2.3" />
        </>
      )}
      {kind === 'year' && (
        <>
          <rect x="4.2" y="5.8" width="15.6" height="14.2" rx="1.8" />
          <path d="M4.2 10h15.6M8.2 3.8v3.4M15.8 3.8v3.4" />
          <circle cx="12" cy="15.1" r="2.05" />
          <path d="M12 12.35v.7M12 17.15v.7M9.55 15.1h.7M13.75 15.1h.7" />
        </>
      )}
      {kind === 'beach' && (
        <>
          <path d="M3.4 9.2c1.6 0 1.6-2.15 3.2-2.15S8.2 9.2 9.8 9.2s1.6-2.15 3.2-2.15 1.6 2.15 3.2 2.15 1.6-2.15 3.2-2.15 1.6 2.15 3.2 2.15" />
          <path d="M3.4 13.1c1.6 0 1.6-2.15 3.2-2.15S8.2 13.1 9.8 13.1s1.6-2.15 3.2-2.15 1.6 2.15 3.2 2.15 1.6-2.15 3.2-2.15 1.6 2.15 3.2 2.15" />
          <path d="M3.4 17c1.6 0 1.6-2.15 3.2-2.15S8.2 17 9.8 17s1.6-2.15 3.2-2.15 1.6 2.15 3.2 2.15 1.6-2.15 3.2-2.15 1.6 2.15 3.2 2.15" />
        </>
      )}
    </svg>
  );
}

function FacilityIcon({ kind }: { kind: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="home-infra-icon"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.85"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === 'pool' && (
        <>
          <path d="M3.4 13.8c1.55 0 1.55-2.1 3.1-2.1s1.55 2.1 3.1 2.1 1.55-2.1 3.1-2.1 1.55 2.1 3.1 2.1 1.55-2.1 3.1-2.1 1.55 2.1 3.1 2.1" />
          <path d="M3.4 17.6c1.55 0 1.55-2.1 3.1-2.1s1.55 2.1 3.1 2.1 1.55-2.1 3.1-2.1 1.55 2.1 3.1 2.1 1.55-2.1 3.1-2.1 1.55 2.1 3.1 2.1" />
        </>
      )}
      {kind === 'kids' && (
        <>
          <circle cx="12" cy="8" r="2.7" />
          <path d="M6.4 19.4c.85-3.35 3.05-5.15 5.6-5.15s4.75 1.8 5.6 5.15" />
        </>
      )}
      {kind === 'park' && (
        <>
          <path d="M4.2 15.4h15.6" />
          <path d="M5.4 15.4 7.2 11.2A1.6 1.6 0 0 1 8.65 10.3h6.7a1.6 1.6 0 0 1 1.45.9l1.8 4.2" />
          <circle cx="7.4" cy="16.8" r="1.35" />
          <circle cx="16.6" cy="16.8" r="1.35" />
        </>
      )}
      {kind === 'yard' && (
        <>
          <path d="M4.2 19.5h15.6" />
          <path d="M9.4 19.5V11h5.2v8.5" />
          <path d="M8.6 11.1 12 8.2l3.4 2.9" />
          <path d="M6.1 19.5V14.6" />
          <path d="M6.1 10.4 4.4 14.2h3.4z" />
          <path d="M17.9 19.5V14.6" />
          <path d="M17.9 10.4 16.2 14.2h3.4z" />
        </>
      )}
      {kind === 'green' && (
        <path d="M12 20.6c0-7.4 6-9.1 6-13.4A6 6 0 0 0 12 1.5 6 6 0 0 0 6 7.2c0 4.3 6 6 6 13.4z" />
      )}
      {kind === 'access' && (
        <>
          <rect x="6.4" y="11" width="11.2" height="9" rx="1.5" />
          <path d="M8.7 11V8.3a3.3 3.3 0 0 1 6.6 0V11" />
        </>
      )}
      {kind === 'lounge' && (
        <>
          <path d="M4.4 15.2h15.2v3.3H4.4z" />
          <path d="M6.2 15.2V11h11.6v4.2" />
          <path d="M7.6 11V9.2h8.8V11" />
        </>
      )}
      {kind === 'service' && (
        <>
          <circle cx="12" cy="12" r="3.15" />
          <path d="M12 5.1v1.5M12 17.4v1.5M5.1 12h1.5M17.4 12h1.5M7.15 7.15l1.05 1.05M15.8 15.8l1.05 1.05M16.85 7.15l-1.05 1.05M8.2 15.8 7.15 16.85" />
        </>
      )}
    </svg>
  );
}

function LocationPlaceIcon({ kind }: { kind: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="home-loc-icon"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.85"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === 'beach' && (
        <>
          <path d="M3.4 13.8c1.55 0 1.55-2.1 3.1-2.1s1.55 2.1 3.1 2.1 1.55-2.1 3.1-2.1 1.55 2.1 3.1 2.1 1.55-2.1 3.1-2.1 1.55 2.1 3.1 2.1" />
          <path d="M3.4 17.6c1.55 0 1.55-2.1 3.1-2.1s1.55 2.1 3.1 2.1 1.55-2.1 3.1-2.1 1.55 2.1 3.1 2.1 1.55-2.1 3.1-2.1 1.55 2.1 3.1 2.1" />
        </>
      )}
      {kind === 'shops' && (
        <>
          <path d="M6.4 8.2h11.2l-.8 11.2H7.2z" />
          <path d="M9 8.2V6.6a3 3 0 0 1 6 0v1.6" />
        </>
      )}
      {kind === 'cafe' && (
        <>
          <path d="M7.2 4.6v6.4M5.8 4.6v3.8M8.6 4.6v3.8M7.2 11v8.6" />
          <path d="M16.4 4.6v15M14.4 4.6c0 3.2 4 3.2 4 6.6v8.4" />
        </>
      )}
      {kind === 'bus' && (
        <>
          <rect x="4.5" y="5" width="15" height="12.5" rx="2" />
          <path d="M4.5 11h15" />
          <circle cx="8.2" cy="18.4" r="1.3" />
          <circle cx="15.8" cy="18.4" r="1.3" />
        </>
      )}
      {kind === 'anchor' && (
        <>
          <circle cx="12" cy="6.2" r="2" />
          <path d="M12 8.2v10.6M8.2 13.4H12M7 18.2A6.2 6.2 0 0 0 12 20.4 6.2 6.2 0 0 0 17 18.2" />
        </>
      )}
      {kind === 'star' && (
        <path d="M12 3.6 14.2 9l5.8.5-4.4 3.8 1.4 5.7L12 16.3 6.99 19l1.41-5.7L4 9.5 9.8 9z" />
      )}
    </svg>
  );
}

function ResidentIcon({ kind }: { kind: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={kind.startsWith('feat') ? 'home-res-feat-icon' : 'home-res-mini-icon'}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === 'lock' && (
        <>
          <rect x="6.2" y="11" width="11.6" height="9" rx="1.6" />
          <path d="M8.6 11V8.4a3.4 3.4 0 0 1 6.8 0V11" />
        </>
      )}
      {kind === 'shield' && (
        <path d="M12 3.4 5.4 6.2v5.4c0 4.2 2.8 7.2 6.6 8.8 3.8-1.6 6.6-4.6 6.6-8.8V6.2z" />
      )}
      {kind === 'clock' && (
        <>
          <circle cx="12" cy="12" r="8.2" />
          <path d="M12 7.4V12l3.2 2" />
        </>
      )}
      {kind === 'device' && (
        <>
          <rect x="8" y="3.4" width="8" height="17.2" rx="1.8" />
          <path d="M11 18.2h2" />
        </>
      )}
      {kind === 'home' && (
        <>
          <path d="M4.4 11 12 4.6 19.6 11" />
          <path d="M6.4 9.8V19.4h11.2V9.8" />
        </>
      )}
      {kind === 'featDoc' && (
        <>
          <path d="M7 4.4h7.2L18.4 8.6V19.6H7z" />
          <path d="M14.2 4.4v4.4h4.2" />
          <path d="M9.4 12.2h5.2M9.4 15.4h5.2" />
        </>
      )}
      {kind === 'featPay' && (
        <>
          <rect x="3.6" y="6.4" width="16.8" height="11.2" rx="2" />
          <path d="M3.6 10.2h16.8" />
          <path d="M7.2 14.4h4.4" />
        </>
      )}
      {kind === 'featMeter' && (
        <>
          <circle cx="12" cy="12" r="8.2" />
          <path d="M12 12 16 8.6" />
          <path d="M8.4 12h.8M16.8 12h.8M12 7.2v.8" />
        </>
      )}
      {kind === 'featWrench' && (
        <path d="M15.4 8.6a3.6 3.6 0 0 0-5.6-2.4l2.2 2.2-2.2 2.2-2.2-2.2A3.6 3.6 0 0 0 9.8 15l6.4 6.2 2.4-2.4L12.2 12.6a3.6 3.6 0 0 0 3.2-4z" />
      )}
      {kind === 'featNews' && (
        <>
          <path d="M5.2 15.4c1.8-1 3.4-4.4 3.4-7.2 0-2.4 1.5-4.2 3.4-4.2s3.4 1.8 3.4 4.2c0 2.8 1.6 6.2 3.4 7.2" />
          <path d="M8.2 18.4h7.6" />
          <path d="M12 15.6v2.8" />
        </>
      )}
      {kind === 'featVote' && (
        <>
          <circle cx="9" cy="8.2" r="2.2" />
          <circle cx="15.4" cy="8.6" r="2" />
          <path d="M4.8 18.6c.4-3 2.2-4.6 4.2-4.6s3.8 1.6 4.2 4.6" />
          <path d="M13.2 14.4c1.4-.6 3-.4 4.2.8.8.8 1.4 2 1.6 3.4" />
        </>
      )}
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
    { label: t('home.navFacilities'), href: '#infrastructure' },
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
    { title: t('home.factFloors'), hint: t('home.factFloorsHint'), icon: 'floors' },
    { title: t('home.factAct'), hint: t('home.factActHint'), icon: 'act' },
    { title: t('home.factLift'), hint: t('home.factLiftHint'), icon: 'lift' },
    { title: t('home.factYear'), hint: t('home.factYearHint'), icon: 'year' },
    { title: t('home.factBeach'), hint: t('home.factBeachHint'), icon: 'beach' },
  ];

  const facilities = [
    { label: t('home.facPool'), icon: 'pool' },
    { label: t('home.facKids'), icon: 'kids' },
    { label: t('home.facParking'), icon: 'park' },
    { label: t('home.facLift'), icon: 'yard' },
    { label: t('home.facGreen'), icon: 'green' },
    { label: t('home.facAccess'), icon: 'access' },
    { label: t('home.facLounge'), icon: 'lounge' },
    { label: t('home.facService'), icon: 'service' },
  ];

  const places = [
    { title: t('home.locBeach'), hint: t('home.locBeachHint'), icon: 'beach' },
    { title: t('home.locShops'), hint: t('home.locNear'), icon: 'shops' },
    { title: t('home.locCafe'), hint: t('home.locNear'), icon: 'cafe' },
    { title: t('home.locTransport'), hint: t('home.locNear'), icon: 'bus' },
    { title: t('home.locNessebar'), hint: t('home.locNessebarHint'), icon: 'anchor' },
    { title: t('home.locEntertainment'), hint: t('home.locNear'), icon: 'star' },
  ];

  return (
    <div className="min-h-screen bg-home text-foreground">
      <div className="home-hero-shell">
      <header
        className={`sticky top-0 z-40 transition-colors duration-300 ${
          scrolled ? 'border-b border-border bg-surface/95 shadow-card backdrop-blur-md' : 'border-b border-transparent bg-transparent'
        }`}
      >
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-3 px-4 sm:h-[72px] sm:px-8">
          <Link href="/" className="inline-flex items-center">
            <Image
              src="/brand/Logo_PNG.png"
              alt="AMADEUS 11"
              width={1729}
              height={910}
              priority
              className="h-11 w-auto object-contain lg:h-14"
            />
          </Link>
          <nav className="hidden items-center gap-2 lg:flex">
            {nav.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="rounded-md px-3 py-2 text-[13px] font-medium tracking-[0.005em] text-[#26373F] transition hover:text-[#1F586A]"
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
              className="inline-flex h-9 items-center rounded-full bg-[#1F586A] px-4 text-[13px] font-medium text-white hover:bg-[#174655] sm:h-10 sm:px-5"
            >
              {cabinetLabel}
            </a>
            <button
              type="button"
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[#202A2E]/12 bg-white/50 lg:hidden"
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

      <section className="relative mx-auto max-w-[1440px] px-4 pb-6 pt-8 sm:px-8 lg:pb-8 lg:pt-[7px]">
        <div className="home-hero-desktop-grid relative z-10 grid gap-8 lg:gap-0">
          <div className="home-hero-panel">
            <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.26em] text-[#1F586A] sm:text-xs">
              {t('home.eyebrow')}
            </p>
            <h1 className="home-hero-serif mt-[22px] flex flex-col leading-none tracking-[-0.03em] text-[clamp(40px,5vw,88px)] lg:mt-3 lg:flex-row lg:items-baseline lg:gap-[0.07em] lg:whitespace-nowrap">
              <span className="text-[#223238]">AMADEUS</span>
              <span className="text-[0.84em] text-[#B58A5A]">11</span>
            </h1>
            <p className="home-hero-serif mt-5 max-w-[360px] text-[26px] leading-[1.12] text-[#24343A] text-pretty sm:text-[30px] lg:mt-3 lg:max-w-[400px] lg:text-[32px]">
              {t('home.heroSubtitle')}
            </p>
            <p className="mt-5 max-w-[480px] text-[16px] leading-[1.7] text-[#5c6669] sm:text-[17px] lg:mt-3">
              {t('home.heroLead')}
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center lg:mt-4">
              <a
                href={cabinetHref}
                className="inline-flex h-[54px] items-center justify-center rounded-full bg-[#1F586A] px-7 text-[15px] font-medium text-white hover:bg-[#174655]"
              >
                {cabinetLabel} →
              </a>
              <a
                href="#infrastructure"
                className="inline-flex h-[54px] items-center justify-center rounded-full border border-[#24343A]/15 bg-transparent px-7 text-[15px] font-medium text-[#24343A] hover:bg-white/40"
              >
                {t('home.navFacilities')}
              </a>
            </div>
            </div>
            <div className="home-hero-panel-spacer" aria-hidden="true" />
            <div className="home-editorial-block">
              <div className="home-editorial-line" />
              <h3 className="home-hero-serif text-[17px] leading-snug font-normal text-[#223238]">
                {t('home.noteTitle')}
              </h3>
              <p className="mt-2 text-[14px] leading-[1.6] text-[#6a7376] sm:text-[15px] lg:mt-1">
                {t('home.noteText')}
              </p>
            </div>
          </div>
          <HeroPhoto placement="desktop" />
          <HeroPhoto placement="mobile" />
        </div>

        <div className="home-facts-bar">
          <div className="home-facts-grid">
            {facts.map((item) => (
              <div key={item.title} className="home-facts-item">
                <HeroFactIcon kind={item.icon} />
                <div className="min-w-0">
                  <div className="home-facts-title">{item.title}</div>
                  <div className="home-facts-hint">{item.hint}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
      </div>

      <section id="infrastructure" className="home-infra">
        <div className="home-infra-arc" aria-hidden="true" />
        <p className="home-infra-mark">{t('home.infraMark')}</p>
        <div className="home-infra-inner">
          <div className="home-infra-line" />
          <h2 className="home-hero-serif home-infra-title">{t('home.facilitiesTitle')}</h2>
          <p className="home-infra-sub">{t('home.infraSubtitle')}</p>
          <div className="home-infra-grid">
            {facilities.map((item) => (
              <div key={item.label} className="home-infra-card">
                <div className="home-infra-icon-wrap">
                  <FacilityIcon kind={item.icon} />
                </div>
                <div className="home-infra-label">{item.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="location" className="home-loc">
        <div className="home-loc-inner">
          <div className="home-loc-header">
            <div className="home-loc-line" />
            <h2 className="home-hero-serif home-loc-title">{t('home.locationTitle')}</h2>
            <p className="home-loc-kicker">{t('home.locationHeading')}</p>
            <p className="home-loc-address">
              <svg viewBox="0 0 24 24" className="home-loc-pin" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M12 21s6.5-6.1 6.5-11.2A6.5 6.5 0 0 0 5.5 9.8C5.5 14.9 12 21 12 21z" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="12" cy="9.8" r="2.1" />
              </svg>
              <span>{t('home.locAddress')}</span>
            </p>
            <p className="home-loc-text">{t('home.locationText')}</p>
          </div>
          <div className="home-loc-body">
            <div className="home-loc-cards">
              {places.map((item) => (
                <div key={item.title} className="home-loc-card">
                  <div className="home-loc-icon-wrap">
                    <LocationPlaceIcon kind={item.icon} />
                  </div>
                  <div className="home-loc-card-copy">
                    <div className="home-loc-card-title">{item.title}</div>
                    <div className="home-loc-card-meta">{item.hint}</div>
                  </div>
                </div>
              ))}
            </div>
            <LocationDiagram
              address={t('home.locAddress')}
              mapsLabel={t('home.mapsOpen')}
              mapsHref="https://www.google.com/maps/search/?api=1&query=Amadeus%2011%2C%20%D0%A1%D0%BB%D1%8A%D0%BD%D1%87%D0%B5%D0%B2%20%D0%91%D1%80%D1%8F%D0%B3%2C%208240%20%D0%A1%D0%BB%D1%8A%D0%BD%D1%87%D0%B5%D0%B2%20%D0%B1%D1%80%D1%8F%D0%B3%2C%20%D0%91%D1%8A%D0%BB%D0%B3%D0%B0%D1%80%D0%B8%D1%8F&query_place_id=ChIJkUyBCwGfpkARH5T7uzzmVL8"
            />
          </div>
        </div>
      </section>

      <section id="residents" className="home-res">
        <div className="home-res-inner">
          <div className="home-res-main">
            <div className="home-res-left">
              <div className="home-res-line" />
              <p className="home-res-label">{t('home.residentsEyebrow')}</p>
              <h2 className="home-hero-serif home-res-title">{t('home.residentsTitle')}</h2>
              <p className="home-res-text">{t('home.residentsText')}</p>
              <div className="home-res-cta-row">
                <a href={cabinetHref} className="home-res-cta">
                  {t('home.openAccount')}
                  <span aria-hidden="true"> →</span>
                </a>
                <p className="home-res-secure">
                  <ResidentIcon kind="lock" />
                  <span>{t('home.resSecure')}</span>
                </p>
              </div>
              <div className="home-res-benefits">
                <div className="home-res-benefit">
                  <ResidentIcon kind="shield" />
                  <span>
                    {t('home.resFastTitle')}
                    <br />
                    {t('home.resFastHint')}
                  </span>
                </div>
                <div className="home-res-benefit">
                  <ResidentIcon kind="clock" />
                  <span>
                    {t('home.res247Title')}
                    <br />
                    {t('home.res247Hint')}
                  </span>
                </div>
                <div className="home-res-benefit">
                  <ResidentIcon kind="device" />
                  <span>
                    {t('home.resDevicesTitle')}
                    <br />
                    {t('home.resDevicesHint')}
                  </span>
                </div>
              </div>
            </div>

            <div id="resident-login" className="home-res-login">
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
            </div>

            <div className="home-res-photo">
              <Image
                src="/complex/amadeus11-hero.jpg"
                alt="AMADEUS 11"
                fill
                sizes="(max-width: 1024px) 100vw, 33vw"
                className="home-res-photo-img"
              />
              <div className="home-res-callout">
                <span className="home-res-callout-icon">
                  <ResidentIcon kind="home" />
                </span>
                <span>{t('home.resCallout')}</span>
              </div>
            </div>
          </div>

          <div className="home-res-feat-wrap">
            <h3 className="home-res-feat-heading">{t('home.featHeading')}</h3>
            <div className="home-res-feat-grid">
              {[
                { title: t('home.featApt'), text: t('home.featAptText'), icon: 'featDoc' },
                { title: t('home.featPay'), text: t('home.featPayText'), icon: 'featPay' },
                { title: t('home.featMeters'), text: t('home.featMetersText'), icon: 'featMeter' },
                { title: t('home.featReq'), text: t('home.featReqText'), icon: 'featWrench' },
                { title: t('home.featNews'), text: t('home.featNewsText'), icon: 'featNews' },
                { title: t('home.featVote'), text: t('home.featVoteText'), icon: 'featVote' },
              ].map((item) => (
                <div key={item.title} className="home-res-feat-card">
                  <div className="home-res-feat-icon-wrap">
                    <ResidentIcon kind={item.icon} />
                  </div>
                  <div className="home-res-feat-title">{item.title}</div>
                  <p className="home-res-feat-text">{item.text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <footer className="home-foot">
        <div className="home-foot-inner">
          <nav className="home-foot-nav" aria-label={t('home.navTitle')}>
            {[
              { href: '/', label: t('home.footerNavHome') },
              { href: '#infrastructure', label: t('home.navFacilities') },
              { href: '#location', label: t('home.navLocation') },
              { href: '#residents', label: t('home.footerNavOwners') },
              { href: cabinetHref, label: t('home.personalCabinet') },
            ].map((item, index) => (
              <span key={item.label} className="home-foot-nav-item">
                {index > 0 ? <span className="home-foot-sep" aria-hidden="true" /> : null}
                {item.href.startsWith('#') || item.href === '/' ? (
                  <a href={item.href} className="home-foot-nav-link">
                    {item.label}
                  </a>
                ) : (
                  <Link href={item.href} className="home-foot-nav-link">
                    {item.label}
                  </Link>
                )}
              </span>
            ))}
          </nav>

          <div className="home-foot-extra">
            {[
              t('home.footerLinkRules'),
              t('home.footerLinkDocs'),
              t('home.footerLinkFaq'),
              t('home.footerLinkService'),
              t('home.footerLinkSafety'),
              t('home.footerLinkPrivacy'),
            ].map((label, index) => (
              <span key={label} className="home-foot-extra-item">
                {index > 0 ? <span className="home-foot-sep home-foot-sep-muted" aria-hidden="true" /> : null}
                <span className="home-foot-extra-text">{label}</span>
              </span>
            ))}
          </div>

          <div className="home-foot-contacts">
            <div className="home-foot-contact">
              <span className="home-foot-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 21s6.5-6.1 6.5-11.2A6.5 6.5 0 0 0 5.5 9.8C5.5 14.9 12 21 12 21z" />
                  <circle cx="12" cy="9.8" r="2.1" />
                </svg>
              </span>
              <span>
                <span className="home-foot-contact-main">{t('home.footerAddr1')}</span>
                <span className="home-foot-contact-sub">
                  {t('home.footerAddr2')}, {t('home.footerAddr3')}
                </span>
              </span>
            </div>
            <div className="home-foot-contact">
              <span className="home-foot-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6.6 4.8h2.6l1.2 3.2-1.7 1.1a12 12 0 0 0 6.2 6.2l1.1-1.7 3.2 1.2v2.6c0 .9-.7 1.6-1.6 1.6C10.4 18.9 5.1 13.6 5 7.4c0-.9.7-1.6 1.6-1.6z" />
                </svg>
              </span>
              <span>
                <a className="home-foot-contact-main home-foot-contact-link" href={`tel:${t('home.footerPhone').replace(/\s/g, '')}`}>
                  {t('home.footerPhone')}
                </a>
                <span className="home-foot-contact-sub">{t('home.footerHours')}</span>
              </span>
            </div>
            <div className="home-foot-contact">
              <span className="home-foot-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3.6" y="5.4" width="16.8" height="13.2" rx="2" />
                  <path d="m4.4 7.2 7.6 6.2 7.6-6.2" />
                </svg>
              </span>
              <span>
                <a className="home-foot-contact-main home-foot-contact-link" href={`mailto:${t('home.footerEmail')}`}>
                  {t('home.footerEmail')}
                </a>
                <span className="home-foot-contact-sub">{t('home.footerEmailNote')}</span>
              </span>
            </div>
          </div>

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
    </div>
  );
}
