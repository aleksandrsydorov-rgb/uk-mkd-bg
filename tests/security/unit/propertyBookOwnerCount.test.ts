import { describe, expect, it } from 'vitest';
import {
  buildBookPreviewIssues,
  coerceOwnershipTypeField,
  collectOwnersStepOwnershipTypeConflicts,
  normalizeOwnershipType,
  parseDeclaredOwnerCount,
} from '@/lib/propertyBookImportPreview';
import { presentBookPreviewIssue } from '@/lib/firstRunUserMessage';
import { translate } from '@/i18n/translate';

describe('property book owner count', () => {
  it('normalizes integers and legacy labels to sole/shared', () => {
    expect(normalizeOwnershipType('1')).toBe('sole');
    expect(normalizeOwnershipType('2')).toBe('shared');
    expect(normalizeOwnershipType('3')).toBe('shared');
    expect(normalizeOwnershipType('sole')).toBe('sole');
    expect(normalizeOwnershipType('Один владелец')).toBe('sole');
    expect(normalizeOwnershipType('shared')).toBe('shared');
    expect(normalizeOwnershipType('Несколько владельцев')).toBe('shared');
    expect(normalizeOwnershipType('')).toBe('');
    expect(normalizeOwnershipType('0')).toBe('');
  });

  it('keeps declared count on coerce for mismatch checks', () => {
    expect(coerceOwnershipTypeField(2)).toBe('2');
    expect(coerceOwnershipTypeField('2')).toBe('2');
    expect(coerceOwnershipTypeField('1')).toBe('1');
    expect(coerceOwnershipTypeField('sole')).toBe('sole');
    expect(parseDeclaredOwnerCount('2')).toBe(2);
    expect(parseDeclaredOwnerCount('sole')).toBe(1);
    expect(parseDeclaredOwnerCount('shared')).toBeNull();
  });

  it('flags count mismatch and conflicting counts', () => {
    const mismatch = collectOwnersStepOwnershipTypeConflicts({
      owners: [
        {
          apartment_number: '15',
          section_code: 'Б',
          block_code: '',
          ownership_type: '2',
          _row: 2,
        },
      ],
    });
    expect(mismatch.some((r) => r.reason === 'owner_count_mismatch')).toBe(true);
    expect(mismatch[0]?.meta?.value).toBe('2/1');

    const conflict = collectOwnersStepOwnershipTypeConflicts({
      owners: [
        {
          apartment_number: '15',
          section_code: 'Б',
          ownership_type: '2',
          _row: 2,
        },
        {
          apartment_number: '15',
          section_code: 'Б',
          ownership_type: '3',
          _row: 3,
        },
      ],
    });
    expect(conflict.some((r) => r.reason === 'owner_count_conflict')).toBe(true);
  });

  it('presents mismatch like «Подъезд Б, квартира №15: указано 2 владельца, заполнена 1 строка»', () => {
    const issues = buildBookPreviewIssues(
      collectOwnersStepOwnershipTypeConflicts({
        owners: [
          {
            apartment_number: '15',
            section_code: 'Б',
            block_code: '',
            ownership_type: '2',
            _row: 2,
          },
        ],
      }),
    );
    const msg = presentBookPreviewIssue(issues[0]!, (k, p) => translate('ru', k, p));
    expect(msg).toBe('Подъезд Б, квартира №15: указано 2 владельца, заполнена 1 строка');
  });

  it('accepts full lists of 1, 2 and 3 owners without count errors', () => {
    const ok = collectOwnersStepOwnershipTypeConflicts({
      owners: [
        { apartment_number: '1', section_code: 'A', ownership_type: '1', _row: 2 },
        { apartment_number: '2', section_code: 'A', ownership_type: '2', _row: 3 },
        { apartment_number: '2', section_code: 'A', ownership_type: '2', _row: 4 },
        { apartment_number: '3', section_code: 'A', ownership_type: '3', _row: 5 },
        { apartment_number: '3', section_code: 'A', ownership_type: '3', _row: 6 },
        { apartment_number: '3', section_code: 'A', ownership_type: '3', _row: 7 },
      ],
    });
    expect(ok).toEqual([]);
  });
});
