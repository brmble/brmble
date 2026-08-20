export type MainPanelMode = 'game' | 'split';

export function selectMainPanelMode(input: {
  idleGameOpen: boolean;
  participatingMatchId: string | null;
}): MainPanelMode {
  return input.participatingMatchId !== null || input.idleGameOpen ? 'game' : 'split';
}
