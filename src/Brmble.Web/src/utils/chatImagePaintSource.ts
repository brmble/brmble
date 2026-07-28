import type { MediaAttachment } from '../types';
import { ALLOWED_MIMETYPES } from './parseMessageMedia';

const DOWNLOAD_TIMEOUT_MS = 15_000;
const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

function normalizedMime(value?: string): string {
  return value?.split(';', 1)[0].trim().toLowerCase() ?? '';
}

export function isPaintSourceAttachment(
  attachment: MediaAttachment,
): boolean {
  if (!attachment.url.trim()) return false;
  const mime = normalizedMime(attachment.mimetype);
  return mime
    ? ALLOWED_MIMETYPES.includes(mime)
    : attachment.type === 'image' || attachment.type === 'gif';
}

export async function prepareChatImagePaintSource(
  attachment: MediaAttachment,
  fetcher: typeof fetch = fetch,
): Promise<File> {
  if (!isPaintSourceAttachment(attachment)) {
    throw new Error('This image cannot be used for paint.');
  }

  const response = await fetcher(attachment.url, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error('Unable to download the chat image.');
  }

  const blob = await response.blob();
  const mime = normalizedMime(attachment.mimetype)
    || normalizedMime(blob.type);
  if (!ALLOWED_MIMETYPES.includes(mime)) {
    throw new Error('This image type cannot be used for paint.');
  }

  const filename = attachment.filename?.trim()
    || `chat-image.${EXTENSION_BY_MIME[mime]}`;
  const file = new File([blob], filename, { type: mime });
  const objectUrl = URL.createObjectURL(file);

  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
  } catch {
    throw new Error('Unable to decode the chat image.');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }

  return file;
}
