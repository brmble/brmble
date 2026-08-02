import type { MediaAttachment } from '../types';
import {
  isSupportedPaintSourceMimeType,
  paintSourceExtension,
  preparePaintSourceFile,
} from './paintSourceFile';

const DOWNLOAD_TIMEOUT_MS = 15_000;

function normalizedMime(value?: string): string {
  return value?.split(';', 1)[0].trim().toLowerCase() ?? '';
}

export function isPaintSourceAttachment(
  attachment: MediaAttachment,
): boolean {
  if (!attachment.url.trim()) return false;
  const mime = normalizedMime(attachment.mimetype);
  return mime
    ? isSupportedPaintSourceMimeType(mime)
    : attachment.type === 'image';
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
  const extension = paintSourceExtension(mime);
  const filename = attachment.filename?.trim()
    || (extension ? `chat-image.${extension}` : 'chat-image');
  const file = new File([blob], filename, { type: mime });

  return preparePaintSourceFile(file, 'chat');
}
