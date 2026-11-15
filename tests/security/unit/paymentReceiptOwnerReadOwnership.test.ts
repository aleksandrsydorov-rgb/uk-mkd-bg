import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('payment receipt owner read by ownership', () => {
  it('grants current owns_property readers access without email-at-issue matching', () => {
    const sql = fs.readFileSync(
      path.join(
        process.cwd(),
        'supabase/migrations/20261130338800_payment_receipt_owner_read_by_ownership.sql',
      ),
      'utf8',
    );
    expect(sql).toMatch(/owns_property\(p_receipt\.property_id\)/);
    expect(sql).toMatch(/can_manage_payment_receipts\(\)/);
    // Former owners must not keep access via frozen email alone after transfer.
    expect(sql).not.toMatch(/owner_email_at_issue/);
  });
});
