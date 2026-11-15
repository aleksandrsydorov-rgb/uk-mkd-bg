import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { inflateRawSync } from 'node:zlib';
import {
  buildPropertyBookOwnersTemplateBuffer,
  coerceBookEntityKindField,
  normalizeBookEntityKindInput,
  parsePropertyBookWorkbookBuffer,
  propertyBookOwnersTemplateFileName,
} from '@/lib/propertyBookAdmin';
import { PROPERTY_BOOK_OWNERS_SPEC } from '@/lib/importTemplates/specs/propertyBook';
import { splitPropertyBookOwnerRow } from '@/lib/moduleCore/adapters/propertyBookOpening';
import { presentBookPreviewIssue } from '@/lib/firstRunUserMessage';
import { translate } from '@/i18n/translate';

function readSheet1Xml(buf: ArrayBuffer): string {
  const data = new Uint8Array(buf);
  let i = 0;
  while (i + 30 <= data.length) {
    if (data[i] === 0x50 && data[i + 1] === 0x4b && data[i + 2] === 0x03 && data[i + 3] === 0x04) {
      const comp = data[i + 8]! | (data[i + 9]! << 8);
      const compSize =
        data[i + 18]! | (data[i + 19]! << 8) | (data[i + 20]! << 16) | (data[i + 21]! << 24);
      const nameLen = data[i + 26]! | (data[i + 27]! << 8);
      const extraLen = data[i + 28]! | (data[i + 29]! << 8);
      const name = Buffer.from(data.subarray(i + 30, i + 30 + nameLen)).toString('utf8');
      const start = i + 30 + nameLen + extraLen;
      const payload = data.subarray(start, start + compSize);
      const text =
        comp === 0
          ? Buffer.from(payload).toString('utf8')
          : inflateRawSync(Buffer.from(payload)).toString('utf8');
      if (/sheet1\.xml$/i.test(name)) return text;
      i = start + compSize;
      continue;
    }
    if (data[i] === 0x50 && data[i + 1] === 0x4b && data[i + 2] === 0x01 && data[i + 3] === 0x02) break;
    i += 1;
  }
  return '';
}

function zipHasDataValidation(buf: ArrayBuffer): boolean {
  const text = readSheet1Xml(buf);
  return (
    /dataValidation/i.test(text) &&
    /(1,0|0,1)/.test(text) &&
    (/sole,shared/.test(text) || /Один владелец|One owner|Един собственик/.test(text))
  );
}

function ownersBook(rows: (string | number)[][]): ArrayBuffer {
  const headers = PROPERTY_BOOK_OWNERS_SPEC.columns
    .filter((c) => c.includeInTemplate !== false)
    .map((c) => c.label.ru);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, ...rows]), 'Собственники');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

