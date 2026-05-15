import type { ChatMessage } from '../types';

export const SUPPORTED_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '😡'] as const;

export type SupportedReaction = typeof SUPPORTED_REACTIONS[number];
export type ReactionMap = NonNullable<ChatMessage['reactions']>;

function cloneWithoutEmptyEntries(reactions: ReactionMap): ReactionMap | undefined {
  const entries = Object.entries(reactions).filter(([, senders]) => senders.length > 0);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function addReactionSender(
  reactions: ReactionMap | undefined,
  emoji: string,
  senderId: string,
): ReactionMap {
  const currentSenders = reactions?.[emoji] ?? [];
  if (currentSenders.includes(senderId)) {
    return reactions ?? { [emoji]: currentSenders };
  }
  return {
    ...(reactions ?? {}),
    [emoji]: [...currentSenders, senderId],
  };
}

export function removeReactionSender(
  reactions: ReactionMap | undefined,
  emoji: string,
  senderId: string,
): ReactionMap | undefined {
  const currentSenders = reactions?.[emoji];
  if (!currentSenders?.includes(senderId)) return reactions;

  const next = {
    ...(reactions ?? {}),
    [emoji]: currentSenders.filter(id => id !== senderId),
  };
  return cloneWithoutEmptyEntries(next);
}

export function hasReactionFromSender(
  reactions: ReactionMap | undefined,
  emoji: string,
  senderId: string | undefined,
): boolean {
  if (!senderId) return false;
  return reactions?.[emoji]?.includes(senderId) ?? false;
}
