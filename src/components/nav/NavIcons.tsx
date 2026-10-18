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

const sizeProps = { className: 'h-4 w-4 shrink-0', strokeWidth: 1.75 } as const;

export function NavIcon({
  icon: Icon,
  className,
}: {
  icon: LucideIcon;
  className?: string;
}) {
  return <Icon className={className ?? sizeProps.className} strokeWidth={sizeProps.strokeWidth} aria-hidden />;
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
  // Owner / guest
  квартира: Home,
  жильцы: Users,
  финансы: Wallet,
  ук: LifeBuoy,
  обращения: LifeBuoy,
};

export function navGroupIcon(id: string, props?: LucideProps) {
  const Icon = GROUP_ICONS[id] ?? Building2;
  return <Icon {...sizeProps} {...props} aria-hidden />;
}

export function navSectionIcon(key: string, props?: LucideProps) {
  const Icon = SECTION_ICONS[key] ?? LayoutDashboard;
  return <Icon {...sizeProps} {...props} aria-hidden />;
}

export function navLogoutIcon(props?: LucideProps) {
  return <LogOut {...sizeProps} {...props} aria-hidden />;
}
