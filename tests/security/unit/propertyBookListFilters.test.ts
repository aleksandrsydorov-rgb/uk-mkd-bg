import { describe, expect, it } from 'vitest';
import {
  EMPTY_PROPERTY_BOOK_LIST_FILTERS,
  collectPropertyBookFilterOptions,
  filterPropertyBookListRows,
  propertyBookListFiltersActive,
  type PropertyBookListRow,
} from '@/lib/propertyBookAdmin';

function row(partial: Partial<PropertyBookListRow> & Pick<PropertyBookListRow, 'property_id' | 'apartment_number'>): PropertyBookListRow {
  return {
    floor: null,
    section_code: null,
    block_code: null,
    purpose: null,
    area_sqm: null,
    ideal_parts_percent: null,
    ownership_type: null,
    owner_count: 0,
    book_complete: true,
    validation: null,
    ...partial,
  };
}

const sample = [
  row({ property_id: 1, apartment_number: '1', block_code: '1', section_code: 'A', floor: 2, book_complete: true }),
  row({ property_id: 2, apartment_number: '10', block_code: '1', section_code: 'B', floor: 3, book_complete: false }),
  row({ property_id: 3, apartment_number: '2', block_code: '2', section_code: 'A', floor: 2, book_complete: false }),
];

describe('property book list filters', () => {
  it('combines completeness, block, section, floor and apartment query', () => {
    const filtered = filterPropertyBookListRows(sample, {
      completeness: 'incomplete',
      block: '1',
      section: 'B',
      floor: '3',
      apartmentQuery: '1',
    });
    expect(filtered.map((r) => r.apartment_number)).toEqual(['10']);
  });

  it('resets to inactive empty filters', () => {
    expect(propertyBookListFiltersActive(EMPTY_PROPERTY_BOOK_LIST_FILTERS)).toBe(false);
    expect(
      propertyBookListFiltersActive({
        ...EMPTY_PROPERTY_BOOK_LIST_FILTERS,
        floor: '2',
      }),
    ).toBe(true);
  });

  it('collects distinct filter options', () => {
    expect(collectPropertyBookFilterOptions(sample)).toEqual({
      blocks: ['1', '2'],
      sections: ['A', 'B'],
      floors: ['2', '3'],
    });
  });
});
