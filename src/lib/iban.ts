/** IBAN normalize + mod-97 check (mirrors SQL public.normalize_iban / iban_mod97_valid). */

export function normalizeIban(raw: string | null | undefined): string {
  return String(raw ?? '')
    .replace(/\s+/g, '')
    .toUpperCase();
}

export function isValidIban(raw: string | null | undefined): boolean {
  const v = normalizeIban(raw);
  if (v.length < 15 || v.length > 34) return false;
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(v)) return false;
  const rearranged = `${v.slice(4)}${v.slice(0, 4)}`;
  let digits = '';
  for (const ch of rearranged) {
    if (ch >= '0' && ch <= '9') digits += ch;
    else digits += String(ch.charCodeAt(0) - 55);
  }
  let rem = 0;
  for (let i = 0; i < digits.length; i += 7) {
    rem = Number(`${rem}${digits.slice(i, i + 7)}`) % 97;
  }
  return rem === 1;
}
