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
