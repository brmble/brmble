import './PaintSessionCard.css';
export interface PaintInvitation { sessionId: string; hostUserId: number; participantUserIds: number[]; channelId: number; status: 'active' | 'ended' | 'expired' | 'unavailable'; sourceEventId?: string; sourcePreview?: string; }
export function PaintSessionCard({ session, canJoin, onJoin }: { session: PaintInvitation; canJoin: boolean; onJoin: () => void }) {
  const live = session.status === 'active';
  return <section className="paint-session-card" aria-label="Collaborative paint session"><strong>Collaborative paint</strong><span>{live ? 'Ready to paint' : `Session ${session.status}`}</span>{live && canJoin && <button onClick={onJoin}>Join paint</button>}{live && !canJoin && <span>Not available to you</span>}</section>;
}
