function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function ymdParts(raw: string): { y: number; m: number; d: number } | null {
  const m = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}

export function formatOwnerDate(iso: string | null | undefined, _locale?: string): string {
  if (iso == null || String(iso).trim() === '') return '—';
  const raw = String(iso).trim();
  const parts = ymdParts(raw);
  if (parts) {
    if (parts.y === 1970 && parts.m === 1 && parts.d === 1) return '—';
    return `${pad2(parts.d)}.${pad2(parts.m)}.${parts.y}`;
  }
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime()) || dt.getTime() === 0) return '—';
  return `${pad2(dt.getDate())}.${pad2(dt.getMonth() + 1)}.${dt.getFullYear()}`;
}

export function formatOwnerDateTime(iso: string | null | undefined, locale: string): string {
  if (iso == null || String(iso).trim() === '') return '—';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime()) || dt.getTime() === 0) return '—';
  const date = formatOwnerDate(iso, locale);
  if (date === '—') return '—';
  const time = dt.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  return `${date} · ${time}`;
}

export function chatDayLabel(iso: string, locale: string, today: string, yesterday: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()) || d.getTime() === 0) return '—';
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return today;
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return yesterday;
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'long' });
}

export function announcementGroup(iso: string, today: string, yesterday: string, earlier: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return today;
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return yesterday;
  return earlier;
}
