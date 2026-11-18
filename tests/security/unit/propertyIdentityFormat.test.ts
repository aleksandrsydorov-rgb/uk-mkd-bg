import { describe, expect, it } from 'vitest';
import {
  formatPropertyIdentity,
  formatPropertyIdentityCompact,
  highlightPropertyMatch,
  rankPropertySearch,
} from '@/lib/propertyIdentity';

const t = (key: string, vars?: Record<string, string | number>) => {
  const map: Record<string, string> = {
    'property.identityApt': `Апартамент №${vars?.n ?? ''}`,
    'property.identityAptUnknown': 'Апартамент',
    'property.identitySection': `Секция ${vars?.section ?? ''}`,
    'property.identityBlock': `Блок ${vars?.block ?? ''}`,
    'property.identityBlockShort': `блок ${vars?.block ?? ''}`,
  };
  return map[key] ?? key;
};

describe('formatPropertyIdentity', () => {
  it('renders full identity with section and block', () => {
    expect(
      formatPropertyIdentity(
        { apartment_number: '32', section_code: 'Б', block_code: '3' },
        t
      )
    ).toBe('Апартамент №32 · Секция Б · Блок 3');
  });

  it('omits empty section/block without placeholders', () => {
    expect(formatPropertyIdentity({ apartment_number: '32', section_code: '  ', block_code: null }, t)).toBe(
      'Апартамент №32'
    );
    expect(formatPropertyIdentity({ apartment_number: '32', section_code: 'A', block_code: '' }, t)).toBe(
      'Апартамент №32 · Секция A'
    );
  });

  it('compact form skips empty parts', () => {
    expect(formatPropertyIdentityCompact({ apartment_number: 32, section_code: 'Б', block_code: '3' }, t)).toBe(
      '№32 · Б · блок 3'
    );
    expect(formatPropertyIdentityCompact({ apartment_number: '8', section_code: null, block_code: null }, t)).toBe(
      '№8'
    );
  });
});

describe('rankPropertySearch', () => {
  const props = [
    { id: 1, apartment_number: '32', section_code: 'A', block_code: '1', owner_name: 'Alpha' },
    { id: 2, apartment_number: '32', section_code: 'Б', block_code: '3', owner_name: 'Beta' },
    { id: 3, apartment_number: '32', section_code: 'В', block_code: '2', owner_name: 'Gamma' },
    { id: 4, apartment_number: '320', section_code: 'A', block_code: null, owner_name: 'Delta' },
    { id: 5, apartment_number: '12', section_code: 'Б', block_code: '3', owner_name: 'Epsilon' },
  ];

  it('ranks exact apartment number before partial', () => {
    const hits = rankPropertySearch(props, '32');
    expect(hits.map((h) => h.property.id)).toEqual([1, 2, 3, 4]);
    expect(hits[0]?.matchKind).toBe('exact_number');
    expect(hits[3]?.matchKind).toBe('prefix_number');
  });

  it('matches number + section + block query', () => {
    const hits = rankPropertySearch(props, '32 б 3');
    expect(hits.some((h) => h.property.id === 2)).toBe(true);
    expect(hits[0]?.property.id).toBe(2);
  });

  it('keeps latin/cyrillic section codes distinct', () => {
    const mixed = [
      { id: 10, apartment_number: '5', section_code: 'A', block_code: null },
      { id: 11, apartment_number: '5', section_code: 'А', block_code: null },
    ];
    const hitsA = rankPropertySearch(mixed, 'a');
    expect(hitsA.map((h) => h.property.id)).toEqual([10]);
    const hitsCyr = rankPropertySearch(mixed, 'а');
    expect(hitsCyr.map((h) => h.property.id)).toEqual([11]);
  });
});

describe('highlightPropertyMatch', () => {
  it('highlights matched fragment without rewriting case of source', () => {
    const parts = highlightPropertyMatch('Апартамент №32 · Секция Б', '32');
    expect(parts).toEqual([
      { text: 'Апартамент №', match: false },
      { text: '32', match: true },
      { text: ' · Секция Б', match: false },
    ]);
  });
});
