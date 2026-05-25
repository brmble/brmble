import type { Channel } from '../types';

export function compareChannelsByMumbleOrder(a: Channel, b: Channel): number {
  const positionDiff = (a.position ?? 0) - (b.position ?? 0);
  if (positionDiff !== 0) return positionDiff;

  const nameDiff = a.name.localeCompare(b.name);
  if (nameDiff !== 0) return nameDiff;

  return a.id - b.id;
}

export function sortChannelsByMumbleOrder<T extends Channel>(channels: T[]): T[] {
  return [...channels].sort(compareChannelsByMumbleOrder);
}
