/**
 * The kind is 'spectate', NOT 'game': MainPanelMode is already 'game' | 'split'
 * where 'game' means PARTICIPATING. Game mode is entered by participating in a
 * game, never by spectating one (docs/UI_GUIDE.md), so two 'game' values meaning
 * opposite things would be a trap. The user-facing chip label is 'Game'.
 */
export type ChannelActivityKind = 'screen-share' | 'paint' | 'spectate';

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
