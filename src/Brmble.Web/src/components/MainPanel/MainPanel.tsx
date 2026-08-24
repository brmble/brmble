import type { ReactNode } from 'react';
import { VerticalSplitPane } from '../VerticalSplitPane/VerticalSplitPane';
import type { MainPanelMode } from '../../workspace/mainPanelMode';
import './MainPanel.css';

export const MAIN_PANEL_SPLIT_STORAGE_KEY = 'brmble-main-split';

interface MainPanelProps {
  mode: MainPanelMode;
  activityRegion: ReactNode | null;
  conversationRegion: ReactNode;
  gameSurface: ReactNode;
}

export function MainPanel({ mode, activityRegion, conversationRegion, gameSurface }: MainPanelProps) {
  const gameOwnsPanel = mode === 'game';

  return (
    <>
      {/*
        Persistent layer: the split stays mounted while a game owns the panel so chat,
        paint and screen share reappear intact. While it is covered it is inert and out
        of the accessibility tree, so it is neither focusable nor announced.
      */}
      <div
        data-main-panel-layer="split"
        className={`main-panel__split${gameOwnsPanel ? ' main-panel__split--hidden' : ''}`}
        inert={gameOwnsPanel}
        aria-hidden={gameOwnsPanel || undefined}
      >
        <VerticalSplitPane
          top={activityRegion}
          storageKey={MAIN_PANEL_SPLIT_STORAGE_KEY}
          label="Resize channel activity and conversation"
        >
          {conversationRegion}
        </VerticalSplitPane>
      </div>

      {gameOwnsPanel && (
        <div data-main-panel-layer="game" className="main-panel__game">
          {gameSurface}
        </div>
      )}
    </>
  );
}
