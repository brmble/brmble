import { useCallback, useEffect, useState } from 'react';
import { paintApi } from '../../api/paint';
import type { PaintSessionStatus, PaintSessionSummary } from '../../types/paint';
import './PaintSessionCard.css';

export interface PaintInvitation {
  version?: 2;
  sessionId: string;
  channelId: number;
  status: 'active' | 'ended' | 'expired' | 'unavailable';
}

export function PaintSessionCard({
  session,
  onJoin,
  onOpen,
  getSummary = paintApi.getSummary,
  liveStatus,
  currentVoiceChannelId,
}: {
  session: PaintInvitation;
  onJoin: (sessionId: string) => Promise<void> | void;
  onOpen: (sessionId: string) => void;
  getSummary?: (sessionId: string) => Promise<PaintSessionSummary>;
  liveStatus?: PaintSessionStatus;
  currentVoiceChannelId?: number;
}) {
  const [summary, setSummary] = useState<PaintSessionSummary | null>(null);
  const [status, setStatus] = useState<PaintSessionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  const refresh = useCallback(async () => {
    const next = await getSummary(session.sessionId);
    setSummary(next);
    setStatus(next.status);
    setError(null);
  }, [getSummary, session.sessionId]);

  useEffect(() => {
    let disposed = false;
    void getSummary(session.sessionId)
      .then(next => {
        if (disposed) return;
        setSummary(next);
        setStatus(next.status);
        setError(null);
      })
      .catch(() => {
        if (disposed) return;
        setSummary(null);
        setStatus('unavailable');
      });
    return () => { disposed = true; };
  }, [currentVoiceChannelId, getSummary, session.sessionId]);

  const handleJoin = async () => {
    setJoining(true);
    setError(null);
    try {
      await onJoin(session.sessionId);
      onOpen(session.sessionId);
      void refresh().catch(() => {});
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to join paint.');
    } finally {
      setJoining(false);
    }
  };

  const effectiveStatus = liveStatus === 'unavailable' && summary !== null
    ? status
    : liveStatus ?? status;
  const active = effectiveStatus === 'active';
  const isParticipant = active && summary?.isParticipant === true;
  const canJoin = active && summary?.canJoin === true && !isParticipant;
  const unavailableToViewer = active && summary !== null && !summary.canJoin && !summary.isParticipant;
  const message = effectiveStatus === null
    ? 'Checking session'
    : effectiveStatus === 'active'
      ? 'Session is available'
      : effectiveStatus === 'ended'
        ? 'Session has ended'
        : effectiveStatus === 'expired'
          ? 'Session has expired'
          : 'Session is unavailable';

  return (
    <section className={`paint-session-card paint-session-card--${effectiveStatus ?? 'checking'}`} aria-label="Collaborative paint session">
      <strong>Collaborative paint</strong>
      <span>{message}</span>
      {canJoin && <button type="button" className="btn btn-sm btn-primary" onClick={() => void handleJoin()} disabled={joining}>{joining ? 'Joining...' : 'Join paint'}</button>}
      {isParticipant && <button type="button" className="btn btn-sm btn-secondary" onClick={() => onOpen(session.sessionId)}>Open paint</button>}
      {unavailableToViewer && <span>Not available to you</span>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
