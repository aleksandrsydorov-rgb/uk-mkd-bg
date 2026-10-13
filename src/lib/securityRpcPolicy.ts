/**
 * Pure authorization mirrors for SECURITY DEFINER RPC / RLS policies.
 * Keep in sync with:
 * - supabase/migrations/20261015120000_phase_e1_security_hardening.sql
 * - supabase/migrations/20261016120000_phase_e2_1_finance_security_hardening.sql
 */

export type RpcCallerRole = 'anon' | 'authenticated' | 'service_role';

export type PropertyBookActiveOwnersContext = {
  role: RpcCallerRole;
  isBookAdmin: boolean;
  ownsProperty: boolean;
  /** Guests never satisfy ownsProperty; kept explicit for regression clarity. */
  isGuestOnly: boolean;
};

/** SEC-P1-1 mirror: who may call property_book_active_owners. */
export function canCallPropertyBookActiveOwners(
  ctx: PropertyBookActiveOwnersContext
): boolean {
  if (ctx.role === 'service_role') return true;
  if (ctx.role === 'anon') return false;
  if (ctx.isBookAdmin) return true;
  if (ctx.isGuestOnly) return false;
  return ctx.ownsProperty === true;
}

export type EmailEnqueueModuleKey =
  | 'pb1_invite'
  | 'user_activation'
  | 'pkg_xfer'
  | 'meeting'
  | 'email_test'
  | 'system';

export type EmailEnqueueAuthzContext = {
  role: RpcCallerRole;
  isBookAdmin: boolean;
  /** For pkg_xfer: caller owns the property resolved from payload/transfer. */
  ownsPayloadProperty: boolean;
  moduleKey: EmailEnqueueModuleKey | string;
  templateKey: string;
};

export function emailTemplateMatchesModule(
  moduleKey: string,
  templateKey: string
): boolean {
  const tpl = templateKey.trim().toLowerCase();
  if (!tpl) return false;
  switch (moduleKey) {
    case 'pb1_invite':
      return tpl.startsWith('pb1_');
    case 'user_activation':
      return tpl.startsWith('ua_');
    case 'pkg_xfer':
      return tpl.startsWith('ownership_change_');
    case 'meeting':
      return tpl.startsWith('meeting_');
    case 'email_test':
      return tpl.startsWith('email_test');
    case 'system':
      return tpl.startsWith('system_');
    default:
      return false;
  }
}

/** SEC-P1-2 mirror: email_core_assert_can_enqueue decision. */
export function canEnqueueEmail(ctx: EmailEnqueueAuthzContext): boolean {
  if (ctx.role === 'service_role') return true;
  if (ctx.role === 'anon') return false;
  if (!emailTemplateMatchesModule(ctx.moduleKey, ctx.templateKey)) return false;

  if (ctx.moduleKey === 'system') return false;

  if (
    ctx.moduleKey === 'pb1_invite' ||
    ctx.moduleKey === 'user_activation' ||
    ctx.moduleKey === 'email_test' ||
    ctx.moduleKey === 'meeting'
  ) {
    return ctx.isBookAdmin === true;
  }

  if (ctx.moduleKey === 'pkg_xfer') {
    if (ctx.isBookAdmin) return true;
    return ctx.ownsPayloadProperty === true;
  }

  return false;
}

export type OverdueDebtAuthzContext = {
  role: RpcCallerRole;
  isBookAdmin: boolean;
  isAccountant: boolean;
  ownsProperty: boolean;
  isGuestOnly: boolean;
  /** Former Book owner / deregistered → ownsProperty false. */
  isFormerOwner: boolean;
};

/** FIN-P0-1 mirror: ownership_change_overdue_debt. */
export function canCallOwnershipChangeOverdueDebt(
  ctx: OverdueDebtAuthzContext
): boolean {
  if (ctx.role === 'service_role') return true;
  if (ctx.role === 'anon') return false;
  if (ctx.isBookAdmin || ctx.isAccountant) return true;
  if (ctx.isGuestOnly || ctx.isFormerOwner) return false;
  return ctx.ownsProperty === true;
}

export type SupportFeeLedgerSelectContext = {
  role: RpcCallerRole;
  isBookAdmin: boolean;
  isAccountant: boolean;
  ownsProperty: boolean;
  isGuestOnly: boolean;
};

/** FIN-P1-2 mirror: support_fee_ledger SELECT policy. */
export function canSelectSupportFeeLedger(
  ctx: SupportFeeLedgerSelectContext
): boolean {
  if (ctx.role === 'anon') return false;
  if (ctx.role === 'service_role') return true;
  if (ctx.isBookAdmin || ctx.isAccountant) return true;
  if (ctx.isGuestOnly) return false;
  return ctx.ownsProperty === true;
}

/** FIN-P1-1: guests never receive real debt/overpayment from list_my_guest_properties. */
export function scrubGuestPropertyFinanceFields<
  T extends { debt?: number | null; overpayment?: number | null },
>(row: T): T {
  return { ...row, debt: 0, overpayment: 0 };
}
