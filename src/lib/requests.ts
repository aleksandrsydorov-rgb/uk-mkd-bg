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
  if (p === 'высокий') return 'bg-danger-bg text-danger border-danger/25';
  if (p === 'низкий') return 'bg-surface-secondary text-secondary border-border';
  return 'bg-warning-bg text-warning border-warning/25';
}
