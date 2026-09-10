import { Icon } from '../Icon/Icon';

/**
 * Rendered when a match's game type is not in GAME_TYPES. It exists so an
 * unrecognised type is visibly unsupported instead of being rendered as
 * Deathroll, which is what the old bare `else` did.
 */
export function UnsupportedGameBoard({ gameType, onClose }: { gameType: string; onClose: () => void }) {
  return (
    <section className="glass-panel animate-slide-up" data-testid="unsupported-game-board">
      <div className="modal-header">
        <h2 className="heading-title modal-title">Unsupported game</h2>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
          <Icon name="x" size={16} />
        </button>
      </div>
      <p>
        This Brmble version can&apos;t play <strong>{gameType}</strong>. Update Brmble to join this match.
      </p>
    </section>
  );
}
