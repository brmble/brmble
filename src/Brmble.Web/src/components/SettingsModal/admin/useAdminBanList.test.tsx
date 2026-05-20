import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import bridge from '../../../bridge';
import { confirm } from '../../../hooks/usePrompt';
import { useAdminBanList } from './useAdminBanList';

vi.mock('../../../bridge', () => ({
  default: {
    send: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    once: vi.fn(),
  },
}));

vi.mock('../../../hooks/usePrompt', () => ({
  confirm: vi.fn().mockResolvedValue(true),
}));

describe('useAdminBanList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads bans and exposes them to both admin surfaces', async () => {
    vi.mocked(bridge.once).mockImplementation((type, handler) => {
      if (type === 'voice.bans') {
        handler([{ name: 'TroubleUser', address: '127.0.0.1', bits: 32, hash: 'h', reason: 'spam', start: 1700000000, duration: 0 }]);
      }
    });

    const { result } = renderHook(() => useAdminBanList());

    await waitFor(() => {
      expect(result.current.bans).toHaveLength(1);
    });
    expect(bridge.send).toHaveBeenCalledWith('voice.getBans');
  });

  it('unbans through the shared confirm flow and refreshes afterwards', async () => {
    vi.mocked(bridge.once).mockImplementation((type, handler) => {
      if (type === 'voice.bans') {
        handler([{ name: 'TroubleUser', address: '127.0.0.1', bits: 32, hash: 'h', reason: 'spam', start: 1700000000, duration: 0 }]);
      }
    });

    const { result } = renderHook(() => useAdminBanList());

    await waitFor(() => expect(result.current.bans[0]?.name).toBe('TroubleUser'));

    await act(async () => {
      await result.current.unban(0);
    });

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Unban User',
      confirmLabel: 'Unban',
    }));
    expect(bridge.send).toHaveBeenCalledWith('voice.unban', { index: 0 });
  });
});
