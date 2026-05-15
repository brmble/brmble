import { describe, expect, it } from 'vitest';
import { areMatrixCredentialsEqual } from './matrixCredentials';
import type { MatrixCredentials } from '../hooks/useMatrixClient';

const base: MatrixCredentials = {
  homeserverUrl: 'https://matrix.example.com',
  accessToken: 'tok_1',
  userId: '@me:example.com',
  roomMap: { '1': '!one:example.com' },
  dmRoomMap: { '@alice:example.com': '!dm:example.com' },
};

describe('areMatrixCredentialsEqual', () => {
  it('returns true for equal credentials with equal maps', () => {
    expect(areMatrixCredentialsEqual(base, { ...base, roomMap: { '1': '!one:example.com' }, dmRoomMap: { '@alice:example.com': '!dm:example.com' } })).toBe(true);
  });

  it('returns false when access token changes', () => {
    expect(areMatrixCredentialsEqual(base, { ...base, accessToken: 'tok_2' })).toBe(false);
  });

  it('returns false when DM map changes', () => {
    expect(areMatrixCredentialsEqual(base, { ...base, dmRoomMap: { '@bob:example.com': '!dm2:example.com' } })).toBe(false);
  });
});
