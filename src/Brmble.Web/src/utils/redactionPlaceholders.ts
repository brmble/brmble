export interface RedactionPlaceholder {
  text: string;
  reason: string;
}

export function getRedactionPlaceholder(event: { unsigned?: { redacted_because?: { content?: { reason?: string } } }; getUnsigned?: () => { redacted_because?: { content?: { reason?: string } } } }): RedactionPlaceholder | null {
  const unsigned = event.unsigned ?? event.getUnsigned?.();
  const reason = unsigned?.redacted_because?.content?.reason;
  if (reason === 'brmble:moderator-delete') {
    return { text: 'This message was deleted by a moderator', reason };
  }
  if (reason === 'brmble:self-delete') {
    return { text: 'This message was deleted', reason };
  }
  if (unsigned?.redacted_because) {
    return { text: 'This message was deleted', reason: reason ?? 'redacted' };
  }
  return null;
}
