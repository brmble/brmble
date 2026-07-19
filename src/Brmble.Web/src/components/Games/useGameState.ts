import { useCallback, useEffect, useRef, useState } from 'react';
import bridge from '../../bridge';
import * as gamesApi from '../../api/games';

/** Turn timeout in ms (server enforces ~15s per turn). */
const TURN_TIMEOUT_MS = 15000;

/** Per-player Deathroll view (engine PublicView, camelCase). */
export interface DeathrollView {
  players: number[];
  currentPlayer: number | null;
  ceiling: number;
  lastRoll: number | null;
  finished: boolean;
  loserId: number | null;
}

export interface IncomingInvite {
  matchId: number;
  gameType: string;
  from: number;
}

export interface ActiveMatch {
  matchId: number;
  gameType: string;
}

export interface EndedMatch {
  matchId: number;
  abandoned?: boolean;
  reason?: string;
  winnerId?: number;
}

export interface GameState {
  incomingInvite: IncomingInvite | null;
  activeMatch: ActiveMatch | null;
  view: DeathrollView | null;
  ended: EndedMatch | null;
  lastError: string | null;
  turnDeadline: number | null;
  invite: (targetUserId: number) => void;
  acceptInvite: () => void;
  declineInvite: () => void;
  roll: () => void;
  forfeit: () => void;
  dismissEnded: () => void;
  clearError: () => void;
}

interface ViewEntry {
  userId: number;
  view: DeathrollView;
}

function pickMyView(views: unknown, myUserId: number): DeathrollView | null {
  if (!Array.isArray(views)) return null;
  const entry = (views as ViewEntry[]).find(v => v.userId === myUserId);
  return entry?.view ?? null;
}

/**
 * Subscribes to the server's `game.*` bridge events and exposes a small state
 * machine plus imperative actions for the Deathroll flow.
 *
 * @param myUserId the local user's id (Mumble session) used to select the
 *   correct per-player `view` from the server's `views` array.
 */
export function useGameState(myUserId: number): GameState {
  const [incomingInvite, setIncomingInvite] = useState<IncomingInvite | null>(null);
  const [activeMatch, setActiveMatch] = useState<ActiveMatch | null>(null);
  const [view, setView] = useState<DeathrollView | null>(null);
  const [ended, setEnded] = useState<EndedMatch | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [turnDeadline, setTurnDeadline] = useState<number | null>(null);

  // Refs so bridge handlers (registered once) can read current values.
  const myUserIdRef = useRef(myUserId);
  myUserIdRef.current = myUserId;
  const activeMatchRef = useRef<ActiveMatch | null>(activeMatch);
  activeMatchRef.current = activeMatch;
  const incomingInviteRef = useRef<IncomingInvite | null>(incomingInvite);
  incomingInviteRef.current = incomingInvite;
  const viewRef = useRef<DeathrollView | null>(view);
  viewRef.current = view;

  useEffect(() => {
    const handleInvited = (data: unknown) => {
      const d = data as { matchId?: number; gameType?: string; from?: number };
      if (d.matchId == null || d.from == null) return;
      setIncomingInvite({ matchId: d.matchId, gameType: d.gameType ?? 'deathroll', from: d.from });
    };

    const handleStarted = (data: unknown) => {
      const d = data as { matchId?: number; gameType?: string; views?: unknown };
      if (d.matchId == null) return;
      setActiveMatch({ matchId: d.matchId, gameType: d.gameType ?? incomingInviteRef.current?.gameType ?? 'deathroll' });
      setIncomingInvite(null);
      setEnded(null);
      setView(pickMyView(d.views, myUserIdRef.current));
      setTurnDeadline(Date.now() + TURN_TIMEOUT_MS);
    };

    const handleStateUpdated = (data: unknown) => {
      const d = data as { matchId?: number; views?: unknown };
      const nextView = pickMyView(d.views, myUserIdRef.current);
      if (nextView) setView(nextView);
      setTurnDeadline(Date.now() + TURN_TIMEOUT_MS);
    };

    const handleEnded = (data: unknown) => {
      const d = data as { matchId?: number; abandoned?: boolean; reason?: string };
      const currentView = viewRef.current;
      let winnerId: number | undefined;
      if (currentView?.loserId != null) {
        winnerId = currentView.players.find(p => p !== currentView.loserId);
      }
      setEnded({
        matchId: d.matchId ?? activeMatchRef.current?.matchId ?? 0,
        abandoned: d.abandoned,
        reason: d.reason,
        winnerId,
      });
      setActiveMatch(null);
      setView(null);
      setTurnDeadline(null);
    };

    const handleDeclined = () => {
      setIncomingInvite(null);
      setActiveMatch(null);
      setTurnDeadline(null);
    };

    const handleActionRejected = (data: unknown) => {
      const d = data as { reason?: string };
      setLastError(d.reason || 'That action was rejected.');
    };

    const handleError = (data: unknown) => {
      const d = data as { error?: string };
      setLastError(d.error || 'A game error occurred.');
    };

    bridge.on('game.invited', handleInvited);
    bridge.on('game.started', handleStarted);
    bridge.on('game.stateUpdated', handleStateUpdated);
    bridge.on('game.ended', handleEnded);
    bridge.on('game.declined', handleDeclined);
    bridge.on('game.actionRejected', handleActionRejected);
    bridge.on('game.error', handleError);

    return () => {
      bridge.off('game.invited', handleInvited);
      bridge.off('game.started', handleStarted);
      bridge.off('game.stateUpdated', handleStateUpdated);
      bridge.off('game.ended', handleEnded);
      bridge.off('game.declined', handleDeclined);
      bridge.off('game.actionRejected', handleActionRejected);
      bridge.off('game.error', handleError);
    };
  }, []);

  const invite = useCallback((targetUserId: number) => {
    gamesApi.invite(targetUserId, 'deathroll').catch(e => {
      setLastError(e instanceof Error ? e.message : 'Failed to send invite.');
    });
  }, []);

  const acceptInvite = useCallback(() => {
    const inv = incomingInviteRef.current;
    if (!inv) return;
    gamesApi.respond(inv.matchId, true).catch(e => {
      setLastError(e instanceof Error ? e.message : 'Failed to accept invite.');
    });
  }, []);

  const declineInvite = useCallback(() => {
    const inv = incomingInviteRef.current;
    setIncomingInvite(null);
    if (!inv) return;
    gamesApi.respond(inv.matchId, false).catch(e => {
      setLastError(e instanceof Error ? e.message : 'Failed to decline invite.');
    });
  }, []);

  const roll = useCallback(() => {
    const match = activeMatchRef.current;
    if (!match) return;
    gamesApi.sendAction(match.matchId, { roll: true }).catch(e => {
      setLastError(e instanceof Error ? e.message : 'Failed to roll.');
    });
  }, []);

  const forfeit = useCallback(() => {
    const match = activeMatchRef.current;
    if (!match) return;
    gamesApi.forfeit(match.matchId).catch(e => {
      setLastError(e instanceof Error ? e.message : 'Failed to forfeit.');
    });
  }, []);

  const dismissEnded = useCallback(() => setEnded(null), []);
  const clearError = useCallback(() => setLastError(null), []);

  return {
    incomingInvite,
    activeMatch,
    view,
    ended,
    lastError,
    turnDeadline,
    invite,
    acceptInvite,
    declineInvite,
    roll,
    forfeit,
    dismissEnded,
    clearError,
  };
}
