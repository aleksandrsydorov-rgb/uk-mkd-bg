'use client';

import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard,
  Building2,
  Wallet,
  Gauge,
  Wrench,
  MessageSquare,
  FileText,
  Settings,
  ClipboardList,
  Users,
  BookOpen,
  ArrowLeftRight,
  Droplets,
  Zap,
  Landmark,
  Wifi,
  Lock,
  Shield,
  Sparkles,
  Package,
  ListTodo,
  Megaphone,
  Vote,
  MessagesSquare,
  Satellite,
  UserPlus,
  Puzzle,
  Receipt,
  BarChart3,
  ScrollText,
  Home,
  CircleDollarSign,
  LifeBuoy,
  LogOut,
  type LucideProps,
} from 'lucide-react';

const sizeClass = 'h-4 w-4 shrink-0';
const stroke = 1.75;

function mergeClass(...parts: Array<string | undefined>) {
  return parts.filter(Boolean).join(' ');
}

/** Semantic stroke colors — restore production-style section recognition without emoji. */
const GROUP_ICON_CLASS: Record<string, string> = {
  overview: 'text-sky-600',
  objects: 'text-teal-600',
  finance: 'text-emerald-600',
  utilities: 'text-amber-600',
  operations: 'text-orange-600',
  maintenance: 'text-orange-600',
  mytasks: 'text-violet-600',
  comms: 'text-cyan-600',
  docs: 'text-indigo-600',
  system: 'text-slate-600',
  settings: 'text-slate-600',
  platform: 'text-fuchsia-600',
  activation: 'text-rose-600',
  invstaff: 'text-lime-700',
};

const SECTION_ICON_CLASS: Record<string, string> = {
  обзор: 'text-sky-600',
  квартиры: 'text-teal-600',
  книга: 'text-indigo-600',
  смены: 'text-violet-600',
  заявки: 'text-amber-600',
  рабочие_задачи: 'text-orange-600',
  мои_задачи: 'text-violet-600',
  вода: 'text-sky-500',
  электроэнергия: 'text-yellow-600',
  счётчики: 'text-amber-500',
  такса: 'text-emerald-600',
  капремонт: 'text-orange-700',
  интернет: 'text-blue-600',
  блокировка: 'text-rose-600',
  охрана: 'text-slate-700',
  уборка: 'text-cyan-600',
  инвентарь: 'text-lime-700',
  моя_инвентаризация: 'text-lime-700',
  бюджет: 'text-emerald-700',
  расходы: 'text-rose-500',
  отчётность: 'text-slate-600',
  тарифы: 'text-emerald-600',
  опросы: 'text-purple-600',
  документы: 'text-indigo-500',
  объявления: 'text-amber-600',
  чат: 'text-cyan-600',
  персонал: 'text-orange-600',
  настройки: 'text-slate-600',
  платформа: 'text-fuchsia-600',
  активация: 'text-rose-600',
  начальная_настройка: 'text-fuchsia-600',
  собрания: 'text-indigo-600',
  решения: 'text-indigo-500',
  квартира: 'text-teal-600',
  жильцы: 'text-orange-600',
  финансы: 'text-emerald-600',
  ук: 'text-sky-600',
  обращения: 'text-sky-600',
};

/** Soft chip behind colored icons (sidebar + mobile). */
const SECTION_ICON_CHIP: Record<string, string> = {
  обзор: 'bg-sky-500/12',
  квартиры: 'bg-teal-500/12',
  книга: 'bg-indigo-500/12',
  смены: 'bg-violet-500/12',
  заявки: 'bg-amber-500/12',
  рабочие_задачи: 'bg-orange-500/12',
  мои_задачи: 'bg-violet-500/12',
  вода: 'bg-sky-500/12',
  электроэнергия: 'bg-yellow-500/15',
  счётчики: 'bg-amber-500/12',
  такса: 'bg-emerald-500/12',
  капремонт: 'bg-orange-500/12',
  интернет: 'bg-blue-500/12',
  блокировка: 'bg-rose-500/12',
  охрана: 'bg-slate-500/12',
  уборка: 'bg-cyan-500/12',
  инвентарь: 'bg-lime-500/12',
  моя_инвентаризация: 'bg-lime-500/12',
  бюджет: 'bg-emerald-500/12',
  расходы: 'bg-rose-500/12',
  отчётность: 'bg-slate-500/12',
  тарифы: 'bg-emerald-500/12',
  опросы: 'bg-purple-500/12',
  документы: 'bg-indigo-500/12',
  объявления: 'bg-amber-500/12',
  чат: 'bg-cyan-500/12',
  персонал: 'bg-orange-500/12',
  настройки: 'bg-slate-500/12',
  платформа: 'bg-fuchsia-500/12',
  активация: 'bg-rose-500/12',
  начальная_настройка: 'bg-fuchsia-500/12',
  собрания: 'bg-indigo-500/12',
  решения: 'bg-indigo-500/12',
  квартира: 'bg-teal-500/12',
  жильцы: 'bg-orange-500/12',
  финансы: 'bg-emerald-500/12',
  ук: 'bg-sky-500/12',
  обращения: 'bg-sky-500/12',
};

