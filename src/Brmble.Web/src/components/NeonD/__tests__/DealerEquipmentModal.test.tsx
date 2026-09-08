import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createBaseGameState } from '../constants';
import { DealerEquipmentModal } from '../DealerEquipmentModal';
import type { Dealer } from '../types';
import { makeReferenceDealer } from './testFixtures';

const dealer: Dealer = makeReferenceDealer({
  id: 'equipment-dealer',
  name: 'Equipment Dealer',
});

const state = {
  ...createBaseGameState(0),
  cash: 1_000_000,
};

describe('DealerEquipmentModal', () => {
  it('moves focus into the dialog, traps Tab, and restores focus to the opener', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [isOpen, setIsOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setIsOpen(true)}>Open equipment</button>
          {isOpen ? (
            <DealerEquipmentModal
              dealer={dealer}
              state={state}
              onBuy={vi.fn()}
              onClose={() => setIsOpen(false)}
            />
          ) : null}
        </>
      );
    }

    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open equipment' });
    await user.click(opener);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveFocus();

    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'Close equipment for Equipment Dealer' })).toHaveFocus();

    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('button', { name: /Ferrari 458 Italia/ })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Close equipment for Equipment Dealer' }));
    expect(opener).toHaveFocus();
  });
});
