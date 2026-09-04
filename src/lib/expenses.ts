export const EXPENSE_PENDING = 'на проверке';
export const EXPENSE_PUBLISHED = 'опубликован';
export const MAX_EXPENSE_PHOTOS = 5;

export function isExpensePublished(expense: { status?: string | null }) {
  const s = (expense.status ?? '').trim().toLowerCase();
  if (!s) return true;
  return s === EXPENSE_PUBLISHED || s === 'approved' || s === 'published';
}

export function expensePhotoUrls(expense: { photo_urls?: string[] | null }): string[] {
  return (expense.photo_urls ?? []).filter(Boolean).slice(0, MAX_EXPENSE_PHOTOS);
}