import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from '../Icon/Icon';
import { getCaptainRemainingThreshold, isCaptainLevelUpAvailable } from './economy';
import { canPurchaseTalent, getTalentDefinition } from './talents';
import type { Captain, TalentPathId } from './types';
import styles from './NeonD.module.css';

export type TalentLedgerProps = {
  captain: Captain;
  onClose: () => void;
  onClaimLevel: () => void;
  onPurchaseTalent: (path: TalentPathId, row: 0 | 1 | 2) => void;
  onPromote: () => void;
};

const PATHS = [
  { id: 'red', label: 'Red path', identity: 'Margin-focused' },
  { id: 'yellow', label: 'Yellow path', identity: 'Network-focused' },
  { id: 'blue', label: 'Blue path', identity: 'Volume-focused' },
] as const satisfies readonly { id: TalentPathId; label: string; identity: string }[];

const formatMoney = (value: number) => `$${Math.round(value).toLocaleString()}`;

const formatEffect = (stat: string, value: number) =>
  `+${Math.round(value * 100)}% ${stat === 'secondarySales' ? 'secondary sales' : stat}`;

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  ));
}

export function TalentLedger({
  captain,
  onClose,
  onClaimLevel,
  onPurchaseTalent,
  onPromote,
}: TalentLedgerProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [promotionConfirming, setPromotionConfirming] = useState(false);
  const remainingThreshold = getCaptainRemainingThreshold(
    captain.level,
    captain.personalEarnings,
    captain.lastLevelUpEarnings,
  );
  const levelUpAvailable = isCaptainLevelUpAvailable(
    captain.level,
    captain.personalEarnings,
    captain.lastLevelUpEarnings,
  );
  const promotionAvailable = captain.kingpinAvailable && captain.talentPoints > 0;

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && !promotionConfirming) {
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const focusable = getFocusableElements(dialogRef.current);
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
    const nextIndex = event.shiftKey
      ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
      : (currentIndex < 0 || currentIndex === focusable.length - 1 ? 0 : currentIndex + 1);
    event.preventDefault();
    focusable[nextIndex].focus();
  };

  return (
    <div
      className={styles.talentLedgerBackdrop}
      data-testid="talent-ledger-backdrop"
      onClick={(event) => {
        if (!promotionConfirming && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={styles.talentLedgerModal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="talent-ledger-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className={styles.talentLedgerHeader}>
          <div>
            <p className={styles.talentLedgerKicker}>Captain’s progression</p>
            <h2 id="talent-ledger-title" className="heading-title">Captain’s Talent Ledger — {captain.name}</h2>
            <p className={styles.talentLedgerSubtitle}>Choose a lane. Claim every rank yourself.</p>
          </div>
          <button
            type="button"
            className={styles.modalCloseButton}
            aria-label={`Close ${captain.name} talent ledger`}
            onClick={onClose}
          >
            <Icon name="x" size={18} />
          </button>
        </div>

        <div className={styles.talentLedgerSummary}>
          <span>Level <strong>{captain.level}</strong></span>
          <span>Personal earnings <strong>{formatMoney(captain.personalEarnings)}</strong></span>
          <span>Talent points: <strong>{captain.talentPoints}</strong></span>
          {remainingThreshold !== null ? (
            <span className={styles.talentLedgerStatus}>{formatMoney(remainingThreshold)} to level</span>
          ) : (
            <span className={styles.talentLedgerStatus}>Maximum level reached</span>
          )}
          {levelUpAvailable ? (
            <button type="button" className={styles.buyButton} onClick={onClaimLevel}>
              Level Up
            </button>
          ) : null}
        </div>

        <div className={styles.talentLedgerTree}>
          {PATHS.map((path) => (
            <section key={path.id} className={`${styles.talentLane} ${styles[`talentLane${path.id[0].toUpperCase()}${path.id.slice(1)}`]}`} aria-label={path.label} role="group">
              <header className={styles.talentLaneHeader}>
                <h3 className="heading-section">{path.label}</h3>
                <span>{path.identity}</span>
              </header>
              {[0, 1, 2].map((row) => {
                const definition = getTalentDefinition(path.id, row as 0 | 1 | 2);
                const currentRanks = captain.talentRanks[path.id][row];
                const canPurchase = canPurchaseTalent(captain, path.id, row as 0 | 1 | 2);
                const isComplete = currentRanks === definition.maxRanks;
                const requirement = row === 0
                  ? 'Requires an available talent point'
                  : `Requires ${getTalentDefinition(path.id, (row - 1) as 0 | 1 | 2).maxRanks}/${getTalentDefinition(path.id, (row - 1) as 0 | 1 | 2).maxRanks} ranks in the preceding ${getTalentDefinition(path.id, (row - 1) as 0 | 1 | 2).label} node`;
                return (
                  <div key={definition.row} className={styles.talentNodeSlot}>
                    <button
                      type="button"
                      className={`${styles.talentNode} ${isComplete ? styles.talentNodeComplete : ''}`}
                      disabled={!canPurchase}
                      aria-label={`${definition.label}, ${currentRanks}/${definition.maxRanks}, ${canPurchase ? 'available' : isComplete ? 'complete' : `locked. ${requirement}`}`}
                      onClick={() => onPurchaseTalent(path.id, row as 0 | 1 | 2)}
                    >
                      <span className={styles.talentNodeLabel}>{definition.label}</span>
                      <strong>{currentRanks}/{definition.maxRanks}</strong>
                      <span className={styles.talentNodeEffect}>
                        {definition.rankBonuses.map((bonus) => formatEffect(definition.stat, bonus)).join(' · ')}
                      </span>
                    </button>
                    {row < 2 ? <span className={styles.talentLaneArrow} aria-hidden="true">↓</span> : null}
                  </div>
                );
              })}
            </section>
          ))}
        </div>

        <div className={styles.kingpinNodeSection}>
          <div className={styles.kingpinNodeCopy}>
            <span className={styles.talentLedgerKicker}>Shared promotion</span>
            <h3 className="heading-section">Kingpin</h3>
            <p>{promotionAvailable ? 'Spend the 10th point to retire this Captain permanently.' : 'Complete one lane and claim Level 10 to unlock promotion.'}</p>
          </div>
          <button
            type="button"
            className={styles.dangerButton}
            disabled={!promotionAvailable}
            aria-label={promotionAvailable ? 'Promote to Kingpin' : 'Promote to Kingpin, locked'}
            onClick={() => setPromotionConfirming(true)}
          >
            Promote to Kingpin
          </button>
        </div>

        {promotionConfirming ? (
          <div className={styles.talentPromotionConfirm} role="alertdialog" aria-modal="true" aria-label="Permanent Kingpin promotion">
            <h3 className="heading-section">Promote permanently?</h3>
            <p>{captain.name} will leave the Captain roster and cannot return.</p>
            <div className={styles.actionStack}>
              <button type="button" className={styles.dangerButton} onClick={() => { setPromotionConfirming(false); onPromote(); }}>
                Confirm Kingpin promotion
              </button>
              <button type="button" className={styles.unlockButton} onClick={() => setPromotionConfirming(false)}>
                Keep Captain
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
