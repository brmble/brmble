import { describe, expect, it, vi } from 'vitest';
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
  it('waits for the matching channel password response', async () => {
    let handler: ((data: unknown) => void) | undefined;
    vi.mocked(bridge.on).mockImplementation((_type, registeredHandler) => {
      handler = registeredHandler;
    });

    const result = getSavedChannelPassword(5);

    handler?.({ requestId: 'channel-password-99', channelId: 99, password: 'wrong-channel' });
    handler?.({ requestId: 'channel-password-5', channelId: 5, password: 'saved-secret' });

    await expect(result).resolves.toBe('saved-secret');
  });
});
