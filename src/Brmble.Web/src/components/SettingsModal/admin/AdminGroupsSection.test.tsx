import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useCallback, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Permission, type AclRule } from '../../../types/acl';
import { AdminGroupsSection } from './AdminGroupsSection';

type SnapshotState = {
  channelId: number;
  inheritAcls: boolean;
  groups: Array<{
    name: string;
    inherited: boolean;
    inherit: boolean;
    inheritable: boolean;
    add: number[];
    remove: number[];
    members: number[];
  }>;
  acls: AclRule[];
  fetchedAt: string;
  stale: boolean;
  warning: string | null;
  snapshotHash: string;
};

type RegisteredUserState = {
  registrationUserId: number;
  registeredName: string;
};

type AclAdminFixture = {
  snapshot: SnapshotState | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
};

type RegisteredUsersFixture = {
  registeredUsers: RegisteredUserState[];
  loading: boolean;
  error: string | null;
  refresh: ReturnType<typeof vi.fn>;
};

type RenderOptions = {
  aclAdmin?: Partial<AclAdminFixture>;
  registeredUsers?: Partial<RegisteredUsersFixture>;
};

const { confirmSpy, promptSpy, saveSpy, refreshSpy, aclAdminState, aclAdminChannelIds, autoRefreshSnapshot, registeredUsersState } = vi.hoisted(() => ({
  confirmSpy: vi.fn(),
  promptSpy: vi.fn(),
  saveSpy: vi.fn(),
  refreshSpy: vi.fn(),
  aclAdminChannelIds: [] as Array<number | null>,
  autoRefreshSnapshot: { value: false },
  aclAdminState: {
    snapshot: null as SnapshotState | null,
    loading: false,
    saving: false,
    error: null as string | null,
  },
  registeredUsersState: {
    registeredUsers: [] as RegisteredUserState[],
    loading: false,
    error: null as string | null,
    refresh: vi.fn(),
  },
}));

function createSnapshot(overrides: Partial<SnapshotState> = {}): SnapshotState {
  return {
    channelId: 0,
    inheritAcls: true,
    groups: [{ name: 'Officers', inherited: false, inherit: true, inheritable: true, add: [], remove: [], members: [] }],
    acls: [],
    fetchedAt: '2026-05-19T19:00:00.000Z',
    stale: false,
    warning: null,
    snapshotHash: 'snapshot-hash',
    ...overrides,
  };
}

function createRegisteredUsers(overrides: Partial<RegisteredUsersFixture> = {}): RegisteredUsersFixture {
  return {
    registeredUsers: [
      { registrationUserId: 1, registeredName: 'Alice' },
      { registrationUserId: 2, registeredName: 'Bob' },
    ],
    loading: false,
    error: null,
    refresh: vi.fn(),
    ...overrides,
  };
}

function setAclAdminState(overrides: Partial<AclAdminFixture> = {}) {
  aclAdminState.snapshot = createSnapshot();
  aclAdminState.loading = false;
  aclAdminState.saving = false;
  aclAdminState.error = null;
  Object.assign(aclAdminState, overrides);
}

function setRegisteredUsersState(overrides: Partial<RegisteredUsersFixture> = {}) {
  Object.assign(registeredUsersState, createRegisteredUsers(overrides));
}

function renderAdminGroupsSection(options: RenderOptions = {}) {
  setAclAdminState(options.aclAdmin);
  setRegisteredUsersState(options.registeredUsers);
  return render(<AdminGroupsSection />);
}

function getPaneByHeading(name: string) {
  const heading = screen.getByRole('heading', { name });
  const pane = heading.parentElement;
  expect(pane).not.toBeNull();
  return pane as HTMLElement;
}

function getCheckbox(name: string) {
  return screen.getByRole('checkbox', { name });
}

function getUserRow(container: HTMLElement, userName: string) {
  const userLabel = within(container).getByText(userName);
  const row = userLabel.closest('.admin-user-row');
  expect(row).not.toBeNull();
  return row as HTMLElement;
}

function renderOperationalPanelFixture() {
  renderAdminGroupsSection({
    aclAdmin: {
      snapshot: createSnapshot({
        groups: [{ name: 'Officers', inherited: false, inherit: true, inheritable: true, add: [], remove: [], members: [1] }],
      }),
    },
  });
}

