import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  PROPERTY_BOOK_OBJECTS_SPEC,
  PROPERTY_BOOK_OWNERS_SPEC,
} from '@/lib/importTemplates/specs/propertyBook';
import {
  buildPropertyBookObjectsTemplateBuffer,
  buildPropertyBookOwnersTemplateBuffer,
  parsePropertyBookWorkbookBuffer,
  propertyBookObjectsTemplateFileName,
  propertyBookOwnersTemplateFileName,
} from '@/lib/propertyBookAdmin';
import { buildPropertyBookIs2TemplateBuffer, splitPropertyBookObjectProps } from '@/lib/moduleCore/adapters/propertyBookOpening';
import { IMPORT_INSTRUCTION_SHEET } from '@/lib/importTemplates/workbook';
import { importReasonI18nKey } from '@/lib/firstRunUserMessage';

function objectHeaders(locale: 'ru' | 'bg' | 'en'): string[] {
  const buf = buildPropertyBookObjectsTemplateBuffer(locale);
  const wb = XLSX.read(buf, { type: 'array' });
  const sheet = wb.Sheets[PROPERTY_BOOK_OBJECTS_SPEC.dataSheetName[locale]];
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
  return (rows[0] ?? []).map((cell) => String(cell));
}

function ownersHeaders(locale: 'ru' | 'bg' | 'en'): string[] {
  const buf = buildPropertyBookOwnersTemplateBuffer(locale);
  const wb = XLSX.read(buf, { type: 'array' });
  const sheet = wb.Sheets[PROPERTY_BOOK_OWNERS_SPEC.dataSheetName[locale]];
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
  return (rows[0] ?? []).map((cell) => String(cell));
}

