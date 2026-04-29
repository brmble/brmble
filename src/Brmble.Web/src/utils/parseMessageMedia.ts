import type { MediaAttachment } from '../types';

export const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
export const ALLOWED_MIMETYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const IMG_REGEX = /<img\s+[^>]*src=["']data:(image\/[^;]+);base64,([^"']+)["'][^>]*\/?>/gi;
// Anchor tag from a Brmble peer (linkifyForMumble) — strip back to inner text
// so the local renderer's own URL detection (linkifyText) creates the React link.
const ANCHOR_REGEX = /<a\s+[^>]*href=["'][^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;

const HTML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};
function decodeEntities(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|#39);/g, m => HTML_ENTITIES[m] ?? m);
}

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
    const [fullMatch, rawMimetype, b64Data] = match;

    // Always strip the img tag from the text output
    text = text.replace(fullMatch, '');

    const mimetype = rawMimetype.toLowerCase();

    if (!ALLOWED_MIMETYPES.includes(mimetype)) continue;

    // MumbleSharp/ICE may URL-encode the data URI content — decode before use
    let rawB64: string;
    try {
      rawB64 = decodeURIComponent(b64Data);
    } catch {
      rawB64 = b64Data;
    }

    const estimatedSize = Math.floor((rawB64.length * 3) / 4);
    if (estimatedSize > MAX_SIZE_BYTES) continue;

    media.push({
      type: mimetype === 'image/gif' ? 'gif' : 'image',
      url: `data:${mimetype};base64,${rawB64}`,
      mimetype,
      size: estimatedSize,
    });
  }

  // Replace anchor tags with their inner text (the URL we sent), then decode
  // the HTML entities we escaped on the way out so the local linkifier sees a
  // clean URL like "https://x.com/a?b=1&c=2" rather than the escaped form.
  text = text.replace(ANCHOR_REGEX, (_m, inner) => inner);
  text = decodeEntities(text);

  return { text: text.trim(), media };
}
