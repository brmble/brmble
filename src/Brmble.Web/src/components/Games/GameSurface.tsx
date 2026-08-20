import type { ReactNode } from 'react';
import './GameSurface.css';

/**
 * Centers a minigame board inside the main panel. A live match owns the whole
 * panel (it is not a dialog), so the board is laid out here rather than inside
 * `div.modal-overlay`.
 */
export function GameSurface({ children }: { children: ReactNode }) {
  return <div className="game-surface">{children}</div>;
}
