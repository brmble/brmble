import { describe, it, expect } from 'vitest';
import { stripReplyFallback, makeReplyFallback, makeReplyHtml, buildReplyContent } from './replyHelpers';

describe('stripReplyFallback', () => {
  it('removes reply fallback lines', () => {
    const body = '> <alice> original message\n> continues here\n\nreply text';
    expect(stripReplyFallback(body)).toBe('reply text');
  });

  it('handles body without fallback', () => {
    const body = 'just a regular message';
    expect(stripReplyFallback(body)).toBe('just a regular message');
  });

  it('trims result', () => {
    const body = '> <alice> test\n\n  ';
    expect(stripReplyFallback(body)).toBe('');
  });
});

describe('makeReplyFallback', () => {
  it('creates fallback with sender and body', () => {
    const result = makeReplyFallback({ sender: 'alice', body: 'Hello world' }, 'My reply');
    expect(result).toContain('> <alice> Hello world');
    expect(result).toContain('\n\nMy reply');
  });

  it('handles multiline body', () => {
    const result = makeReplyFallback({ sender: 'alice', body: 'Line 1\nLine 2\nLine 3' }, 'Reply');
    expect(result).toContain('> <alice> Line 1');
    expect(result).toContain('> Line 2');
    expect(result).toContain('> Line 3');
  });

  it('handles empty body with placeholder', () => {
    const result = makeReplyFallback({ sender: 'alice', body: '' }, 'Reply');
    expect(result).toContain('(empty message)');
  });

  it('handles whitespace-only body', () => {
    const result = makeReplyFallback({ sender: 'alice', body: '   ' }, 'Reply');
    expect(result).toContain('(empty message)');
  });
});

describe('makeReplyHtml', () => {
  it('generates mx-reply block with escaped content', () => {
    const result = makeReplyHtml('!room:example.com', '$event:example.com', 'alice', '@alice:example.com', 'Hello world');
    expect(result).toContain('<mx-reply>');
    expect(result).toContain('https://matrix.to/');
    expect(result).toContain('@alice:example.com');
  });

  it('escapes HTML in sender and body', () => {
    const result = makeReplyHtml('!room:example.com', '$event:example.com', 'alice', '<script>evil</script>', 'Test <b>bold</b>');
    expect(result).toContain('&lt;script&gt;');
    expect(result).toContain('&lt;b&gt;bold&lt;/b&gt;');
  });

  it('truncates long body', () => {
    const longBody = 'a'.repeat(200);
    const result = makeReplyHtml('!room:example.com', '$event:example.com', 'alice', '@alice:example.com', longBody);
    expect(result).toContain('...');
  });
});

describe('buildReplyContent', () => {
  it('returns correct structure', () => {
    const result = buildReplyContent('!room:example.com', '$event:example.com', 'alice', '@alice:example.com', 'Original', 'My reply');
    
    expect(result.msgtype).toBe('m.text');
    expect(result.format).toBe('org.matrix.custom.html');
    expect(result.body).toContain('> <@alice:example.com>');
    expect(result.body).toContain('\n\nMy reply');
    expect(result.formatted_body).toContain('<mx-reply>');
    expect(result['m.relates_to']['m.in_reply_to'].event_id).toBe('$event:example.com');
  });

  it('escapes replyText in formatted_body', () => {
    const result = buildReplyContent('!room:example.com', '$event:example.com', 'alice', '@alice:example.com', 'Original', 'Reply with <html>');
    expect(result.formatted_body).toContain('&lt;html&gt;');
  });

  it('converts newlines to <br> in formatted_body', () => {
    const result = buildReplyContent('!room:example.com', '$event:example.com', 'alice', '@alice:example.com', 'Original', 'Line 1\nLine 2');
    expect(result.formatted_body).toContain('<br>');
  });
});