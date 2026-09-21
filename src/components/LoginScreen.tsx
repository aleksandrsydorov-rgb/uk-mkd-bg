'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BrandMark } from '@/components/BrandMark';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { useI18n } from '@/i18n/I18nProvider';
import { supabase } from '@/lib/supabaseClient';

type DevAccount = {
  email: string;
  name: string;
  apartments: number[];
  staffRole: string | null;
  isOwner: boolean;
  isStaff: boolean;
};

function isDev() {
  return process.env.NODE_ENV === 'development';
}

export function LoginScreen({
  email,
  onEmailChange,
  onSubmit,
  onDevLogin,
}: {
  email: string;
  onEmailChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onDevLogin: (email: string) => void;
}) {
  const { t } = useI18n();
  const [devAccounts, setDevAccounts] = useState<DevAccount[]>([]);
  const [devLoading, setDevLoading] = useState(false);
  const [devError, setDevError] = useState<string | null>(null);

  useEffect(() => {
    if (!isDev()) return;

    let cancelled = false;

    async function loadDevAccounts() {
      setDevLoading(true);
      setDevError(null);
      try {
        const byEmail = new Map<string, DevAccount>();

        const propsRes = await supabase
          .from('properties')
          .select('owner_email, owner_name, apartment_number')
          .order('apartment_number', { ascending: true });

        if (propsRes.error) throw propsRes.error;

        for (const row of propsRes.data ?? []) {
          const addr = String(row.owner_email ?? '').trim().toLowerCase();
          if (!addr) continue;
          const apt = Number(row.apartment_number);
          const existing = byEmail.get(addr);
          if (existing) {
            existing.isOwner = true;
            if (Number.isFinite(apt) && !existing.apartments.includes(apt)) {
              existing.apartments.push(apt);
            }
            if (!existing.name && row.owner_name) existing.name = row.owner_name;
          } else {
            byEmail.set(addr, {
              email: addr,
              name: row.owner_name?.trim() || addr,
              apartments: Number.isFinite(apt) ? [apt] : [],
              staffRole: null,
              isOwner: true,
              isStaff: false,
            });
          }
        }

        const staffRes = await supabase.from('staff').select('email, name, role');
        if (staffRes.error) {
          const msg = staffRes.error.message ?? '';
          if (!(msg.includes('email') || msg.includes('schema cache') || msg.includes('Could not find'))) {
            throw staffRes.error;
          }
        } else {
          for (const row of staffRes.data ?? []) {
            const addr = String(row.email ?? '').trim().toLowerCase();
            if (!addr) continue;
            const existing = byEmail.get(addr);
            if (existing) {
              existing.isStaff = true;
              existing.staffRole = row.role || existing.staffRole;
              if (!existing.name || existing.name === existing.email) {
                existing.name = row.name?.trim() || existing.name;
              }
            } else {
              byEmail.set(addr, {
                email: addr,
                name: row.name?.trim() || addr,
                apartments: [],
                staffRole: row.role || null,
                isOwner: false,
                isStaff: true,
              });
            }
          }
        }

        const list = [...byEmail.values()].map((acc) => ({
          ...acc,
          apartments: [...acc.apartments].sort((a, b) => a - b),
        }));
        list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

        if (!cancelled) setDevAccounts(list);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to load DEV accounts';
        if (!cancelled) setDevError(message);
      } finally {
        if (!cancelled) setDevLoading(false);
      }
    }

    void loadDevAccounts();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="relative min-h-dvh bg-[#070b0a] text-white flex items-center justify-center px-4 py-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-24 left-1/4 h-72 w-72 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-64 w-64 rounded-full bg-teal-500/10 blur-3xl" />
      </div>
      <div className="relative z-10 w-full max-w-md px-4">
        <div className="mb-4 flex justify-center">
          <LanguageSwitcher />
        </div>
        <div className="mb-6 flex justify-center">
          <BrandMark />
        </div>
        <h1 className="text-xl font-semibold text-center mb-4">{t('login.title')}</h1>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="text-sm text-white/70">Email</label>
              <input
                className="mt-2 w-full rounded-xl border border-white/10 bg-[#070b0a] px-3 py-3 text-base text-white"
                value={email}
                onChange={(e) => onEmailChange(e.target.value)}
                placeholder="email@example.com"
                type="email"
                autoComplete="email"
              />
            </div>
            <button
              type="submit"
              className="w-full min-h-12 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-3 font-semibold text-white"
            >
              {t('common.login')}
            </button>
            <p className="text-xs text-white/40">
              {t('login.hint')}
            </p>
          </form>
        </div>
        {isDev() && (
          <div className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
            <h2 className="text-xs font-semibold tracking-wide text-amber-200">DEV QUICK LOGIN</h2>
            <p className="mt-1 text-[11px] text-white/40">Development only — not available in production</p>
            {devLoading && (
              <div className="mt-3 text-sm text-white/50">Loading…</div>
            )}
            {devError && (
              <div className="mt-3 rounded-lg border border-red-800 bg-red-900/20 p-3 text-xs text-red-200">
                {devError}
              </div>
            )}
            {!devLoading && !devError && devAccounts.length === 0 && (
              <div className="mt-3 text-sm text-white/40">No accounts with email.</div>
            )}
            {devAccounts.length > 0 && (
              <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
                {devAccounts.map((acc) => (
                  <button
                    key={acc.email}
                    type="button"
                    onClick={() => onDevLogin(acc.email)}
                    className="w-full rounded-xl border border-white/10 bg-[#070b0a] px-3 py-2.5 text-left hover:border-amber-400/40 hover:bg-white/[0.04]"
                  >
                    <div className="text-sm font-medium text-white">{acc.name}</div>
                    {acc.isOwner && (
                      <div className="text-xs text-white/50">
                        Owner{acc.apartments.length > 0 ? ` · Apt ${acc.apartments.join(', ')}` : ''}
                      </div>
                    )}
                    {acc.isStaff && (
                      <div className="text-xs text-white/50">
                        Staff{acc.staffRole ? ` · ${acc.staffRole}` : ''}
                      </div>
                    )}
                    <div className="text-xs text-amber-200/80">{acc.email}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="text-center mt-4">
          <Link href="/" className="text-sm text-white/50 hover:text-white">
            {t('common.backHome')}
          </Link>
        </div>
      </div>
    </div>
  );
}
