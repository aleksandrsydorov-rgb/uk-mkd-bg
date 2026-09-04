'use client';

import { useState } from 'react';
import Link from 'next/link';
import { BrandMark } from '@/components/BrandMark';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { useI18n } from '@/i18n/I18nProvider';

export default function HomePage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { t } = useI18n();
  const nav = [
    { label: t('home.navFeatures'), href: '#features' },
    { label: t('home.navHow'), href: '#how' },
    { label: t('home.navContacts'), href: '#footer' },
  ];

  return (
    <div className="min-h-screen bg-[#070b0a] text-white">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-24 left-1/4 h-72 w-72 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-64 w-64 rounded-full bg-teal-500/10 blur-3xl" />
      </div>

      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#070b0a]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <BrandMark />

          <nav className="hidden items-center gap-1 md:flex">
            {nav.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-2 text-sm text-white/55 transition hover:bg-white/5 hover:text-white"
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <LanguageSwitcher compact />
            <Link
              href="/account"
              className="hidden rounded-lg px-3 py-2 text-sm text-white/60 hover:bg-white/5 hover:text-white sm:inline-flex"
            >
              {t('common.cabinet')}
            </Link>
            <Link
              href="/account"
              className="rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 px-3.5 py-2 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20"
            >
              {t('common.login')}
            </Link>
            <button
              type="button"
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 md:hidden"
              aria-label={t('common.menu')}
              onClick={() => setMenuOpen((v) => !v)}
            >
              {menuOpen ? '✕' : '☰'}
            </button>
          </div>
        </div>

        {menuOpen && (
          <div className="border-t border-white/10 bg-[#070b0a] px-4 py-3 md:hidden">
            <div className="flex flex-col gap-1">
              {nav.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  className="rounded-lg px-3 py-2.5 text-sm text-white/70 hover:bg-white/5"
                >
                  {item.label}
                </a>
              ))}
              <Link
                href="/account"
                onClick={() => setMenuOpen(false)}
                className="rounded-lg px-3 py-2.5 text-sm text-emerald-300 hover:bg-white/5"
              >
                {t('home.personalCabinet')}
              </Link>
            </div>
          </div>
        )}
      </header>

      <section className="relative z-10 mx-auto max-w-6xl px-4 pb-10 pt-10 text-center sm:px-6 sm:pb-12 sm:pt-12 md:pt-14">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          {t('home.badge')}
        </div>

        <h1 className="mx-auto max-w-3xl text-3xl font-bold tracking-tight sm:text-5xl">
          {t('home.hero1')}{' '}
          <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
            {t('home.hero2')}
          </span>
        </h1>

        <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-white/50 sm:text-base">
          {t('home.lead')}
        </p>

        <div className="mt-6 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
          <Link
            href="/account"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-500/25"
          >
            {t('home.openCabinet')}
            <span aria-hidden>→</span>
          </Link>
          <a
            href="#how"
            className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/5 px-6 py-3 text-sm font-medium text-white/70 hover:bg-white/10"
          >
            {t('home.howItWorks')}
          </a>
        </div>

        <div className="mx-auto mt-8 grid max-w-2xl grid-cols-3 overflow-hidden rounded-2xl border border-white/10">
          {[
            { value: '100%', label: t('home.statTransparency') },
            { value: '51%', label: t('home.statQuorum') },
            { value: '24/7', label: t('home.statCabinet') },
          ].map((stat) => (
            <div key={stat.label} className="bg-white/[0.03] px-2 py-4 text-center sm:px-4 sm:py-5">
              <div className="text-lg font-bold sm:text-2xl">{stat.value}</div>
              <div className="mt-0.5 text-[10px] uppercase tracking-wide text-white/35 sm:text-xs">
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section id="features" className="relative z-10 border-t border-white/10">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-12">
          <div className="max-w-2xl">
            <p className="text-xs font-medium uppercase tracking-wider text-emerald-400/80">{t('home.featuresKicker')}</p>
            <h2 className="mt-1 text-2xl font-bold sm:text-3xl">{t('home.featuresTitle')}</h2>
            <p className="mt-2 text-sm text-white/45">{t('home.featuresLead')}</p>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                title: t('home.featExpTitle'),
                text: t('home.featExpText'),
                tags: [t('home.tagDate'), t('home.tagAmount'), t('home.tagYears')],
                tone: 'border-emerald-500/20',
              },
              {
                title: t('home.featPollTitle'),
                text: t('home.featPollText'),
                tags: [t('home.tagPhoto'), t('home.tagBudget'), '51%'],
                tone: 'border-cyan-500/20',
              },
              {
                title: t('home.featReqTitle'),
                text: t('home.featReqText'),
                tags: [t('home.tagPhoto'), t('home.tagStatus')],
                tone: 'border-amber-500/20',
              },
              {
                title: t('home.featFinTitle'),
                text: t('home.featFinText'),
                tags: [t('home.tagBalance'), t('home.tagMeters')],
                tone: 'border-teal-500/20',
              },
            ].map((card) => (
              <div
                key={card.title}
                className={`rounded-2xl border bg-white/[0.03] p-4 ${card.tone}`}
              >
                <h3 className="font-semibold text-white">{card.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/45">{card.text}</p>
                <div className="mt-3 flex flex-wrap gap-1">
                  {card.tags.map((tag) => (
                    <span key={tag} className="rounded-md bg-white/5 px-2 py-0.5 text-[10px] text-white/35">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="how" className="relative z-10 border-t border-white/10 bg-white/[0.02]">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-12">
          <h2 className="text-2xl font-bold sm:text-3xl">{t('home.stepsTitle')}</h2>
          <p className="mt-2 max-w-xl text-sm text-white/45">{t('home.stepsLead')}</p>

          <div className="mt-6 grid gap-3 md:grid-cols-3">
            {[
              { step: '1', title: t('home.step1'), desc: t('home.step1d'), ring: 'bg-emerald-500' },
              { step: '2', title: t('home.step2'), desc: t('home.step2d'), ring: 'bg-cyan-500' },
              { step: '3', title: t('home.step3'), desc: t('home.step3d'), ring: 'bg-amber-500' },
            ].map((item) => (
              <div key={item.step} className="flex gap-3 rounded-2xl border border-white/10 bg-[#070b0a] p-4 md:block md:text-center">
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-gray-900 ${item.ring} md:mx-auto md:mb-3`}>
                  {item.step}
                </div>
                <div>
                  <h3 className="font-semibold">{item.title}</h3>
                  <p className="mt-1 text-sm text-white/45">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="relative z-10 border-t border-white/10">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
          <div className="flex flex-col items-start justify-between gap-4 rounded-2xl border border-emerald-500/20 bg-gradient-to-r from-emerald-500/15 to-teal-500/10 p-5 sm:flex-row sm:items-center sm:p-6">
            <div>
              <h2 className="text-xl font-bold sm:text-2xl">{t('home.ctaTitle')}</h2>
              <p className="mt-1 text-sm text-white/50">{t('home.ctaLead')}</p>
            </div>
            <Link
              href="/account"
              className="inline-flex w-full shrink-0 items-center justify-center rounded-xl bg-white px-5 py-3 text-sm font-semibold text-gray-900 sm:w-auto"
            >
              {t('home.ctaBtn')}
            </Link>
          </div>
        </div>
      </section>

      <footer id="footer" className="relative z-10 border-t border-white/10">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <div className="grid gap-6 sm:grid-cols-2 md:grid-cols-4">
            <div className="sm:col-span-2">
              <p className="font-bold">
                {t('brand.name')} <span className="text-emerald-400">{t('brand.country')}</span>
              </p>
              <p className="mt-2 max-w-sm text-sm text-white/40">{t('home.footerAbout')}</p>
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-white/35">{t('home.navTitle')}</h4>
              <ul className="mt-2 space-y-1.5">
                <li>
                  <Link href="/account" className="text-sm text-white/50 hover:text-white">
                    {t('home.personalCabinet')}
                  </Link>
                </li>
                <li>
                  <a href="#features" className="text-sm text-white/50 hover:text-white">
                    {t('home.navFeatures')}
                  </a>
                </li>
                <li>
                  <a href="#how" className="text-sm text-white/50 hover:text-white">
                    {t('home.navHow')}
                  </a>
                </li>
                <li>
                  <Link href="/account" className="text-sm text-white/50 hover:text-white">
                    {t('common.login')}
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-white/35">{t('home.contacts')}</h4>
              <ul className="mt-2 space-y-1.5 text-sm text-white/50">
                <li>Sofia, Bulgaria</li>
                <li>
                  <a href="mailto:info@mkdbulgaria.com" className="text-emerald-400/80 hover:text-emerald-300">
                    info@mkdbulgaria.com
                  </a>
                </li>
                <li>
                  <a href="tel:+359888123456" className="hover:text-white">
                    +359 888 123 456
                  </a>
                </li>
              </ul>
            </div>
          </div>
          <p className="mt-6 border-t border-white/10 pt-4 text-xs text-white/30">
            © {new Date().getFullYear()} {t('brand.name')} {t('brand.country')}
          </p>
        </div>
      </footer>
    </div>
  );
}
