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
  it('uses the shared modal title and subtitle styling hooks', () => {
    hookSnapshot = {
      ...hookSnapshot,
      acls: [],
    };

    render(<AclEditorDialog isOpen channelId={4} channelName="Secret" onClose={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Permissions for Secret' })).toHaveClass('heading-title', 'modal-title');
    expect(screen.getByText("Rules save to Mumble and refresh from the server's canonical ACL state.")).toHaveClass('modal-subtitle');
  });

  it('adds a token rule draft', async () => {
    hookSnapshot = {
      ...hookSnapshot,
      acls: [],
    };
    render(<AclEditorDialog isOpen channelId={4} channelName="Secret" onClose={vi.fn()} />);

    fireEvent.click(screen.getByText('Add Token Rule'));

    expect(await screen.findByDisplayValue('#token')).toBeInTheDocument();
  });

  it('preserves user-targeted rules when editing their value', () => {
    hookSnapshot = {
      ...hookSnapshot,
      acls: [
        { applyHere: true, applySubs: false, inherited: false, userId: 42, group: null, allow: 4, deny: 0 },
      ],
    };
    save.mockClear();

    render(<AclEditorDialog isOpen channelId={4} channelName="Secret" onClose={vi.fn()} />);

    fireEvent.change(screen.getByDisplayValue('42'), { target: { value: '84' } });
    fireEvent.click(screen.getByText('Save ACLs'));

    expect(save).toHaveBeenCalledWith({
      inheritAcls: true,
      groups: [],
      acls: [
        { applyHere: true, applySubs: false, inherited: false, userId: 84, group: null, allow: 4, deny: 0 },
      ],
    });
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

  it('does not show Brmble password marker rules in the generic ACL editor', () => {
    hookSnapshot = {
      ...hookSnapshot,
      acls: [
        { applyHere: true, applySubs: false, inherited: false, userId: null, group: '__brmble_password_marker__:#secret', allow: 0, deny: 0 },
        { applyHere: true, applySubs: false, inherited: false, userId: null, group: '#secret', allow: 6, deny: 0 },
      ],
    };

    render(<AclEditorDialog isOpen channelId={4} channelName="Secret" onClose={vi.fn()} />);

    expect(screen.queryByDisplayValue('__brmble_password_marker__:#secret')).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('#secret')).toBeInTheDocument();
  });
});
