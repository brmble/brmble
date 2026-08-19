import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createBaseGameState } from '../constants';
import { DealerTransferModal } from '../DealerTransferModal';
import { makeReferenceDealer } from './testFixtures';

const dealer = makeReferenceDealer({
  id: 'transfer-dealer',
  name: 'Transfer Dealer',
  equipmentIds: ['baseballBat', 'bicycle'],
});

const state = {
  ...createBaseGameState(0),
  zones: [
    {
      id: 'amsterdam' as const,
      displayName: 'Amsterdam',
      captainId: null,
      dealerSlots: [
        { id: 'amsterdam-slot-1', dealer, reservedTransferId: null },
        { id: 'amsterdam-slot-2', dealer: null, reservedTransferId: null },
      ],
      perkIds: [],
    },
    {
      id: 'paris' as const,
      displayName: 'Paris',
      captainId: null,
      dealerSlots: [{ id: 'paris-slot-1', dealer: null, reservedTransferId: null }],
      perkIds: [],
    },
    {
      id: 'berlin' as const,
      displayName: 'Berlin',
      captainId: null,
      dealerSlots: [
        { id: 'berlin-slot-1', dealer: makeReferenceDealer({ id: 'berlin-dealer' }), reservedTransferId: null },
        { id: 'berlin-slot-2', dealer: null, reservedTransferId: 'transfer-1' },
      ],
      perkIds: [],
    },
  ],
};

const renderModal = (overrides: Partial<ComponentProps<typeof DealerTransferModal>> = {}) => {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  render(
    <DealerTransferModal
      state={state}
      dealer={dealer}
      sourceZoneId="amsterdam"
      onConfirm={onConfirm}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { onConfirm, onClose };
};

describe('DealerTransferModal', () => {
  it('offers only unreserved slots in other zones and explains the transfer risk', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole('combobox', { name: 'Transfer destination' }));

    expect(screen.getByRole('option', { name: 'Paris · Slot 1' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Amsterdam/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Berlin/ })).not.toBeInTheDocument();
    expect(screen.getByText('2 minutes')).toBeInTheDocument();
    expect(screen.getByText('50% chance').closest('p')).toHaveTextContent('Each equipped item has an independent 50% chance of being lost on arrival.');
    expect(screen.getByText('Baseball Bat')).toBeInTheDocument();
    expect(screen.getByText('Bicycle')).toBeInTheDocument();
  });

  it('confirms the selected destination once, then closes without a cancel-transfer control', async () => {
    const user = userEvent.setup();
    const { onConfirm, onClose } = renderModal();

    await user.click(screen.getByRole('combobox', { name: 'Transfer destination' }));
    await user.click(screen.getByRole('option', { name: 'Paris · Slot 1' }));
    await user.click(screen.getByRole('button', { name: 'Confirm transfer' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith('transfer-dealer', 'paris', 'paris-slot-1');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /cancel transfer/i })).not.toBeInTheDocument();
  });

  it('does not start a transfer when closed from the close button or backdrop', async () => {
    const user = userEvent.setup();
    const first = renderModal();

    await user.click(screen.getByRole('button', { name: 'Close transfer confirmation' }));
    expect(first.onConfirm).not.toHaveBeenCalled();
    expect(first.onClose).toHaveBeenCalledTimes(1);

    const second = renderModal();
    await user.click(screen.getAllByTestId('transfer-modal-backdrop')[1]);
    expect(second.onConfirm).not.toHaveBeenCalled();
    expect(second.onClose).toHaveBeenCalledTimes(1);
  });

  it('explains that no equipment is at risk when the dealer has none', () => {
    renderModal({ dealer: makeReferenceDealer({ equipmentIds: [] }) });

    expect(screen.getByText('No equipment is at risk.')).toBeInTheDocument();
  });
});
