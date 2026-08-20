import type { ReactNode } from 'react';
import { VerticalSplitPane } from '../VerticalSplitPane/VerticalSplitPane';
import type { MainPanelMode } from '../../workspace/mainPanelMode';

export const MAIN_PANEL_SPLIT_STORAGE_KEY = 'brmble-main-split';

interface MainPanelProps {
  mode: MainPanelMode;
  activityRegion: ReactNode | null;
  conversationRegion: ReactNode;
  gameSurface: ReactNode;
}

export function MainPanel({ mode, activityRegion, conversationRegion, gameSurface }: MainPanelProps) {
  if (mode === 'game') return <>{gameSurface}</>;

  return (
    <VerticalSplitPane
      top={activityRegion}
      storageKey={MAIN_PANEL_SPLIT_STORAGE_KEY}
      label="Resize channel activity and conversation"
    >
      {conversationRegion}
    </VerticalSplitPane>
  );
}
