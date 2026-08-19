import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TalentLedger } from '../TalentLedger';
import { makeReferenceCaptain } from './testFixtures';

describe('TalentLedger', () => {
  it('keeps the modal opaque and centers each node track within its lane', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/components/NeonD/NeonD.module.css'), 'utf8');

    expect(css).toMatch(/\.talentLedgerModal\s*\{[^}]*background:[^}]*var\(--bg-deep\)/);
    expect(css).toMatch(/\.talentNodeSlot\s*\{[^}]*grid-template-columns:\s*minmax\(0, 12rem\)/);
    expect(css).toMatch(/\.talentNodeSlot\s*\{[^}]*justify-content:\s*center/);
  });

  it('shows the Captain identity, points, and the exact three lane orders', () => {
    render(
      <TalentLedger
        captain={makeReferenceCaptain({ name: 'Captain Red' })}
        onClose={vi.fn()}
        onClaimLevel={vi.fn()}
        onPurchaseTalent={vi.fn()}
        onPromote={vi.fn()}
      />,
    );

    expect(screen.getByRole('dialog', { name: /Captain Red/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Captain’s Talent Ledger — Captain Red/ })).toBeInTheDocument();
    expect(screen.getByText(/Talent points:/)).toHaveTextContent('Talent points: 0');

    const redText = screen.getByRole('group', { name: 'Red path' }).textContent ?? '';
    const yellowText = screen.getByRole('group', { name: 'Yellow path' }).textContent ?? '';
    const blueText = screen.getByRole('group', { name: 'Blue path' }).textContent ?? '';
    expect(redText.indexOf('Margin')).toBeLessThan(redText.indexOf('Volume'));
    expect(redText.indexOf('Volume')).toBeLessThan(redText.indexOf('Secondary sales'));
    expect(yellowText.indexOf('Secondary sales')).toBeLessThan(yellowText.indexOf('Margin'));
    expect(yellowText.indexOf('Margin')).toBeLessThan(yellowText.indexOf('Volume'));
    expect(blueText.indexOf('Volume')).toBeLessThan(blueText.indexOf('Secondary sales'));
    expect(blueText.indexOf('Secondary sales')).toBeLessThan(blueText.indexOf('Margin'));
  });

  it('shows the level-up action and zero remaining threshold', () => {
    render(
      <TalentLedger
        captain={makeReferenceCaptain({ level: 0, personalEarnings: 500_000, ledgerUnlocked: true })}
        onClose={vi.fn()}
        onClaimLevel={vi.fn()}
        onPurchaseTalent={vi.fn()}
        onPromote={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Level Up' })).toBeInTheDocument();
    expect(screen.getByText('$0 to level')).toBeInTheDocument();
  });

  it('shows the remaining Captain earnings needed for the next level', () => {
    render(
      <TalentLedger
        captain={makeReferenceCaptain({ level: 0, personalEarnings: 125_000, ledgerUnlocked: true })}
        onClose={vi.fn()}
        onClaimLevel={vi.fn()}
        onPurchaseTalent={vi.fn()}
        onPromote={vi.fn()}
      />,
    );

    const threshold = screen.getByText(/to level/);
    expect(threshold.textContent?.replace(/\D/g, '')).toBe('375000');
  });

  it('does not show next-level progress before the current level claim', () => {
    const { rerender } = render(
      <TalentLedger
        captain={makeReferenceCaptain({ level: 0, personalEarnings: 750_000, lastLevelUpEarnings: 0, ledgerUnlocked: true })}
        onClose={vi.fn()}
        onClaimLevel={vi.fn()}
        onPurchaseTalent={vi.fn()}
        onPromote={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Level Up' })).toBeInTheDocument();
    expect(screen.getByText('$0 to level')).toBeInTheDocument();

    rerender(
      <TalentLedger
        captain={makeReferenceCaptain({ level: 1, personalEarnings: 750_000, lastLevelUpEarnings: 750_000, talentPoints: 1, ledgerUnlocked: true })}
        onClose={vi.fn()}
        onClaimLevel={vi.fn()}
        onPurchaseTalent={vi.fn()}
        onPromote={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Level Up' })).not.toBeInTheDocument();
    const threshold = screen.getByText(/to level/);
    expect(threshold.textContent?.replace(/\D/g, '')).toBe('450000');
  });

  it('shows rank counters and disables only locked or unaffordable nodes', async () => {
    const user = userEvent.setup();
    const onPurchaseTalent = vi.fn();
    const captain = makeReferenceCaptain({
      level: 1,
      talentPoints: 1,
      ledgerUnlocked: true,
    });
    render(
      <TalentLedger
        captain={captain}
        onClose={vi.fn()}
        onClaimLevel={vi.fn()}
        onPurchaseTalent={onPurchaseTalent}
        onPromote={vi.fn()}
      />,
    );

    expect(screen.getAllByText('0/2')).not.toHaveLength(0);
    expect(screen.getAllByText('0/3')).not.toHaveLength(0);
    expect(screen.getAllByText('0/4')).not.toHaveLength(0);
    const redPath = within(screen.getByRole('group', { name: 'Red path' }));
    const margin = redPath.getByRole('button', { name: /Margin.*0\/2.*available/i });
    const volume = redPath.getByRole('button', { name: /Volume.*0\/3.*locked/i });
    expect(margin).toBeEnabled();
    expect(volume).toBeDisabled();

    await user.click(margin);
    expect(onPurchaseTalent).toHaveBeenCalledWith('red', 0);
  });

  it('closes on Escape or backdrop click and traps focus', () => {
    const onClose = vi.fn();
    render(
      <TalentLedger
        captain={makeReferenceCaptain({ level: 1, talentPoints: 1, ledgerUnlocked: true })}
        onClose={onClose}
        onClaimLevel={vi.fn()}
        onPurchaseTalent={vi.fn()}
        onPromote={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog');
    expect(document.activeElement).toBe(dialog);
    const close = screen.getByRole('button', { name: 'Close Test Captain talent ledger' });
    close.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).not.toBe(close);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByTestId('talent-ledger-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('requires confirmation before optional Kingpin promotion', async () => {
    const user = userEvent.setup();
    const onPromote = vi.fn();
    render(
      <TalentLedger
        captain={makeReferenceCaptain({
          level: 10,
          talentPoints: 1,
          talentRanks: { red: [2, 3, 4], yellow: [0, 0, 0], blue: [0, 0, 0] },
          ledgerUnlocked: true,
          kingpinAvailable: true,
        })}
        onClose={vi.fn()}
        onClaimLevel={vi.fn()}
        onPurchaseTalent={vi.fn()}
        onPromote={onPromote}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Promote to Kingpin/i }));
    expect(screen.getByText('Promote permanently?')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: /Test Captain/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm Kingpin promotion' }));
    expect(onPromote).toHaveBeenCalledOnce();
  });

  it('renders a read-only tree without progression or promotion actions', () => {
    render(
      <TalentLedger
        captain={makeReferenceCaptain({
          name: 'Preview Captain',
          level: 10,
          talentPoints: 1,
          talentRanks: { red: [2, 3, 4], yellow: [0, 0, 0], blue: [0, 0, 0] },
          ledgerUnlocked: true,
          kingpinAvailable: true,
        })}
        readOnly
        onClose={vi.fn()}
        onClaimLevel={vi.fn()}
        onPurchaseTalent={vi.fn()}
        onPromote={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Level Up' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Volume, 0\/2/ })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Promote to Kingpin' })).not.toBeInTheDocument();
  });

  it('shows deep-rank special effects only on the final rank, including in read-only ledgers', () => {
    const props = {
      onClose: vi.fn(),
      onClaimLevel: vi.fn(),
      onPurchaseTalent: vi.fn(),
      onPromote: vi.fn(),
    };
    const captain = makeReferenceCaptain({
      level: 10,
      talentPoints: 1,
      talentRanks: { red: [2, 3, 4], yellow: [2, 3, 4], blue: [0, 0, 0] },
      ledgerUnlocked: true,
      kingpinAvailable: true,
    });

    const { rerender } = render(<TalentLedger captain={captain} {...props} />);

    const redPath = screen.getByRole('group', { name: 'Red path' });
    const yellowPath = screen.getByRole('group', { name: 'Yellow path' });
    expect(within(redPath).getByText(/Protection coverage/)).toBeInTheDocument();
    expect(within(yellowPath).getByText(/Unlock Zone bulk sale/)).toBeInTheDocument();
    expect(within(redPath).getByRole('button', { name: /Margin, 2\/2/i })).not.toHaveTextContent('Protection coverage');
    expect(within(yellowPath).getByRole('button', { name: /Margin, 3\/3/i })).not.toHaveTextContent('Unlock Zone bulk sale');

    rerender(<TalentLedger captain={captain} readOnly {...props} />);

    expect(within(screen.getByRole('group', { name: 'Red path' })).getByText(/Protection coverage/)).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Yellow path' })).getByText(/Unlock Zone bulk sale/)).toBeInTheDocument();
  });
});
