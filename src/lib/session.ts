export const SESSION_EMAIL_KEY = 'dev_email';

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function escapeIlike(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export function readSessionEmail() {
  if (typeof window === 'undefined') return '';
  return normalizeEmail(localStorage.getItem(SESSION_EMAIL_KEY) ?? '');
}

export function writeSessionEmail(email: string) {
  localStorage.setItem(SESSION_EMAIL_KEY, normalizeEmail(email));
}

export function clearSessionEmail() {
  localStorage.removeItem(SESSION_EMAIL_KEY);
}
