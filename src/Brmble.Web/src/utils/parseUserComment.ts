export interface ParsedUserComment {
  text: string;
  hasEmbeddedMedia: boolean;
}

const IMG_TAG_REGEX = /<img\b[^>]*>/gi;
const BR_TAG_REGEX = /<br\s*\/?>/gi;
const TAG_REGEX = /<\/?[^>]+>/g;

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

export function parseUserComment(comment?: string): ParsedUserComment {
  if (!comment) {
    return { text: '', hasEmbeddedMedia: false };
  }

  const hasEmbeddedMedia = IMG_TAG_REGEX.test(comment);
  const withoutImages = comment.replace(IMG_TAG_REGEX, ' ');
  const withLineBreaks = withoutImages.replace(BR_TAG_REGEX, '\n');
  const withoutTags = withLineBreaks.replace(TAG_REGEX, ' ');
  const decoded = decodeHtmlEntities(withoutTags);
  const normalized = decoded
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return {
    text: normalized,
    hasEmbeddedMedia,
  };
}
