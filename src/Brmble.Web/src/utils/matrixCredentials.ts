import type { MatrixCredentials } from '../hooks/useMatrixClient';

function recordEqual(a: Record<string, string> | undefined, b: Record<string, string> | undefined): boolean {
  const aEntries = Object.entries(a ?? {}).sort(([left], [right]) => left.localeCompare(right));
  const bEntries = Object.entries(b ?? {}).sort(([left], [right]) => left.localeCompare(right));
  if (aEntries.length !== bEntries.length) return false;
  return aEntries.every(([key, value], index) => bEntries[index][0] === key && bEntries[index][1] === value);
}

function customCompanionsEqual(
  a: MatrixCredentials['customCompanions'],
  b: MatrixCredentials['customCompanions'],
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.enabled === b.enabled
    && a.schemaVersion === b.schemaVersion
    && a.galleryRoomId === b.galleryRoomId
    && a.trustedSender === b.trustedSender
    && a.canModerate === b.canModerate
    && a.selectedCompanionId === b.selectedCompanionId
    && a.maxActivePerUser === b.maxActivePerUser
    && a.maxActiveTotal === b.maxActiveTotal;
}

function messageDeletionEqual(
  a: MatrixCredentials['messageDeletion'],
  b: MatrixCredentials['messageDeletion'],
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.canModerate === b.canModerate
    && a.maxAgeMs === b.maxAgeMs;
}

export function areMatrixCredentialsEqual(a: MatrixCredentials | null, b: MatrixCredentials | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.homeserverUrl === b.homeserverUrl
    && a.accessToken === b.accessToken
    && a.userId === b.userId
    && recordEqual(a.roomMap, b.roomMap)
    && recordEqual(a.dmRoomMap, b.dmRoomMap)
    && customCompanionsEqual(a.customCompanions, b.customCompanions)
    && messageDeletionEqual(a.messageDeletion, b.messageDeletion);
}
