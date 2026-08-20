import { useMemo, useState } from 'react';
import { Icon } from '../Icon/Icon';
import { Select } from '../Select';
import { getEquipmentDefinition } from './economy';
import type { Dealer, GameState, ZoneCityId } from './types';
import { getActiveDealerEntries, getAvailableZoneDealerSlots } from './zones';
import styles from './NeonD.module.css';

type DealerTransferModalProps = {
  state: GameState;
  dealer?: Dealer;
  sourceZoneId?: ZoneCityId;
  destination?: { zoneId: ZoneCityId; slotId: string };
  onConfirm: (dealerId: string, destinationZoneId: ZoneCityId, destinationSlotId: string) => void;
  onClose: () => void;
};

export function DealerTransferModal({ state, dealer, sourceZoneId, destination: fixedDestination, onConfirm, onClose }: DealerTransferModalProps) {
  const [destination, setDestination] = useState('');
  const [dealerId, setDealerId] = useState('');
  const isDestinationInitiated = fixedDestination !== undefined;
  const availableSlots = useMemo(
    () => getAvailableZoneDealerSlots(state).filter((slot) => slot.zoneId !== sourceZoneId),
    [sourceZoneId, state],
  );
  const availableDealers = useMemo(
    () => !fixedDestination ? [] : getActiveDealerEntries(state).filter((entry) =>
      entry.zoneId !== fixedDestination.zoneId && !entry.dealer.isArrested,
    ),
    [fixedDestination, state],
  );
  const destinationOptions = availableSlots.map(({ zoneId, slotId }) => {
    const zone = state.zones.find((candidate) => candidate.id === zoneId)!;
    const slotNumber = zone.dealerSlots.findIndex((slot) => slot.id === slotId) + 1;
    return { value: `${zoneId}:${slotId}`, label: `${zone.displayName} · Slot ${slotNumber}` };
  });
  const dealerOptions = availableDealers.map((entry) => {
    const zone = state.zones.find((candidate) => candidate.id === entry.zoneId)!;
    return { value: entry.dealer.id, label: `${entry.dealer.name} · ${zone.displayName}` };
  });
  const selectedDestination = availableSlots.find(({ zoneId, slotId }) => `${zoneId}:${slotId}` === destination) ?? null;
  const selectedDealer = availableDealers.find((entry) => entry.dealer.id === dealerId) ?? null;
  const selectedDealerForRisk = isDestinationInitiated ? selectedDealer?.dealer : dealer;
  const fixedDestinationZone = fixedDestination
    ? state.zones.find((zone) => zone.id === fixedDestination.zoneId) ?? null
    : null;
  const fixedDestinationSlotNumber = fixedDestinationZone && fixedDestination
    ? fixedDestinationZone.dealerSlots.findIndex((slot) => slot.id === fixedDestination.slotId) + 1
    : 0;

  const confirmTransfer = () => {
    if (isDestinationInitiated) {
      if (!selectedDealer || !fixedDestination) return;
      onConfirm(selectedDealer.dealer.id, fixedDestination.zoneId, fixedDestination.slotId);
    } else {
      if (!dealer || !selectedDestination) return;
      onConfirm(dealer.id, selectedDestination.zoneId, selectedDestination.slotId);
    }
    onClose();
  };

  return (
    <div className="modal-overlay" data-testid="transfer-modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className={`glass-panel animate-slide-up ${styles.dealerHiringModal}`} role="dialog" aria-modal="true" aria-labelledby="dealer-transfer-title" onClick={(event) => event.stopPropagation()}>
        <div className={`modal-header ${styles.dealerHiringHeader}`}>
          <div>
            <span className={styles.label}>Irreversible travel</span>
            <h2 id="dealer-transfer-title" className="heading-title modal-title">Transfer {selectedDealerForRisk?.name ?? 'dealer'}</h2>
          </div>
          <button type="button" className="modal-close" aria-label="Close transfer confirmation" onClick={onClose}><Icon name="x" size={18} /></button>
        </div>
        {isDestinationInitiated ? (
          <>
            <label className={styles.hiringDestinationField}>
              <span>Dealer</span>
              <Select ariaLabel="Dealer to transfer" value={dealerId} onChange={setDealerId} options={dealerOptions} placeholder="Select an active dealer" />
            </label>
            <p>Destination: <strong>{fixedDestinationZone?.displayName} · Slot {fixedDestinationSlotNumber}</strong></p>
          </>
        ) : (
          <label className={styles.hiringDestinationField}>
            <span>Destination</span>
            <Select ariaLabel="Transfer destination" value={destination} onChange={setDestination} options={destinationOptions} placeholder="Select an available zone slot" />
          </label>
        )}
        <p>
          Travel time: <strong>2 minutes</strong>. This transfer cannot be cancelled.
        </p>
        <p>
          Each equipped item has an independent <strong>50% chance</strong> of being lost on arrival.
        </p>
        {selectedDealerForRisk && selectedDealerForRisk.equipmentIds.length > 0 ? (
          <ul className={styles.transferEquipmentList}>
            {selectedDealerForRisk.equipmentIds.map((equipmentId) => (
              <li key={equipmentId}>{getEquipmentDefinition(equipmentId).name}</li>
            ))}
          </ul>
        ) : selectedDealerForRisk ? <p>No equipment is at risk.</p> : null}
        <button type="button" className={styles.dangerButton} disabled={isDestinationInitiated ? !selectedDealer : !selectedDestination} onClick={confirmTransfer}>Confirm transfer</button>
      </div>
    </div>
  );
}
