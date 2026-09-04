export type RequestPriority = 'низкий' | 'средний' | 'высокий';

export function normalizePriority(raw: string | null | undefined): RequestPriority {
  const s = String(raw ?? '')
    .trim()
    .replace(/^['"`]+|['"`]+$/g, '')
    .toLowerCase();
  if (s === 'high' || s === 'высокий' || s === 'urgent' || s === 'высокий приоритет') return 'высокий';
  if (s === 'low' || s === 'низкий') return 'низкий';
  return 'средний';
}

export function priorityLabel(raw: string | null | undefined) {
  const p = normalizePriority(raw);
  if (p === 'высокий') return 'Высокий';
  if (p === 'низкий') return 'Низкий';
  return 'Средний';
}

export function priorityClass(raw: string | null | undefined) {
  const p = normalizePriority(raw);
  if (p === 'высокий') return 'bg-red-500/15 text-red-300 border-red-500/30';
  if (p === 'низкий') return 'bg-white/10 text-white/70 border-white/15';
  return 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30';
}
