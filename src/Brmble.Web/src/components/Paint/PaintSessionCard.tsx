import { useEffect, useState } from 'react';
import { paintApi } from '../../api/paint';
import type { PaintSessionStatus } from '../../types/paint';
import './PaintSessionCard.css';
export interface PaintInvitation { sessionId: string; hostUserId: number; participantUserIds: number[]; channelId: number; status: 'active' | 'ended' | 'expired' | 'unavailable'; sourceEventId?: string; sourcePreview?: string; }
export function PaintSessionCard({ session, canJoin, onJoin, getSnapshot = paintApi.getSnapshot }: { session: PaintInvitation; canJoin: boolean; onJoin: () => void; getSnapshot?: (sessionId: string) => Promise<{ status: PaintSessionStatus }> }) {
  const [status, setStatus] = useState<PaintSessionStatus>(session.status);
  useEffect(() => { let disposed = false; void getSnapshot(session.sessionId).then(next => { if (!disposed) setStatus(next.status); }).catch(() => { if (!disposed) setStatus('unavailable'); }); return () => { disposed = true; }; }, [getSnapshot, session.sessionId]);
  const live = status === 'active';
  return <section className="paint-session-card" aria-label="Collaborative paint session"><strong>Collaborative paint</strong><span>{live ? 'Ready to paint' : `Session ${status}`}</span>{live && canJoin && <button onClick={onJoin}>Join paint</button>}{live && !canJoin && <span>Not available to you</span>}</section>;
}
