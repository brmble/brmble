import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderConnectedApp, resetAppHarness } from './testing/appHarness';

function shareFrom(userId: number) {
  return { roomName: 'channel-7', userId, userName: `User ${userId}` };
}

describe('channel activity region', () => {
  beforeEach(() => {
    localStorage.clear();
    resetAppHarness();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows no region and no divider in a quiet channel', () => {
    renderConnectedApp({ joinedChannelId: '7' });
    expect(screen.queryByRole('region', { name: /activity/ })).not.toBeInTheDocument();
    // The sidebar keeps its own vertical resize handle; what must be absent is the
    // main panel's horizontal split.
    expect(screen.queryByRole('separator', { name: /Resize channel activity/ })).not.toBeInTheDocument();
  });

  it('stages a screen share and offers paint as a chip', async () => {
    const user = userEvent.setup();
    const { screenShare } = renderConnectedApp({
      joinedChannelId: '7',
      watchedShares: [shareFrom(10)],
      paintSessionId: 'p1',
    });
    expect(screen.getByRole('tab', { name: 'Screen share' })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('tab', { name: 'Paint' }));
    expect(screen.getByRole('tab', { name: 'Paint' })).toHaveAttribute('aria-selected', 'true');
    expect(screenShare.setRemoteScreenSharesHidden).toHaveBeenLastCalledWith(true);
  });

  it('restores the share when it returns to the stage', async () => {
    const user = userEvent.setup();
    const { screenShare } = renderConnectedApp({
      joinedChannelId: '7',
      watchedShares: [shareFrom(10)],
      paintSessionId: 'p1',
    });
    await user.click(screen.getByRole('tab', { name: 'Paint' }));
    await user.click(screen.getByRole('tab', { name: 'Screen share' }));
    expect(screenShare.setRemoteScreenSharesHidden).toHaveBeenLastCalledWith(false);
  });

  it('never renders the activity region at server root', () => {
    renderConnectedApp({ joinedChannelId: 'server-root', watchedShares: [shareFrom(10)] });
    expect(screen.queryByRole('region', { name: /activity/ })).not.toBeInTheDocument();
  });
});
