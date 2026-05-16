import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EditChannelDialog } from './EditChannelDialog';

vi.mock('../Icon/Icon', () => ({
  Icon: () => null,
}));

describe('EditChannelDialog', () => {
  it('explains that channel password management lives in the ACL editor', () => {
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

    expect(screen.getByText(/Permissions.*ACL editor/i)).toBeInTheDocument();
  });
});
