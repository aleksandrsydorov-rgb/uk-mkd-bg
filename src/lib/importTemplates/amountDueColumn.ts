/**
 * Shared money-balance column for first-run opening templates
 * (support fee, capital repair, internet, water/electricity meters).
 *
 * Sign semantics (unchanged):
 *   positive — debt; negative — overpayment; 0 — zero balance; blank — unknown / enter later.
 */
export const AMOUNT_DUE_COLUMN_LABEL = {
  ru: 'Сумма к оплате, EUR',
  bg: 'Сума за плащане, EUR',
  en: 'Amount due, EUR',
} as const;

/** Previous canonical headers + short aliases. Labels from AMOUNT_DUE_COLUMN_LABEL are also accepted. */
export const AMOUNT_DUE_COLUMN_ALIASES: string[] = [
  // Previous localized headers (kept for files already filled).
  'сумма начального остатка, eur',
  'сумма начального остатка (eur)',
  'сума начален остатък, eur',
  'сума начален остатък (eur)',
  'сума на началния остатък (eur)',
  'opening balance amount, eur',
  'opening balance amount (eur)',
  // Short / generic / legacy keys.
  'opening_balance',
  'opening_balance_eur',
  'amount',
  'сумма',
  'сума',
  'сумма, eur',
  'сумма eur',
  'amount eur',
  'amount, eur',
  'остаток',
  'остатък',
];

export const AMOUNT_DUE_COLUMN_NOTES = {
  ru:
    'Колонка «Сумма к оплате, EUR»: положительная сумма — долг; отрицательная — переплата; 0 — нулевой остаток; пусто — данных нет, можно внести позже. Одиночный дефис «-» — ошибка.',
  bg:
    'Колона «Сума за плащане, EUR»: положителна сума — дълг; отрицателна — преплата; 0 — нулев остатък; празно — няма данни, може по-късно. Самостоятелен дефис «-» е грешка.',
  en:
    'Column “Amount due, EUR”: positive — debt; negative — overpayment; 0 — zero balance; blank — no data yet, enter later. A lone hyphen “-” is an error.',
} as const;

export const AMOUNT_DUE_COLUMN_INSTRUCTION = {
  ru:
    'Сумма к оплате: плюс или без знака — долг; минус — переплата; 0 — нулевой остаток; пусто — данных нет, можно внести позже. Числа Excel и текст с точкой/запятой.',
  bg:
    'Сума за плащане: плюс или без знак — дълг; минус — преплата; 0 — нулев остатък; празно — няма данни, може по-късно. Числа от Excel и текст с точка/запетая.',
  en:
    'Amount due: plus or unsigned — debt; minus — overpayment; 0 — zero balance; blank — no data yet, enter later. Excel numbers and comma/dot text.',
} as const;
