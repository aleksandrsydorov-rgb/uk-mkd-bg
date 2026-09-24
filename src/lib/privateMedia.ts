import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

export const REQUEST_PHOTOS_BUCKET = 'request-photos';
export const CHAT_FILES_BUCKET = 'chat-files';
export const EXPENSE_RECEIPTS_BUCKET = 'uk-expense-receipts';
export const POLL_IMAGES_BUCKET = 'poll-images';

export const MAX_PRIVATE_UPLOAD_BYTES = 10 * 1024 * 1024;

const IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'image/bmp',
]);

const CHAT_MIMES = new Set([
  ...IMAGE_MIMES,
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
]);

export class PrivateUploadValidationError extends Error {
  readonly reason: 'type' | 'size';

  constructor(reason: 'type' | 'size') {
    super(reason === 'size' ? 'upload_size' : 'upload_type');
    this.name = 'PrivateUploadValidationError';
    this.reason = reason;
  }
}

export function messageForUploadError(error: unknown, typeMsg: string, sizeMsg: string) {
  if (error instanceof PrivateUploadValidationError) {
    return error.reason === 'size' ? sizeMsg : typeMsg;
  }
  return null;
}

function normalizedMime(file: File) {
  return file.type.toLowerCase().split(';')[0].trim();
}

export function privateUploadRejectReason(bucket: string, file: File): 'type' | 'size' | null {
  if (file.size > MAX_PRIVATE_UPLOAD_BYTES) return 'size';
  const mime = normalizedMime(file);
  if (bucket === CHAT_FILES_BUCKET) {
    return CHAT_MIMES.has(mime) ? null : 'type';
  }
  if (
    bucket === REQUEST_PHOTOS_BUCKET
    || bucket === POLL_IMAGES_BUCKET
    || bucket === EXPENSE_RECEIPTS_BUCKET
  ) {
    return IMAGE_MIMES.has(mime) ? null : 'type';
  }
  return null;
}

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
  const rejected = privateUploadRejectReason(bucket, file);
  if (rejected) throw new PrivateUploadValidationError(rejected);
  const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: false });
  if (error) throw error;
  return path;
}
