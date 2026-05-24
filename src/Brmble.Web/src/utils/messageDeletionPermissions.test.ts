import { describe, expect, it } from 'vitest';
import { canShowDeleteMessageAction } from './messageDeletionPermissions';

describe('canShowDeleteMessageAction', () => {
  it('allows own message within 24 hours', () => {
    expect(canShowDeleteMessageAction({
      senderMatrixUserId: '@alice:example.com',
      currentUserMatrixId: '@alice:example.com',
      createdAt: new Date(Date.now() - 1000),
    })).toBe(true);
  });

  it('denies deleted message', () => {
    expect(canShowDeleteMessageAction({
      senderMatrixUserId: '@alice:example.com',
      currentUserMatrixId: '@alice:example.com',
      createdAt: new Date(),
      isDeleted: true,
    })).toBe(false);
  });
});