vi.mock('../../../hooks/useAclAdmin', () => ({
  useAclAdmin: (channelId: number | null) => {
    const [isRefreshing, setIsRefreshing] = useState(false);
    const refresh = useCallback(() => {
      refreshSpy();
      if (!autoRefreshSnapshot.value) return;

      setIsRefreshing(true);
      setTimeout(() => {
        aclAdminState.snapshot = createSnapshot();
        aclAdminState.loading = false;
        setIsRefreshing(false);
      }, 0);
    }, []);

    aclAdminChannelIds.push(channelId);
    return {
    snapshot: aclAdminState.snapshot,
    loading: isRefreshing || aclAdminState.loading,
    saving: aclAdminState.saving,
    error: aclAdminState.error,
    refresh,
    save: saveSpy,
    };
  },
}));

vi.mock('../../../hooks/usePrompt', () => ({
  confirm: confirmSpy,
  prompt: promptSpy,
}));

vi.mock('./useAdminRegisteredUsers', () => ({
  useAdminRegisteredUsers: () => ({
    registeredUsers: registeredUsersState.registeredUsers,
    loading: registeredUsersState.loading,
    error: registeredUsersState.error,
    refresh: registeredUsersState.refresh,
  }),
}));

afterEach(() => {
  saveSpy.mockReset();
  confirmSpy.mockReset();
  promptSpy.mockReset();
  refreshSpy.mockReset();
  autoRefreshSnapshot.value = false;
  aclAdminChannelIds.length = 0;
  registeredUsersState.refresh.mockReset();
  setAclAdminState();
  setRegisteredUsersState();
});

