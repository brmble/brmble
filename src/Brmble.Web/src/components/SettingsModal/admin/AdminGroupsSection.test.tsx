import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AdminGroupsSection } from './AdminGroupsSection';

const { saveSpy, stableSnapshot } = vi.hoisted(() => ({
  saveSpy: vi.fn(),
  stableSnapshot: {
    inheritAcls: true,
    groups: [{ name: 'Officers', inherited: false, inherit: true, inheritable: true, add: [], remove: [], members: [] }],
    acls: [],
  },
}));

vi.mock('../../../hooks/useAclAdmin', () => ({
  useAclAdmin: () => ({
    snapshot: stableSnapshot,
    save: saveSpy,
  }),
}));

describe('AdminGroupsSection', () => {
  it('renders add/delete actions and save controls for groups', () => {
    render(<AdminGroupsSection />);

    expect(screen.getByRole('button', { name: 'Add Group' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete Group' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeInTheDocument();
  });

  it('creates and deletes staged groups before save', () => {
    render(<AdminGroupsSection />);

    fireEvent.click(screen.getByRole('button', { name: 'Add Group' }));
    expect(screen.getByText('New Group')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete Group' }));
    expect(screen.queryByText('New Group')).not.toBeInTheDocument();
  });

  it('saves the edited groups through the ACL-backed persistence path', async () => {
    render(<AdminGroupsSection />);

    fireEvent.click(screen.getByRole('button', { name: 'Add Group' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalled();
    });
  });
});
