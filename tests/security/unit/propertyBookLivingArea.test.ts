import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { PROPERTY_BOOK_OBJECTS_SPEC } from '@/lib/importTemplates/specs/propertyBook';
import { parsePropertyBookWorkbookBuffer } from '@/lib/propertyBookAdmin';
import { buildPropertyBookIs2TemplateBuffer, splitPropertyBookObjectProps } from '@/lib/moduleCore/adapters/propertyBookOpening';
import { importReasonI18nKey } from '@/lib/firstRunUserMessage';

function objectHeaders(locale: 'ru' | 'bg' | 'en'): string[] {
  const buf = buildPropertyBookIs2TemplateBuffer(locale);
  const wb = XLSX.read(buf, { type: 'array' });
  const sheet = wb.Sheets[PROPERTY_BOOK_OBJECTS_SPEC.dataSheetName[locale]];
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

  it('downloads the wizard template with living area after area in every locale', () => {
    expect(objectHeaders('ru')).toEqual([
      'Апартамент',
      'Этаж',
      'Секция',
      'Блок',
      'Назначение',
      'Площадь, м²',
      'Жилая площадь, м²',
      'Идеальные части, %',
      'Тип собственности',
    ]);
    expect(objectHeaders('bg')).toEqual([
      'Апартамент',
      'Етаж',
      'Секция',
      'Блок',
      'Предназначение',
      'Площ, м²',
      'Жилищна площ, м²',
      'Идеални части, %',
      'Вид собственост',
    ]);
    expect(objectHeaders('en')).toEqual([
      'Apartment',
      'Floor',
      'Section',
      'Block',
      'Purpose',
      'Area, m²',
      'Living area, m²',
      'Ideal parts, %',
      'Ownership type',
    ]);
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
