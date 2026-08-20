import { useEffect, useMemo, useRef, useState } from 'react';
import { DealerRating } from './DealerRating';
import { getCaptainMainSaleRate, getCaptainMarginMultiplier } from './dealers';
import { getCaptainCost, getProductDefinition, getRecruitmentRefreshRemainingMs, getTerritoryCost, isCaptainVisible } from './economy';
import type { Captain, DealerSlotTarget, GameState } from './types';
import { getAvailableZoneDealerSlots, getUnassignedCaptains } from './zones';
import { Icon } from '../Icon/Icon';
import { Select } from '../Select';
import styles from './NeonD.module.css';
import { TalentLedger } from './TalentLedger';

type HiringTab = 'dealers' | 'captains';

type DealerHiringModalProps = {
  state: GameState;
  slotIndex: number;
  target?: DealerSlotTarget | null;
  initialTab?: HiringTab;
  rosterOnly?: boolean;
  onHireSeller: (sellerId: string, slotIndex: number, sellerKind: 'dealer' | 'captain') => void;
  onHireDealer?: (dealerId: string, target: DealerSlotTarget) => void;
  onRefreshDealers: () => void;
  onBuyTerritory?: () => void;
  onRecruitCaptain?: () => void;
  onUnlockZone?: () => void;
  onRenameCaptain: (captainId: string, name: string) => void;
  onClose: () => void;
};

const formatRefresh = (remainingMs: number) => remainingMs > 0
  ? `Refresh available in ${Math.ceil(remainingMs / 1000)}s`
  : 'Refresh dealers';

