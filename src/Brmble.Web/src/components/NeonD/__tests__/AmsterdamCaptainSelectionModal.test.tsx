import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AmsterdamCaptainSelectionModal } from '../AmsterdamCaptainSelectionModal';
import { makeReferenceCaptain } from './testFixtures';

const captains = [
  makeReferenceCaptain({
    id: 'captain-one',
    name: 'Captain One',
    selling: 'weed',
    level: 2,
    talentPoints: 1,
    ledgerUnlocked: true,
  }),
  makeReferenceCaptain({
    id: 'captain-two',
    name: 'Captain Two',
    selling: 'mushrooms',
    level: 4,
    talentPoints: 2,
    ledgerUnlocked: true,
  }),
];

describe('AmsterdamCaptainSelectionModal', () => {
  it('lists every owned Captain with their assignment details and a read-only talent-ledger preview', async () => {
    const user = userEvent.setup();

    render(<AmsterdamCaptainSelectionModal captains={captains} onConfirm={vi.fn()} />);

    expect(screen.getByRole('radio', { name: /Captain One/ })).toBeInTheDocument();
    const secondCaptainRadio = screen.getByRole('radio', { name: /Captain Two/ });
    const secondCaptainCard = secondCaptainRadio.closest('label');
    expect(secondCaptainCard).not.toBeNull();
    expect(within(secondCaptainCard!).getByText('Magic Mushrooms')).toBeInTheDocument();
    expect(within(secondCaptainCard!).getByText('Level 4')).toBeInTheDocument();
    expect(within(secondCaptainCard!).getByText('Volume 1.75x')).toBeInTheDocument();
    expect(within(secondCaptainCard!).getByText('Margin 1.75x')).toBeInTheDocument();

    await user.click(secondCaptainRadio);
    await user.click(screen.getByRole('button', { name: 'Preview Captain Two talent ledger' }));

    expect(screen.getByRole('dialog', { name: /Captain Two/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Level Up' })).not.toBeInTheDocument();
  });

  it('confirms the selected owned Captain', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(<AmsterdamCaptainSelectionModal captains={captains} onConfirm={onConfirm} />);

    const firstCaptain = screen.getByRole('radio', { name: /Captain One/ });
    const secondCaptain = screen.getByRole('radio', { name: /Captain Two/ });
    expect(firstCaptain).toBeChecked();

    await user.click(secondCaptain);
    expect(secondCaptain).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Assign Captain to Amsterdam' }));

    expect(onConfirm).toHaveBeenCalledWith('captain-two');
  });

  it('cannot be dismissed by close controls, the backdrop, or Escape', () => {
    const onConfirm = vi.fn();
    render(<AmsterdamCaptainSelectionModal captains={captains} onConfirm={onConfirm} />);

    const dialog = screen.getByRole('dialog', { name: 'Choose Amsterdam’s Captain' });
    fireEvent.click(screen.getByTestId('amsterdam-captain-selection-backdrop'));
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(dialog).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /close|cancel/i })).not.toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('keeps Tab and Shift+Tab focus inside the required dialog', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Background control</button>
        <AmsterdamCaptainSelectionModal captains={captains} onConfirm={vi.fn()} />
      </>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Choose Amsterdam’s Captain' });
    const firstRadio = within(dialog).getByRole('radio', { name: /Captain One/ });
    const confirmButton = within(dialog).getByRole('button', { name: 'Assign Captain to Amsterdam' });

    expect(firstRadio).toHaveFocus();

    confirmButton.focus();
    await user.tab();
    expect(firstRadio).toHaveFocus();

    await user.tab({ shift: true });
    expect(confirmButton).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Background control' })).not.toHaveFocus();
  });
});
