import type { MediaAttachment } from '../types';

const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIMETYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const IMG_REGEX = /<img\s+[^>]*src=["']data:(image\/[^;]+);base64,([^"']+)["'][^>]*\/?>/gi;

export interface ParsedMessage {
  text: string;
  media: MediaAttachment[];
}

export function parseMessageMedia(message: string): ParsedMessage {
  const media: MediaAttachment[] = [];
  let text = message;

  IMG_REGEX.lastIndex = 0;

  let match;
  while ((match = IMG_REGEX.exec(message)) !== null) {
    const [fullMatch, mimetype, b64Data] = match;

    // Always strip the img tag from the text output
    text = text.replace(fullMatch, '');

    if (!ALLOWED_MIMETYPES.includes(mimetype.toLowerCase())) continue;

    // MumbleSharp/ICE may URL-encode the data URI content — decode before use
    const rawB64 = decodeURIComponent(b64Data);

    const estimatedSize = Math.floor((rawB64.length * 3) / 4);
    if (estimatedSize > MAX_SIZE_BYTES) continue;

    media.push({
      type: mimetype === 'image/gif' ? 'gif' : 'image',
      url: `data:${mimetype};base64,${rawB64}`,
      mimetype,
      size: estimatedSize,
    });
  }

  return { text: text.trim(), media };
}
