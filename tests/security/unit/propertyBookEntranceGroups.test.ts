import { describe, expect, it } from 'vitest';
import { translate } from '@/i18n/translate';
import {
  buildBookPreviewIssues,
  formatBookApartmentCardHeading,
  formatEntranceGroupTitle,
  groupBookApartmentCardsByEntrance,
  groupBookPreviewByApartment,
  supplementApartmentCardsFromOwners,
  type BookApartmentPreviewCard,
} from '@/lib/propertyBookImportPreview';
import { presentBookPreviewIssue } from '@/lib/firstRunUserMessage';

const tRu = (k: string, p?: Record<string, string | number>) => translate('ru', k, p);

function card(
  partial: Partial<BookApartmentPreviewCard> &
    Pick<BookApartmentPreviewCard, 'apartment' | 'sectionCode'>,
): BookApartmentPreviewCard {
  const section = partial.sectionCode || '';
  const block = partial.blockCode || '';
  const apt = partial.apartment;
  return {
    key: `${apt.toLowerCase()}\u0001${section.toLowerCase()}\u0001${block.toLowerCase()}`,
    apartment: apt,
    sectionCode: section,
    blockCode: block,
    status: partial.status ?? 'clarify',
    issues: partial.issues ?? [],
  };
}

describe('entrance-grouped apartment preview cards', () => {
  it('groups A → Б → В with natural apartment order and correct counts', () => {
    const cards: BookApartmentPreviewCard[] = [
      card({ apartment: '10', sectionCode: 'В' }),
      card({ apartment: '1', sectionCode: 'Б' }),
      card({ apartment: '2', sectionCode: 'A' }),
      card({ apartment: '1', sectionCode: 'A' }),
      card({ apartment: '10', sectionCode: 'A' }),
      card({ apartment: '2', sectionCode: 'Б' }),
      card({ apartment: '1', sectionCode: 'В' }),
      card({ apartment: '9', sectionCode: 'A' }),
    ];
    // Pad to realistic counts for title check is unnecessary — order matters.
    const groups = groupBookApartmentCardsByEntrance(cards);
    expect(groups.map((g) => g.sectionCode)).toEqual(['A', 'Б', 'В']);
    expect(groups[0]!.cards.map((c) => c.apartment)).toEqual(['1', '2', '9', '10']);
    expect(groups[1]!.cards.map((c) => c.apartment)).toEqual(['1', '2']);
    expect(groups[2]!.cards.map((c) => c.apartment)).toEqual(['1', '10']);
    expect(formatEntranceGroupTitle(groups[0]!, tRu)).toBe('Вход A — 4 квартиры');
    expect(formatBookApartmentCardHeading(tRu, groups[0]!.cards[0]!)).toBe(
      'Квартира №1 — Требует уточнения',
    );
  });

  it('keeps №1 as three separate cards across entrances and counts apartments once', () => {
    const cards = [
      card({ apartment: '1', sectionCode: 'A' }),
      card({ apartment: '1', sectionCode: 'Б' }),
      card({ apartment: '1', sectionCode: 'В' }),
    ];
    const groups = groupBookApartmentCardsByEntrance(cards);
    expect(groups).toHaveLength(3);
    expect(groups.every((g) => g.cards.length === 1)).toBe(true);
    expect(groups.reduce((n, g) => n + g.cards.length, 0)).toBe(3);
  });

  it('shows block in card title when present; multi-owner stays one card', () => {
    const heading = formatBookApartmentCardHeading(tRu, {
      apartment: '5',
      blockCode: '1',
      status: 'clarify',
    });
    expect(heading).toBe('Квартира №5 · блок 1 — Требует уточнения');

    const issues = buildBookPreviewIssues(
      [
        {
          sheet: 'owners',
          row: '3',
          field: 'entity_kind',
          reason: 'entity_kind_required',
          apartment: '7',
          severity: 'warning',
          meta: { sectionCode: 'A', sourceRows: [3] },
        },
        {
          sheet: 'owners',
          row: '4',
          field: 'owner_share_required',
          reason: 'owner_share_required',
          apartment: '7',
          severity: 'warning',
          meta: { sectionCode: 'A', sourceRows: [4] },
        },
      ],
      {
        owners: [
          {
            apartment_number: '7',
            section_code: 'A',
            first_name: 'A',
            last_name: 'B',
            _row: '3',
          },
          {
            apartment_number: '7',
            section_code: 'A',
            first_name: 'C',
            last_name: 'D',
            _row: '4',
          },
        ],
      },
    );
    const { cards } = groupBookPreviewByApartment(issues);
    expect(cards.filter((c) => c.apartment === '7' && c.sectionCode === 'A')).toHaveLength(1);
  });

  it('supplements ok cards from owners so every apartment appears', () => {
    const issues = buildBookPreviewIssues([
      {
        sheet: 'owners',
        row: '2',
        field: 'owners',
        reason: 'owners_required',
        apartment: '1',
        severity: 'warning',
        meta: { sectionCode: 'A', sourceRows: [2] },
      },
    ]);
    const { cards } = groupBookPreviewByApartment(issues);
    const merged = supplementApartmentCardsFromOwners(cards, [
      { apartment_number: '1', section_code: 'A' },
      { apartment_number: '2', section_code: 'A' },
      { apartment_number: '10', section_code: 'A' },
      // Ambiguous row without section must not become a «Без секции» card.
      { apartment_number: '8', section_code: '' },
    ]);
    const groups = groupBookApartmentCardsByEntrance(merged);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.cards.map((c) => c.apartment)).toEqual(['1', '2', '10']);
    expect(groups[0]!.cards[1]!.status).toBe('ok');
    expect(merged.some((c) => c.apartment === '8' && !c.sectionCode)).toBe(false);
  });

  it('keeps ambiguous apartment without section in unlinked blocking list', () => {
    const issues = buildBookPreviewIssues([
      {
        sheet: 'Собственники',
        row: '12',
        field: 'section_code',
        reason: 'section_code_required_for_disambiguation',
        apartment: '8',
        severity: 'error',
        meta: { candidateSections: ['A', 'Б'], sourceRows: [12] },
      },
    ]);
    const { cards, unlinked } = groupBookPreviewByApartment(issues);
    expect(cards).toHaveLength(0);
    expect(unlinked).toHaveLength(1);
    const msg = presentBookPreviewIssue(unlinked[0]!.issue, tRu);
    expect(msg).toContain('Секция');
    expect(msg).toContain('строка 12');
  });
});
