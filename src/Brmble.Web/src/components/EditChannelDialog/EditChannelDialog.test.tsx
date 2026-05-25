import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EditChannelDialog } from './EditChannelDialog';

vi.mock('../Icon/Icon', () => ({
  Icon: () => null,
}));

describe('EditChannelDialog', () => {
  it('does not render password access help text', () => {
    const onSave = vi.fn();
    render(
      <EditChannelDialog
        isOpen
        initialName="Main channel"
        initialDescription=""
        initialPassword=""
        onClose={vi.fn()}
        onSave={onSave}
      />
    );

    expect(screen.queryByText('Password Access')).not.toBeInTheDocument();
    expect(screen.queryByText(/Permissions.*ACL editor/i)).not.toBeInTheDocument();
  });

  it('hides the Mumble channel position by default', () => {
    render(
      <EditChannelDialog
        isOpen
        initialName="Main channel"
        initialDescription=""
        initialPassword=""
        initialPosition={4}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );

    expect(screen.queryByLabelText('Position')).not.toBeInTheDocument();
  });

  it('allows admins to edit the Mumble channel position when enabled', () => {
    const onSave = vi.fn();
    render(
      <EditChannelDialog
        isOpen
        initialName="Main channel"
        initialDescription=""
        initialPassword=""
        initialPosition={4}
        showPosition
        onClose={vi.fn()}
        onSave={onSave}
      />
    );

    fireEvent.change(screen.getByLabelText('Position'), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith('Main channel', '', 9, '');
  });
});
