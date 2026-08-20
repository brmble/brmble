import { useEffect, useRef, useState } from 'react';
import { getCaptainMainSaleRate, getCaptainMarginMultiplier } from './dealers';
import { getProductDefinition } from './economy';
import { TalentLedger } from './TalentLedger';
import type { Captain } from './types';
import styles from './NeonD.module.css';

export type AmsterdamCaptainSelectionModalProps = {
  captains: Captain[];
  onConfirm: (captainId: string) => void;
};

const formatMultiplier = (value: number) => `${value.toFixed(2)}x`;

export function AmsterdamCaptainSelectionModal({
  captains,
  onConfirm,
}: AmsterdamCaptainSelectionModalProps) {
  const [selectedCaptainId, setSelectedCaptainId] = useState(captains[0]?.id ?? '');
  const [isTalentLedgerOpen, setIsTalentLedgerOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const selectedCaptain = captains.find((captain) => captain.id === selectedCaptainId) ?? null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(
      'input:not([disabled]), button:not([disabled])',
    ));
    const first = focusable()[0];
    first?.focus();

    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || event.defaultPrevented) return;
      const elements = focusable();
      const firstElement = elements[0];
      const lastElement = elements[elements.length - 1];
      if (!firstElement || !lastElement) return;

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener('keydown', trapFocus);
    return () => document.removeEventListener('keydown', trapFocus);
  }, []);

  return (
    <>
      <div className="modal-overlay" data-testid="amsterdam-captain-selection-backdrop">
        <div
          ref={dialogRef}
          className={`glass-panel animate-slide-up ${styles.captainSelectionModal}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="amsterdam-captain-title"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === 'Escape') event.stopPropagation();
          }}
        >
          <div className="modal-header">
            <div>
              <h2 id="amsterdam-captain-title" className="heading-title modal-title">
                Choose Amsterdam’s Captain
              </h2>
              <p className="modal-subtitle">
                Every other owned Captain will remain unassigned until you open another zone.
              </p>
            </div>
          </div>

          <div className={styles.captainSelectionGrid}>
            {captains.map((captain) => {
              const isSelected = selectedCaptainId === captain.id;
              return (
                <label key={captain.id} className={styles.captainSelectionCard}>
                  <input
                    type="radio"
                    name="amsterdam-captain"
                    value={captain.id}
                    checked={isSelected}
                    onChange={() => setSelectedCaptainId(captain.id)}
                  />
                  <span className={styles.captainSelectionCardCopy}>
                    <strong>{captain.name}</strong>
                    <span>{getProductDefinition(captain.selling).name}</span>
                    <span>Level {captain.level}</span>
                    <span>Volume {formatMultiplier(getCaptainMainSaleRate(captain) / 3)}</span>
                    <span>Margin {formatMultiplier(getCaptainMarginMultiplier(captain))}</span>
                  </span>
                </label>
              );
            })}
          </div>

          {selectedCaptain ? (
            <button
              type="button"
              className={styles.unlockButton}
              onClick={() => setIsTalentLedgerOpen(true)}
            >
              Preview {selectedCaptain.name} talent ledger
            </button>
          ) : null}

          <button
            type="button"
            className={styles.buyButton}
            disabled={!selectedCaptainId}
            onClick={() => onConfirm(selectedCaptainId)}
          >
            Assign Captain to Amsterdam
          </button>
        </div>
      </div>

      {isTalentLedgerOpen && selectedCaptain ? (
        <TalentLedger
          captain={selectedCaptain}
          readOnly
          onClose={() => setIsTalentLedgerOpen(false)}
          onClaimLevel={() => undefined}
          onPurchaseTalent={() => undefined}
          onPromote={() => undefined}
        />
      ) : null}
    </>
  );
}
