import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AclEditorDialog } from './AclEditorDialog';

const refresh = vi.fn();
const save = vi.fn();
const snapshot = {
  channelId: 4,
  inheritAcls: true,
  groups: [],
  acls: [],
  fetchedAt: '2026-05-15T12:00:00Z',
  stale: false,
  warning: null,
  snapshotHash: 'known-hash',
};

vi.mock('../../hooks/useAclAdmin', () => ({
  useAclAdmin: () => ({
    snapshot,
    loading: false,
    saving: false,
    error: null,
    refresh,
    save,
  }),
}));

describe('AclEditorDialog', () => {
  it('adds a token rule draft', async () => {
    render(<AclEditorDialog isOpen channelId={4} channelName="Secret" onClose={vi.fn()} />);

    fireEvent.click(screen.getByText('Add Token Rule'));

    expect(await screen.findByDisplayValue('#token')).toBeInTheDocument();
  });
});
