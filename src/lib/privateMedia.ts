import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

export const REQUEST_PHOTOS_BUCKET = 'request-photos';
export const CHAT_FILES_BUCKET = 'chat-files';
export const EXPENSE_RECEIPTS_BUCKET = 'uk-expense-receipts';
export const POLL_IMAGES_BUCKET = 'poll-images';

const UUID_FILE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,8}$/;

export function storageExtension(fileName: string) {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0 || dot === fileName.length - 1) return 'bin';
  const raw = fileName.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (raw.length < 1 || raw.length > 8) return 'bin';
  return raw;
}

function objectFileName(fileName: string) {
  return `${crypto.randomUUID()}.${storageExtension(fileName)}`;
}

export function requestPhotoPath(propertyId: number, fileName: string) {
  return `requests/${propertyId}/${objectFileName(fileName)}`;
}

export function chatFilePath(propertyId: number, fileName: string) {
  return `properties/${propertyId}/${objectFileName(fileName)}`;
}

export function expenseReceiptPath(expenseId: number, fileName: string) {
  return `expenses/${expenseId}/${objectFileName(fileName)}`;
}

export function pollImagePath(pollId: number, fileName: string) {
  return `polls/${pollId}/${objectFileName(fileName)}`;
}

export function bucketForStoredPath(stored: string | null | undefined) {
  const path = stored?.trim() ?? '';
  if (!path || path.includes('..') || path.startsWith('http://') || path.startsWith('https://')) {
    return null;
  }
  const file = path.split('/').pop() ?? '';
  if (!UUID_FILE.test(file)) return null;
  if (/^requests\/[0-9]+\//.test(path)) return REQUEST_PHOTOS_BUCKET;
  if (/^properties\/[0-9]+\//.test(path)) return CHAT_FILES_BUCKET;
  if (/^expenses\/[0-9]+\//.test(path)) return EXPENSE_RECEIPTS_BUCKET;
  if (/^polls\/[0-9]+\//.test(path)) return POLL_IMAGES_BUCKET;
  return null;
}

export async function uploadPrivateFile(
  supabase: SupabaseClient<Database>,
  bucket: string,
  path: string,
  file: File,
) {
  const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: false });
  if (error) throw error;
  return path;
}
