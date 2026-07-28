import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Header } from './Header';

vi.mock('../UserPanel/UserPanel', () => ({
  UserPanel: () => <div data-testid="user-panel" />,
}));

vi.mock('../../bridge', () => ({
  default: { send: vi.fn() },
}));

describe('Header paint action', () => {
  it('uses the shared icon button pattern and disables while paint is active', () => {
    render(<Header onOpenSettings={vi.fn()} onStartPaint={vi.fn()} canStartPaint activePaintSessionId="paint-1" />);

    const paint = screen.getByRole('button', { name: 'Start collaborative paint' });
    expect(paint).toHaveAttribute('type', 'button');
    expect(paint).toHaveClass('btn', 'btn-ghost', 'btn-icon');
    expect(paint).toBeDisabled();
    expect(paint.querySelector('svg')).toBeInTheDocument();
  });
});
