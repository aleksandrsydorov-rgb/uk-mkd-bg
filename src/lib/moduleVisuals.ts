import {
  BookOpen,
  ClipboardList,
  Droplets,
  FileText,
  Landmark,
  Lock,
  Megaphone,
  MessagesSquare,
  Package,
  Puzzle,
  Receipt,
  Shield,
  Sparkles,
  Users,
  Vote,
  Wallet,
  Wifi,
  Zap,
  type LucideIcon,
} from 'lucide-react';

export type ModuleVisual = {
  icon: LucideIcon;
  iconClass: string;
};

const VISUALS: Record<string, ModuleVisual> = {
  property_book: { icon: BookOpen, iconClass: 'text-indigo-600' },
  support_fee: { icon: Wallet, iconClass: 'text-emerald-600' },
  capital_repair: { icon: Landmark, iconClass: 'text-orange-700' },
  budget: { icon: Wallet, iconClass: 'text-teal-700' },
  water: { icon: Droplets, iconClass: 'text-sky-600' },
  electricity: { icon: Zap, iconClass: 'text-amber-600' },
  internet: { icon: Wifi, iconClass: 'text-sky-600' },
  service_lock: { icon: Lock, iconClass: 'text-slate-600' },
  security: { icon: Shield, iconClass: 'text-slate-700' },
  requests: { icon: ClipboardList, iconClass: 'text-teal-700' },
  chat: { icon: MessagesSquare, iconClass: 'text-sky-700' },
  polls: { icon: Vote, iconClass: 'text-violet-600' },
  announcements: { icon: Megaphone, iconClass: 'text-orange-600' },
  general_meeting: { icon: Landmark, iconClass: 'text-indigo-600' },
  building_documents: { icon: FileText, iconClass: 'text-slate-600' },
  guest_mode: { icon: Users, iconClass: 'text-teal-600' },
  cleaning: { icon: Sparkles, iconClass: 'text-sky-600' },
  inventory: { icon: Package, iconClass: 'text-amber-700' },
  uk_expenses: { icon: Receipt, iconClass: 'text-emerald-700' },
};

const PURPOSE_KEYS: Record<string, string> = {
  property_book: 'admin.firstRunModuleAboutPropertyBook',
  support_fee: 'admin.firstRunModuleAboutSupportFee',
  capital_repair: 'admin.firstRunModuleAboutCapitalRepair',
  budget: 'admin.firstRunModuleAboutBudget',
  water: 'admin.firstRunModuleAboutWater',
  electricity: 'admin.firstRunModuleAboutElectricity',
  internet: 'admin.firstRunModuleAboutInternet',
  requests: 'admin.firstRunModuleAboutRequests',
  chat: 'admin.firstRunModuleAboutChat',
  polls: 'admin.firstRunModuleAboutPolls',
  announcements: 'admin.firstRunModuleAboutAnnouncements',
  general_meeting: 'admin.firstRunModuleAboutGeneralMeeting',
  service_lock: 'admin.firstRunModuleAboutServiceLock',
  cleaning: 'admin.firstRunModuleAboutCleaning',
  inventory: 'admin.firstRunModuleAboutInventory',
  uk_expenses: 'admin.firstRunModuleAboutUkExpenses',
  security: 'admin.firstRunModuleAboutSecurity',
  building_documents: 'admin.firstRunModuleAboutDocuments',
  guest_mode: 'admin.firstRunModuleAboutGuestMode',
};

export function moduleVisual(moduleKey: string): ModuleVisual {
  return VISUALS[moduleKey] ?? { icon: Puzzle, iconClass: 'text-slate-500' };
}

export function modulePurposeMessageKey(moduleKey: string): string | null {
  return PURPOSE_KEYS[moduleKey] ?? null;
}
