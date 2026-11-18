import { normalizePriority } from '@/lib/requests';
import { listingStatus } from '@/lib/ownership';
import type { Translate } from '@/i18n/translate';

export function labelListing(raw: string | null | undefined, t: Translate) {
  return listingStatus(raw) === 'на продаже' ? t('status.listingSale') : t('status.listingOwned');
}

export function labelOccupancy(raw: string | null | undefined, t: Translate) {
  if (raw === 'standby') return t('status.occStandby');
  if (raw === 'rented') return t('status.occRented');
  return t('status.occOwner');
}

export function labelOccupantKind(raw: string | null | undefined, t: Translate) {
  if (raw === 'tenant') return t('registry.occupantTenant');
  if (raw === 'user') return t('book.userOfProperty');
  return t('registry.occupantOwner');
}

export function labelRegistryRelation(raw: string | null | undefined, t: Translate) {
  if (raw === 'user_of_property') return t('book.userOfProperty');
  if (raw === 'household_member') return t('book.householdMember');
  if (raw === 'occupant') return t('book.occupant');
  if (raw === 'owner') return t('book.owner');
  return t('book.owner');
}

export function labelIdealPartsSource(raw: string | null | undefined, t: Translate) {
  if (raw === 'document') return t('book.sourceDocument');
  if (raw === 'calculated') return t('book.sourceCalculated');
  if (raw === 'general_meeting_approved') return t('book.sourceMeeting');
  if (raw === 'unknown') return t('book.sourceUnknown');
  return null;
}

export function labelRequestStatus(raw: string | null | undefined, t: Translate) {
  if (raw === 'в работе') return t('status.reqWork');
  if (raw === 'выполнена') return t('status.reqDone');
  if (raw === 'отклонена') return t('status.reqReject');
  return t('status.reqNew');
}

export function labelPriority(raw: string | null | undefined, t: Translate) {
  const p = normalizePriority(raw);
  if (p === 'высокий') return t('status.prioHigh');
  if (p === 'низкий') return t('status.prioLow');
  return t('status.prioMid');
}

function warnUnknownLabel(kind: string, value: string) {
  if (process.env.NODE_ENV !== 'production') {
    console.warn(`[label] unknown ${kind}:`, value);
  }
}

export function labelStaffRole(raw: string | null | undefined, t: Translate) {
  const r = (raw ?? '').trim().toLowerCase();
  if (r === 'администрация') return t('admin.roleAdmin');
  if (r === 'бухгалтер') return t('admin.roleAccountant');
  if (r === 'инженер') return t('admin.roleEngineer');
  if (r === 'уборщик') return t('admin.roleCleaner');
  if (r === 'охрана') return t('admin.roleGuard');
  if (!r) return '—';
  warnUnknownLabel('staff role', r);
  return t('admin.roleUnknown');
}

export function labelLedgerKind(kind: string | null | undefined, t: Translate) {
  if (kind === 'charge') return t('admin.kindCharge');
  if (kind === 'payment') return t('admin.kindPayment');
  if (kind === 'adjustment_debit') return t('admin.kindAdjDebit');
  if (kind === 'adjustment_credit') return t('admin.kindAdjCredit');
  if (!kind) return '—';
  warnUnknownLabel('ledger kind', kind);
  return t('admin.kindUnknown');
}

export function labelReadingStatus(status: string | null | undefined, t: Translate) {
  if (status === 'reversed') return t('account.utilReversed');
  if (status === 'active') return t('admin.readingActive');
  if (!status) return '—';
  warnUnknownLabel('reading status', status);
  return t('admin.valueUnknown');
}

export function labelAssessmentStatus(status: string | null | undefined, t: Translate) {
  if (status === 'active') return t('admin.statusActive');
  if (status === 'closed') return t('admin.sfStatusClosed');
  if (status === 'draft') return t('admin.sfStatusDraft');
  if (!status) return '—';
  warnUnknownLabel('assessment status', status);
  return t('admin.valueUnknown');
}

export function labelDocumentStatus(status: string | null | undefined, t: Translate) {
  if (status === 'draft') return t('docs.draft');
  if (status === 'published') return t('docs.statusPublished');
  if (status === 'archived') return t('docs.statusHeld');
  if (!status) return '—';
  warnUnknownLabel('document status', status);
  return t('admin.valueUnknown');
}