describe('book entity_kind 0/1', () => {
  it('normalizes Excel numbers and text 0/1 plus legacy labels', () => {
    expect(normalizeBookEntityKindInput(0)).toBe('legal_entity');
    expect(normalizeBookEntityKindInput(1)).toBe('natural_person');
    expect(normalizeBookEntityKindInput('0')).toBe('legal_entity');
    expect(normalizeBookEntityKindInput('1')).toBe('natural_person');
    expect(normalizeBookEntityKindInput('')).toBe('');
    expect(normalizeBookEntityKindInput('natural_person')).toBe('natural_person');
    expect(normalizeBookEntityKindInput('legal_entity')).toBe('legal_entity');
    expect(normalizeBookEntityKindInput('sole_trader')).toBe('sole_trader');
    expect(normalizeBookEntityKindInput('2')).toBeNull();
    expect(coerceBookEntityKindField(0)).toBe('legal_entity');
    expect(coerceBookEntityKindField('')).toBe('');
    expect(coerceBookEntityKindField('xyz')).toBe('xyz');
  });

  it('does not treat 0 as an empty owner-type cell', () => {
    const row = {
      apartment_number: '12',
      entity_kind: '0',
      entity_name: 'Строй ООД',
      eik_bulstat: '123456789',
      ownership_share_percent: '100',
      email: 'a@example.com',
    };
    const split = splitPropertyBookOwnerRow(row);
    expect(split.errors).not.toContain('invalid:entity_kind');
    expect(split.warnings).not.toContain('required:entity_kind');
    expect(row.entity_kind).toBe('legal_entity');
  });

  it('parses numeric and text 0/1 from an owners workbook', () => {
    const buf = ownersBook([
      ['12', 'A', '', 'sole', 0, '100', '', 'a@example.com', '', '', '', '', '', 'ООО Тест', '111'],
      ['13', 'A', '', 'sole', '1', '100', '', 'b@example.com', '', '', 'Иван', '', 'Иванов', '', ''],
      ['14', 'A', '', 'sole', 'natural_person', '100', '', 'c@example.com', '', '', 'Пётр', '', 'Петров', '', ''],
      ['15', 'A', '', 'sole', '', '100', '', 'd@example.com', '', '', 'Аня', '', 'Анова', '', ''],
      ['16', 'A', '', 'sole', 'legal_entity', '100', '', 'e@example.com', '', '', '', '', '', 'Legacy ЮЛ', '222'],
    ]);
    const parsed = parsePropertyBookWorkbookBuffer(buf, 'owners');
    const byApt = Object.fromEntries(parsed.owners.map((o) => [o.apartment_number, o.entity_kind]));
    expect(byApt['12']).toBe('legal_entity');
    expect(byApt['13']).toBe('natural_person');
    expect(byApt['14']).toBe('natural_person');
    expect(byApt['15']).toBe('');
    expect(byApt['16']).toBe('legal_entity');
  });

  it('RU owners template filename, 1000-row dropdowns, freeze, instruction', () => {
    expect(propertyBookOwnersTemplateFileName('ru')).toBe(
      'шаблон-книга-собственности-собственники.xlsx',
    );
    expect(PROPERTY_BOOK_OWNERS_SPEC.templateInputRows).toBe(1000);
    const buf = buildPropertyBookOwnersTemplateBuffer('ru');
    expect(zipHasDataValidation(buf)).toBe(true);
    const sheetXml = readSheet1Xml(buf);
    expect(sheetXml).toMatch(/sqref="D2:D1001"/);
    expect(sheetXml).toMatch(/sqref="E2:E1001"/);
    expect(sheetXml).toMatch(/state="frozen"/);
    expect(sheetXml).toMatch(/errorStyle="warning"/);
    // OOXML: dataValidations must precede ignoredErrors (Excel repairs otherwise).
    const dvAt = sheetXml.search(/<dataValidations\b/i);
    const ignoredAt = sheetXml.search(/<ignoredErrors\b/i);
    expect(dvAt).toBeGreaterThan(0);
    if (ignoredAt >= 0) expect(dvAt).toBeLessThan(ignoredAt);
    const wb = XLSX.read(buf, { type: 'array' });
    const data = wb.Sheets['Собственники'];
    expect(String(data['!ref'])).toMatch(/A1:O1001/i);
    const dataRows = XLSX.utils.sheet_to_json<string[]>(data, { header: 1, raw: false });
    const filled = dataRows.slice(1).filter((r) => (r ?? []).some((c) => String(c ?? '').trim()));
    expect(filled.length).toBe(0);
    const instr = XLSX.utils
      .sheet_to_json<string[]>(wb.Sheets['Инструкция'], { header: 1 })
      .flat()
      .map(String)
      .join('\n');
    expect(instr).toMatch(/Кто владелец/);
    expect(instr).toMatch(/Сколько владельцев у квартиры/);
    expect(instr).toMatch(/Один владелец/);
    expect(instr).toMatch(/Несколько владельцев/);
    expect(instr).toMatch(/1 — физлицо|1 — физическое лицо/);
    expect(instr).toMatch(/0 — юрлицо|0 — юридическое лицо/);
    expect(instr).toMatch(/sole_trader/);
    expect(instr).toMatch(/60/);
    expect(instr).toMatch(/40/);
    expect(sheetXml).toMatch(/Один владелец,Несколько владельцев/);
  });

  it('presents invalid entity_kind with sheet/row/column/allowed values', () => {
    const msg = presentBookPreviewIssue(
      {
        severity: 'error',
        reason: 'invalid:entity_kind',
        sheet: 'owners',
        field: 'entity_kind',
        apartment: '12',
        sectionCode: 'A',
        blockCode: '',
        rows: [3],
        candidateSections: [],
        value: '2',
      },
      (k, p) => translate('ru', k, p),
    );
    expect(msg).toMatch(/Собственники|owners/i);
    expect(msg).toMatch(/3/);
    expect(msg).toMatch(/Тип собственника|Тип лица|Owner type|entity_kind/i);
    expect(msg).toMatch(/1 \(физическое лицо\)/);
    expect(msg).toMatch(/0 \(юридическое лицо\)/);
    expect(msg).toContain('2');
  });
});
