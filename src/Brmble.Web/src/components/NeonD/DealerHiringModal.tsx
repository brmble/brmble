import { useEffect, useRef, useState } from 'react';
import { DealerRating } from './DealerRating';
import { getCaptainMainSaleRate, getCaptainMarginMultiplier } from './dealers';
import { getProductDefinition } from './economy';
import { getRecruitmentRefreshRemainingMs } from './economy';
import type { Captain, GameState } from './types';
import { Icon } from '../Icon/Icon';
import styles from './NeonD.module.css';
import { TalentLedger } from './TalentLedger';

type DealerHiringModalProps = {
  state: GameState;
  slotIndex: number;
  rosterOnly?: boolean;
  onHireSeller: (sellerId: string, slotIndex: number, sellerKind: 'dealer' | 'captain') => void;
  onRefreshDealers: () => void;
  onRenameCaptain: (captainId: string, name: string) => void;
  onClose: () => void;
};

const formatRefresh = (remainingMs: number) => remainingMs > 0
  ? `Refresh available in ${Math.ceil(remainingMs / 1000)}s`
  : 'Refresh dealers';

function CaptainCandidate({
  captain,
  slotIndex,
  onHire,
  canHire,
  onRename,
  onViewTalents,
}: {
  captain: Captain;
  slotIndex: number;
  onHire: () => void;
  canHire: boolean;
  onRename: (name: string) => void;
  onViewTalents: () => void;
}) {
  const [name, setName] = useState(captain.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelBlurRef = useRef(false);
  const commit = () => {
    const trimmed = name.trim();
    if (trimmed) {
      setName(trimmed);
      onRename(trimmed);
    } else {
      setName(captain.name);
    }
  };
  return (
    <article className={`${styles.dealerCard} ${styles.hiringCaptainCard}`}>
      <h4 className={styles.dealerName}><span aria-label="Captain crown">♛</span> {captain.name}</h4>
      <label className={styles.captainRenameField}>
        <span>Name</span>
        <input
          ref={inputRef}
          className="brmble-input"
          value={name}
          aria-label={`Name for ${captain.name}`}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => {
            if (cancelBlurRef.current) {
              cancelBlurRef.current = false;
              return;
            }
            commit();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              inputRef.current?.blur();
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              cancelBlurRef.current = true;
              setName(captain.name);
              inputRef.current?.blur();
            }
          }}
        />
      </label>
      <DealerRating label="Volume" multiplier={getCaptainMainSaleRate(captain) / 3} maxStars={6} />
      <DealerRating label="Margin" multiplier={getCaptainMarginMultiplier(captain)} maxStars={6} />
      <div className={styles.metricRow}><span>Product</span><strong>{getProductDefinition(captain.selling).name}</strong></div>
      <div className={styles.metricRow}><span>Level</span><strong>Level {captain.level}</strong></div>
      <div className={styles.metricRow}>
        <span>Talent</span>
        <button
          type="button"
          className={styles.talentPreviewButton}
          aria-label={`View talents for ${captain.name}`}
          onClick={onViewTalents}
        >
          View talents
        </button>
      </div>
      {canHire ? (
        <button type="button" className={styles.buyButton} onClick={onHire}>
          Hire {captain.name} to Slot {slotIndex + 1}
        </button>
      ) : null}
    </article>
  );
}

export function DealerHiringModal({
  state,
  slotIndex,
  rosterOnly = false,
  onHireSeller,
  onRefreshDealers,
  onRenameCaptain,
  onClose,
}: DealerHiringModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const refreshRemainingMs = getRecruitmentRefreshRemainingMs(state, Date.now());
  const assignedCaptainIds = new Set(
    state.activeDealers.flatMap((seller) => seller && 'talentPoints' in seller ? [seller.id] : []),
  );
  const unassignedCaptains = state.captains.filter((captain) => !assignedCaptainIds.has(captain.id));
  const [previewCaptainId, setPreviewCaptainId] = useState<string | null>(null);
  const previewCaptain = previewCaptainId === null
    ? null
    : state.captains.find((captain) => captain.id === previewCaptainId) ?? null;

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const title = rosterOnly ? 'Unassigned Captains' : `Hire seller for Slot ${slotIndex + 1}`;

  return (
    <div
      className="modal-overlay"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        className={`glass-panel animate-slide-up ${styles.dealerHiringModal}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dealer-hiring-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={`modal-header ${styles.dealerHiringHeader}`}>
          <div>
            <span className={styles.label}>{rosterOnly ? 'Captain roster' : 'Open seller slot'}</span>
            <h2 id="dealer-hiring-title" className="heading-title modal-title">{title}</h2>
          </div>
          <button type="button" className="modal-close" aria-label="Close hiring modal" onClick={onClose}>
            <Icon name="x" size={18} />
          </button>
        </div>
        {!rosterOnly ? (
          <>
            <div className={styles.hiringDealerGrid}>
              {state.availableDealers.map((dealer) => (
                <article key={dealer.id} className={styles.dealerCard}>
                  <h3 className={styles.dealerName}>{dealer.name}</h3>
                  <DealerRating label="Volume" multiplier={dealer.volumeMultiplier} maxStars={5} />
                  <DealerRating label="Margin" multiplier={dealer.marginMultiplier} maxStars={5} />
                  <div className={styles.metricRow}><span>Product</span><strong>{getProductDefinition(dealer.selling).name}</strong></div>
                  <button type="button" className={styles.buyButton} onClick={() => { onHireSeller(dealer.id, slotIndex, 'dealer'); onClose(); }}>
                    Hire {dealer.name} to Slot {slotIndex + 1}
                  </button>
                </article>
              ))}
            </div>
            <div className={styles.dealerHiringActions}>
              <button type="button" className={styles.unlockButton} disabled={refreshRemainingMs > 0} onClick={onRefreshDealers}>
                <Icon name="refresh-cw" size={14} /> {formatRefresh(refreshRemainingMs)}
              </button>
            </div>
          </>
        ) : null}
        <section aria-labelledby="captain-candidates-title">
          <h3 id="captain-candidates-title" className={styles.columnHeader}>Unassigned Captains</h3>
          {unassignedCaptains.length > 0 ? (
            <div className={styles.hiringCaptainGrid}>
              {unassignedCaptains.map((captain) => (
                <CaptainCandidate
                  key={captain.id}
                  captain={captain}
                  slotIndex={slotIndex}
                  onHire={() => { onHireSeller(captain.id, slotIndex, 'captain'); onClose(); }}
                  canHire={!rosterOnly}
                  onRename={(name) => onRenameCaptain(captain.id, name)}
                  onViewTalents={() => setPreviewCaptainId(captain.id)}
                />
              ))}
            </div>
          ) : <p className={styles.label}>All Captains are assigned.</p>}
        </section>
      </div>
      {previewCaptain ? (
        <TalentLedger
          captain={previewCaptain}
          readOnly
          onClose={() => setPreviewCaptainId(null)}
          onClaimLevel={() => undefined}
          onPurchaseTalent={() => undefined}
          onPromote={() => undefined}
        />
      ) : null}
    </div>
  );
}
