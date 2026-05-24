interface DeletionContext {
  senderMatrixUserId?: string;
  currentUserMatrixId?: string;
  isDeleted?: boolean;
  createdAt: Date;
  requesterIsAdmin?: boolean;
  now?: Date;
}

export function canShowDeleteMessageAction(context: DeletionContext): boolean {
  if (context.isDeleted) return false;
  if (context.requesterIsAdmin) return true;
  if (!context.senderMatrixUserId || !context.currentUserMatrixId) return false;
  if (context.senderMatrixUserId !== context.currentUserMatrixId) return false;
  const now = context.now ?? new Date();
  return now.getTime() - context.createdAt.getTime() <= 24 * 60 * 60 * 1000;
}
