import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PaintSessionView } from './PaintSessionView';

const refresh = vi.fn();

vi.mock('../../hooks/usePaintSession', () => ({
  usePaintSession: () => ({ snapshot: null, previews: [], error: new Error('Snapshot unavailable'), refresh }),
}));

describe('PaintSessionView', () => {
  beforeEach(() => refresh.mockReset().mockResolvedValue(undefined));

  it('shows an initial snapshot failure with a retry action', () => {
    render(<PaintSessionView sessionId="session-1" matrixClient={null} channelRoomMap={undefined} onClose={vi.fn()} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Snapshot unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('keeps the retry failure in the hook state without leaking a rejected click promise', async () => {
    refresh.mockRejectedValueOnce(new Error('Still unavailable'));
    render(<PaintSessionView sessionId="session-1" matrixClient={null} channelRoomMap={undefined} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await Promise.resolve();

    expect(refresh).toHaveBeenCalledOnce();
  });
});
