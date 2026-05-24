import { describe, expect, it } from 'vitest';
import { getRedactionPlaceholder } from './redactionPlaceholders';

describe('getRedactionPlaceholder', () => {
  it('maps self-delete reason', () => {
    const result = getRedactionPlaceholder({ unsigned: { redacted_because: { content: { reason: 'brmble:self-delete' } } } });
    expect(result?.text).toBe('This message was deleted');
  });

  it('maps moderator-delete reason', () => {
    const result = getRedactionPlaceholder({ unsigned: { redacted_because: { content: { reason: 'brmble:moderator-delete' } } } });
    expect(result?.text).toBe('This message was deleted by a moderator');
  });
});
