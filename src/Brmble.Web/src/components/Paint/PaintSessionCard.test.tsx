import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PaintSessionCard } from './PaintSessionCard';

describe('PaintSessionCard', () => {
  it('shows join action only for accessible active paint session cards', () => {
    render(<PaintSessionCard session={{ sessionId: 'session-1', status: 'active', hostUserId: 1, participantUserIds: [2], channelId: 5 }} canJoin onJoin={vi.fn()} />);

    expect(screen.getByRole('button', { name: /join/i })).toBeEnabled();
  });
});
