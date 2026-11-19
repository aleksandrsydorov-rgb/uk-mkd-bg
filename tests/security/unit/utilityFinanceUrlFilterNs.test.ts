import { describe, expect, it } from 'vitest';
import { readUtilityFiltersFromSearch } from '@/components/admin/AdminUtilityFinanceWorkplace';

describe('utility finance URL filter namespaces', () => {
  it('reads uf and ff namespaces independently', () => {
    const search =
      '?section=%D0%B2%D0%BE%D0%B4%D0%B0&tab=payments&q=aptA&ufSection=A&ufStatus=debt&ffQ=aptB&ffSection=B&ffStatus=credit';
    const uf = readUtilityFiltersFromSearch(search, 'uf');
    const ff = readUtilityFiltersFromSearch(search, 'ff');
    expect(uf.query).toBe('aptA');
    expect(uf.section).toBe('A');
    expect(uf.status).toBe('debt');
    expect(ff.query).toBe('aptB');
    expect(ff.section).toBe('B');
    expect(ff.status).toBe('credit');
  });

  it('does not leak uf filters into ff namespace', () => {
    const search = '?q=only-uf&ufSection=A&ufFrom=2026-01-01';
    const ff = readUtilityFiltersFromSearch(search, 'ff');
    expect(ff.query).toBe('');
    expect(ff.section).toBe('');
    expect(ff.periodFrom).toBe('');
  });
});
