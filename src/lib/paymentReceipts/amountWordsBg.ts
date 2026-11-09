/** Bulgarian amount-in-words for EUR receipts (official PDF language). */

const ONES = [
  '',
  'един',
  'два',
  'три',
  'четири',
  'пет',
  'шест',
  'седем',
  'осем',
  'девет',
];
const ONES_F = [
  '',
  'една',
  'две',
  'три',
  'четири',
  'пет',
  'шест',
  'седем',
  'осем',
  'девет',
];
const TEENS = [
  'десет',
  'единадесет',
  'дванадесет',
  'тринадесет',
  'четиринадесет',
  'петнадесет',
  'шестнадесет',
  'седемнадесет',
  'осемнадесет',
  'деветнадесет',
];
const TENS = [
  '',
  '',
  'двадесет',
  'тридесет',
  'четиридесет',
  'петдесет',
  'шестдесет',
  'седемдесет',
  'осемдесет',
  'деветдесет',
];
const HUNDREDS = [
  '',
  'сто',
  'двеста',
  'триста',
  'четиристотин',
  'петстотин',
  'шестстотин',
  'седемстотин',
  'осемстотин',
  'деветстотин',
];

function joinParts(parts: string[]): string {
  return parts.filter(Boolean).join(' ');
}

function underThousand(n: number, feminine: boolean): string {
  if (n <= 0) return '';
  const h = Math.floor(n / 100);
  const rem = n % 100;
  const ones = feminine ? ONES_F : ONES;
  const parts: string[] = [];
  if (h > 0) parts.push(HUNDREDS[h]!);
  if (rem >= 10 && rem <= 19) {
    parts.push(TEENS[rem - 10]!);
  } else {
    const t = Math.floor(rem / 10);
    const o = rem % 10;
    if (t > 0) parts.push(TENS[t]!);
    if (o > 0) parts.push(ones[o]!);
  }
  return joinParts(parts);
}

function scaleWord(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 19) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

function integerToWords(n: number): string {
  if (n === 0) return 'нула';
  const parts: string[] = [];
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const rest = n % 1000;

  if (millions > 0) {
    if (millions === 1) parts.push('един милион');
    else parts.push(joinParts([underThousand(millions, false), scaleWord(millions, 'милион', 'милиона', 'милиона')]));
  }
  if (thousands > 0) {
    if (thousands === 1) parts.push('хиляда');
    else parts.push(joinParts([underThousand(thousands, true), scaleWord(thousands, 'хиляда', 'хиляди', 'хиляди')]));
  }
  if (rest > 0) parts.push(underThousand(rest, false));
  return joinParts(parts);
}

/** e.g. 400.00 → «четиристотин евро и 00/100» */
export function amountEurToWordsBg(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) return '—';
  const rounded = Math.round(amount * 100) / 100;
  const whole = Math.floor(rounded + 1e-9);
  const cents = Math.round((rounded - whole) * 100);
  const words = integerToWords(whole);
  const euroWord = whole === 1 ? 'евро' : 'евро';
  return `${words} ${euroWord} и ${String(cents).padStart(2, '0')}/100`;
}
