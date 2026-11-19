'use client';

import type { ReactNode } from 'react';
import {
  LayoutDashboard,
  Building2,
  Boxes,
  KeyRound,
  Bell,
  Wallet,
  Shield,
} from 'lucide-react';
import {
  AdminPageHeader,
  AdminTabBar,
  AdminToggle,
  adminCardClass,
  adminBtnSecondaryClass,
} from '@/components/admin/AdminUi';
import { AdminBuildingProfile } from '@/components/admin/AdminBuildingProfile';
import { AdminInitialSetup } from '@/components/admin/AdminInitialSetup';
import { parseModuleCatalogFilter } from '@/components/admin/AdminModuleCatalogPanel';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

export const SETTINGS_TABS = [
  'hub',
  'complex',
  'modules',
  'access',
  'notify',
  'finance',
  'security',
] as const;

export type SettingsTabId = (typeof SETTINGS_TABS)[number];

export function parseSettingsTab(raw: string | null | undefined): SettingsTabId {
  const v = String(raw ?? '').trim();
  if ((SETTINGS_TABS as readonly string[]).includes(v)) return v as SettingsTabId;
  return 'hub';
}

type OverviewCardKey = string;

type Props = {
  t: (key: string) => string;
  supabase: SupabaseClient<Database>;
  canManageCriticalAccess: boolean;
  canChangeBuildingModules: boolean;
  moduleFilter?: string | null;
  onModulesChanged?: () => void;
  activeTab: SettingsTabId;
  onTabChange: (tab: SettingsTabId) => void;
  onNavigateSection: (section: string) => void;
  overviewCards: {
    key: OverviewCardKey;
    label: string;
    enabled: boolean;
    onToggle: (next: boolean) => void;
  }[];
};

