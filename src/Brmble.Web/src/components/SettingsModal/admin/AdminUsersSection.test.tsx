import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminUsersSection } from './AdminUsersSection';

const { bridgeHandlers, bridgeMock } = vi.hoisted(() => {
  const bridgeHandlers = new Map<string, ((data: unknown) => void)[]>();
  const bridgeMock = {
    send: vi.fn((type: string) => {
      if (type === 'voice.getRegisteredUsers') {
        for (const handler of bridgeHandlers.get('voice.registeredUsers') ?? []) {
          handler({ 12: 'Alice', 34: 'Bob' });
        }
      }
    }),
    on: vi.fn((type: string, handler: (data: unknown) => void) => {
      const handlers = bridgeHandlers.get(type) ?? [];
      handlers.push(handler);
      bridgeHandlers.set(type, handlers);
    }),
    off: vi.fn((type: string, handler: (data: unknown) => void) => {
      const handlers = bridgeHandlers.get(type) ?? [];
      bridgeHandlers.set(type, handlers.filter(candidate => candidate !== handler));
    }),
    once: vi.fn((type: string, handler: (data: unknown) => void) => {
      const wrapped = (data: unknown) => {
        bridgeMock.off(type, wrapped);
        handler(data);
      };
      bridgeMock.on(type, wrapped);
    }),
  };

  return { bridgeHandlers, bridgeMock };
});

vi.mock('../../../bridge', () => ({ default: bridgeMock }));
vi.mock('../../../hooks/usePrompt', () => ({
  confirm: vi.fn().mockResolvedValue(true),
}));

describe('AdminUsersSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bridgeHandlers.clear();
  });

  afterEach(() => {
    bridgeHandlers.clear();
  });

  it('renders registered and banned users in one table', async () => {
    render(<AdminUsersSection liveUsers={[{ session: 7, name: 'Alice' }]} />);

    await screen.findByRole('heading', { name: 'Users' });

    expect(await screen.findByText('Alice')).toBeInTheDocument();
    expect(screen.getAllByText('Registered').length).toBeGreaterThan(0);
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('filters rows locally from the search input', async () => {
    render(<AdminUsersSection liveUsers={[{ session: 7, name: 'Alice' }, { session: 9, name: 'Bob' }]} />);

    fireEvent.change(await screen.findByPlaceholderText('Search users'), { target: { value: 'bob' } });

    await waitFor(() => {
      expect(screen.queryByText('Alice')).not.toBeInTheDocument();
      expect(screen.getByText('Bob')).toBeInTheDocument();
    });
  });

  it('keeps partial failure scoped to the registered-users source', async () => {
    bridgeMock.send.mockImplementationOnce((type: string) => {
      if (type === 'voice.getRegisteredUsers') {
        for (const handler of bridgeHandlers.get('voice.registeredUsersError') ?? []) {
          handler({ message: 'Registered users lookup failed with status 403.' });
        }
        for (const handler of bridgeHandlers.get('voice.registeredUsers') ?? []) {
          handler([]);
        }
      }
    });

    render(<AdminUsersSection liveUsers={[{ session: 7, name: 'LiveOnlyUser' }]} />);

    expect(await screen.findByText('Registered users lookup failed with status 403.')).toBeInTheDocument();
    expect(screen.getByText('LiveOnlyUser')).toBeInTheDocument();
  });
});
