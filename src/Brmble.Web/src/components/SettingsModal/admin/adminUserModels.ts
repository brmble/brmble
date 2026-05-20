export interface AdminRegisteredUser {
  registrationUserId: number;
  registeredName: string;
}

export interface AdminConnectedUser {
  session: number;
  name: string;
  channelId?: number;
  matrixUserId?: string;
  companionId?: string;
  isBrmbleClient?: boolean;
}

export interface AdminBannedUser {
  banIndex: number;
  name: string;
  address: string;
  hash: string;
  reason: string;
  start: number;
  duration: number;
}

export interface AdminUserRow {
  key: string;
  displayName: string;
  searchText: string;
  aliases: string[];
  isRegistered: boolean;
  isConnected: boolean;
  isBanned: boolean;
  registrationUserId?: number;
  sessionId?: number;
  banIndex?: number;
  matrixUserId?: string;
  address?: string;
  hash?: string;
  sourceKinds: Array<'registered' | 'connected' | 'banned'>;
}

const normalize = (value: string) => value.trim().toLowerCase();

export function buildAdminUserRows(input: {
  registeredUsers: AdminRegisteredUser[];
  connectedUsers: AdminConnectedUser[];
  bannedUsers: AdminBannedUser[];
}): AdminUserRow[] {
  const rows = new Map<string, AdminUserRow>();

  for (const registeredUser of input.registeredUsers) {
    rows.set(`registered:${registeredUser.registrationUserId}`, {
      key: `registered:${registeredUser.registrationUserId}`,
      displayName: registeredUser.registeredName,
      searchText: normalize(registeredUser.registeredName),
      aliases: [registeredUser.registeredName],
      isRegistered: true,
      isConnected: false,
      isBanned: false,
      registrationUserId: registeredUser.registrationUserId,
      sourceKinds: ['registered'],
    });
  }

  for (const connectedUser of input.connectedUsers) {
    const normalizedConnectedName = normalize(connectedUser.name);
    const existing = [...rows.values()].find(row => row.isRegistered && normalize(row.displayName) === normalizedConnectedName);

    if (existing) {
      existing.isConnected = true;
      existing.sessionId = connectedUser.session;
      existing.matrixUserId = connectedUser.matrixUserId;
      existing.aliases = Array.from(new Set([...existing.aliases, connectedUser.name]));
      existing.searchText = normalize([...existing.aliases, connectedUser.matrixUserId ?? ''].join(' '));
      existing.sourceKinds = Array.from(new Set([...existing.sourceKinds, 'connected']));
      continue;
    }

    rows.set(`connected:${connectedUser.session}`, {
      key: `connected:${connectedUser.session}`,
      displayName: connectedUser.name,
      searchText: normalize([connectedUser.name, connectedUser.matrixUserId ?? ''].join(' ')),
      aliases: [connectedUser.name],
      isRegistered: false,
      isConnected: true,
      isBanned: false,
      sessionId: connectedUser.session,
      matrixUserId: connectedUser.matrixUserId,
      sourceKinds: ['connected'],
    });
  }

  for (const bannedUser of input.bannedUsers) {
    const exactHashMatch = [...rows.values()].find(row => row.hash && row.hash === bannedUser.hash);

    if (exactHashMatch) {
      exactHashMatch.isBanned = true;
      exactHashMatch.banIndex = bannedUser.banIndex;
      exactHashMatch.address = bannedUser.address;
      exactHashMatch.hash = bannedUser.hash;
      exactHashMatch.searchText = normalize([exactHashMatch.searchText, bannedUser.address, bannedUser.hash].join(' '));
      exactHashMatch.sourceKinds = Array.from(new Set([...exactHashMatch.sourceKinds, 'banned']));
      continue;
    }

    rows.set(`banned:${bannedUser.banIndex}`, {
      key: `banned:${bannedUser.banIndex}`,
      displayName: bannedUser.name || bannedUser.address,
      searchText: normalize([bannedUser.name, bannedUser.address, bannedUser.hash].join(' ')),
      aliases: [bannedUser.name, bannedUser.address].filter(Boolean),
      isRegistered: false,
      isConnected: false,
      isBanned: true,
      banIndex: bannedUser.banIndex,
      address: bannedUser.address,
      hash: bannedUser.hash,
      sourceKinds: ['banned'],
    });
  }

  return [...rows.values()].sort((left, right) => left.displayName.localeCompare(right.displayName));
}
