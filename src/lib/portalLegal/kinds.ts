export const PORTAL_LEGAL_KINDS = {
  operator: 'operator_contacts',
  terms: 'portal_terms',
  privacy: 'privacy',
  cookies: 'cookies',
  'house-rules': 'house_rules',
} as const;

export type PortalLegalSlug = keyof typeof PORTAL_LEGAL_KINDS;
export type PortalLegalKind = (typeof PORTAL_LEGAL_KINDS)[PortalLegalSlug];

export const PORTAL_LEGAL_SLUGS = Object.keys(PORTAL_LEGAL_KINDS) as PortalLegalSlug[];

export function isPortalLegalSlug(value: string): value is PortalLegalSlug {
  return Object.prototype.hasOwnProperty.call(PORTAL_LEGAL_KINDS, value);
}

export function portalLegalKind(slug: PortalLegalSlug): PortalLegalKind {
  return PORTAL_LEGAL_KINDS[slug];
}

export function portalLegalSlug(kind: string): PortalLegalSlug | null {
  const found = PORTAL_LEGAL_SLUGS.find((slug) => PORTAL_LEGAL_KINDS[slug] === kind);
  return found ?? null;
}

/** Stable ids of the local stage-1 test edition. Stage 2 can reference these on the isolated stand. */
export const PORTAL_LEGAL_STAGE1_IDS = {
  termsRevision1: 'a1111111-1111-4111-8111-111111111111',
  termsText1Bg: 'a1111111-1111-4111-8111-1111111111b1',
  termsRevision2: 'a2222222-2222-4222-8222-222222222222',
  termsText2Bg: 'a2222222-2222-4222-8222-2222222222b2',
  draftRevision: 'a3333333-3333-4333-8333-333333333333',
  draftTextBg: 'a3333333-3333-4333-8333-3333333333d3',
  closedAttachment: 'a4444444-4444-4444-8444-444444444444',
} as const;
