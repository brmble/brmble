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

  it('allows admins to delete any message', () => {
    expect(canShowDeleteMessageAction({
      senderMatrixUserId: '@bob:example.com',
      currentUserMatrixId: '@alice:example.com',
      createdAt: new Date(Date.now() - (7 * 24 * 60 * 60 * 1000)),
      requesterIsAdmin: true,
    })).toBe(true);
  });

  it('allows matching localparts even when domains differ', () => {
    expect(canShowDeleteMessageAction({
      senderMatrixUserId: '@1:noscope.it',
      currentUserMatrixId: '@1:localhost',
      createdAt: new Date(Date.now() - 1000),
    })).toBe(true);
  });
});
