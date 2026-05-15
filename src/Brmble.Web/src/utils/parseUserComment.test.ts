import { describe, expect, it } from 'vitest';
import { parseUserComment } from './parseUserComment';

describe('parseUserComment', () => {
  it('returns plain text comments unchanged', () => {
    expect(parseUserComment('Hello from Mumble')).toEqual({
      text: 'Hello from Mumble',
      hasEmbeddedMedia: false,
    });
  });

  it('strips embedded mumble image markup from comments', () => {
    const result = parseUserComment(
      `Look at my profile<img src="data:image/png;base64,AAAA" />`
    );

    expect(result).toEqual({
      text: 'Look at my profile',
      hasEmbeddedMedia: true,
    });
  });

  it('drops image-only comments instead of showing raw encoded payload', () => {
    const result = parseUserComment(
      `<img src="data:image/png;base64,AAAA" />`
    );

    expect(result).toEqual({
      text: '',
      hasEmbeddedMedia: true,
    });
  });

  it('decodes simple html entities around preserved text', () => {
    const result = parseUserComment(
      'Tom &amp; Jerry &lt;3<img src="data:image/png;base64,AAAA" />'
    );

    expect(result).toEqual({
      text: 'Tom & Jerry <3',
      hasEmbeddedMedia: true,
    });
  });

  it('strips entity-escaped image tags to prevent base64 payload leaks', () => {
    const result = parseUserComment(
      'Check this out &lt;img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" /&gt;'
    );

    expect(result).toEqual({
      text: 'Check this out',
      hasEmbeddedMedia: true,
    });
  });

  it('strips double-escaped image tags', () => {
    const result = parseUserComment(
      '&amp;lt;img src="data:image/png;base64,AAAA" /&amp;gt;'
    );

    expect(result).toEqual({
      text: '',
      hasEmbeddedMedia: true,
    });
  });
});
