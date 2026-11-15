import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('payment receipt access after ownership change', () => {
  const mig388 = fs.readFileSync(
    path.join(
      process.cwd(),
      'supabase/migrations/20261130338800_payment_receipt_owner_read_by_ownership.sql',
    ),
    'utf8',
  );
  const mig389 = fs.readFileSync(
    path.join(
      process.cwd(),
      'supabase/migrations/20261130338900_payment_receipt_access_emails_at_issue.sql',
    ),
    'utf8',
  );

  it('221 freezes access emails and does not grant by owns_property alone', () => {
    expect(mig389).toMatch(/access_emails_at_issue/);
    expect(mig389).toMatch(/payment_receipt_access_emails_for_property/);
    expect(mig389).toMatch(/can_manage_payment_receipts\(\)/);
    expect(mig389).toMatch(/owner_email_at_issue/);
    expect(mig389).toMatch(/property_access_invites/);

    const bodyStart = mig389.indexOf('create or replace function public.can_read_payment_receipt');
    const body = mig389.slice(bodyStart, mig389.indexOf('$fn$;', bodyStart) + 5);
    expect(body).not.toMatch(/owns_property\(/);
    expect(body).toMatch(/access_emails_at_issue/);
  });

  it('220 ownership migration remains in the tree before 221', () => {
    expect(mig388).toMatch(/owns_property\(p_receipt\.property_id\)/);
    expect(mig389).toMatch(/20261130338900|access_emails_at_issue/);
  });
});
