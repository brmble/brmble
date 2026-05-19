import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

const { saveSpy, refreshSpy, aclAdminState, registeredUsersState, groupCatalogState } = vi.hoisted(() => ({
  saveSpy: vi.fn(),
  refreshSpy: vi.fn(),
  aclAdminState: {
    snapshot: null as SnapshotState | null,
    loading: false,
    error: null as string | null,
  },
  registeredUsersState: {
    registeredUsers: [] as RegisteredUserState[],
    loading: false,
    error: null as string | null,
    refresh: vi.fn(),
  },
  groupCatalogState: {
    groups: [] as SnapshotState['groups'],
    acls: [] as AclRule[],
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

function renderCatalogAdminGroupsSection(options: RenderOptions = {}) {
  setAclAdminState(options.aclAdmin);
  setRegisteredUsersState(options.registeredUsers);
  return render(<AdminGroupsSection channels={[{ id: 5, name: 'General' }, { id: 7, name: 'Raid' }]} />);
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
  useAclAdmin: () => ({
    snapshot: aclAdminState.snapshot,
    loading: aclAdminState.loading,
    error: aclAdminState.error,
    refresh: refreshSpy,
    save: saveSpy,
  }),
}));

vi.mock('./useAdminRegisteredUsers', () => ({
  useAdminRegisteredUsers: () => ({
    registeredUsers: registeredUsersState.registeredUsers,
    loading: registeredUsersState.loading,
    error: registeredUsersState.error,
    refresh: registeredUsersState.refresh,
  }),
}));

vi.mock('./useAdminGroupCatalog', () => ({
  useAdminGroupCatalog: () => ({
    groups: groupCatalogState.groups,
    acls: groupCatalogState.acls,
    loading: groupCatalogState.loading,
    error: groupCatalogState.error,
    refresh: groupCatalogState.refresh,
  }),
}));

afterEach(() => {
  saveSpy.mockReset();
  refreshSpy.mockReset();
  registeredUsersState.refresh.mockReset();
  groupCatalogState.groups = [];
  groupCatalogState.acls = [];
  groupCatalogState.loading = false;
  groupCatalogState.error = null;
  groupCatalogState.refresh.mockReset();
  setAclAdminState();
  setRegisteredUsersState();
});

describe('AdminGroupsSection', () => {
  it('renders add/delete actions and save controls for groups', () => {
    renderAdminGroupsSection();

    expect(screen.getByRole('button', { name: 'Add Group' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete Group' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeInTheDocument();
  });

  it('creates and deletes staged groups before save', () => {
    renderAdminGroupsSection();

    fireEvent.click(screen.getByRole('button', { name: 'Add Group' }));
    expect(screen.getByRole('button', { name: '@New Group' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete Group' }));
    expect(screen.queryByRole('button', { name: '@New Group' })).not.toBeInTheDocument();
  });

  it('saves the edited groups through the ACL-backed persistence path', async () => {
    renderAdminGroupsSection();

    fireEvent.click(screen.getByRole('button', { name: 'Add Group' }));
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

    const readChannelsCheckbox = getCheckbox('Read Channels');
    const speakCheckbox = getCheckbox('Speak');

    expect(readChannelsCheckbox).not.toBeChecked();
    expect(speakCheckbox).toBeChecked();

    fireEvent.click(readChannelsCheckbox);
    fireEvent.click(speakCheckbox);
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalledWith(expect.objectContaining({
        acls: expect.arrayContaining([
          expect.objectContaining({
            group: 'Officers',
            allow: Permission.Traverse,
            deny: 0,
          }),
        ]),
      }));
    });
  });

  it('updates permission checkbox state immediately from the local draft after toggles', () => {
    renderAdminGroupsSection();

    const readChannelsCheckbox = getCheckbox('Read Channels');

    expect(readChannelsCheckbox).not.toBeChecked();

    fireEvent.click(readChannelsCheckbox);
    expect(readChannelsCheckbox).toBeChecked();

    fireEvent.click(readChannelsCheckbox);
    expect(readChannelsCheckbox).not.toBeChecked();
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
            allow: Permission.Traverse,
            deny: 0,
          }],
        }),
      },
    });

    const inheritedReadChannelsCheckbox = getCheckbox('Read Channels (Inherited)');

    expect(inheritedReadChannelsCheckbox).toBeChecked();
    expect(inheritedReadChannelsCheckbox).toBeDisabled();

    fireEvent.click(inheritedReadChannelsCheckbox);
    expect(inheritedReadChannelsCheckbox).toBeChecked();
  });

  it('keeps staged permission edits when a fresh snapshot arrives before save', async () => {
    const view = renderAdminGroupsSection();

    fireEvent.click(screen.getByRole('button', { name: 'Add Group' }));
    expect(screen.getByRole('button', { name: '@New Group' })).toBeInTheDocument();

    setAclAdminState({
      snapshot: createSnapshot({
        fetchedAt: '2026-05-19T20:00:00.000Z',
      }),
    });
    view.rerender(<AdminGroupsSection />);

    expect(screen.getByRole('button', { name: '@New Group' })).toBeInTheDocument();
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

  it('stages membership changes by moving users between the available and member panes', () => {
    renderAdminGroupsSection();

    const initialMembersPane = getPaneByHeading('Members of "Officers"');
    const initialAvailableUsersPane = getPaneByHeading('Available users');
    const aliceAvailableRow = getUserRow(initialAvailableUsersPane, 'Alice');

    expect(within(initialMembersPane).queryByText('Alice')).not.toBeInTheDocument();
    expect(within(initialAvailableUsersPane).getByText('Alice')).toBeInTheDocument();
    expect(within(initialAvailableUsersPane).getByText('Bob')).toBeInTheDocument();

    fireEvent.click(within(aliceAvailableRow).getByRole('button', { name: 'Add' }));

    const membersPaneAfterAdd = getPaneByHeading('Members of "Officers"');
    const availableUsersPaneAfterAdd = getPaneByHeading('Available users');
    const aliceMembersRow = getUserRow(membersPaneAfterAdd, 'Alice');

    expect(within(aliceMembersRow).getByText('Member')).toBeInTheDocument();
    expect(within(availableUsersPaneAfterAdd).queryByText('Alice')).not.toBeInTheDocument();
    expect(within(availableUsersPaneAfterAdd).getByText('Bob')).toBeInTheDocument();

    fireEvent.click(within(aliceMembersRow).getByRole('button', { name: 'Remove' }));

    const membersPaneAfterRemove = getPaneByHeading('Members of "Officers"');
    const availableUsersPaneAfterRemove = getPaneByHeading('Available users');

    expect(within(membersPaneAfterRemove).queryByText('Alice')).not.toBeInTheDocument();
    expect(within(availableUsersPaneAfterRemove).getByText('Alice')).toBeInTheDocument();
    expect(within(availableUsersPaneAfterRemove).getByText('Bob')).toBeInTheDocument();
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

    expect(screen.getByRole('checkbox', { name: 'Read Channels' })).toBeInTheDocument();
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

  it('lists acl-backed selectors with native mumble @ labels in the groups rail', () => {
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

    expect(screen.getByRole('button', { name: '@all' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '@auth' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '@Officers' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '@#secret-token' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '@__brmble_password_marker__:#secret-token' })).not.toBeInTheDocument();
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

  it('shows aggregated mumble groups from the channel catalog when channels are provided', () => {
    groupCatalogState.groups = [
      { name: 'Officers', inherited: false, inherit: true, inheritable: true, add: [], remove: [], members: [1] },
    ];
    groupCatalogState.acls = [
      { applyHere: true, applySubs: false, inherited: false, userId: null, group: 'all', allow: Permission.Traverse, deny: 0 },
      { applyHere: true, applySubs: false, inherited: false, userId: null, group: 'auth', allow: Permission.Enter, deny: 0 },
    ];

    renderCatalogAdminGroupsSection();

    expect(screen.getByRole('button', { name: '@Officers' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '@all' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '@auth' })).toBeInTheDocument();
    expect(screen.queryByText('Not connected or invalid channel')).not.toBeInTheDocument();
  });
});
