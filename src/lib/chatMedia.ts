export const MAX_CHAT_FILE_BYTES = 10 * 1024 * 1024;

export function isImageAttachment(url: string, fileName?: string | null) {
  const source = (fileName || url).split('?')[0].toLowerCase();
  return /\.(png|jpe?g|gif|webp|heic|bmp)$/.test(source);
}

export function chatPreviewText(message: string, fileName?: string | null, photoUrl?: string | null) {
  const text = message.trim();
  if (text) return text;
  if (fileName?.trim()) return fileName;
  if (photoUrl) return '📎';
  return '';
}