function CaptainCandidate({ captain, slotIndex, onHire, canHire, onRename, onViewTalents }: {
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
    } else setName(captain.name);
  };

  return (
    <article className={`${styles.dealerCard} ${styles.hiringCaptainCard}`}>
      <h4 className={styles.dealerName}><Icon name="crown" size={14} /> {captain.name}</h4>
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
        <button type="button" className={styles.talentPreviewButton} aria-label={`View talents for ${captain.name}`} onClick={onViewTalents}>
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
  state, slotIndex, target, initialTab, rosterOnly = false, onHireSeller, onHireDealer,
  onRefreshDealers, onBuyTerritory, onRecruitCaptain, onUnlockZone, onRenameCaptain, onClose,
}: DealerHiringModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const captainManagementVisible = isCaptainVisible(state);
  const [activeTab, setActiveTab] = useState<HiringTab>(
    captainManagementVisible ? (rosterOnly ? 'captains' : (initialTab ?? 'dealers')) : 'dealers',
  );
  const [destination, setDestination] = useState('');
  const [previewCaptainId, setPreviewCaptainId] = useState<string | null>(null);
  const refreshRemainingMs = getRecruitmentRefreshRemainingMs(state, Date.now());
  const isZoneMode = state.zones.length > 0;
  const availableSlots = useMemo(() => getAvailableZoneDealerSlots(state), [state]);
  const destinationOptions = availableSlots.map(({ zoneId, slotId }) => {
    const zone = state.zones.find((candidate) => candidate.id === zoneId)!;
    const slotNumber = zone.dealerSlots.findIndex((slot) => slot.id === slotId) + 1;
    return { value: `${zoneId}:${slotId}`, label: `${zone.displayName} · Slot ${slotNumber}` };
  });
  const selectedDestination = availableSlots.find(({ zoneId, slotId }) => `${zoneId}:${slotId}` === destination) ?? null;
  const firstLegacyVacancy = state.activeDealers.findIndex((seller) => seller === null);
  const resolvedTarget: DealerSlotTarget | null = target === undefined
    ? { kind: 'legacy', slotIndex }
    : target?.kind === 'legacy'
      ? firstLegacyVacancy === -1 ? null : { kind: 'legacy', slotIndex: firstLegacyVacancy }
      : target ?? (selectedDestination ? { kind: 'zone', ...selectedDestination } : null);
  const unassignedCaptains = isZoneMode
    ? getUnassignedCaptains(state)
    : state.captains.filter((captain) => !state.activeDealers.some((seller) => seller?.id === captain.id));
  const previewCaptain = previewCaptainId === null
    ? null
    : state.captains.find((captain) => captain.id === previewCaptainId) ?? null;
  const captainCost = getCaptainCost(state);
  const canRecruitCaptain = state.cash >= captainCost;

  useEffect(() => { dialogRef.current?.focus(); }, []);
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !previewCaptainId) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, previewCaptainId]);

  const hireDealer = (dealerId: string) => {
    if (!resolvedTarget) return;
    if (onHireDealer) onHireDealer(dealerId, resolvedTarget);
    else onHireSeller(dealerId, resolvedTarget.kind === 'legacy' ? resolvedTarget.slotIndex : slotIndex, 'dealer');
    onClose();
  };

  const title = rosterOnly
    ? 'Unassigned Captains'
    : captainManagementVisible ? 'Distribution hiring' : `Hire seller for Slot ${slotIndex + 1}`;

  return (
    <div className="modal-overlay" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} className={`glass-panel animate-slide-up ${styles.dealerHiringModal}`} role="dialog" aria-modal="true" aria-labelledby="dealer-hiring-title" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
        <div className={`modal-header ${styles.dealerHiringHeader}`}>
          <div>
            <span className={styles.label}>{rosterOnly ? 'Captain roster' : captainManagementVisible ? 'Dealer and Captain management' : 'Open seller slot'}</span>
            <h2 id="dealer-hiring-title" className="heading-title modal-title">{title}</h2>
          </div>
          <button type="button" className="modal-close" aria-label="Close hiring modal" onClick={onClose}><Icon name="x" size={18} /></button>
        </div>
        {captainManagementVisible && !rosterOnly ? (
          <div className={styles.hiringTabs} role="tablist" aria-label="Distribution hiring">
            <button type="button" role="tab" aria-selected={activeTab === 'dealers'} className={styles.hiringTab} onClick={() => setActiveTab('dealers')}>Dealers</button>
            <button type="button" role="tab" aria-selected={activeTab === 'captains'} className={styles.hiringTab} onClick={() => setActiveTab('captains')}>Captains</button>
          </div>
        ) : null}
        {activeTab === 'dealers' ? (
          <>
            {isZoneMode && target === null ? (
              <label className={styles.hiringDestinationField}>
                <span>Destination</span>
                <Select ariaLabel="Dealer destination" value={destination} onChange={setDestination} options={destinationOptions} placeholder="Select an empty zone slot" />
              </label>
            ) : null}
            <div className={styles.hiringDealerGrid}>
              {state.availableDealers.map((dealer) => (
                <article key={dealer.id} className={styles.dealerCard}>
                  <h3 className={styles.dealerName}>{dealer.name}</h3>
                  <DealerRating label="Volume" multiplier={dealer.volumeMultiplier} maxStars={5} />
                  <DealerRating label="Margin" multiplier={dealer.marginMultiplier} maxStars={5} />
                  <div className={styles.metricRow}><span>Product</span><strong>{getProductDefinition(dealer.selling).name}</strong></div>
                  <button type="button" className={styles.buyButton} disabled={!resolvedTarget} onClick={() => hireDealer(dealer.id)}>
                    Hire {dealer.name}{resolvedTarget?.kind === 'legacy' ? ` to Slot ${resolvedTarget.slotIndex + 1}` : ''}
                  </button>
                </article>
              ))}
            </div>
            <div className={styles.dealerHiringActions}>
              {!isZoneMode && onBuyTerritory ? (
                <button
                  type="button"
                  className={styles.unlockButton}
                  disabled={state.respect < getTerritoryCost(state.territoryLevel)}
                  onClick={onBuyTerritory}
                >
                  Territory {state.territoryLevel} · Capacity {state.activeDealers.length} - {Math.round(getTerritoryCost(state.territoryLevel)).toLocaleString()} Respect
                </button>
              ) : null}
              <button type="button" className={styles.unlockButton} disabled={refreshRemainingMs > 0} onClick={onRefreshDealers}><Icon name="refresh-cw" size={14} /> {formatRefresh(refreshRemainingMs)}</button>
            </div>
          </>
        ) : (
          <section aria-labelledby="captain-candidates-title">
            <div className={styles.captainHiringSummary}>
              <span>Next Captain — Cash saved</span>
              <strong>${Math.round(state.cash).toLocaleString()} / ${Math.round(captainCost).toLocaleString()}</strong>
              <button type="button" className={styles.buyButton} disabled={!canRecruitCaptain} onClick={onRecruitCaptain}>Recruit Captain</button>
              {isZoneMode && unassignedCaptains.length > 0 ? <button type="button" className={styles.unlockButton} onClick={onUnlockZone}>Open new zone</button> : null}
            </div>
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
        )}
      </div>
      {previewCaptain ? <TalentLedger captain={previewCaptain} readOnly onClose={() => setPreviewCaptainId(null)} onClaimLevel={() => undefined} onPurchaseTalent={() => undefined} onPromote={() => undefined} /> : null}
    </div>
  );
}
