import { useMemo, useState } from 'react';
import { Icon } from '../Icon/Icon';
import { Select } from '../Select';
import { getEquipmentDefinition } from './economy';
import type { Dealer, GameState, ZoneCityId } from './types';
import { getAvailableZoneDealerSlots } from './zones';
import styles from './NeonD.module.css';

type DealerTransferModalProps = {
  state: GameState;
  dealer: Dealer;
  sourceZoneId: ZoneCityId;
  onConfirm: (destinationZoneId: ZoneCityId, destinationSlotId: string) => void;
  onClose: () => void;
};

export function DealerTransferModal({ state, dealer, sourceZoneId, onConfirm, onClose }: DealerTransferModalProps) {
  const [destination, setDestination] = useState('');
  const availableSlots = useMemo(
    () => getAvailableZoneDealerSlots(state).filter((slot) => slot.zoneId !== sourceZoneId),
    [sourceZoneId, state],
  );
  const destinationOptions = availableSlots.map(({ zoneId, slotId }) => {
    const zone = state.zones.find((candidate) => candidate.id === zoneId)!;
    const slotNumber = zone.dealerSlots.findIndex((slot) => slot.id === slotId) + 1;
    return { value: `${zoneId}:${slotId}`, label: `${zone.displayName} · Slot ${slotNumber}` };
  });
  const selectedDestination = availableSlots.find(({ zoneId, slotId }) => `${zoneId}:${slotId}` === destination) ?? null;

  const confirmTransfer = () => {
    if (!selectedDestination) return;
    onConfirm(selectedDestination.zoneId, selectedDestination.slotId);
    onClose();
  };

  return (
    <div className="modal-overlay" data-testid="transfer-modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className={`glass-panel animate-slide-up ${styles.dealerHiringModal}`} role="dialog" aria-modal="true" aria-labelledby="dealer-transfer-title" onClick={(event) => event.stopPropagation()}>
        <div className={`modal-header ${styles.dealerHiringHeader}`}>
          <div>
            <span className={styles.label}>Irreversible travel</span>
            <h2 id="dealer-transfer-title" className="heading-title modal-title">Transfer {dealer.name}</h2>
          </div>
          <button type="button" className="modal-close" aria-label="Close transfer confirmation" onClick={onClose}><Icon name="x" size={18} /></button>
        </div>
        <label className={styles.hiringDestinationField}>
          <span>Destination</span>
          <Select ariaLabel="Transfer destination" value={destination} onChange={setDestination} options={destinationOptions} placeholder="Select an available zone slot" />
        </label>
        <p>
          Travel time: <strong>2 minutes</strong>. This transfer cannot be cancelled.
        </p>
        <p>
          Each equipped item has an independent <strong>50% chance</strong> of being lost on arrival.
        </p>
        {dealer.equipmentIds.length > 0 ? (
          <ul className={styles.transferEquipmentList}>
            {dealer.equipmentIds.map((equipmentId) => (
              <li key={equipmentId}>{getEquipmentDefinition(equipmentId).name}</li>
            ))}
          </ul>
        ) : <p>No equipment is at risk.</p>}
        <button type="button" className={styles.dangerButton} disabled={!selectedDestination} onClick={confirmTransfer}>Confirm transfer</button>
      </div>
    </div>
  );
}
