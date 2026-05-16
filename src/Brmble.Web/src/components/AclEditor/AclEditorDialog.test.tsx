import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AclEditorDialog } from './AclEditorDialog';
import type { AclChannelSnapshot } from '../../types/acl';

const refresh = vi.fn();
const save = vi.fn();
let hookSnapshot: AclChannelSnapshot = {
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
    snapshot: hookSnapshot,
    loading: false,
    saving: false,
    error: null,
    refresh,
    save,
  }),
}));

describe('AclEditorDialog', () => {
  it('adds a token rule draft', async () => {
    hookSnapshot = {
      ...hookSnapshot,
      acls: [],
    };
    render(<AclEditorDialog isOpen channelId={4} channelName="Secret" onClose={vi.fn()} />);

    fireEvent.click(screen.getByText('Add Token Rule'));

    expect(await screen.findByDisplayValue('#token')).toBeInTheDocument();
  });

  it('edits the correct local rule when inherited rules come first', () => {
    hookSnapshot = {
      ...hookSnapshot,
      acls: [
        { applyHere: true, applySubs: false, inherited: true, userId: null, group: '#inherited', allow: 4, deny: 0 },
        { applyHere: true, applySubs: false, inherited: false, userId: null, group: '#local', allow: 4, deny: 0 },
      ],
    };
    save.mockClear();

    render(<AclEditorDialog isOpen channelId={4} channelName="Secret" onClose={vi.fn()} />);

    fireEvent.change(screen.getByDisplayValue('#local'), { target: { value: '#updated-local' } });
    fireEvent.click(screen.getByText('Save ACLs'));

    expect(save).toHaveBeenCalledWith({
      inheritAcls: true,
      groups: [],
      acls: [
        { applyHere: true, applySubs: false, inherited: true, userId: null, group: '#inherited', allow: 4, deny: 0 },
        { applyHere: true, applySubs: false, inherited: false, userId: null, group: '#updated-local', allow: 4, deny: 0 },
      ],
    });
  });
});
