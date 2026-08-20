export type Conversation =
  | { kind: 'channel'; channelId: string }
  | { kind: 'dm'; contactId: string };

export function conversationKey(conversation: Conversation): string {
  return conversation.kind === 'channel'
    ? `channel:${conversation.channelId}`
    : `dm:${conversation.contactId}`;
}

export function sameConversation(a: Conversation, b: Conversation): boolean {
  return conversationKey(a) === conversationKey(b);
}

export function isChannelConversation(
  conversation: Conversation,
): conversation is { kind: 'channel'; channelId: string } {
  return conversation.kind === 'channel';
}
