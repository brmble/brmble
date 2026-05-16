import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AdminSettingsTab } from './AdminSettingsTab';
import { confirm } from '../../hooks/usePrompt';

const { bridgeMock } = vi.hoisted(() => ({
  bridgeMock: {
    send: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    once: vi.fn(),
  },
}));

const ban = {
  address: '127.0.0.1',
  bits: 32,
  name: 'TroubleUser',
  hash: 'hash-1',
  reason: 'spam',
  start: 1700000000,
  duration: 0,
};

vi.mock('../../bridge', () => ({
  default: bridgeMock,
}));

vi.mock('../../hooks/usePrompt', () => ({
  confirm: vi.fn().mockResolvedValue(true),
}));

function renderWithBan() {
  bridgeMock.once.mockImplementation((type: string, handler: (data: unknown) => void) => {
    if (type === 'voice.bans') handler([ban]);
  });
  return render(<AdminSettingsTab />);
}

describe('AdminSettingsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(confirm).mockResolvedValue(true);
  });

  it('renders ban summary and unban as sibling buttons', async () => {
    renderWithBan();

    const summary = await screen.findByRole('button', { name: /TroubleUser/ });
    const unban = screen.getByRole('button', { name: 'Unban' });

    expect(summary).not.toContainElement(unban);
    expect(summary.parentElement).toContainElement(unban);
  });

  it('keeps expand and unban behavior separate', async () => {
    renderWithBan();

    fireEvent.click(await screen.findByRole('button', { name: /TroubleUser/ }));
    expect(screen.getByText('IP:')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Unban' }));

    await waitFor(() => {
      expect(bridgeMock.send).toHaveBeenCalledWith('voice.unban', { index: 0 });
    });
  });
});
