import type { MediaAttachment } from '../types';
import {
  MAX_PAINT_SOURCE_BYTES,
  isSupportedPaintSourceMimeType,
  paintSourceExtension,
  preparePaintSourceFile,
} from './paintSourceFile';

const DOWNLOAD_TIMEOUT_MS = 15_000;
const DOWNLOAD_SIZE_ERROR =
  'This chat image is too large to use as a Paint source.';

function normalizedMime(value?: string): string {
  return value?.split(';', 1)[0].trim().toLowerCase() ?? '';
}

async function readResponseBlob(response: Response): Promise<Blob> {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_PAINT_SOURCE_BYTES) {
    throw new Error(DOWNLOAD_SIZE_ERROR);
  }

  if (!response.body) {
    throw new Error('Unable to download the chat image.');
  }

  const reader = response.body.getReader();
  const chunks: ArrayBuffer[] = [];
  let bytesRead = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      bytesRead += value.byteLength;
      if (bytesRead > MAX_PAINT_SOURCE_BYTES) {
        throw new Error(DOWNLOAD_SIZE_ERROR);
      }
      const chunk = new ArrayBuffer(value.byteLength);
      new Uint8Array(chunk).set(value);
      chunks.push(chunk);
    }
  } catch (error) {
    try {
      await reader.cancel(error);
    } catch {
      // The stream may already be closed by the time the limit is detected.
    }
    throw error;
  } finally {
    reader.releaseLock();
  }

  return new Blob(chunks, {
    type: response.headers.get('content-type') ?? '',
  });
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

  const blob = await readResponseBlob(response);
  const mime = normalizedMime(attachment.mimetype)
    || normalizedMime(blob.type);
  const extension = paintSourceExtension(mime);
  const filename = attachment.filename?.trim()
    || (extension ? `chat-image.${extension}` : 'chat-image');
  const file = new File([blob], filename, { type: mime });

  return preparePaintSourceFile(file, 'chat');
}