const GROUP_ICON_CHIP: Record<string, string> = {
  overview: 'bg-sky-500/12',
  objects: 'bg-teal-500/12',
  finance: 'bg-emerald-500/12',
  utilities: 'bg-amber-500/12',
  operations: 'bg-orange-500/12',
  maintenance: 'bg-orange-500/12',
  mytasks: 'bg-violet-500/12',
  comms: 'bg-cyan-500/12',
  docs: 'bg-indigo-500/12',
  system: 'bg-slate-500/12',
  settings: 'bg-slate-500/12',
  platform: 'bg-fuchsia-500/12',
  activation: 'bg-rose-500/12',
  invstaff: 'bg-lime-500/12',
};

export function NavIcon({
  icon: Icon,
  className,
}: {
  icon: LucideIcon;
  className?: string;
}) {
  return <Icon className={className ?? sizeClass} strokeWidth={stroke} aria-hidden />;
}

const GROUP_ICONS: Record<string, LucideIcon> = {
  overview: LayoutDashboard,
  objects: Building2,
  finance: Wallet,
  utilities: Gauge,
  operations: Wrench,
  maintenance: Wrench,
  mytasks: ListTodo,
  comms: MessageSquare,
  docs: FileText,
  system: Settings,
  settings: Settings,
  platform: Satellite,
  activation: UserPlus,
  invstaff: Package,
};

const SECTION_ICONS: Record<string, LucideIcon> = {
  обзор: LayoutDashboard,
  квартиры: Home,
  книга: BookOpen,
  смены: ArrowLeftRight,
  заявки: ClipboardList,
  рабочие_задачи: ListTodo,
  мои_задачи: ListTodo,
  вода: Droplets,
  электроэнергия: Zap,
  счётчики: Gauge,
  такса: CircleDollarSign,
  капремонт: Landmark,
  интернет: Wifi,
  блокировка: Lock,
  охрана: Shield,
  уборка: Sparkles,
  инвентарь: Package,
  моя_инвентаризация: Package,
  бюджет: BarChart3,
  расходы: Receipt,
  отчётность: ScrollText,
  тарифы: ScrollText,
  опросы: Vote,
  документы: FileText,
  объявления: Megaphone,
  чат: MessagesSquare,
  персонал: Users,
  настройки: Settings,
  платформа: Satellite,
  активация: UserPlus,
  начальная_настройка: Puzzle,
  собрания: Landmark,
  решения: ScrollText,
  квартира: Home,
  жильцы: Users,
  финансы: Wallet,
  ук: LifeBuoy,
  обращения: LifeBuoy,
};

export function navSectionIconClass(key: string): string {
  return SECTION_ICON_CLASS[key] ?? 'text-sky-600';
}

export function navSectionIconChipClass(key: string): string {
  return SECTION_ICON_CHIP[key] ?? 'bg-sky-500/12';
}

export function navGroupIconClass(id: string): string {
  return GROUP_ICON_CLASS[id] ?? 'text-teal-600';
}

export function navGroupIconChipClass(id: string): string {
  return GROUP_ICON_CHIP[id] ?? 'bg-teal-500/12';
}

export function navGroupIcon(id: string, props?: LucideProps) {
  const Icon = GROUP_ICONS[id] ?? Building2;
  const { className, ...rest } = props ?? {};
  return (
    <Icon
      className={mergeClass(sizeClass, navGroupIconClass(id), className)}
      strokeWidth={stroke}
      aria-hidden
      {...rest}
    />
  );
}

export function navSectionIcon(key: string, props?: LucideProps) {
  const Icon = SECTION_ICONS[key] ?? LayoutDashboard;
  const { className, ...rest } = props ?? {};
  return (
    <Icon
      className={mergeClass(sizeClass, navSectionIconClass(key), className)}
      strokeWidth={stroke}
      aria-hidden
      {...rest}
    />
  );
}

export function navLogoutIcon(props?: LucideProps) {
  const { className, ...rest } = props ?? {};
  return (
    <LogOut
      className={mergeClass(sizeClass, 'text-rose-600', className)}
      strokeWidth={stroke}
      aria-hidden
      {...rest}
    />
  );
}
