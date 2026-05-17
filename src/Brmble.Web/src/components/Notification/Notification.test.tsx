import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Notification } from './Notification';

describe('Notification', () => {
  it('renders only the top-right notification position', () => {
    const props = { status: 'info' as const, position: 'top-right' as const, visible: true, title: 'Saved' };

    render(<Notification {...props} />);

    expect(screen.getByRole('status')).toHaveClass('notification--top-right');
    expect(screen.getByRole('status').className).not.toContain('bottom-center');
  });
});
