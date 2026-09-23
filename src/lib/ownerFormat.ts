export function formatOwnerDateTime(iso: string | null | undefined, locale: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const date = d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  return `${date} · ${time}`;
}

export function formatOwnerDate(iso: string | null | undefined, locale: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    const [y, m, day] = String(iso).slice(0, 10).split('-');
    if (y && m && day) return `${day}.${m}.${y}`;
    return String(iso);
  }
  return d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function chatDayLabel(iso: string, locale: string, today: string, yesterday: string): string {
  const d = new Date(iso);
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
