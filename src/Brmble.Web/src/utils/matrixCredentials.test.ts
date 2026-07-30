import { describe, expect, it } from 'vitest';
import { areMatrixCredentialsEqual } from './matrixCredentials';
import type { MatrixCredentials } from '../hooks/useMatrixClient';

const base: MatrixCredentials = {
  homeserverUrl: 'https://matrix.example.com',
  accessToken: 'tok_1',
  userId: '@me:example.com',
  roomMap: { '1': '!one:example.com' },
  dmRoomMap: { '@alice:example.com': '!dm:example.com' },
  customCompanions: {
    enabled: true,
    schemaVersion: 1,
    galleryRoomId: '!gallery:example.com',
    trustedSender: '@brmble:example.com',
    canModerate: false,
    selectedCompanionId: 'floppy',
    maxActivePerUser: 10,
    maxActiveTotal: 100,
  },
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

  it.each([
    ['galleryRoomId', '!other:example.com'],
    ['canModerate', true],
    ['selectedCompanionId', 'bee'],
  ] as const)('returns false when custom companion %s changes', (key, value) => {
    expect(areMatrixCredentialsEqual(base, {
      ...base,
      customCompanions: { ...base.customCompanions!, [key]: value },
    })).toBe(false);
  });

  it('compares every custom companion capability scalar', () => {
    expect(areMatrixCredentialsEqual(base, {
      ...base,
      customCompanions: { ...base.customCompanions! },
    })).toBe(true);
    expect(areMatrixCredentialsEqual(base, {
      ...base,
      customCompanions: { ...base.customCompanions!, maxActiveTotal: 101 },
    })).toBe(false);
    expect(areMatrixCredentialsEqual(base, { ...base, customCompanions: undefined })).toBe(false);
  });
});
