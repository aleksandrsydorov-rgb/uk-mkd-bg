import { describe, expect, it } from 'vitest';
import { csvCell, csvLine } from '@/lib/portalLegal/csv';

describe('legal acknowledgement CSV', () => {
  it('keeps formula-like owner input as text', () => {
    expect(csvCell('=HYPERLINK("http://evil")')).toBe(`"'=HYPERLINK(""http://evil"")"`);
    expect(csvCell('+cmd')).toBe("'+cmd");
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell('@sum')).toBe("'@sum");
    expect(csvCell('12')).toBe('12');
  });

  it('quotes separators without dropping the formula guard', () => {
    expect(csvLine(['=1+1', 'a,b'])).toBe(`'=1+1,"a,b"`);
  });
});