export function labelPollDecision(raw: string, t: Translate) {
  if (raw === 'принято') return t('status.pollAccepted');
  if (raw === 'не принято') return t('status.pollRejected');
  return t('status.pollRunning');
}

export function labelTransfer(raw: string, t: Translate) {
  if (raw === 'утверждена') return t('status.trOk');
  if (raw === 'отклонена') return t('status.trNo');
  if (raw === 'отменена') return t('status.trCancel');
  return t('status.trWait');
}

export function labelExpenseStatus(published: boolean, t: Translate) {
  return published ? t('status.expPublished') : t('status.expPending');
}

export function labelCategory(raw: string | null | undefined, t: Translate) {
  if (raw === 'сантехника') return t('cat.plumbing');
  if (raw === 'электрика') return t('cat.electric');
  if (raw === 'уборка') return t('cat.cleaning');
  if (raw === 'отопление') return t('cat.heating');
  if (raw === 'книга') return t('cat.book');
  return t('cat.other');
}

export function labelPollCategory(raw: string | null | undefined, t: Translate) {
  if (raw === 'покупка') return t('pollCat.buy');
  if (raw === 'ремонт') return t('pollCat.repair');
  return t('pollCat.poll');
}

export function labelPollStatus(raw: string | null | undefined, t: Translate) {
  if ((raw ?? '').trim() === 'открыт') return t('status.pollOpen');
  if ((raw ?? '').trim() === 'закрыт') return t('status.pollClosed');
  const value = (raw ?? '').trim();
  if (!value) return '—';
  warnUnknownLabel('poll status', value);
  return t('admin.valueUnknown');
}

export function labelOwnerType(raw: string | null | undefined, t: Translate) {
  if (raw === 'юридическое лицо') return t('ownerType.company');
  if (raw === 'физическое лицо') return t('ownerType.person');
  if (!raw) return t('book.notSpecified');
  warnUnknownLabel('owner type', raw);
  return t('admin.valueUnknown');
}

/** Certified extract / ownership request workflow status. */
export function labelCertifiedRequestStatus(raw: string | null | undefined, t: Translate) {
  const s = (raw ?? '').trim().toLowerCase();
  if (!s) return '—';
  if (s === 'pending' || s === 'requested' || s === 'in_review') return t('status.trWait');
  if (s === 'approved' || s === 'issued' || s === 'ready' || s === 'completed') return t('status.trOk');
  if (s === 'rejected' || s === 'denied') return t('status.trNo');
  if (s === 'cancelled' || s === 'canceled' || s === 'void') return t('status.trCancel');
  warnUnknownLabel('certified request status', s);
  return t('admin.valueUnknown');
}

/** Generic admin/guest/liability status for ownership stage-3 panels. */
export function labelGenericRecordStatus(raw: string | null | undefined, t: Translate) {
  const s = (raw ?? '').trim().toLowerCase();
  if (!s) return '—';
  if (s === 'active' || s === 'accepted' || s === 'confirmed') return t('admin.statusActive');
  if (s === 'pending' || s === 'draft' || s === 'requested') return t('status.trWait');
  if (s === 'closed' || s === 'inactive' || s === 'archived') return t('admin.sfStatusClosed');
  if (s === 'rejected' || s === 'denied') return t('status.trNo');
  if (s === 'cancelled' || s === 'canceled' || s === 'revoked') return t('status.trCancel');
  warnUnknownLabel('record status', s);
  return t('admin.valueUnknown');
}

/** Inventory / warehouse movement kind (RECEIPT, ISSUE, …). */
export function labelInventoryDocKind(raw: string | null | undefined, t: Translate) {
  const s = (raw ?? '').trim().toUpperCase().replace(/-/g, '_');
  if (!s) return '—';
  if (s === 'RECEIPT' || s === 'IN' || s === 'INBOUND') return t('admin.invMove_RECEIPT');
  if (s === 'ISSUE' || s === 'OUT' || s === 'OUTBOUND') return t('admin.invMove_ISSUE');
  if (s === 'TRANSFER' || s === 'MOVE') return t('admin.invMove_TRANSFER');
  if (s === 'WRITE_OFF' || s === 'WRITEOFF' || s === 'SCRAP') return t('admin.invMove_WRITE_OFF');
  if (s === 'ADJUSTMENT' || s === 'ADJUST') return t('admin.invMove_ADJUSTMENT');
  warnUnknownLabel('inventory doc kind', s);
  return t('admin.valueUnknown');
}
