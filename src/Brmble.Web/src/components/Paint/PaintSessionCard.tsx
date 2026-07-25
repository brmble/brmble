import { useEffect, useState } from 'react';
import { paintApi } from '../../api/paint';
import type { PaintSessionStatus } from '../../types/paint';
import './PaintSessionCard.css';
export interface PaintInvitation { sessionId: string; hostUserId: number; participantUserIds: number[]; channelId: number; status: 'active' | 'ended' | 'expired' | 'unavailable'; sourceEventId?: string; sourcePreview?: string; }
export function PaintSessionCard({
  session,
  canJoin,
  onJoin,
  getSnapshot = paintApi.getSnapshot,
  liveStatus,
}: {
  session: PaintInvitation;
  canJoin: boolean;
  onJoin: () => void;
  getSnapshot?: (sessionId: string) => Promise<{ status: PaintSessionStatus }>;
  liveStatus?: PaintSessionStatus;
}) {
  const [liveSnapshot, setLiveSnapshot] = useState<{ sessionId: string; status: PaintSessionStatus } | null>(null);
  useEffect(() => { let disposed = false; void getSnapshot(session.sessionId).then(next => { if (!disposed) setLiveSnapshot({ sessionId: session.sessionId, status: next.status }); }).catch(() => { if (!disposed) setLiveSnapshot({ sessionId: session.sessionId, status: 'unavailable' }); }); return () => { disposed = true; }; }, [getSnapshot, session.sessionId]);
  const status = liveStatus ?? (liveSnapshot?.sessionId === session.sessionId ? liveSnapshot.status : null);
  const active = status === 'active';
  const message = status === null
    ? 'Checking session'
    : status === 'active'
      ? 'Session is available'
      : status === 'ended'
        ? 'Session has ended'
        : status === 'expired'
          ? 'Session has expired'
          : 'Session is unavailable';

  return (
    <section className={`paint-session-card paint-session-card--${status ?? 'checking'}`} aria-label="Collaborative paint session">
      <strong>Collaborative paint</strong>
      <span>{message}</span>
      {active && canJoin && <button type="button" onClick={onJoin}>Join paint</button>}
      {active && !canJoin && <span>Not available to you</span>}
    </section>
  );
}
