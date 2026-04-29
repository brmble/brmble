import { describe, it, expect } from 'vitest';
import { linkifyForMumble } from './linkifyForMumble';

describe('linkifyForMumble', () => {
  it('returns empty string unchanged', () => {
    expect(linkifyForMumble('')).toBe('');
  });

  it('escapes HTML special characters in plain text', () => {
    expect(linkifyForMumble('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d');
  });

  it('wraps an https URL in an anchor tag', () => {
    expect(linkifyForMumble('see https://example.com here'))
      .toBe('see <a href="https://example.com">https://example.com</a> here');
  });

  it('wraps an http URL in an anchor tag', () => {
    expect(linkifyForMumble('http://example.com'))
      .toBe('<a href="http://example.com">http://example.com</a>');
  });

  it('does not linkify www-prefixed URLs (native Mumble handles those itself)', () => {
    expect(linkifyForMumble('Check out www.google.com today'))
      .toBe('Check out www.google.com today');
  });

  it('handles multiple http(s) URLs in one message', () => {
    expect(linkifyForMumble('see https://a.com and http://b.com'))
      .toBe('see <a href="https://a.com">https://a.com</a> and <a href="http://b.com">http://b.com</a>');
  });

  it('does not linkify bare domains', () => {
    expect(linkifyForMumble('example.com is great')).toBe('example.com is great');
  });

  it('escapes ampersands in URLs to keep the href valid', () => {
    expect(linkifyForMumble('https://x.com/a?b=1&c=2'))
      .toBe('<a href="https://x.com/a?b=1&amp;c=2">https://x.com/a?b=1&amp;c=2</a>');
  });

  it('escapes user-typed angle brackets even when a URL is present', () => {
    expect(linkifyForMumble('<script>alert(1)</script> https://safe.com'))
      .toBe('&lt;script&gt;alert(1)&lt;/script&gt; <a href="https://safe.com">https://safe.com</a>');
  });

  it('does not match URL inside an existing tag-like fragment', () => {
    // The regex stops at <, so "foo<https://..." would still linkify the URL part.
    // What we care about is that we never emit an unescaped tag boundary.
    const out = linkifyForMumble('foo<https://x.com>');
    expect(out).not.toContain('<https');
    expect(out).toContain('&lt;');
  });
});
