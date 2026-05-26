import { describe, expect, it } from 'vitest';
import { buildReorderPayload, canDropIntoSiblingGroup, getOrderedChannels, getOrderedChildChannels, moveChannelWithinSiblings } from './channelOrder';

describe('getOrderedChildChannels', () => {
  it('sorts siblings by position before name and id', () => {
    const ordered = getOrderedChildChannels(
      [
        { id: 20, name: 'Bravo', parent: 0, position: 2 },
        { id: 10, name: 'Alpha', parent: 0, position: 1 },
        { id: 30, name: 'Zulu', parent: 0, position: 2 },
      ],
      0,
    );

    expect(ordered.map(channel => channel.id)).toEqual([10, 20, 30]);
  });
});

describe('getOrderedChannels', () => {
  it('keeps a root channel with parent 0 and includes its visible children', () => {
    const ordered = getOrderedChannels([
      { id: 0, name: 'Root', parent: 0, position: 0 },
      { id: 20, name: 'Raid', parent: 0, position: 1 },
      { id: 10, name: 'General', parent: 0, position: 0 },
    ]);

    expect(ordered.map(channel => channel.id)).toEqual([0, 10, 20]);
  });
});

const channels = [
  { id: 0, name: 'Root', position: 0 },
  { id: 10, name: 'General', parent: 0, position: 0 },
  { id: 20, name: 'Raid', parent: 0, position: 1 },
  { id: 30, name: 'Off Topic', parent: 0, position: 2 },
  { id: 40, name: 'Nested', parent: 10, position: 0 },
];

describe('moveChannelWithinSiblings', () => {
  it('moves only within the current parent group', () => {
    const moved = moveChannelWithinSiblings(channels, 20, 'up');
    expect(moved.filter(channel => channel.parent === 0).map(channel => channel.id)).toEqual([20, 10, 30]);
    expect(moved.find(channel => channel.id === 40)?.position).toBe(0);
  });
});

describe('buildReorderPayload', () => {
  it('assigns distinct positions for each sibling in display order', () => {
    const payload = buildReorderPayload([
      { id: 20, name: 'Raid', parent: 0, position: 0 },
      { id: 10, name: 'General', parent: 0, position: 1 },
      { id: 30, name: 'Off Topic', parent: 0, position: 2 },
    ], 0);

    expect(payload).toEqual({
      parentId: 0,
      channelIds: [20, 10, 30],
      positions: [0, 10, 20],
    });
  });
});

describe('canDropIntoSiblingGroup', () => {
  it('allows drops only within the same parent group', () => {
    expect(canDropIntoSiblingGroup(10, 20, channels)).toBe(true);
    expect(canDropIntoSiblingGroup(10, 40, channels)).toBe(false);
  });
});
