import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EditChannelDialog } from './EditChannelDialog';

vi.mock('../Icon/Icon', () => ({
  Icon: () => null,
}));

describe('EditChannelDialog', () => {
  it('submits password token as third onSave argument', () => {
    const onSave = vi.fn();
    render(
      <EditChannelDialog
        isOpen
        initialName="Secret"
        initialDescription=""
        initialPassword=""
        onClose={vi.fn()}
        onSave={onSave}
      />
    );

    fireEvent.change(screen.getByLabelText('Password Token'), { target: { value: 'new-secret' } });
    fireEvent.click(screen.getByText('Save'));

    expect(onSave).toHaveBeenCalledWith('Secret', '', 'new-secret');
  });
});
