import type { Channel } from '../types';

export type ReorderDirection = 'up' | 'down';

function compareChannels(a: Channel, b: Channel) {
  const aPosition = a.position ?? Number.MAX_SAFE_INTEGER;
  const bPosition = b.position ?? Number.MAX_SAFE_INTEGER;
  if (aPosition !== bPosition) {
    return aPosition - bPosition;
  }

  const byName = a.name.localeCompare(b.name);
  if (byName !== 0) {
    return byName;
  }

  return a.id - b.id;
}

export function sortChannels(channels: Channel[]) {
  return [...channels].sort(compareChannels);
}

export function getOrderedChildChannels(channels: Channel[], parentId: number | undefined) {
  return sortChannels(
    channels.filter(channel => (channel.parent ?? undefined) === parentId),
  );
}

export function getOrderedChannels(channels: Channel[]) {
  const ordered: Channel[] = [];
  const hasExplicitRoot = channels.some(channel => channel.id === 0);
  const visited = new Set<number>();

  const visit = (parentId: number | undefined) => {
    for (const channel of getOrderedChildChannels(channels, parentId)) {
      if (channel.id === parentId || visited.has(channel.id)) {
        continue;
      }

      visited.add(channel.id);
      ordered.push(channel);
      visit(channel.id);
    }
  };

  if (hasExplicitRoot) {
    for (const rootChannel of sortChannels(channels.filter(channel => channel.id === 0))) {
      visited.add(rootChannel.id);
      ordered.push(rootChannel);
    }
    visit(0);
  } else {
    visit(undefined);
  }

  return ordered;
}

function applySiblingPositions(siblings: Channel[]) {
  return new Map(
    siblings.map((channel, index) => [
      channel.id,
      { ...channel, position: index * 10 },
    ]),
  );
}

export function moveChannelWithinSiblings(channels: Channel[], channelId: number, direction: ReorderDirection) {
  const target = channels.find(channel => channel.id === channelId);
  if (!target) {
    return channels;
  }

  const parentId = target.parent ?? undefined;
  const siblings = getOrderedChildChannels(channels, parentId);
  const index = siblings.findIndex(channel => channel.id === channelId);
  const swapIndex = direction === 'up' ? index - 1 : index + 1;

  if (index < 0 || swapIndex < 0 || swapIndex >= siblings.length) {
    return channels;
  }

  const reordered = [...siblings];
  [reordered[index], reordered[swapIndex]] = [reordered[swapIndex], reordered[index]];
  const byId = applySiblingPositions(reordered);

  return getOrderedChannels(channels.map(channel => byId.get(channel.id) ?? channel));
}

export function buildReorderPayload(channels: Channel[], parentId: number | undefined) {
  const ordered = getOrderedChildChannels(channels, parentId);
  return {
    parentId: parentId ?? 0,
    channelIds: ordered.map(channel => channel.id),
    positions: ordered.map((_, index) => index * 10),
  };
}

export function canDropIntoSiblingGroup(
  draggedChannelId: number,
  targetChannelId: number,
  channels: Channel[],
) {
  const dragged = channels.find(channel => channel.id === draggedChannelId);
  const target = channels.find(channel => channel.id === targetChannelId);
  if (!dragged || !target) {
    return false;
  }

  return (dragged.parent ?? undefined) === (target.parent ?? undefined);
}

export function moveChannelToSiblingIndex(channels: Channel[], draggedChannelId: number, targetChannelId: number) {
  if (!canDropIntoSiblingGroup(draggedChannelId, targetChannelId, channels)) {
    return channels;
  }

  const dragged = channels.find(channel => channel.id === draggedChannelId);
  if (!dragged) {
    return channels;
  }

  const parentId = dragged.parent ?? undefined;
  const siblings = getOrderedChildChannels(channels, parentId);
  const fromIndex = siblings.findIndex(channel => channel.id === draggedChannelId);
  const toIndex = siblings.findIndex(channel => channel.id === targetChannelId);

  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
    return channels;
  }

  const reordered = [...siblings];
  const [moved] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, moved);
  const byId = applySiblingPositions(reordered);

  return getOrderedChannels(channels.map(channel => byId.get(channel.id) ?? channel));
}
