import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import bridge from '../bridge';
import { DEFAULT_OVERLAY } from '../components/SettingsModal/InterfaceSettingsTypes';
import { createOverlaySnapshot, updateFullCompanionContext } from '../components/CompanionOverlay/overlayModel';
import { useCompanionOverlayPublisher } from './useCompanionOverlayPublisher';

vi.mock('../bridge', () => ({
  default: {
    send: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
}));

describe('useCompanionOverlayPublisher', () => {
  it('publishes overlay.sync payload', () => {
    const snapshot = createOverlaySnapshot('7', 'Raid');
    renderHook(() => useCompanionOverlayPublisher({ ...DEFAULT_OVERLAY, overlayEnabled: true }, snapshot));

    expect(bridge.send).toHaveBeenCalledWith('overlay.sync', expect.objectContaining({
      enabled: true,
      mode: 'minimal',
      snapshot: expect.objectContaining({ currentChannelId: '7' }),
    }));
  });

  it('publishes full companion context in overlay.sync payload', () => {
    const snapshot = updateFullCompanionContext(createOverlaySnapshot('7', 'Raid'), {
      localUser: {
        session: 42,
        name: 'Local',
        companionId: 'bee',
      },
      companionsByUser: {
        99: {
          session: 99,
          name: 'Milo',
          companionId: 'engineer',
        },
      },
      localMuted: true,
      liveUserSessions: [42],
    });

    renderHook(() => useCompanionOverlayPublisher({ ...DEFAULT_OVERLAY, overlayEnabled: true }, snapshot));

    expect(bridge.send).toHaveBeenCalledWith('overlay.sync', expect.objectContaining({
      snapshot: expect.objectContaining({
        fullCompanion: expect.objectContaining({
          localUser: expect.objectContaining({ session: 42, name: 'Local' }),
          flags: expect.objectContaining({ localMuted: true, liveUserSessions: [42] }),
        }),
      }),
    }));
  });
});
