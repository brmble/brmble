import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AclEditorDialog } from './AclEditorDialog';
import type { AclChannelSnapshot } from '../../types/acl';

const refresh = vi.fn();
const save = vi.fn();
const savePassword = vi.fn();
const { bridgeHandlers, bridgeSend } = vi.hoisted(() => {
  const bridgeHandlers = new Map<string, ((data: unknown) => void)[]>();
  const bridgeSend = vi.fn((type: string) => {
    if (type === 'voice.getRegisteredUsers') {
      for (const handler of bridgeHandlers.get('voice.registeredUsers') ?? []) {
        handler({ 45: 'Charlie', 67: 'Dana' });
      }
    }
  });

  return { bridgeHandlers, bridgeSend };
});

vi.mock('../../bridge', () => ({
  default: {
    on: (type: string, handler: (data: unknown) => void) => {
      const handlers = bridgeHandlers.get(type) ?? [];
      handlers.push(handler);
      bridgeHandlers.set(type, handlers);
    },
    off: (type: string, handler: (data: unknown) => void) => {
      const handlers = bridgeHandlers.get(type) ?? [];
      bridgeHandlers.set(type, handlers.filter(candidate => candidate !== handler));
    },
    send: bridgeSend,
  },
}));

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
let hookSaving = false;

vi.mock('../../hooks/useAclAdmin', () => ({
  useAclAdmin: () => ({
    snapshot: hookSnapshot,
    loading: false,
    saving: hookSaving,
    error: null,
    refresh,
    save,
    savePassword,
  }),
}));

