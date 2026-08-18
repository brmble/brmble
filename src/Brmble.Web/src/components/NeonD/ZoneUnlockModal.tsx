import { useEffect, useMemo, useRef, useState } from 'react';
import { ZONE_CITY_CATALOG } from './constants';
import { DealerRating } from './DealerRating';
import { getCaptainMainSaleRate, getCaptainMarginMultiplier } from './dealers';
import { getProductDefinition, getZoneUnlockCost } from './economy';
import type { GameState, ZoneCityId } from './types';
import { getUnassignedCaptains } from './zones';
import { Icon } from '../Icon/Icon';
import { Select } from '../Select';
import styles from './NeonD.module.css';
import { TalentLedger } from './TalentLedger';

export type ZoneUnlockModalProps = {
  state: GameState;
  onConfirm: (cityId: ZoneCityId, captainId: string) => void;
  onClose: () => void;
};

export function ZoneUnlockModal({ state, onConfirm, onClose }: ZoneUnlockModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [selectedCityId, setSelectedCityId] = useState('');
  const [selectedCaptainId, setSelectedCaptainId] = useState('');
  const [isTalentLedgerOpen, setTalentLedgerOpen] = useState(false);
  const cost = getZoneUnlockCost(state);
  const unassignedCaptains = getUnassignedCaptains(state);
  const usedCityIds = useMemo(() => new Set(state.zones.map((zone) => zone.id)), [state.zones]);
  const cityOptions = ZONE_CITY_CATALOG
    .filter((city) => !usedCityIds.has(city.id))
    .map((city) => ({ value: city.id, label: city.name, disabled: state.respect < cost || unassignedCaptains.length === 0 }));
  const selectedCity = ZONE_CITY_CATALOG.find((city) => city.id === selectedCityId) ?? null;
  const selectedCaptain = unassignedCaptains.find((captain) => captain.id === selectedCaptainId) ?? null;

  useEffect(() => { dialogRef.current?.focus(); }, []);
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isTalentLedgerOpen) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isTalentLedgerOpen, onClose]);

  return (
    <div className="modal-overlay" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} className={`glass-panel animate-slide-up ${styles.zoneUnlockModal}`} role="dialog" aria-modal="true" aria-labelledby="zone-unlock-title" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <span className={styles.label}>Respect expansion</span>
            <h2 id="zone-unlock-title" className="heading-title modal-title">Open new zone</h2>
          </div>
          <button type="button" className="modal-close" aria-label="Close zone unlock" onClick={onClose}><Icon name="x" size={18} /></button>
        </div>
        <p className={styles.label}>Current cost: {Math.round(cost).toLocaleString()} Respect</p>
        <label className={styles.hiringDestinationField}>
          <span>City</span>
          <Select ariaLabel="City" value={selectedCityId} onChange={setSelectedCityId} options={cityOptions} placeholder="Select a city" />
        </label>
        <label className={styles.hiringDestinationField}>
          <span>Captain</span>
          <Select ariaLabel="Captain" value={selectedCaptainId} onChange={setSelectedCaptainId} options={unassignedCaptains.map((captain) => ({ value: captain.id, label: captain.name }))} placeholder="Select an unassigned Captain" />
        </label>
        {selectedCaptain ? (
          <article className={`${styles.dealerCard} ${styles.zoneCaptainPreview}`}>
            <h3 className={styles.dealerName}>♛ {selectedCaptain.name}</h3>
            <DealerRating label="Volume" multiplier={getCaptainMainSaleRate(selectedCaptain) / 3} maxStars={6} />
            <DealerRating label="Margin" multiplier={getCaptainMarginMultiplier(selectedCaptain)} maxStars={6} />
            <div className={styles.metricRow}><span>Product</span><strong>{getProductDefinition(selectedCaptain.selling).name}</strong></div>
            <div className={styles.metricRow}><span>Level</span><strong>Level {selectedCaptain.level}</strong></div>
            <button type="button" className={styles.talentPreviewButton} onClick={() => setTalentLedgerOpen(true)}>View talents</button>
          </article>
        ) : null}
        <button type="button" className={styles.buyButton} disabled={!selectedCityId || !selectedCaptainId || state.respect < cost} onClick={() => onConfirm(selectedCityId as ZoneCityId, selectedCaptainId)}>
          Open {selectedCity?.name ?? 'city'} for {Math.round(cost).toLocaleString()} Respect
        </button>
      </div>
      {isTalentLedgerOpen && selectedCaptain ? <TalentLedger captain={selectedCaptain} readOnly onClose={() => setTalentLedgerOpen(false)} onClaimLevel={() => undefined} onPurchaseTalent={() => undefined} onPromote={() => undefined} /> : null}
    </div>
  );
}
