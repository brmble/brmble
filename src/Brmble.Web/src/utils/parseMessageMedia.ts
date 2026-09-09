import type { MediaAttachment } from '../types';

export const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
export const ALLOWED_MIMETYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const IMG_REGEX = /<img\s+[^>]*src=["']data:(image\/[^;]+);base64,([^"']+)["'][^>]*\/?>/gi;
// Anchor tag from a Brmble peer (linkifyForMumble) or any other Mumble HTML
// sender. Captures the href so we can preserve the URL even when the visible
// text is descriptive (e.g. <a href="https://example.com">click here</a>).
const ANCHOR_REGEX = /<a\s+[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
// Quick check whether a string already contains a URL the local linkifier
// will recognize. Mirrors the lead-in of linkifyText's URL_PATTERN.
const URL_HINT_PATTERN = /(?:https?:\/\/|\bwww\.)\S/i;

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

export interface PaintInvitationMetadata {
  version?: 2;
  sessionId: string;
  channelId: number;
  status: 'active' | 'ended' | 'expired' | 'unavailable';
}

/** Paint invitations are stored in Matrix message content when available and serialized in plain text for chat history fallbacks. */
export function parsePaintInvitation(message: string): PaintInvitationMetadata | null {
  const match = message.match(/^\[brmble-paint\]([\s\S]+)$/);
  if (!match) return null;
  try {
    const value = JSON.parse(match[1]) as Partial<PaintInvitationMetadata> & {
      version?: number;
      hostUserId?: number;
      participantUserIds?: number[];
    };
    if (!value.sessionId || typeof value.channelId !== 'number') return null;
    if (value.version === 2) {
      return { version: 2, sessionId: value.sessionId, channelId: value.channelId, status: value.status ?? 'active' };
    }
    // Legacy compatibility: validate the old participant snapshot, then normalize it away.
    if (typeof value.hostUserId !== 'number' || !Array.isArray(value.participantUserIds)) return null;
    return { sessionId: value.sessionId, channelId: value.channelId, status: value.status ?? 'active' };
  } catch { return null; }
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

  // Replace anchor tags with a plain-text rendering. If the visible text
  // already contains a URL (the common case when the anchor came from
  // linkifyForMumble — visible == href), keep just the inner text and let
  // the local linkifier re-wrap it into a React link. Otherwise the inner
  // text is descriptive ("click here") and dropping the href would lose the
  // URL, so we render as "inner (href)" to preserve both label and URL.
  text = text.replace(ANCHOR_REGEX, (_m, href, inner) => {
    const innerStr = String(inner);
    if (URL_HINT_PATTERN.test(innerStr)) return innerStr;
    return `${innerStr} (${href})`;
  });
  // Decode the HTML entities we escaped on the way out. The decode is
  // intentionally applied to the WHOLE message — linkifyForMumble escapes
  // both URL and non-URL text so Mumble's HTML parser doesn't eat literal
  // '<' or '&', and we have to reverse that on the receiver side to recover
  // the original text. A single-pass decode (no recursive expansion) means
  // a user who typed literal '&lt;' on the way out gets back literal '&lt;'
  // here, which is the correct round-trip for our outgoing format.
  text = decodeEntities(text);

  return { text: text.trim(), media };
}
