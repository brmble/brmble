import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Notification } from './Notification';

describe('Notification', () => {
  it('renders only the top-right notification position', () => {
    render(<Notification status="info" position="top-right" visible title="Saved" />);

    expect(screen.getByRole('status')).toHaveClass('notification--top-right');
    expect(screen.getByRole('status').className).not.toContain('bottom-center');
  });
});
