import { describe, expect, it, vi } from 'vitest';

import { getNextLiveKitStatusUpdate, shouldClearLocalShareStartPending, toggleLocalScreenShare } from './App';

describe('toggleLocalScreenShare', () => {
  it('starts sharing in the current voice channel without changing LiveKit status first', async () => {
    const startSharing = vi.fn().mockResolvedValue(undefined);
    const stopSharing = vi.fn();
    const setSharingChannelId = vi.fn();

    await toggleLocalScreenShare({
      isSharing: false,
      selfLeftVoice: false,
      voiceChannelId: 7,
      startSharing,
      stopSharing,
      setSharingChannelId,
    });

    expect(startSharing).toHaveBeenCalledWith('channel-7');
    expect(setSharingChannelId).toHaveBeenCalledWith('7');
    expect(stopSharing).not.toHaveBeenCalled();
  });
});

describe('getNextLiveKitStatusUpdate', () => {
  it('preserves the previous LiveKit status while the share picker is unresolved after clearing an error', () => {
    expect(getNextLiveKitStatusUpdate({
      isSharing: false,
      watchingShareCount: 0,
      screenShareError: null,
      isLocalShareStartPending: true,
    })).toBeNull();
  });

  it('keeps LiveKit connected while watching a share even if local share start is still pending', () => {
    expect(getNextLiveKitStatusUpdate({
      isSharing: false,
      watchingShareCount: 1,
      screenShareError: null,
      isLocalShareStartPending: true,
    })).toEqual({ state: 'connected', error: undefined });
  });
});

describe('shouldClearLocalShareStartPending', () => {
  it('clears a pending local share start when the app leaves voice before the picker resolves', () => {
    expect(shouldClearLocalShareStartPending({
      isLocalShareStartPending: true,
      selfLeftVoice: true,
      voiceChannelId: 7,
    })).toBe(true);
  });
});
