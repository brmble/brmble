export type ChannelActivityKind = 'screen-share' | 'paint';

export function selectStage(input: {
  available: ChannelActivityKind[];
  explicit: ChannelActivityKind | null;
  previous: ChannelActivityKind | null;
}): ChannelActivityKind | null {
  if (input.available.length === 0) return null;
  if (input.explicit && input.available.includes(input.explicit)) return input.explicit;
  if (input.previous && input.available.includes(input.previous)) return input.previous;
  return input.available[0];
}
