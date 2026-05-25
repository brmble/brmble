import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSavedChannelPassword } from './channelPasswords';
import bridge from '../bridge';

vi.mock('../bridge', () => ({
  default: {
    send: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    once: vi.fn(),
  },
}));

describe('getSavedChannelPassword', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses a unique request id for each lookup of the same channel', () => {
    getSavedChannelPassword(5);
    getSavedChannelPassword(5);

    const sentPayloads = vi.mocked(bridge.send).mock.calls.map(call => call[1] as { requestId: string });
    expect(sentPayloads[0].requestId).not.toBe(sentPayloads[1].requestId);
  });

  it('waits for the matching channel password response', async () => {
    let handler: ((data: unknown) => void) | undefined;
    vi.mocked(bridge.on).mockImplementation((_type, registeredHandler) => {
      handler = registeredHandler;
    });

    const result = getSavedChannelPassword(5);

    const requestId = (vi.mocked(bridge.send).mock.calls[0][1] as { requestId: string }).requestId;

    handler?.({ requestId: 'channel-password-99', channelId: 99, password: 'wrong-channel' });
    handler?.({ requestId, channelId: 5, password: 'saved-secret' });

    await expect(result).resolves.toBe('saved-secret');
  });
});
