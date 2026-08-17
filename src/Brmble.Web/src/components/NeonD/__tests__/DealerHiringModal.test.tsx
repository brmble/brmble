import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createBaseGameState } from '../constants';
import { DealerHiringModal } from '../DealerHiringModal';
import { makeReferenceCaptain, makeReferenceDealer } from './testFixtures';

const state = {
  ...createBaseGameState(0),
  availableDealers: [
    makeReferenceDealer({ id: 'dealer-1', name: 'Dealer One' }),
    makeReferenceDealer({ id: 'dealer-2', name: 'Dealer Two' }),
    makeReferenceDealer({ id: 'dealer-3', name: 'Dealer Three' }),
  ],
  captains: [makeReferenceCaptain({ id: 'captain-1', name: 'Captain One', level: 2, ledgerUnlocked: true })],
};

describe('DealerHiringModal', () => {
  it('shows three dealers and unassigned Captain candidates with Captain details', async () => {
    const user = userEvent.setup();
    const onHireSeller = vi.fn();
    const onClose = vi.fn();

    render(
      <DealerHiringModal
        state={state}
        slotIndex={0}
        onHireSeller={onHireSeller}
        onRefreshDealers={vi.fn()}
        onRenameCaptain={vi.fn()}
        onClose={onClose}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'Hire seller for Slot 1' })).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(4);
    expect(screen.getByText('♛')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Volume: 1.75x' }).querySelectorAll('[data-star-state="full"]')).toHaveLength(6);
    expect(screen.getByText('Level 2')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Hire Captain One to Slot 1' }));
    expect(onHireSeller).toHaveBeenCalledWith('captain-1', 0, 'captain');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('refreshes dealer candidates and closes on Escape', async () => {
    const user = userEvent.setup();
    const onRefreshDealers = vi.fn();
    const onClose = vi.fn();

    render(
      <DealerHiringModal
        state={{ ...state, lastDealerRefreshAt: Date.now() - 60_000 }}
        slotIndex={1}
        onHireSeller={vi.fn()}
        onRefreshDealers={onRefreshDealers}
        onRenameCaptain={vi.fn()}
        onClose={onClose}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Refresh dealers' }));
    expect(onRefreshDealers).toHaveBeenCalledOnce();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows the refresh countdown inside the modal', () => {
    render(
      <DealerHiringModal
        state={{ ...state, lastDealerRefreshAt: Date.now() }}
        slotIndex={0}
        onHireSeller={vi.fn()}
        onRefreshDealers={vi.fn()}
        onRenameCaptain={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /refresh available in/i })).toBeDisabled();
  });

  it('shows the talent preview button instead of the talent bonus summary', () => {
    render(
      <DealerHiringModal
        state={{
          ...state,
          captains: [makeReferenceCaptain({
            id: 'captain-1',
            name: 'Captain One',
            level: 2,
            ledgerUnlocked: true,
            talentRanks: { red: [2, 3, 4], yellow: [0, 0, 0], blue: [0, 0, 0] },
          })],
        }}
        slotIndex={0}
        onHireSeller={vi.fn()}
        onRefreshDealers={vi.fn()}
        onRenameCaptain={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'View talents for Captain One' })).toBeInTheDocument();
    expect(screen.queryByText('+80% margin')).not.toBeInTheDocument();
  });

  it('opens the selected unassigned Captain talent tree as a read-only preview', async () => {
    const user = userEvent.setup();
    const onHireSeller = vi.fn();
    const onClose = vi.fn();

    render(
      <DealerHiringModal
        state={state}
        slotIndex={0}
        onHireSeller={onHireSeller}
        onRefreshDealers={vi.fn()}
        onRenameCaptain={vi.fn()}
        onClose={onClose}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'View talents for Captain One' }));

    expect(screen.getByRole('heading', { name: /Captain’s Talent Ledger — Captain One/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Level Up' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Promote to Kingpin' })).not.toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('heading', { name: /Captain’s Talent Ledger — Captain One/ })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'View talents for Captain One' }));
    await user.click(screen.getByRole('button', { name: 'Close Captain One talent ledger' }));
    expect(screen.queryByRole('heading', { name: /Captain’s Talent Ledger — Captain One/ })).not.toBeInTheDocument();
    expect(onHireSeller).not.toHaveBeenCalled();
  });

  it('keeps Captain naming focused when the parent rerenders', async () => {
    const user = userEvent.setup();
    const firstOnClose = vi.fn();
    const { rerender } = render(
      <DealerHiringModal
        state={state}
        slotIndex={0}
        onHireSeller={vi.fn()}
        onRefreshDealers={vi.fn()}
        onRenameCaptain={vi.fn()}
        onClose={firstOnClose}
      />,
    );

    const input = screen.getByRole('textbox', { name: 'Name for Captain One' });
    await user.clear(input);
    await user.type(input, 'Night');

    rerender(
      <DealerHiringModal
        state={state}
        slotIndex={0}
        onHireSeller={vi.fn()}
        onRefreshDealers={vi.fn()}
        onRenameCaptain={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await user.keyboard('shade');

    expect(input).toHaveValue('Nightshade');
    expect(document.activeElement).toBe(input);
  });

  it('commits a Captain rename once when Enter blurs the input', async () => {
    const user = userEvent.setup();
    const onRenameCaptain = vi.fn();

    render(
      <DealerHiringModal
        state={state}
        slotIndex={0}
        onHireSeller={vi.fn()}
        onRefreshDealers={vi.fn()}
        onRenameCaptain={onRenameCaptain}
        onClose={vi.fn()}
      />,
    );

    const input = screen.getByRole('textbox', { name: 'Name for Captain One' });
    await user.clear(input);
    await user.type(input, 'Nightshade');
    await user.keyboard('{Enter}');

    expect(onRenameCaptain).toHaveBeenCalledOnce();
    expect(onRenameCaptain).toHaveBeenCalledWith('captain-1', 'Nightshade');
  });

  it('cancels a Captain rename on Escape without committing the draft', async () => {
    const user = userEvent.setup();
    const onRenameCaptain = vi.fn();

    render(
      <DealerHiringModal
        state={state}
        slotIndex={0}
        onHireSeller={vi.fn()}
        onRefreshDealers={vi.fn()}
        onRenameCaptain={onRenameCaptain}
        onClose={vi.fn()}
      />,
    );

    const input = screen.getByRole('textbox', { name: 'Name for Captain One' });
    await user.clear(input);
    await user.type(input, 'Temporary');
    await user.keyboard('{Escape}');

    expect(onRenameCaptain).not.toHaveBeenCalled();
    expect(input).toHaveValue('Captain One');
  });

  it('uses the shared modal shell and does not close when its panel is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <DealerHiringModal
        state={state}
        slotIndex={0}
        onHireSeller={vi.fn()}
        onRefreshDealers={vi.fn()}
        onRenameCaptain={vi.fn()}
        onClose={onClose}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Hire seller for Slot 1' });
    expect(dialog).toHaveClass('glass-panel', 'animate-slide-up');
    expect(dialog.parentElement).toHaveClass('modal-overlay');

    await user.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('announces purchasable nodes as unavailable in a read-only preview', async () => {
    const user = userEvent.setup();

    render(
      <DealerHiringModal
        state={{
          ...state,
          captains: [makeReferenceCaptain({
            id: 'captain-1',
            name: 'Captain One',
            level: 1,
            talentPoints: 1,
            ledgerUnlocked: true,
          })],
        }}
        slotIndex={0}
        onHireSeller={vi.fn()}
        onRefreshDealers={vi.fn()}
        onRenameCaptain={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'View talents for Captain One' }));

    expect(screen.queryByRole('button', { name: /Margin, 0\/2, available/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Margin, 0\/2, locked/ })).toBeDisabled();
  });
});
