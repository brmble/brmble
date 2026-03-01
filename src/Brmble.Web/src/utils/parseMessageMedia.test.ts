import { describe, it, expect } from 'vitest';
import { parseMessageMedia } from './parseMessageMedia';

describe('parseMessageMedia', () => {
  it('returns original text and empty media for plain text', () => {
    const result = parseMessageMedia('hello world');
    expect(result.text).toBe('hello world');
    expect(result.media).toHaveLength(0);
  });

  it('extracts a single base64 PNG image', () => {
    const b64 = btoa('fake-png-data');
    const html = `<img src="data:image/png;base64,${b64}" />`;
    const result = parseMessageMedia(html);
    expect(result.text).toBe('');
    expect(result.media).toHaveLength(1);
    expect(result.media[0].type).toBe('image');
    expect(result.media[0].mimetype).toBe('image/png');
    expect(result.media[0].url).toBe(`data:image/png;base64,${b64}`);
  });

  it('extracts a GIF and sets type to gif', () => {
    const b64 = btoa('fake-gif-data');
    const html = `<img src="data:image/gif;base64,${b64}" />`;
    const result = parseMessageMedia(html);
    expect(result.media).toHaveLength(1);
    expect(result.media[0].type).toBe('gif');
    expect(result.media[0].mimetype).toBe('image/gif');
  });

  it('preserves surrounding text', () => {
    const b64 = btoa('img');
    const html = `Check this out: <img src="data:image/jpeg;base64,${b64}" /> pretty cool`;
    const result = parseMessageMedia(html);
    expect(result.text).toBe('Check this out:  pretty cool');
    expect(result.media).toHaveLength(1);
  });

  it('extracts multiple images', () => {
    const b64a = btoa('img-a');
    const b64b = btoa('img-b');
    const html = `<img src="data:image/png;base64,${b64a}" /><img src="data:image/jpeg;base64,${b64b}" />`;
    const result = parseMessageMedia(html);
    expect(result.media).toHaveLength(2);
  });

  it('rejects images over 5 MB', () => {
    const bigB64 = 'A'.repeat(7_000_000);
    const html = `<img src="data:image/png;base64,${bigB64}" />`;
    const result = parseMessageMedia(html);
    expect(result.media).toHaveLength(0);
    expect(result.text).toBe('');
  });

  it('rejects non-image mimetypes', () => {
    const b64 = btoa('script');
    const html = `<img src="data:text/html;base64,${b64}" />`;
    const result = parseMessageMedia(html);
    expect(result.media).toHaveLength(0);
  });

  it('handles img tags with single quotes', () => {
    const b64 = btoa('img');
    const html = `<img src='data:image/png;base64,${b64}' />`;
    const result = parseMessageMedia(html);
    expect(result.media).toHaveLength(1);
  });

  it('handles img tags without self-closing slash', () => {
    const b64 = btoa('img');
    const html = `<img src="data:image/png;base64,${b64}">`;
    const result = parseMessageMedia(html);
    expect(result.media).toHaveLength(1);
  });
});
