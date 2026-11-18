/**
 * Stable, human-readable apartment identity for admin lists/search/cards.
 * Always operate on property id for actions; this is display-only.
 */

export type PropertyIdentityFields = {
  id?: number;
  apartment_number?: string | number | null;
  section_code?: string | null;
  block_code?: string | null;
  owner_name?: string | null;
  owner_email?: string | null;
  owner_phone?: string | null;
  company_name?: string | null;
};

export type PropertyIdentityTranslator = (
  key: string,
  vars?: Record<string, string | number>
) => string;

function trimCode(value: string | number | null | undefined): string {
  return String(value ?? '').trim();
}

/** Canonical apartment number string (never invent values). */
export function propertyApartmentNumber(property: PropertyIdentityFields): string {
  return trimCode(property.apartment_number);
}

export function propertySectionCode(property: PropertyIdentityFields): string {
  return trimCode(property.section_code);
}

export function propertyBlockCode(property: PropertyIdentityFields): string {
  return trimCode(property.block_code);
}

/**
 * Full identity: «Апартамент №32 · Секция Б · Блок 3»
 * Omits section/block parts when empty — never shows blank placeholders.
 */
export function formatPropertyIdentity(
  property: PropertyIdentityFields,
  t: PropertyIdentityTranslator
): string {
  const n = propertyApartmentNumber(property);
  const parts: string[] = [
    n ? t('property.identityApt', { n }) : t('property.identityAptUnknown'),
  ];
  const section = propertySectionCode(property);
  if (section) parts.push(t('property.identitySection', { section }));
  const block = propertyBlockCode(property);
  if (block) parts.push(t('property.identityBlock', { block }));
  return parts.join(' · ');
}

/** Compact title for tight table cells: №32 · Б · блок 3 */
export function formatPropertyIdentityCompact(
  property: PropertyIdentityFields,
  t: PropertyIdentityTranslator
): string {
  const n = propertyApartmentNumber(property);
  const bits: string[] = [n ? `№${n}` : '—'];
  const section = propertySectionCode(property);
  if (section) bits.push(section);
  const block = propertyBlockCode(property);
  if (block) bits.push(t('property.identityBlockShort', { block }));
  return bits.join(' · ');
}

export type PropertySearchHit = {
  property: PropertyIdentityFields;
  score: number;
  matchKind: 'exact_number' | 'prefix_number' | 'partial_number' | 'section_block' | 'owner' | 'other';
};

function normalizeQuery(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Rank properties for apartment search.
 * Exact apartment number beats prefix, then partial, then section/block/owner.
 */
export function rankPropertySearch(
  properties: PropertyIdentityFields[],
  queryRaw: string
): PropertySearchHit[] {
  const q = normalizeQuery(queryRaw);
  if (!q) {
    return [...properties]
      .sort((a, b) =>
        propertyApartmentNumber(a).localeCompare(propertyApartmentNumber(b), undefined, {
          numeric: true,
          sensitivity: 'base',
        })
      )
      .map((property) => ({ property, score: 0, matchKind: 'other' as const }));
  }

  const hits: PropertySearchHit[] = [];
  for (const property of properties) {
    const num = propertyApartmentNumber(property).toLowerCase();
    const section = propertySectionCode(property).toLowerCase();
    const block = propertyBlockCode(property).toLowerCase();
    const owner = trimCode(property.owner_name).toLowerCase();
    const email = trimCode(property.owner_email).toLowerCase();
    const phone = trimCode(property.owner_phone).toLowerCase();
    const company = trimCode(property.company_name).toLowerCase();
    const identityBlob = [num, section, block].filter(Boolean).join(' ');

    let score = -1;
    let matchKind: PropertySearchHit['matchKind'] = 'other';

    if (num && num === q) {
      score = 1000;
      matchKind = 'exact_number';
    } else if (num && num.startsWith(q)) {
      score = 800 - Math.min(num.length, 40);
      matchKind = 'prefix_number';
    } else if (num && num.includes(q)) {
      score = 600 - Math.min(num.indexOf(q), 40);
      matchKind = 'partial_number';
    } else if (
      identityBlob.includes(q) ||
      (section && section.includes(q)) ||
      (block && block.includes(q)) ||
      `${num} ${section}`.includes(q) ||
      `${num} ${section} ${block}`.includes(q)
    ) {
      score = 400;
      matchKind = 'section_block';
    } else if (
      (owner && owner.includes(q)) ||
      (email && email.includes(q)) ||
      (phone && phone.includes(q)) ||
      (company && company.includes(q))
    ) {
      score = 200;
      matchKind = 'owner';
    }

    if (score >= 0) hits.push({ property, score, matchKind });
  }

  hits.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return propertyApartmentNumber(a.property).localeCompare(
      propertyApartmentNumber(b.property),
      undefined,
      { numeric: true, sensitivity: 'base' }
    );
  });
  return hits;
}

/** Split label into plain / highlighted chunks for the query (case-insensitive). */
export function highlightPropertyMatch(
  label: string,
  queryRaw: string
): Array<{ text: string; match: boolean }> {
  const q = queryRaw.trim();
  if (!q || !label) return [{ text: label, match: false }];
  const lower = label.toLowerCase();
  const needle = q.toLowerCase();
  const idx = lower.indexOf(needle);
  if (idx < 0) return [{ text: label, match: false }];
  const before = label.slice(0, idx);
  const mid = label.slice(idx, idx + q.length);
  const after = label.slice(idx + q.length);
  const parts: Array<{ text: string; match: boolean }> = [];
  if (before) parts.push({ text: before, match: false });
  parts.push({ text: mid, match: true });
  if (after) parts.push(...highlightPropertyMatch(after, q));
  return parts;
}