describe('AclEditorDialog', () => {
  beforeEach(() => {
    bridgeHandlers.clear();
    hookSnapshot = {
      channelId: 4,
      inheritAcls: true,
      groups: [],
      acls: [],
      fetchedAt: '2026-05-15T12:00:00Z',
      stale: false,
      warning: null,
      snapshotHash: 'known-hash',
    };
    refresh.mockClear();
    save.mockClear();
    savePassword.mockClear();
    bridgeSend.mockClear();
    hookSaving = false;
  });

  it('loads registered users from the bridge so approved and moderator add lists can populate', () => {
    render(<AclEditorDialog isOpen channelId={4} channelName="Secret" onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Only approved users can join' }));

    expect(screen.getAllByRole('combobox')).toHaveLength(3);
    expect(screen.queryAllByRole('option', { name: 'Charlie' })).toHaveLength(0);
    expect(screen.queryAllByRole('option', { name: 'Dana' })).toHaveLength(0);
  });

  it('only offers registered-user ids for ACL additions, not live session ids', () => {
    render(
      <AclEditorDialog
        isOpen
        channelId={4}
        channelName="Secret"
        availableUsers={[
          { session: 999, name: 'Unregistered online user' },
        ]}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Only approved users can join' }));

    expect(screen.queryAllByRole('option', { name: 'Unregistered online user' })).toHaveLength(0);
  });

  it('uses the shared modal title and subtitle styling hooks', () => {
    render(<AclEditorDialog isOpen channelId={4} channelName="Secret" onClose={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Permissions for Secret' })).toHaveClass('heading-title', 'modal-title');
    expect(screen.getByText('Choose who can join, who can moderate, and who is blocked. Then save your channel access rules.')).toHaveClass('modal-subtitle');
  });

  it('uses the shared toggle switch pattern for boolean controls', () => {
    render(<AclEditorDialog isOpen channelId={4} channelName="Secret" onClose={vi.fn()} />);

    const inheritToggle = screen.getByLabelText('Inherit ACLs from the parent channel');

    expect(inheritToggle.closest('label')).toHaveClass('brmble-toggle');
    expect(inheritToggle.nextElementSibling).toHaveClass('brmble-toggle-slider');
  });

  it('shows the simplified cards for join access, password, and moderators', () => {
    render(<AclEditorDialog isOpen channelId={4} channelName="Main channel" onClose={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Who can join' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Password' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Moderators' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Blocked users' })).toBeInTheDocument();
  });

  it('switches to whitelist mode and shows the approved users section', () => {
    render(
      <AclEditorDialog
        isOpen
        channelId={4}
        channelName="Secret"
        availableUsers={[
          { session: 12, name: 'Alice' },
          { session: 34, name: 'Bob' },
        ]}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Only approved users can join' }));

    expect(screen.getByText('0 approved users')).toBeInTheDocument();
    expect(screen.getByText('Add approved user')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Approved users' })).toHaveClass('heading-label');
  });

  it('shows existing moderators in the simplified moderator list', () => {
    hookSnapshot = {
      ...hookSnapshot,
      acls: [
        { applyHere: true, applySubs: false, inherited: false, userId: 12, group: null, allow: 196662, deny: 0 },
      ],
    };

    render(
      <AclEditorDialog
        isOpen
        channelId={4}
        channelName="Secret"
        availableUsers={[{ session: 12, name: 'Alice' }]}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('1 moderator')).toBeInTheDocument();
    expect(screen.getByText('User id 12')).toBeInTheDocument();
  });

  it('shows a native-password warning when the channel is protected outside Brmble', () => {
    render(
      <AclEditorDialog
        isOpen
        channelId={4}
        channelName="Secret"
        isNativePasswordProtected
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('Native Mumble Password Detected')).toBeInTheDocument();
    expect(screen.getByText(/remove the existing password using a Mumble client first/i)).toBeInTheDocument();
  });

  it('preserves the password marker rule while exposing the simple password field', () => {
    hookSnapshot = {
      ...hookSnapshot,
      groups: [],
      acls: [
        { applyHere: true, applySubs: false, inherited: false, userId: null, group: '__brmble_password_marker__:#secret', allow: 0, deny: 0 },
        { applyHere: true, applySubs: false, inherited: false, userId: null, group: '#secret', allow: 6, deny: 0 },
      ],
    };
    save.mockClear();

    render(<AclEditorDialog isOpen channelId={4} channelName="Secret" onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Channel password selector'), { target: { value: '#new-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save password' }));

    expect(savePassword).toHaveBeenCalledWith('#new-secret');
  });

  it('shows cancel and highlighted save only when an existing password changes', () => {
    hookSnapshot = {
      ...hookSnapshot,
      groups: [],
      acls: [
        { applyHere: true, applySubs: false, inherited: false, userId: null, group: '__brmble_password_marker__:#secret', allow: 0, deny: 0 },
        { applyHere: true, applySubs: false, inherited: false, userId: null, group: '#secret', allow: 6, deny: 0 },
      ],
    };

    render(<AclEditorDialog isOpen channelId={4} channelName="Secret" onClose={vi.fn()} />);

    const passwordInput = screen.getByLabelText('Channel password selector');

    expect(screen.queryByRole('button', { name: 'Cancel password change' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save password' })).not.toBeInTheDocument();

    fireEvent.change(passwordInput, { target: { value: '#new-secret' } });

    expect(screen.getByRole('button', { name: 'Cancel password change' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save password' })).toHaveClass('btn-primary');

    fireEvent.click(screen.getByRole('button', { name: 'Save password' }));

    expect(savePassword).toHaveBeenCalledWith('#new-secret');
  });

  it('reverts unsaved password changes when cancel is pressed', () => {
    hookSnapshot = {
      ...hookSnapshot,
      groups: [],
      acls: [
        { applyHere: true, applySubs: false, inherited: false, userId: null, group: '__brmble_password_marker__:#secret', allow: 0, deny: 0 },
        { applyHere: true, applySubs: false, inherited: false, userId: null, group: '#secret', allow: 6, deny: 0 },
      ],
    };

    render(<AclEditorDialog isOpen channelId={4} channelName="Secret" onClose={vi.fn()} />);

    const passwordInput = screen.getByLabelText('Channel password selector');

    fireEvent.change(passwordInput, { target: { value: '#draft-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel password change' }));

    expect(passwordInput).toHaveValue('#secret');
    expect(screen.queryByRole('button', { name: 'Cancel password change' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save password' })).not.toBeInTheDocument();
  });

  it('requires saving a non-empty password when password protection has no saved value', () => {
    render(<AclEditorDialog isOpen channelId={4} channelName="Secret" onClose={vi.fn()} />);

    fireEvent.click(screen.getByLabelText('Password protected'));

    expect(screen.getByLabelText('Channel password selector')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Cancel password change' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save password' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Channel password selector'), { target: { value: '#new-secret' } });

    expect(screen.getByRole('button', { name: 'Save password' })).not.toBeDisabled();
  });

  it('uses an icon-only reveal button for the channel password', () => {
    hookSnapshot = {
      ...hookSnapshot,
      groups: [],
      acls: [
        { applyHere: true, applySubs: false, inherited: false, userId: null, group: '__brmble_password_marker__:#secret', allow: 0, deny: 0 },
        { applyHere: true, applySubs: false, inherited: false, userId: null, group: '#secret', allow: 6, deny: 0 },
      ],
    };

    render(<AclEditorDialog isOpen channelId={4} channelName="Secret" onClose={vi.fn()} />);

    const passwordInput = screen.getByLabelText('Channel password selector');

    expect(screen.queryByRole('button', { name: 'Show password' })).not.toBeInTheDocument();

    fireEvent.focus(passwordInput);

    const toggle = screen.getByRole('button', { name: 'Show password' });
    expect(toggle).toHaveTextContent('');
    expect(toggle.querySelector('svg')).toBeInTheDocument();

    fireEvent.mouseDown(toggle);

    expect(passwordInput).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide password' })).toBeInTheDocument();
  });

  it('persists approved-user additions immediately', () => {
    render(<AclEditorDialog isOpen channelId={4} channelName="Secret" onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Only approved users can join' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add User' }));

    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      acls: expect.arrayContaining([
        expect.objectContaining({ userId: 45, allow: 6, deny: 0 }),
      ]),
    }));
  });

  it('removing password protection persists immediately', () => {
    hookSnapshot = {
      ...hookSnapshot,
      groups: [],
      acls: [
        { applyHere: true, applySubs: false, inherited: false, userId: null, group: '__brmble_password_marker__:#secret', allow: 0, deny: 0 },
        { applyHere: true, applySubs: false, inherited: false, userId: null, group: '#secret', allow: 6, deny: 0 },
      ],
    };

    render(<AclEditorDialog isOpen channelId={4} channelName="Secret" onClose={vi.fn()} />);

    fireEvent.click(screen.getByLabelText('Password protected'));

    expect(savePassword).toHaveBeenCalledWith('');
  });

  it('disables ACL actions while a write is in flight', () => {
    hookSaving = true;

    render(<AclEditorDialog isOpen channelId={4} channelName="Secret" onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Only approved users can join' }));

    expect(screen.getByRole('button', { name: 'Everyone can join' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Only approved users can join' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
  });
});
