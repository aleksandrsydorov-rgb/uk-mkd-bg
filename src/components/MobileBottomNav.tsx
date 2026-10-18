'use client';

import type { ReactNode } from 'react';
import { Menu } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';

export type MobileNavItem = {
  key: string;
  label: string;
  icon: ReactNode;
  badge?: number;
};

export function MobileBottomNav({
  items,
  activeKey,
  moreActive,
  onSelect,
  onMore,
  hidden = false,
}: {
  items: MobileNavItem[];
  activeKey: string;
  moreActive: boolean;
  onSelect: (key: string) => void;
  onMore: () => void;
  hidden?: boolean;
}) {
  const { t } = useI18n();
  if (hidden) return null;

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1 backdrop-blur-xl md:hidden"
      aria-label={t('common.menu')}
    >
      <div className="grid grid-cols-5">
        {items.map((item) => {
          const active = !moreActive && activeKey === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onSelect(item.key)}
              className={`relative flex min-h-12 flex-col items-center justify-center gap-0.5 px-1 text-[10px] font-medium ${
                active ? 'text-accent' : 'text-muted'
              }`}
            >
              <span className="flex h-5 items-center justify-center leading-none [&>svg]:h-4 [&>svg]:w-4">
                {item.icon}
              </span>
              <span className="max-w-full truncate">{item.label}</span>
              {item.badge ? (
                <span className="absolute right-2 top-1 min-w-[16px] rounded-full bg-danger px-1 text-[9px] leading-4 text-white">
                  {item.badge > 9 ? '9+' : item.badge}
                </span>
              ) : null}
            </button>
          );
        })}
        <button
          type="button"
          onClick={onMore}
          className={`flex min-h-12 flex-col items-center justify-center gap-0.5 px-1 text-[10px] font-medium ${
            moreActive ? 'text-accent' : 'text-muted'
          }`}
        >
          <span className="flex h-5 items-center justify-center leading-none">
            <Menu className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          </span>
          <span>{t('common.more')}</span>
        </button>
      </div>
    </nav>
  );
}