describe('AdminGroupsSection', () => {
  it('shows only local inheritable groups defined on the root channel', () => {
    renderAdminGroupsSection({
      aclAdmin: {
        snapshot: createSnapshot({
          groups: [
            { name: 'Classleaders', inherited: false, inherit: true, inheritable: true, add: [], remove: [], members: [1] },
            { name: 'RootLocalOnly', inherited: false, inherit: true, inheritable: false, add: [], remove: [], members: [] },
            { name: 'InheritedGroup', inherited: true, inherit: true, inheritable: true, add: [], remove: [], members: [] },
          ],
          acls: [{ applyHere: true, applySubs: true, inherited: false, userId: null, group: 'AclOnly', allow: Permission.Speak, deny: 0 }],
        }),
      },
    });

    expect(screen.getByRole('button', { name: '@Classleaders' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '@RootLocalOnly' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '@InheritedGroup' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '@AclOnly' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete Group' })).not.toBeInTheDocument();
  });

  it('creates a named inheritable root group and saves it through the ACL hook', async () => {
    renderAdminGroupsSection({ aclAdmin: { snapshot: createSnapshot({ groups: [], acls: [] }) } });
    promptSpy.mockResolvedValue('Classleaders');

    fireEvent.click(screen.getByRole('button', { name: 'Add Group' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '@Classleaders' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(saveSpy).toHaveBeenCalledWith(expect.objectContaining({
      groups: [expect.objectContaining({ name: 'Classleaders', inherited: false, inheritable: true })],
    })));
  });

  it('does not stage reserved Mumble selector syntax as a group name', async () => {
    renderAdminGroupsSection({ aclAdmin: { snapshot: createSnapshot({ groups: [], acls: [] }) } });
    promptSpy.mockResolvedValue('all');

    fireEvent.click(screen.getByRole('button', { name: 'Add Group' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: '@all' })).not.toBeInTheDocument());
  });

  it('explains when a group name already exists', async () => {
    renderAdminGroupsSection();
    promptSpy.mockResolvedValue('Officers');

    fireEvent.click(screen.getByRole('button', { name: 'Add Group' }));

    await waitFor(() => expect(confirmSpy).toHaveBeenCalledWith({
      title: 'Duplicate group name',
      message: 'A group named "Officers" already exists.',
      confirmLabel: 'OK',
    }));
  });

  it('preserves hidden local non-inheritable groups in replacement saves', async () => {
    const hiddenGroup = { name: 'RootLocalOnly', inherited: false, inherit: true, inheritable: false, add: [], remove: [], members: [77] };
    renderAdminGroupsSection({
      aclAdmin: { snapshot: createSnapshot({ groups: [hiddenGroup, { name: 'Classleaders', inherited: false, inherit: true, inheritable: true, add: [], remove: [], members: [] }] }) },
    });

    fireEvent.click(getCheckbox('Speak'));
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(saveSpy).toHaveBeenCalledWith(expect.objectContaining({
      groups: [hiddenGroup, expect.objectContaining({ name: 'Classleaders' })],
    })));
  });

  it('keeps channel entry permissions out of the root group permission grid', () => {
    renderAdminGroupsSection();

    expect(screen.queryByRole('checkbox', { name: 'Read Channels' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Join Channels' })).not.toBeInTheDocument();
    expect(screen.getByText(/channel access is assigned from the Channels tab/i)).toBeInTheDocument();
  });

  it('renders add and save controls without rename or delete', () => {
    renderAdminGroupsSection();

    expect(screen.getByRole('button', { name: 'Add Group' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete Group' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeInTheDocument();
  });

  it('creates a named staged group before save', async () => {
    renderAdminGroupsSection();
    promptSpy.mockResolvedValue('Classleaders');

    fireEvent.click(screen.getByRole('button', { name: 'Add Group' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '@Classleaders' })).toBeInTheDocument());
  });

  it('does not stage the same group name more than once', async () => {
    renderAdminGroupsSection({ aclAdmin: { snapshot: createSnapshot({ groups: [], acls: [] }) } });
    promptSpy.mockResolvedValue('Classleaders');

    fireEvent.click(screen.getByRole('button', { name: 'Add Group' }));
    await waitFor(() => expect(screen.getAllByRole('button', { name: '@Classleaders' })).toHaveLength(1));

    fireEvent.click(screen.getByRole('button', { name: 'Add Group' }));
    await waitFor(() => expect(promptSpy).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getAllByRole('button', { name: '@Classleaders' })).toHaveLength(1));
  });

  it('saves the edited groups through the ACL-backed persistence path', async () => {
    renderAdminGroupsSection();

    promptSpy.mockResolvedValue('Classleaders');
    fireEvent.click(screen.getByRole('button', { name: 'Add Group' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '@Classleaders' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalled();
    });
  });

  it('stages permission edits and persists them through the save payload', async () => {
    renderAdminGroupsSection({
      aclAdmin: {
        snapshot: createSnapshot({
          acls: [{
            applyHere: true,
            applySubs: true,
            inherited: false,
            userId: null,
            group: 'Officers',
            allow: Permission.Speak,
            deny: 0,
          }],
        }),
      },
    });

    const writeMessagesCheckbox = getCheckbox('Write Messages');
    const speakCheckbox = getCheckbox('Speak');

    expect(writeMessagesCheckbox).not.toBeChecked();
    expect(speakCheckbox).toBeChecked();

    fireEvent.click(writeMessagesCheckbox);
    fireEvent.click(speakCheckbox);
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalledWith(expect.objectContaining({
        acls: expect.arrayContaining([
          expect.objectContaining({
            group: 'Officers',
            allow: Permission.TextMessage,
            deny: 0,
          }),
        ]),
      }));
    });
  });

  it('updates permission checkbox state immediately from the local draft after toggles', () => {
    renderAdminGroupsSection();

    const writeMessagesCheckbox = getCheckbox('Write Messages');

    expect(writeMessagesCheckbox).not.toBeChecked();

    fireEvent.click(writeMessagesCheckbox);
    expect(writeMessagesCheckbox).toBeChecked();

    fireEvent.click(writeMessagesCheckbox);
    expect(writeMessagesCheckbox).not.toBeChecked();
  });

  it('shows inherited-only permissions as checked but non-editable', () => {
    renderAdminGroupsSection({
      aclAdmin: {
        snapshot: createSnapshot({
          acls: [{
            applyHere: true,
            applySubs: true,
            inherited: true,
            userId: null,
            group: 'Officers',
            allow: Permission.Speak,
            deny: 0,
          }],
        }),
      },
    });

    const inheritedSpeakCheckbox = getCheckbox('Speak (Inherited)');

    expect(inheritedSpeakCheckbox).toBeChecked();
    expect(inheritedSpeakCheckbox).toBeDisabled();

    fireEvent.click(inheritedSpeakCheckbox);
    expect(inheritedSpeakCheckbox).toBeChecked();
  });

  it('keeps staged permission edits when a fresh snapshot arrives before save', async () => {
    const view = renderAdminGroupsSection();

    promptSpy.mockResolvedValue('Classleaders');
    fireEvent.click(screen.getByRole('button', { name: 'Add Group' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '@Classleaders' })).toBeInTheDocument());

    setAclAdminState({
      snapshot: createSnapshot({
        fetchedAt: '2026-05-19T20:00:00.000Z',
      }),
    });
    view.rerender(<AdminGroupsSection />);

    expect(screen.getByRole('button', { name: '@Classleaders' })).toBeInTheDocument();
  });

  it('shows registered users split between current group members and available users', () => {
    renderAdminGroupsSection({
      aclAdmin: {
        snapshot: createSnapshot({
          groups: [{ name: 'Officers', inherited: false, inherit: true, inheritable: true, add: [], remove: [], members: [1] }],
        }),
      },
    });

    const membersPane = getPaneByHeading('Members of "Officers"');
    const availableUsersPane = getPaneByHeading('Available users');

    expect(within(membersPane).getByText('Alice')).toBeInTheDocument();
    expect(within(membersPane).queryByText('Bob')).not.toBeInTheDocument();
    expect(within(availableUsersPane).getByText('Bob')).toBeInTheDocument();
    expect(within(availableUsersPane).queryByText('Alice')).not.toBeInTheDocument();
  });

  it('shows a confirmed membership change immediately while saving', async () => {
    confirmSpy.mockResolvedValue(true);
    renderAdminGroupsSection();

    const initialMembersPane = getPaneByHeading('Members of "Officers"');
    const initialAvailableUsersPane = getPaneByHeading('Available users');
    const aliceAvailableRow = getUserRow(initialAvailableUsersPane, 'Alice');

    expect(within(initialMembersPane).queryByText('Alice')).not.toBeInTheDocument();
    expect(within(initialAvailableUsersPane).getByText('Alice')).toBeInTheDocument();
    expect(within(initialAvailableUsersPane).getByText('Bob')).toBeInTheDocument();

    fireEvent.click(within(aliceAvailableRow).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(confirmSpy).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Add Alice to @Officers?',
      confirmLabel: 'Save',
    })));
    await waitFor(() => expect(saveSpy).toHaveBeenCalledWith(expect.objectContaining({
      groups: [expect.objectContaining({ name: 'Officers', add: [1], remove: [], members: [1] })],
    })));

    const membersPaneAfterAdd = getPaneByHeading('Members of "Officers"');
    const availableUsersPaneAfterAdd = getPaneByHeading('Available users');

    expect(within(membersPaneAfterAdd).getByText('Alice')).toBeInTheDocument();
    expect(within(availableUsersPaneAfterAdd).queryByText('Alice')).not.toBeInTheDocument();
    expect(within(availableUsersPaneAfterAdd).getByText('Bob')).toBeInTheDocument();
  });

  it('does not show inherited groups in the editable root-group list', () => {
    renderAdminGroupsSection({
      aclAdmin: {
        snapshot: createSnapshot({
          groups: [{ name: 'Inherited Officers', inherited: true, inherit: true, inheritable: true, add: [], remove: [], members: [1] }],
        }),
      },
    });

    expect(screen.queryByRole('button', { name: '@Inherited Officers' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Members' })).toBeInTheDocument();
  });

  it('does not save a membership change when the shared confirmation is canceled', async () => {
    confirmSpy.mockResolvedValue(false);
    renderAdminGroupsSection();

    const availableUsersPane = getPaneByHeading('Available users');
    const aliceAvailableRow = getUserRow(availableUsersPane, 'Alice');

    fireEvent.click(within(aliceAvailableRow).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());

    expect(saveSpy).not.toHaveBeenCalled();
    expect(within(getPaneByHeading('Members of "Officers"')).queryByText('Alice')).not.toBeInTheDocument();
    expect(within(getPaneByHeading('Available users')).getByText('Alice')).toBeInTheDocument();
  });

  it('persists membership changes through group add and remove lists', async () => {
    confirmSpy.mockResolvedValue(true);
    renderAdminGroupsSection();

    const availableUsersPane = getPaneByHeading('Available users');
    const aliceAvailableRow = getUserRow(availableUsersPane, 'Alice');

    fireEvent.click(within(aliceAvailableRow).getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalledWith(expect.objectContaining({
        groups: [expect.objectContaining({
          add: [1],
          remove: [],
          members: [1],
        })],
      }));
    });
  });

  it('does not save unrelated staged ACL edits with a membership change', async () => {
    confirmSpy.mockResolvedValue(true);
    const view = renderAdminGroupsSection({
      aclAdmin: {
        snapshot: createSnapshot({
          groups: [{ name: 'Officers', inherited: false, inherit: true, inheritable: true, add: [], remove: [], members: [] }],
          acls: [{
            applyHere: true,
            applySubs: true,
            inherited: false,
            userId: null,
            group: 'Officers',
            allow: Permission.Speak,
            deny: 0,
          }],
        }),
      },
    });

    fireEvent.click(getCheckbox('Write Messages'));
    const availableUsersPane = getPaneByHeading('Available users');
    const aliceAvailableRow = getUserRow(availableUsersPane, 'Alice');
    fireEvent.click(within(aliceAvailableRow).getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalledWith(expect.objectContaining({
        groups: [expect.objectContaining({ add: [1], remove: [], members: [1] })],
        acls: [{
          applyHere: true,
          applySubs: true,
          inherited: false,
          userId: null,
          group: 'Officers',
          allow: Permission.Speak,
          deny: 0,
        }],
      }));
    });

    setAclAdminState({
      snapshot: createSnapshot({
        groups: [{ name: 'Officers', inherited: false, inherit: true, inheritable: true, add: [1], remove: [], members: [1] }],
        acls: [{
          applyHere: true,
          applySubs: true,
          inherited: false,
          userId: null,
          group: 'Officers',
          allow: Permission.Speak,
          deny: 0,
        }],
      }),
    });
    view.rerender(<AdminGroupsSection />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(getCheckbox('Write Messages')).not.toBeChecked();
    expect(within(getPaneByHeading('Members of "Officers"')).getByText('Alice')).toBeInTheDocument();
  });

  it('disables membership actions while a membership save is in progress', () => {
    renderAdminGroupsSection({ aclAdmin: { saving: true } });

    const availableUsersPane = getPaneByHeading('Available users');
    expect(within(getUserRow(availableUsersPane, 'Alice')).getByRole('button', { name: 'Add' })).toBeDisabled();
  });

  it('shows the available-users pane heading in the operational panel', () => {
    renderOperationalPanelFixture();

    expect(screen.getByRole('heading', { name: 'Available users' })).toBeInTheDocument();
  });

  it('shows the selected-group membership heading target for the operational panel', () => {
    renderOperationalPanelFixture();

    expect(screen.getByRole('heading', { name: 'Members of "Officers"' })).toBeInTheDocument();
  });

  it('shows the transfer workspace heading for the operational panel', () => {
    renderOperationalPanelFixture();

    expect(screen.getByText('Transfer actions')).toBeInTheDocument();
  });

  it('shows permission category headings for the operational panel', () => {
    renderOperationalPanelFixture();

    expect(screen.getByRole('heading', { name: 'General Permissions' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Moderation Permissions' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Channel Management' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Administrative Permissions' })).toBeInTheDocument();
  });

  it('shows permission checkbox labels for the operational panel', () => {
    renderOperationalPanelFixture();

    expect(screen.getByRole('checkbox', { name: 'Write Messages' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Manage Groups (Unavailable)' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Manage Channel Settings & ACLs' })).toBeInTheDocument();
  });

  it('uses a single clear label for the shared write permission', () => {
    renderOperationalPanelFixture();

    expect(screen.getByRole('checkbox', { name: 'Manage Channel Settings & ACLs' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Edit Channel Settings' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Manage ACL' })).not.toBeInTheDocument();
  });

  it('shows unavailable permission labels explicitly and keeps them unchecked', () => {
    renderAdminGroupsSection({
      aclAdmin: {
        snapshot: createSnapshot({
          acls: [{
            applyHere: true,
            applySubs: true,
            inherited: false,
            userId: null,
            group: 'Officers',
            allow: Permission.Register,
            deny: 0,
          }],
        }),
      },
    });

    const unavailableManageGroups = getCheckbox('Manage Groups (Unavailable)');

    expect(unavailableManageGroups).toBeDisabled();
    expect(unavailableManageGroups).not.toBeChecked();
  });

  it('updates the membership heading target when another group is selected from the compact rail', () => {
    renderAdminGroupsSection({
      aclAdmin: {
        snapshot: createSnapshot({
          groups: [
            { name: 'Officers', inherited: false, inherit: true, inheritable: true, add: [], remove: [], members: [1] },
            { name: 'Members', inherited: false, inherit: true, inheritable: true, add: [], remove: [], members: [2] },
          ],
        }),
      },
    });

    fireEvent.click(screen.getByRole('button', { name: '@Members' }));

    expect(screen.getByRole('heading', { name: 'Members of "Members"' })).toBeInTheDocument();
  });

  it('does not synthesize groups from ACL selectors', () => {
    renderAdminGroupsSection({
      aclAdmin: {
        snapshot: createSnapshot({
          groups: [],
          acls: [
            { applyHere: true, applySubs: false, inherited: false, userId: null, group: 'all', allow: Permission.Traverse, deny: 0 },
            { applyHere: true, applySubs: false, inherited: false, userId: null, group: 'auth', allow: Permission.Enter, deny: 0 },
            { applyHere: true, applySubs: false, inherited: false, userId: null, group: 'Officers', allow: Permission.Speak, deny: 0 },
            { applyHere: true, applySubs: false, inherited: false, userId: null, group: '#secret-token', allow: Permission.Enter, deny: 0 },
            { applyHere: true, applySubs: false, inherited: false, userId: null, group: '__brmble_password_marker__:#secret-token', allow: 0, deny: 0 },
          ],
        }),
      },
    });

    expect(screen.queryByRole('button', { name: '@all' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '@auth' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '@Officers' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '@#secret-token' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '@__brmble_password_marker__:#secret-token' })).not.toBeInTheDocument();
  });

  it('does not offer membership editing for ACL-only groups', async () => {
    renderAdminGroupsSection({
      aclAdmin: {
        snapshot: createSnapshot({
          groups: [],
          acls: [{ applyHere: true, applySubs: false, inherited: false, userId: null, group: 'admin', allow: Permission.Write, deny: 0 }],
        }),
      },
    });

    expect(screen.queryByRole('button', { name: '@admin' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Select a group to manage its members.')).toHaveLength(2);
  });

  it('does not show placeholder groups when no acl snapshot is available', () => {
    renderAdminGroupsSection({
      aclAdmin: {
        snapshot: null,
        error: 'Not connected or invalid channel',
      },
    });

    expect(screen.queryByRole('button', { name: '@Officers' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '@Members' })).not.toBeInTheDocument();
  });

  it('hydrates root groups after the initial refresh returns a snapshot', async () => {
    autoRefreshSnapshot.value = true;
    renderAdminGroupsSection({
      aclAdmin: {
        snapshot: null,
      },
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '@Officers' })).toBeInTheDocument();
    });
  });

  it('shows the connection status message above the transfer workspace', () => {
    renderAdminGroupsSection({
      aclAdmin: {
        error: 'Not connected or invalid channel',
      },
    });

    const transferWorkspaceHeading = screen.getByText('Transfer actions');
    const statusMessage = screen.getByText('Not connected or invalid channel');

    expect(statusMessage.compareDocumentPosition(transferWorkspaceHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows the loading status message above the transfer workspace', () => {
    renderAdminGroupsSection({
      aclAdmin: {
        loading: true,
      },
      registeredUsers: {
        loading: true,
      },
    });

    const transferWorkspaceHeading = screen.getByText('Transfer actions');
    const statusMessage = screen.getByText('Loading groups and registered users...');

    expect(statusMessage.compareDocumentPosition(transferWorkspaceHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps the root groups editor editable', () => {
    setAclAdminState({
      snapshot: createSnapshot({
        groups: [{ name: 'Root Officers', inherited: false, inherit: true, inheritable: true, add: [], remove: [], members: [] }],
      }),
    });

    render(<AdminGroupsSection />);

    expect(screen.getByRole('button', { name: '@Root Officers' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Group' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Delete Group' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Write Messages' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled();
    expect(screen.queryByText('Showing groups aggregated from all Mumble channels.')).not.toBeInTheDocument();
    expect(aclAdminChannelIds).toContain(0);
  });
});
