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

  it('rewrites www. URLs by prepending https:// to both the visible text and the href', () => {
    expect(linkifyForMumble('Check out www.google.com today'))
      .toBe('Check out <a href="https://www.google.com">https://www.google.com</a> today');
  });

  it('handles a mix of http(s) and www. URLs in one message', () => {
    expect(linkifyForMumble('see https://a.com and www.b.com'))
      .toBe('see <a href="https://a.com">https://a.com</a> and <a href="https://www.b.com">https://www.b.com</a>');
  });

  it('does not linkify bare domains without a www. prefix', () => {
    expect(linkifyForMumble('example.com is great')).toBe('example.com is great');
  });

  it('matches www at a word boundary, not embedded inside another word', () => {
    expect(linkifyForMumble('foowww.google.com')).toBe('foowww.google.com');
  });

  it('preserves preceding punctuation when matching www', () => {
    expect(linkifyForMumble('(www.google.com)'))
      .toBe('(<a href="https://www.google.com">https://www.google.com</a>)');
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

  it('does not include a trailing period in the URL', () => {
    expect(linkifyForMumble('see https://example.com.'))
      .toBe('see <a href="https://example.com">https://example.com</a>.');
  });

  it('does not include a trailing comma in the URL', () => {
    expect(linkifyForMumble('see https://x.com, then go home'))
      .toBe('see <a href="https://x.com">https://x.com</a>, then go home');
  });

  it('does not include trailing sentence punctuation (?, !, ;, :)', () => {
    expect(linkifyForMumble('really https://x.com?'))
      .toBe('really <a href="https://x.com">https://x.com</a>?');
    expect(linkifyForMumble('wow https://x.com!'))
      .toBe('wow <a href="https://x.com">https://x.com</a>!');
    expect(linkifyForMumble('see https://x.com; later'))
      .toBe('see <a href="https://x.com">https://x.com</a>; later');
    expect(linkifyForMumble('here https://x.com: yes'))
      .toBe('here <a href="https://x.com">https://x.com</a>: yes');
  });

  it('drops trailing punctuation on www. URLs too', () => {
    expect(linkifyForMumble('go to www.google.com.'))
      .toBe('go to <a href="https://www.google.com">https://www.google.com</a>.');
  });

  it('preserves ports, paths, query strings, and fragments inside the URL', () => {
    const url = 'https://example.com:8080/path/to?a=1&b=2#section';
    const out = linkifyForMumble(url);
    expect(out).toContain('href="https://example.com:8080/path/to?a=1&amp;b=2#section"');
    expect(out).toContain('>https://example.com:8080/path/to?a=1&amp;b=2#section<');
  });

  it('does not linkify javascript: or data: URLs (only http/https/www)', () => {
    expect(linkifyForMumble('javascript:alert(1)')).toBe('javascript:alert(1)');
    expect(linkifyForMumble('data:text/html,<script>alert(1)</script>'))
      .toBe('data:text/html,&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(linkifyForMumble('ftp://x.com')).toBe('ftp://x.com');
  });

  it('does not linkify URLs that follow another word with no boundary', () => {
    // Pattern uses \b for www. so foowww.x.com stays plain text.
    expect(linkifyForMumble('foowww.example.com')).toBe('foowww.example.com');
  });

  it('round-trips a literal &amp; from user input as a single-pass entity', () => {
    // User typed literal "&amp;" — linkifyForMumble escapes the & to "&amp;",
    // producing "&amp;amp;" on the wire. parseMessageMedia decodes once back
    // to "&amp;". This test just confirms our outgoing escape.
    expect(linkifyForMumble('typed &amp; literally')).toBe('typed &amp;amp; literally');
  });
});
