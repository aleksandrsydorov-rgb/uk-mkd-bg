import { describe, expect, it } from 'vitest';
import { translate } from '@/i18n/translate';
import {
  presentBookApartmentCardContent,
  presentBookPreviewIssue,
} from '@/lib/firstRunUserMessage';
import {
  buildBookPreviewIssues,
  groupBookPreviewByApartment,
} from '@/lib/propertyBookImportPreview';

const tRu = (k: string, p?: Record<string, string | number>) => translate('ru', k, p);
const tEn = (k: string, p?: Record<string, string | number>) => translate('en', k, p);
const tBg = (k: string, p?: Record<string, string | number>) => translate('bg', k, p);

describe('owners import apartment card copy', () => {
  it('B/1 identity-only → one short message, no Excel row', () => {
    const issues = buildBookPreviewIssues(
      [
        {
          sheet: 'Собственники',
          row: '81',
          field: 'owners',
          reason: 'owners_required',
          apartment: '1',
          severity: 'warning',
          meta: { sectionCode: 'В', blockCode: '', sourceRows: [81] },
        },
      ],
      {
        owners: [{ apartment_number: '1', section_code: 'В', _row: '81', _sheet: 'Собственники' }],
      },
    );
    const { cards } = groupBookPreviewByApartment(issues);
    const card = cards.find((c) => c.apartment === '1' && c.sectionCode === 'В');
    expect(card).toBeTruthy();
    const content = presentBookApartmentCardContent(card!, [], tRu);
    expect(content.where).toBe('');
    expect(content.blocks).toHaveLength(1);
    expect(content.blocks[0]!.lines).toEqual([
      'Сведений о владельце пока нет. После импорта квартира будет отмечена как требующая уточнения. Добавьте сведения в Книге собственности.',
    ]);
    expect(content.blocks[0]!.lines.join('\n')).not.toMatch(/строк/i);
    expect(content.blocks[0]!.lines.join('\n')).not.toMatch(/лист/i);
  });

  it('B/2 partial → saved fields include email; clarify entity kind + share; no Excel row', () => {
    const owners = [
      {
        apartment_number: '2',
        section_code: 'В',
        ownership_type: '1',
        entity_kind: '',
        ownership_share_percent: '',
        email: 'AndreyMAKHROV@mail.ru',
        phone: '89037451468',
        first_name: 'Гульнара',
        middle_name: '',
        last_name: 'Антахунова',
        eik_bulstat: '176044993',
        _row: '82',
        _sheet: 'Собственники',
      },
    ];
    const issues = buildBookPreviewIssues(
      [
        {
          sheet: 'Собственники',
          row: '82',
          field: 'entity_kind',
          reason: 'entity_kind_required',
          apartment: '2',
          severity: 'warning',
          meta: { sectionCode: 'В', blockCode: '', sourceRows: [82] },
        },
        {
          sheet: 'Собственники',
          row: '82',
          field: 'ownership_share_percent',
          reason: 'owner_share_required',
          apartment: '2',
          severity: 'warning',
          meta: { sectionCode: 'В', blockCode: '', sourceRows: [82] },
        },
      ],
      { owners },
    );
    const { cards } = groupBookPreviewByApartment(issues);
    const card = cards.find((c) => c.apartment === '2' && c.sectionCode === 'В');
    expect(card?.status).toBe('clarify');
    const content = presentBookApartmentCardContent(card!, owners, tRu);
    expect(content.where).toBe('');
    const text = content.blocks.flatMap((b) => b.lines).join('\n');
    expect(text).not.toMatch(/строк/i);
    expect(text).not.toMatch(/лист/i);
    expect(text).not.toMatch(/отчеств/i);
    expect(text).toContain('Будут сохранены:');
    expect(text).toContain('email');
    expect(text).toContain('имя');
    expect(text).toContain('фамилия');
    expect(text).toContain('телефон');
    expect(text).toContain('ЕИК / Булстат');
    expect(text).toContain('Можно уточнить после импорта:');
    expect(text).toContain('физическое или юридическое лицо');
    expect(text).toContain('долю владения квартирой');

    const en = presentBookApartmentCardContent(card!, owners, tEn)
      .blocks.flatMap((b) => b.lines)
      .join('\n');
    expect(en).toContain('Will be saved:');
    expect(en).toContain('email');
    expect(en).toContain('Can be clarified after import:');
    expect(en).toContain('individual or legal entity');

    const bg = presentBookApartmentCardContent(card!, owners, tBg)
      .blocks.flatMap((b) => b.lines)
      .join('\n');
    expect(bg).toContain('Ще бъдат записани:');
    expect(bg).toContain('email');
    expect(bg).toContain('Може да се уточни след импорта:');
  });

  it('blocking ambiguous shows sheet/row/column once and does not promise save', () => {
    const issues = buildBookPreviewIssues([
      {
        sheet: 'Собственники',
        row: '12',
        field: 'section_code',
        reason: 'section_code_required_for_disambiguation',
        apartment: '8',
        severity: 'error',
        meta: { candidateSections: ['А', 'Б'], sourceRows: [12] },
      },
    ]);
    const { unlinked } = groupBookPreviewByApartment(issues);
    expect(unlinked).toHaveLength(1);
    const msg = presentBookPreviewIssue(unlinked[0]!.issue, tRu);
    expect(msg).toContain('Квартира №8');
    expect(msg).toContain('Секция');
    expect(msg).toContain('строка 12');
    expect(msg).toContain('Собственники');
    expect(msg.toLowerCase()).not.toContain('будут сохранены');
  });

  it('blocking + soft does not show will-save', () => {
    const owners = [
      {
        apartment_number: '5',
        section_code: 'А',
        first_name: 'Иван',
        last_name: 'Иванов',
        email: 'a@ex.com',
        phone: '100',
        entity_kind: '',
        ownership_share_percent: '',
        _row: '10',
      },
    ];
    const issues = buildBookPreviewIssues(
      [
        {
          sheet: 'owners',
          row: '10',
          field: 'ownership_share_percent',
          reason: 'shares_must_sum_100',
          apartment: '5',
          severity: 'error',
          meta: { sectionCode: 'А', sourceRows: [10] },
        },
        {
          sheet: 'owners',
          row: '10',
          field: 'entity_kind',
          reason: 'entity_kind_required',
          apartment: '5',
          severity: 'warning',
          meta: { sectionCode: 'А', sourceRows: [10] },
        },
        {
          sheet: 'owners',
          row: '10',
          field: 'ownership_share_percent',
          reason: 'owner_share_required',
          apartment: '5',
          severity: 'warning',
          meta: { sectionCode: 'А', sourceRows: [10] },
        },
      ],
      { owners },
    );
    const { cards } = groupBookPreviewByApartment(issues);
    const card = cards.find((c) => c.apartment === '5');
    expect(card?.status).toBe('error');
    const content = presentBookApartmentCardContent(card!, owners, tRu);
    const text = content.blocks.flatMap((b) => b.lines).join('\n');
    expect(text).not.toContain('Будут сохранены');
    expect(content.where).toMatch(/строка 10/i);
  });
});
