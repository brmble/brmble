import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createBaseGameState } from '../constants';
import { ZoneUnlockModal } from '../ZoneUnlockModal';
import { makeReferenceCaptain } from './testFixtures';

const assignedCaptain = makeReferenceCaptain({ id: 'captain-assigned', name: 'Assigned Captain' });
const availableCaptain = makeReferenceCaptain({
  id: 'captain-available',
  name: 'Available Captain',
  selling: 'mushrooms',
  level: 4,
  ledgerUnlocked: true,
});

const state = {
  ...createBaseGameState(0),
  respect: 1_000,
  captains: [assignedCaptain, availableCaptain],
  zones: [{
    id: 'amsterdam' as const,
    displayName: 'Amsterdam',
    captainId: assignedCaptain.id,
    dealerSlots: [],
    perkIds: [],
  }],
};

describe('ZoneUnlockModal', () => {
  it('offers only unused cities and only unassigned Captains', async () => {
    const user = userEvent.setup();
    render(<ZoneUnlockModal state={state} onConfirm={vi.fn()} onClose={vi.fn()} />);

    await user.click(screen.getByRole('combobox', { name: 'City' }));
    expect(screen.queryByRole('option', { name: 'Amsterdam' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Paris' })).toBeInTheDocument();

    await user.click(screen.getByRole('combobox', { name: 'Captain' }));
    expect(screen.queryByRole('option', { name: 'Assigned Captain' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Available Captain' })).toBeInTheDocument();
  });

  it('disables cities when Respect is insufficient or no Captain is available', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ZoneUnlockModal state={{ ...state, respect: 0 }} onConfirm={vi.fn()} onClose={vi.fn()} />,
    );

    await user.click(screen.getByRole('combobox', { name: 'City' }));
    expect(screen.getByRole('option', { name: 'Paris' })).toBeDisabled();
    await user.keyboard('{Escape}');

    rerender(
      <ZoneUnlockModal
        state={{ ...state, captains: [assignedCaptain] }}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('combobox', { name: 'City' }));
    expect(screen.getByRole('option', { name: 'Paris' })).toBeDisabled();
  });

  it('shows the selected Captain, opens a read-only talent ledger, confirms the choices, and allows closing without a mutation', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<ZoneUnlockModal state={state} onConfirm={onConfirm} onClose={onClose} />);

    await user.click(screen.getByRole('combobox', { name: 'City' }));
    await user.click(screen.getByRole('option', { name: 'Paris' }));
    await user.click(screen.getByRole('combobox', { name: 'Captain' }));
    await user.click(screen.getByRole('option', { name: 'Available Captain' }));

    expect(screen.getByText('Magic Mushrooms')).toBeInTheDocument();
    expect(screen.getByText('Level 4')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'View talents' }));
    expect(screen.getByRole('heading', { name: /Captain’s Talent Ledger — Available Captain/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Level Up' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close Available Captain talent ledger' }));

    await user.click(screen.getByRole('button', { name: /Open Paris for 100 Respect/ }));
    expect(onConfirm).toHaveBeenCalledWith('paris', 'captain-available');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes without confirming when dismissed', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<ZoneUnlockModal state={state} onConfirm={onConfirm} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'Close zone unlock' }));

    expect(onClose).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
