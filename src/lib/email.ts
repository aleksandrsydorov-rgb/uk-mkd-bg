export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function escapeIlike(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}
