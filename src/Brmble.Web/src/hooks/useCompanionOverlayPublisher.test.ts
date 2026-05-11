import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import bridge from '../bridge';
import { DEFAULT_OVERLAY } from '../components/SettingsModal/InterfaceSettingsTypes';
import { createOverlaySnapshot } from '../components/CompanionOverlay/overlayModel';
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
});