describe('property book living area', () => {
  it('places the optional living-area column immediately after apartment area', () => {
    const keys = PROPERTY_BOOK_OBJECTS_SPEC.columns.map((col) => col.key);
    expect(keys.indexOf('living_area_sqm')).toBe(keys.indexOf('area_sqm') + 1);
    const living = PROPERTY_BOOK_OBJECTS_SPEC.columns.find((col) => col.key === 'living_area_sqm');
    expect(living?.required).toBe(false);
    expect(living?.format).toBe('number');
    expect(living?.label).toEqual({
      ru: 'Жилая площадь, м²',
      bg: 'Жилищна площ, м²',
      en: 'Living area, m²',
    });
  });

  it('downloads the wizard apartments template without ownership type; ideal parts stay', () => {
    expect(objectHeaders('ru')).toEqual([
      'Апартамент',
      'Секция',
      'Блок',
      'Этаж',
      'Назначение',
      'Общая площадь, м²',
      'Жилая площадь, м²',
      'Идеальные части, %',
    ]);
    expect(objectHeaders('bg')).toEqual([
      'Апартамент',
      'Секция',
      'Блок',
      'Етаж',
      'Предназначение',
      'Обща площ, м²',
      'Жилищна площ, м²',
      'Идеални части, %',
    ]);
    expect(objectHeaders('en')).toEqual([
      'Apartment',
      'Section',
      'Block',
      'Floor',
      'Purpose',
      'Total area, m²',
      'Living area, m²',
      'Ideal parts, %',
    ]);
    expect(propertyBookObjectsTemplateFileName('ru')).toBe(
      'шаблон-книга-собственности-апартаменты.xlsx',
    );
  });

  it('downloads owners template with owner-count / who-owns after block and scenario examples', () => {
    expect(ownersHeaders('ru').slice(0, 6)).toEqual([
      'Апартамент',
      'Секция',
      'Блок',
      'Количество владельцев',
      'Кто владелец',
      'Доля владения, %',
    ]);
    expect(ownersHeaders('ru')).toEqual(
      expect.arrayContaining(['Основной телефон', 'Дополнительный телефон']),
    );
    expect(propertyBookOwnersTemplateFileName('en')).toBe('property-book-owners-template.xlsx');

    const buf = buildPropertyBookOwnersTemplateBuffer('ru');
    const wb = XLSX.read(buf, { type: 'array' });
    const instr = XLSX.utils
      .sheet_to_json<string[]>(wb.Sheets[IMPORT_INSTRUCTION_SHEET.ru], { header: 1 })
      .map((row) => row.map((c) => String(c ?? '')).join(' | '))
      .join('\n');
    expect(instr).toMatch(/Количество владельцев/);
    expect(instr).not.toMatch(/Один владелец|Несколько владельцев|sole_trader|\bsole\b|\bshared\b/);
    expect(instr).toMatch(/60/);
    expect(instr).toMatch(/40/);
    expect(instr).toMatch(/Кто владелец/);
    expect(PROPERTY_BOOK_OWNERS_SPEC.instructionScenarios?.length).toBe(2);

    // Combined IS2 template still omits ownership type from Objects sheet.
    const combined = XLSX.read(buildPropertyBookIs2TemplateBuffer('ru'), { type: 'array' });
    const combinedObj = XLSX.utils
      .sheet_to_json<string[]>(combined.Sheets[PROPERTY_BOOK_OBJECTS_SPEC.dataSheetName.ru], {
        header: 1,
      })[0]
      ?.map(String);
    expect(combinedObj).not.toContain('Тип собственности');
    expect(combinedObj).not.toContain('Количество владельцев');
  });

  it('accepts a fractional living area and rejects a non-positive value', () => {
    expect(
      splitPropertyBookObjectProps({
        apartment_number: '20',
        area_sqm: '85.40',
        living_area_sqm: '62.75',
      }).errors,
    ).toEqual([]);
    expect(
      splitPropertyBookObjectProps({
        apartment_number: '20',
        area_sqm: '85.40',
        living_area_sqm: '',
      }).errors,
    ).toEqual([]);
    expect(
      splitPropertyBookObjectProps({ apartment_number: '20', area_sqm: '85.40' }).errors,
    ).toEqual([]);
    expect(
      splitPropertyBookObjectProps({
        apartment_number: '20',
        area_sqm: '85.40',
        living_area_sqm: 'нет',
      }).errors,
    ).toContain('invalid:living_area_sqm');
    expect(importReasonI18nKey('invalid:living_area_sqm')).toBe('admin.bookImport_invalid_living_area');
    expect(importReasonI18nKey('living_area_sqm_invalid')).toBe('admin.bookImport_invalid_living_area');
  });

  it('keeps an absent living-area column as an empty value and reads a filled cell', () => {
    const legacy = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      legacy,
      XLSX.utils.aoa_to_sheet([
        ['Апартамент', 'Площадь, м²'],
        ['20', '85.40'],
      ]),
      'Объекты',
    );
    XLSX.utils.book_append_sheet(
      legacy,
      XLSX.utils.aoa_to_sheet([['Апартамент'], ['20']]),
      'Собственники',
    );
    const legacyRow = parsePropertyBookWorkbookBuffer(XLSX.write(legacy, { type: 'array' }) as ArrayBuffer)
      .objects[0];
    expect(legacyRow.area_sqm).toBe('85.40');
    expect(legacyRow.living_area_sqm).toBe('');
    expect(legacyRow._row).toBe('2');

    const current = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      current,
      XLSX.utils.aoa_to_sheet([
        ['Апартамент', 'Площадь, м²', 'Жилая площадь, м²'],
        ['20', '85.40', '62.75'],
        ['21', '90', ''],
      ]),
      'Объекты',
    );
    XLSX.utils.book_append_sheet(
      current,
      XLSX.utils.aoa_to_sheet([['Апартамент'], ['20'], ['21']]),
      'Собственники',
    );
    const rows = parsePropertyBookWorkbookBuffer(XLSX.write(current, { type: 'array' }) as ArrayBuffer)
      .objects;
    expect(rows[0]).toMatchObject({ area_sqm: '85.40', living_area_sqm: '62.75', _row: '2' });
    expect(rows[1]).toMatchObject({ area_sqm: '90', living_area_sqm: '', _row: '3' });
  });
});
