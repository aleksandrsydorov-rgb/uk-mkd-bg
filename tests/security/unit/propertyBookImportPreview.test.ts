import { describe, expect, it } from 'vitest';
import {
  applyOwnershipTypesToObjects,
  buildBookPreviewIssues,
  buildBookSectionBreakdown,
  clarifyGroupSummary,
  collectOwnersStepOwnershipTypeConflicts,
  formatExcelRowRanges,
  formatSectionCountsLine,
  groupClarifyIssuesByReason,
} from '@/lib/propertyBookImportPreview';
import { presentBookPreviewIssue } from '@/lib/firstRunUserMessage';
import { translate } from '@/i18n/translate';
import type { FirstRunErrorRow } from '@/lib/firstRun';

const tRu = (key: string, params?: Record<string, string | number>) =>
  translate('ru', key, params);
const tEn = (key: string, params?: Record<string, string | number>) =>
  translate('en', key, params);
const tBg = (key: string, params?: Record<string, string | number>) =>
  translate('bg', key, params);

describe('propertyBookImportPreview', () => {
  it('formats contiguous excel row ranges', () => {
    expect(formatExcelRowRanges([2, 3, 4, 5, 80])).toBe('2–5, 80');
    expect(formatExcelRowRanges([2, 80])).toBe('2, 80');
  });

  it('breaks objects down by section A/Б/В = 36+43+36', () => {
    const objects = [];
    for (let i = 1; i <= 36; i += 1) {
      objects.push({ apartment_number: String(i), section_code: 'A', ownership_type: i === 1 ? '' : 'sole', _row: i + 1 });
    }
    for (let i = 1; i <= 43; i += 1) {
      objects.push({ apartment_number: String(i), section_code: 'Б', ownership_type: 'sole', _row: 40 + i });
    }
    for (let i = 1; i <= 36; i += 1) {
      objects.push({ apartment_number: String(i), section_code: 'В', ownership_type: 'sole', _row: 90 + i });
    }
    const br = buildBookSectionBreakdown(objects);
    expect(br.total).toBe(115);
    expect(br.sections.map((s) => [s.sectionCode, s.apartments.length])).toEqual([
      ['A', 36],
      ['Б', 43],
      ['В', 36],
    ]);
    expect(br.sections[0]!.apartments[0]!.ownershipTypeMissing).toBe(true);
  });

  it('groups ambiguous owner rows and presents RU/BG/EN without section_code tokens', () => {
    const objects = [
      { apartment_number: '8', section_code: 'A', ownership_type: '', _row: '10' },
      { apartment_number: '8', section_code: 'Б', ownership_type: 'sole', _row: '50' },
      { apartment_number: '8', section_code: 'В', ownership_type: 'sole', _row: '90' },
    ];
    const owners = [];
    for (let row = 2; row <= 80; row += 1) {
      owners.push({
        apartment_number: '8',
        section_code: '',
        entity_kind: 'natural_person',
        _row: String(row),
      });
    }
    const rows: FirstRunErrorRow[] = [
      {
        sheet: 'owners',
        row: '2',
        field: 'section_code',
        reason: 'section_code_required_for_disambiguation',
        apartment: '8',
        severity: 'error',
      },
      {
        sheet: 'validation',
        row: '',
        field: 'ownership_type',
        reason: 'ownership_type_required',
        apartment: '8',
        severity: 'warning',
        meta: { sectionCode: 'A' },
      },
    ];
    const issues = buildBookPreviewIssues(rows, { objects, owners });
    const blocking = issues.filter((i) => i.severity === 'error');
    expect(blocking).toHaveLength(1);
    expect(blocking[0]!.rows[0]).toBe(2);
    expect(blocking[0]!.rows[blocking[0]!.rows.length - 1]).toBe(80);
    expect(blocking[0]!.candidateSections).toEqual(['A', 'Б', 'В']);

    const ru = presentBookPreviewIssue(blocking[0]!, tRu);
    const en = presentBookPreviewIssue(blocking[0]!, tEn);
    const bg = presentBookPreviewIssue(blocking[0]!, tBg);
    expect(ru).toContain('Собственники');
    expect(ru).toMatch(/строк[аи] 2–80/);
    expect(ru).toContain('№8');
    expect(ru).toContain('A, Б, В');
    expect(ru).toContain('Секция');
    expect(ru).not.toMatch(/section_code|section code/i);
    expect(en).toContain('Owners');
    expect(en).toMatch(/rows? 2–80/);
    expect(en).not.toMatch(/section_code/);
    expect(bg).toContain('Собственици');
    expect(bg).not.toMatch(/section_code/);

    const clarify = issues.filter((i) => i.severity === 'warning');
    expect(clarify.length).toBeGreaterThan(0);
    const ownMsg = presentBookPreviewIssue(clarify[0]!, tRu);
    expect(ownMsg).toContain('Подъезд A');
    expect(ownMsg).toMatch(/количество владельцев|Тип собственности/i);
    expect(ownMsg).toContain('Собственники');
  });

  it('formats compact section counts without per-apt ownership clutter', () => {
    const objects = [];
    for (let i = 1; i <= 36; i += 1) objects.push({ apartment_number: String(i), section_code: 'A', _row: i + 1 });
    for (let i = 1; i <= 43; i += 1) objects.push({ apartment_number: String(i), section_code: 'Б', _row: 40 + i });
    for (let i = 1; i <= 36; i += 1) objects.push({ apartment_number: String(i), section_code: 'В', _row: 90 + i });
    const br = buildBookSectionBreakdown(objects);
    const line = formatSectionCountsLine(tRu, br);
    expect(line).toContain('A — 36');
    expect(line).toContain('Б — 43');
    expect(line).toContain('В — 36');
    expect(line).toContain('всего 115');
    expect(line).not.toMatch(/тип собств/i);

    const groups = groupClarifyIssuesByReason([
      {
        severity: 'warning',
        reason: 'ownership_type_required',
        sheet: 'owners',
        field: 'ownership_type',
        apartment: '1',
        sectionCode: 'A',
        blockCode: '',
        rows: [2],
        candidateSections: [],
        value: '',
      },
      {
        severity: 'warning',
        reason: 'ownership_type_required',
        sheet: 'owners',
        field: 'ownership_type',
        apartment: '2',
        sectionCode: 'A',
        blockCode: '',
        rows: [3],
        candidateSections: [],
        value: '',
      },
    ]);
    expect(groups).toHaveLength(1);
    expect(clarifyGroupSummary(groups[0]!, tRu)).toBe('Тип собственности не указан у 2 квартир');
  });

  it('rewrites orphan object_row_missing to ambiguous section when file has multiple sections', () => {
    const objects = [
      { apartment_number: '8', section_code: 'A', _row: '2' },
      { apartment_number: '8', section_code: 'Б', _row: '3' },
      { apartment_number: '8', section_code: 'В', _row: '4' },
    ];
    const owners = [{ apartment_number: '8', section_code: '', _row: '2' }];
    const issues = buildBookPreviewIssues(
      [
        {
          sheet: 'owners',
          row: '',
          field: 'apartment_number',
          reason: 'object_row_missing',
          apartment: '8',
          severity: 'error',
        },
      ],
      { objects, owners },
    );
    expect(issues[0]!.reason).toBe('section_code_required_for_disambiguation');
    expect(issues[0]!.candidateSections).toEqual(['A', 'Б', 'В']);
  });

  it('flags conflicting ownership_type rows on owners with all Excel line numbers', () => {
    const conflicts = collectOwnersStepOwnershipTypeConflicts({
      owners: [
        { apartment_number: '3', section_code: 'A', ownership_type: 'sole', _row: '2' },
        { apartment_number: '3', section_code: 'A', ownership_type: 'shared', _row: '5' },
      ],
    });
    const typeConflict = conflicts.find((c) => c.reason === 'ownership_type_conflict');
    expect(typeConflict).toBeTruthy();
    expect(typeConflict!.meta?.sourceRows).toEqual([2, 5]);
    // sole declares count 1 while two rows exist → also owner_count_mismatch.
    expect(conflicts.some((c) => c.reason === 'owner_count_mismatch')).toBe(true);
    expect(presentBookPreviewIssue(
      {
        severity: 'error',
        reason: 'ownership_type_conflict',
        sheet: 'owners',
        field: 'ownership_type',
        apartment: '3',
        sectionCode: 'A',
        blockCode: '',
        rows: [2, 5],
        candidateSections: [],
        value: 'shared/sole',
      },
      tRu,
    )).toContain('2, 5');
    expect(presentBookPreviewIssue(
      {
        severity: 'error',
        reason: 'ownership_type_conflict',
        sheet: 'owners',
        field: 'ownership_type',
        apartment: '3',
        sectionCode: 'A',
        blockCode: '',
        rows: [2, 5],
        candidateSections: [],
        value: 'shared/sole',
      },
      tBg,
    )).toMatch(/разминаване|различни/);
    expect(presentBookPreviewIssue(
      {
        severity: 'error',
        reason: 'ownership_type_conflict',
        sheet: 'owners',
        field: 'ownership_type',
        apartment: '3',
        sectionCode: 'A',
        blockCode: '',
        rows: [2, 5],
        candidateSections: [],
        value: 'shared/sole',
      },
      tEn,
    )).toMatch(/conflicting|mismatch/i);
  });

  it('flags Objects vs Owners sheet ownership_type conflicts for combined legacy workbooks', () => {
    const conflicts = collectOwnersStepOwnershipTypeConflicts({
      objectsFromFile: [
        { apartment_number: '1', section_code: 'A', ownership_type: 'shared', _row: '2' },
      ],
      owners: [
        { apartment_number: '1', section_code: 'A', ownership_type: 'sole', _row: '2' },
      ],
    });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.reason).toBe('ownership_type_sheet_conflict');
    expect(conflicts[0]!.meta?.objectsValue).toBe('shared');
    expect(conflicts[0]!.meta?.ownersValue).toBe('sole');
  });

  it('applies owners-sheet type, then Objects legacy type, never invents blank', () => {
    const stubs = [
      { apartment_number: '1', section_code: 'A', block_code: '', ownership_type: '' },
      { apartment_number: '2', section_code: 'A', block_code: '', ownership_type: 'sole' },
      { apartment_number: '3', section_code: 'A', block_code: '', ownership_type: '' },
      { apartment_number: '4', section_code: 'A', block_code: '', ownership_type: 'shared' },
    ];
    const out = applyOwnershipTypesToObjects(stubs, {
      owners: [
        { apartment_number: '1', section_code: 'A', ownership_type: 'sole' },
        { apartment_number: '2', section_code: 'A', ownership_type: '' },
        { apartment_number: '3', section_code: 'A', ownership_type: '' },
      ],
      objectsFromFile: [
        { apartment_number: '2', section_code: 'A', ownership_type: 'shared' },
        { apartment_number: '3', section_code: 'A', ownership_type: 'sole' },
        { apartment_number: '4', section_code: 'A', ownership_type: 'sole' },
      ],
    });
    expect(out[0]!.ownership_type).toBe('sole'); // from owners
    expect(out[1]!.ownership_type).toBe('sole'); // keep stub; owners blank, Objects differs → keep DB
    expect(out[2]!.ownership_type).toBe('sole'); // Objects legacy fills empty stub
    expect(out[3]!.ownership_type).toBe('shared'); // keep stub; no owners type
  });
});
