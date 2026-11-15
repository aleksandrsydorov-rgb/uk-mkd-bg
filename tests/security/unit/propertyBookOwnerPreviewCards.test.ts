import { describe, expect, it } from 'vitest';
import {
  partitionPropertyBookOwnerRows,
  isPropertyBookOwnerIdentityOnly,
  isPropertyBookOwnerRowBlank,
} from '@/lib/propertyBookAdmin';
import {
  buildBookPreviewIssues,
  groupBookPreviewByApartment,
} from '@/lib/propertyBookImportPreview';
import { presentBookPreviewIssue } from '@/lib/firstRunUserMessage';
import { translate } from '@/i18n/translate';

describe('owners identity-only / blank rows', () => {
  it('skips fully blank rows and partitions identity-only', () => {
    expect(
      isPropertyBookOwnerRowBlank({
        apartment_number: '',
        entity_kind: '',
        first_name: '',
      }),
    ).toBe(true);
    expect(
      isPropertyBookOwnerIdentityOnly({
        apartment_number: '12',
        section_code: 'A',
        entity_kind: '',
        first_name: '',
      }),
    ).toBe(true);
    const part = partitionPropertyBookOwnerRows([
      { apartment_number: '', entity_kind: '', _row: '2' },
      { apartment_number: '10', section_code: 'A', entity_kind: '', _row: '3' },
      {
        apartment_number: '11',
        section_code: 'A',
        entity_kind: 'natural_person',
        first_name: 'Иван',
        last_name: 'Иванов',
        ownership_share_percent: '100',
        email: 'a@ex.com',
        _row: '4',
      },
    ]);
    expect(part.blankSkipped).toBe(1);
    expect(part.identityOnly).toHaveLength(1);
    expect(part.creatable).toHaveLength(1);
    expect(part.creatable[0]?.apartment_number).toBe('11');
  });
});

describe('book preview apartment cards', () => {
  it('groups multiple remarks under one apartment card', () => {
    const issues = buildBookPreviewIssues([
      {
        sheet: 'owners',
        row: '5',
        field: 'email',
        reason: 'owner_email_required',
        apartment: '15',
        severity: 'warning',
        meta: { sectionCode: 'A', blockCode: '', sourceRows: [5, 6] },
      },
      {
        sheet: 'owners',
        row: '5',
        field: 'ownership_share_percent',
        reason: 'shares_must_sum_100',
        apartment: '15',
        severity: 'error',
        meta: { sectionCode: 'A', blockCode: '', sourceRows: [5, 6] },
      },
      {
        sheet: 'owners',
        row: '',
        field: 'owners',
        reason: 'owners_required',
        apartment: '20',
        severity: 'warning',
        meta: { sectionCode: 'Б', blockCode: '' },
      },
    ]);
    const { cards, unlinked } = groupBookPreviewByApartment(issues);
    expect(unlinked).toHaveLength(0);
    expect(cards.length).toBeGreaterThanOrEqual(2);
    const multi = cards.find((c) => c.apartment === '15');
    expect(multi?.status).toBe('error');
    expect(multi?.issues.length).toBeGreaterThanOrEqual(2);
    const missing = cards.find((c) => c.apartment === '20');
    expect(missing?.status).toBe('clarify');
    expect(presentBookPreviewIssue(missing!.issues[0]!, (k, p) => translate('ru', k, p))).toBe(
      'Сведения о собственнике отсутствуют',
    );
  });

  it('keeps ambiguous apartment numbers in unlinked list', () => {
    const issues = buildBookPreviewIssues([
      {
        sheet: 'owners',
        row: '8',
        field: 'section_code',
        reason: 'section_code_required_for_disambiguation',
        apartment: '8',
        severity: 'error',
        meta: { candidateSections: ['A', 'Б'], sourceRows: [8] },
      },
    ]);
    const { cards, unlinked } = groupBookPreviewByApartment(issues);
    expect(cards).toHaveLength(0);
    expect(unlinked).toHaveLength(1);
  });

  it('attaches Excel rows and fields from owner file for soft RPC warnings', () => {
    const issues = buildBookPreviewIssues(
      [
        {
          sheet: 'validation',
          row: '',
          field: 'email',
          reason: 'owner_email_required',
          apartment: '15',
          severity: 'warning',
        },
        {
          sheet: 'validation',
          row: '',
          field: 'owners',
          reason: 'owners_required',
          apartment: '20',
          severity: 'warning',
        },
      ],
      {
        owners: [
          {
            apartment_number: '15',
            section_code: 'A',
            entity_kind: 'natural_person',
            first_name: 'A',
            last_name: 'B',
            _row: '5',
          },
          {
            apartment_number: '15',
            section_code: 'A',
            entity_kind: 'natural_person',
            first_name: 'C',
            last_name: 'D',
            _row: '6',
          },
          { apartment_number: '20', section_code: 'Б', _row: '40' },
        ],
      },
    );
    const multi = issues.find((i) => i.reason === 'owner_email_required');
    expect(multi?.rows).toEqual([5, 6]);
    expect(multi?.field).toBe('email');
    expect(multi?.sectionCode).toBe('A');
    const missing = issues.find((i) => i.reason === 'owners_required');
    expect(missing?.rows).toEqual([40]);
    expect(missing?.field).toBe('owners');
    expect(missing?.sectionCode).toBe('Б');
  });
});
