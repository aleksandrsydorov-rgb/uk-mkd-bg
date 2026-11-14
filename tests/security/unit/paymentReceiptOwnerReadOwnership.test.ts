import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('payment receipt owner read by ownership', () => {
  it('lets current owns_property readers open receipts without matching owner_email_at_issue', () => {
    const sql = fs.readFileSync(
      path.join(
        process.cwd(),
        'supabase/migrations/20261130338800_payment_receipt_owner_read_by_ownership.sql',
      ),
      'utf8',
    );
    expect(sql).toMatch(/owns_property\(p_receipt\.property_id\)/);
    expect(sql).toMatch(/owner_email_at_issue/);
    expect(sql).toMatch(/can_manage_payment_receipts\(\)/);
    // Must not require email match AND ownership together.
    expect(sql).not.toMatch(
      /owns_property\(p_receipt\.property_id\)\s*\n\s*and p_receipt\.owner_email_at_issue/i,
    );
  });
});