function HubCard({
  title,
  lead,
  actionLabel,
  onClick,
}: {
  title: string;
  lead: string;
  actionLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${adminCardClass} flex w-full flex-col p-4 text-left transition hover:bg-hover/40`}
    >
      <span className="text-[15px] font-semibold text-foreground">{title}</span>
      <span className="mt-1 text-xs text-secondary">{lead}</span>
      <span className="mt-3 text-sm font-medium text-accent">{actionLabel} →</span>
    </button>
  );
}

export function AdminSettingsHub({
  t,
  supabase,
  canManageCriticalAccess,
  canChangeBuildingModules,
  moduleFilter = 'all',
  onModulesChanged,
  activeTab,
  onTabChange,
  onNavigateSection,
  overviewCards,
}: Props) {
  const tabs = SETTINGS_TABS.map((id) => {
    const icons = {
      hub: LayoutDashboard,
      complex: Building2,
      modules: Boxes,
      access: KeyRound,
      notify: Bell,
      finance: Wallet,
      security: Shield,
    } as const;
    const labels = {
      hub: t('admin.settingsTabHub'),
      complex: t('admin.settingsTabComplex'),
      modules: t('admin.settingsTabModules'),
      access: t('admin.settingsTabAccess'),
      notify: t('admin.settingsTabNotify'),
      finance: t('admin.settingsTabFinance'),
      security: t('admin.settingsTabSecurity'),
    } as const;
    return {
      id,
      label: labels[id],
      icon: icons[id],
      href: `/admin?section=${encodeURIComponent('настройки')}&tab=${encodeURIComponent(id)}`,
    };
  });

  let body: ReactNode = null;

  if (activeTab === 'hub') {
    body = (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <HubCard
          title={t('admin.settingsTabComplex')}
          lead={t('admin.settingsHubComplexLead')}
          actionLabel={t('admin.settingsHubOpen')}
          onClick={() => onTabChange('complex')}
        />
        <HubCard
          title={t('admin.settingsTabModules')}
          lead={t('admin.settingsHubModulesLead')}
          actionLabel={t('admin.settingsHubOpen')}
          onClick={() => onTabChange('modules')}
        />
        <HubCard
          title={t('admin.settingsTabAccess')}
          lead={t('admin.settingsHubAccessLead')}
          actionLabel={t('admin.settingsHubOpen')}
          onClick={() => onTabChange('access')}
        />
        <HubCard
          title={t('admin.settingsTabNotify')}
          lead={t('admin.settingsHubNotifyLead')}
          actionLabel={t('admin.settingsHubOpen')}
          onClick={() => onNavigateSection('уведомления')}
        />
        <HubCard
          title={t('admin.settingsTabFinance')}
          lead={t('admin.settingsHubFinanceLead')}
          actionLabel={t('admin.settingsHubOpen')}
          onClick={() => onTabChange('finance')}
        />
        <HubCard
          title={t('admin.settingsTabSecurity')}
          lead={t('admin.settingsHubSecurityLead')}
          actionLabel={t('admin.settingsHubOpen')}
          onClick={() => onTabChange('security')}
        />
        {canManageCriticalAccess ? (
          <HubCard
            title={t('admin.is1Title')}
            lead={t('admin.settingsHubInitialSetupLead')}
            actionLabel={t('admin.settingsHubOpen')}
            onClick={() => onNavigateSection('начальная_настройка')}
          />
        ) : null}
      </div>
    );
  } else if (activeTab === 'complex') {
    body = (
      <div className="space-y-6">
        <section className="space-y-3">
          <div className="px-0.5">
            <h3 className="text-base font-semibold text-foreground">
              {t('admin.settingsWorkspace')}
            </h3>
            <p className="mt-1 max-w-xl text-sm text-secondary">
              {t('admin.settingsWorkspaceHint')}
            </p>
          </div>
          {overviewCards.length === 0 ? (
            <div className={`${adminCardClass} px-4 py-5`}>
              <p className="text-sm text-muted">{t('admin.settingsWorkspaceEmpty')}</p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {overviewCards.map((card) => (
                <div
                  key={card.key}
                  className={`${adminCardClass} flex items-start justify-between gap-3 p-4 ${
                    card.enabled ? 'ring-1 ring-accent/20' : ''
                  }`}
                >
                  <div className="min-w-0">
                    <p className="text-[15px] font-semibold text-foreground">{card.label}</p>
                    <p className="mt-1 text-xs text-muted">
                      {card.enabled
                        ? t('admin.settingsWorkspaceOn')
                        : t('admin.settingsWorkspaceOff')}
                    </p>
                  </div>
                  <AdminToggle
                    checked={card.enabled}
                    label={card.label}
                    onChange={card.onToggle}
                  />
                </div>
              ))}
            </div>
          )}
        </section>
        <section className={`${adminCardClass} space-y-3 p-4`}>
          <h3 className="text-sm font-semibold text-foreground">
            {t('admin.settingsComplexDataTitle')}
          </h3>
          <p className="text-sm text-secondary">{t('admin.settingsComplexDataLead')}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={adminBtnSecondaryClass}
              onClick={() => onNavigateSection('книга')}
            >
              {t('admin.settingsComplexOpenBook')}
            </button>
            {canManageCriticalAccess ? (
              <button
                type="button"
                className={adminBtnSecondaryClass}
                onClick={() => onNavigateSection('начальная_настройка')}
              >
                {t('admin.is1Title')}
              </button>
            ) : null}
          </div>
        </section>
        <AdminBuildingProfile
          supabase={supabase}
          t={t}
          canEdit={canManageCriticalAccess}
        />
      </div>
    );
  } else if (activeTab === 'modules') {
    body = canChangeBuildingModules ? (
      <AdminInitialSetup
        supabase={supabase}
        t={t}
        defaultFilter={parseModuleCatalogFilter(moduleFilter)}
        embedded
        onModulesChanged={onModulesChanged}
      />
    ) : (
      <div className={`${adminCardClass} px-4 py-5`}>
        <p className="text-sm text-muted">{t('admin.feeAdminOnlyRate')}</p>
      </div>
    );
  } else if (activeTab === 'access') {
    body = (
      <div className="grid gap-3 sm:grid-cols-2">
        <HubCard
          title={t('admin.staff')}
          lead={t('admin.settingsAccessStaffLead')}
          actionLabel={t('admin.settingsHubOpen')}
          onClick={() => onNavigateSection('персонал')}
        />
        <HubCard
          title={t('admin.uaTitle')}
          lead={t('admin.settingsAccessUaLead')}
          actionLabel={t('admin.settingsHubOpen')}
          onClick={() => onNavigateSection('активация')}
        />
      </div>
    );
  } else if (activeTab === 'notify') {
    // Legacy tab — page redirects to section=уведомления; keep a soft pointer if redirect lags.
    body = (
      <div className={`${adminCardClass} space-y-3 p-4`}>
        <p className="text-[15px] font-semibold text-foreground">{t('admin.settingsTabNotify')}</p>
        <p className="text-sm text-secondary">{t('admin.settingsHubNotifyLead')}</p>
        <button
          type="button"
          className={adminBtnSecondaryClass}
          onClick={() => onNavigateSection('уведомления')}
        >
          {t('admin.settingsHubOpen')} →
        </button>
      </div>
    );
  } else if (activeTab === 'finance') {
    body = (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <HubCard
          title={t('admin.tariffsCore')}
          lead={t('admin.settingsFinanceTariffsLead')}
          actionLabel={t('admin.settingsHubOpen')}
          onClick={() => onNavigateSection('тарифы')}
        />
        <HubCard
          title={t('admin.fee')}
          lead={t('admin.settingsFinanceFeeLead')}
          actionLabel={t('admin.settingsHubOpen')}
          onClick={() => onNavigateSection('такса')}
        />
        <HubCard
          title={t('admin.capital')}
          lead={t('admin.settingsFinanceCapitalLead')}
          actionLabel={t('admin.settingsHubOpen')}
          onClick={() => onNavigateSection('капремонт')}
        />
        <HubCard
          title={t('admin.budget')}
          lead={t('admin.settingsFinanceBudgetLead')}
          actionLabel={t('admin.settingsHubOpen')}
          onClick={() => onNavigateSection('бюджет')}
        />
      </div>
    );
  } else if (activeTab === 'security') {
    body = (
      <div className="grid gap-3 sm:grid-cols-2">
        <HubCard
          title={t('admin.platformTitle')}
          lead={t('admin.settingsSecurityPlatformLead')}
          actionLabel={t('admin.settingsHubOpen')}
          onClick={() => onNavigateSection('платформа')}
        />
        <div className={`${adminCardClass} space-y-2 p-4`}>
          <p className="text-[15px] font-semibold text-foreground">
            {t('admin.settingsSecurityTechTitle')}
          </p>
          <p className="text-sm text-secondary">{t('admin.settingsSecurityTechLead')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-5">
      <AdminPageHeader title={t('admin.settingsTitle')} secondary={t('admin.settingsLead')} />
      <AdminTabBar
        aria-label={t('admin.settingsTitle')}
        tabs={tabs}
        active={activeTab}
        onChange={(id) => onTabChange(parseSettingsTab(id))}
      />
      {body}
    </div>
  );
}
