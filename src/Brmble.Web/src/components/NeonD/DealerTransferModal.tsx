import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../Icon/Icon';
import { Select } from '../Select';
import { getEquipmentDefinition } from './economy';
import type { Dealer, GameState, ZoneCityId } from './types';
import { getActiveDealerEntries, getAvailableZoneDealerSlots } from './zones';
import styles from './NeonD.module.css';

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  ));
}

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
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
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

  useEffect(() => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    return () => openerRef.current?.focus();
  }, []);

  const closeModal = useCallback(() => {
    openerRef.current?.focus();
    onClose();
  }, [onClose]);

  const handleKeyDown = useCallback((event: globalThis.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      closeModal();
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
  }, [closeModal]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const confirmTransfer = () => {
    if (isDestinationInitiated) {
      if (!selectedDealer || !fixedDestination) return;
      onConfirm(selectedDealer.dealer.id, fixedDestination.zoneId, fixedDestination.slotId);
    } else {
      if (!dealer || !selectedDestination) return;
      onConfirm(dealer.id, selectedDestination.zoneId, selectedDestination.slotId);
    }
    closeModal();
  };

  return (
    <div className="modal-overlay" data-testid="transfer-modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) closeModal(); }}>
      <div ref={dialogRef} className={`glass-panel animate-slide-up ${styles.dealerHiringModal}`} role="dialog" aria-modal="true" aria-labelledby="dealer-transfer-title" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
        <div className={`modal-header ${styles.dealerHiringHeader}`}>
          <div>
            <span className={styles.label}>Irreversible travel</span>
            <h2 id="dealer-transfer-title" className="heading-title modal-title">Transfer {selectedDealerForRisk?.name ?? 'dealer'}</h2>
          </div>
          <button type="button" className="modal-close" aria-label="Close transfer confirmation" onClick={closeModal}><Icon name="x" size={18} /></button>
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
