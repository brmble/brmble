import type { ReactNode } from 'react';
import './GameSurface.css';

/**
 * Centers a minigame board inside the main panel. A live match owns the whole
 * panel (it is not a dialog), so the board is laid out here rather than inside
 * `div.modal-overlay`.
 */
export function GameSurface({ children, fill = false }: { children: ReactNode; fill?: boolean }) {
  return <div className={`game-surface${fill ? ' game-surface--fill' : ''}`}>{children}</div>;
}
