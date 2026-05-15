import type { MatrixCredentials } from '../hooks/useMatrixClient';

function recordEqual(a: Record<string, string> | undefined, b: Record<string, string> | undefined): boolean {
  const aEntries = Object.entries(a ?? {}).sort(([left], [right]) => left.localeCompare(right));
  const bEntries = Object.entries(b ?? {}).sort(([left], [right]) => left.localeCompare(right));
  if (aEntries.length !== bEntries.length) return false;
  return aEntries.every(([key, value], index) => bEntries[index][0] === key && bEntries[index][1] === value);
}

export function areMatrixCredentialsEqual(a: MatrixCredentials | null, b: MatrixCredentials | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.homeserverUrl === b.homeserverUrl
    && a.accessToken === b.accessToken
    && a.userId === b.userId
    && recordEqual(a.roomMap, b.roomMap)
    && recordEqual(a.dmRoomMap, b.dmRoomMap);
}
