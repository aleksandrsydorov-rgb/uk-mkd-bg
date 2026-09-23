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

export function labelPollDecision(raw: string, t: Translate) {
  if (raw === 'принято') return t('status.pollAccepted');
  if (raw === 'не принято') return t('status.pollRejected');
  return t('status.pollRunning');
}

export function labelTransfer(raw: string, t: Translate) {
  if (raw === 'утверждена') return t('status.trOk');
  if (raw === 'отклонена') return t('status.trNo');
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

export function labelOwnerType(raw: string | null | undefined, t: Translate) {
  if (raw === 'юридическое лицо') return t('ownerType.company');
  if (raw === 'физическое лицо') return t('ownerType.person');
  return raw || '';
}
