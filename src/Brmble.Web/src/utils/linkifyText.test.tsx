import type { ReactElement } from 'react';
import { describe, it, expect } from 'vitest';
import { linkifyText } from './linkifyText';

describe('linkifyText', () => {
  it('returns the original string when there are no URLs', () => {
    const result = linkifyText('hello world, no links here');
    expect(result).toBe('hello world, no links here');
  });

  it('returns the original string for empty input', () => {
    const result = linkifyText('');
    expect(result).toBe('');
  });

  it('wraps a single URL in an anchor tag', () => {
    const result = linkifyText('visit https://example.com today');
    expect(result).toBeInstanceOf(Array);
    const parts = result as unknown[];
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe('visit ');
    expect(parts[2]).toBe(' today');
  });

  it('handles multiple URLs in one message', () => {
    const result = linkifyText('see https://a.com and https://b.com done');
    expect(result).toBeInstanceOf(Array);
    const parts = result as unknown[];
    expect(parts).toHaveLength(5);
    expect(parts[0]).toBe('see ');
    expect(parts[2]).toBe(' and ');
    expect(parts[4]).toBe(' done');
  });

  it('linkifies URLs adjacent to punctuation', () => {
    const result = linkifyText('check https://example.com.');
    expect(result).toBeInstanceOf(Array);
    const parts = result as unknown[];
    // The URL pattern will grab the trailing dot as part of the URL or leave it —
    // either way, there should be an anchor element in the result
    expect(parts.length).toBeGreaterThanOrEqual(2);
  });

  it('handles URL at the start of the string', () => {
    const result = linkifyText('https://example.com is great');
    expect(result).toBeInstanceOf(Array);
    const parts = result as unknown[];
    expect(parts[0]).toBe('');
    expect(parts[2]).toBe(' is great');
  });

  it('handles URL at the end of the string', () => {
    const result = linkifyText('go to https://example.com');
    expect(result).toBeInstanceOf(Array);
    const parts = result as unknown[];
    expect(parts[0]).toBe('go to ');
    expect(parts[parts.length - 1]).toBe('');
  });

  it('correctly linkifies consecutive calls (no /g statefulness bug)', () => {
    // This test ensures the /g regex fix works — calling linkifyText
    // multiple times should produce consistent results
    for (let i = 0; i < 5; i++) {
      const result = linkifyText('link: https://example.com end');
      expect(result).toBeInstanceOf(Array);
      const parts = result as unknown[];
      expect(parts).toHaveLength(3);
      expect(parts[0]).toBe('link: ');
      expect(parts[2]).toBe(' end');
    }
  });

  it('handles http URLs (not just https)', () => {
    const result = linkifyText('old link http://example.com here');
    expect(result).toBeInstanceOf(Array);
    const parts = result as unknown[];
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe('old link ');
  });

  it('linkifies www-prefixed URLs and prepends https:// to the href', () => {
    const result = linkifyText('Check out www.google.com today');
    expect(result).toBeInstanceOf(Array);
    const parts = result as unknown[];
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe('Check out ');
    expect(parts[2]).toBe(' today');

    const anchor = parts[1] as ReactElement<{ href: string; children: string }>;
    expect(anchor.props.href).toBe('https://www.google.com');
    expect(anchor.props.children).toBe('www.google.com');
  });

  it('does not linkify "www." embedded inside another word', () => {
    const result = linkifyText('foowww.google.com');
    expect(result).toBe('foowww.google.com');
  });

  it('excludes a trailing period from the linkified URL', () => {
    const result = linkifyText('check https://example.com.');
    expect(result).toBeInstanceOf(Array);
    const parts = result as unknown[];
    const anchor = parts[1] as ReactElement<{ href: string; children: string }>;
    expect(anchor.props.children).toBe('https://example.com');
    expect(parts[2]).toBe('.');
  });

  it('excludes a trailing comma from the linkified URL', () => {
    const result = linkifyText('see https://x.com, then later');
    const parts = result as unknown[];
    const anchor = parts[1] as ReactElement<{ href: string; children: string }>;
    expect(anchor.props.children).toBe('https://x.com');
    expect(parts[2]).toBe(', then later');
  });

  it('preserves ports, paths, query strings, and fragments inside the URL', () => {
    const result = linkifyText('go to https://example.com:8080/path?a=1&b=2#frag now');
    const parts = result as unknown[];
    const anchor = parts[1] as ReactElement<{ href: string; children: string }>;
    expect(anchor.props.href).toBe('https://example.com:8080/path?a=1&b=2#frag');
    expect(parts[2]).toBe(' now');
  });

  it('does not linkify javascript: or data: schemes', () => {
    expect(linkifyText('javascript:alert(1)')).toBe('javascript:alert(1)');
    expect(linkifyText('data:text/html,foo')).toBe('data:text/html,foo');
  });

  it('safely handles HTML-like input by linkifying the URL portion only', () => {
    // Contract: linkifyText takes plain text. If a caller passes serialized
    // HTML, the surrounding tag fragments stay as plain text (React escapes
    // them) — no broken DOM is produced.
    const result = linkifyText('<a href="https://example.com">label</a>');
    // Contains an anchor for the URL portion
    expect(result).toBeInstanceOf(Array);
    const parts = result as unknown[];
    const anchor = parts.find((p) => typeof p !== 'string') as
      | ReactElement<{ href: string; children: string }>
      | undefined;
    expect(anchor).toBeDefined();
    expect(anchor!.props.href).toBe('https://example.com');
    // The literal angle-bracket text remains as a string fragment that React
    // will safely escape during rendering.
    expect(parts.some((p) => typeof p === 'string' && p.startsWith('<a href='))).toBe(true);
  });
});
