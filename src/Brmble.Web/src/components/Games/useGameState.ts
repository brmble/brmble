import { useCallback, useEffect, useRef, useState } from 'react';
import bridge from '../../bridge';
import * as gamesApi from '../../api/games';

/** Fallback turn window in ms if the server omits `turnMs` (normal turn). */
const DEFAULT_TURN_MS = 15000;

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
  /** Server-owned invite window in ms (for the visual countdown). */
  inviteMs?: number;
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

export type InviteOutcomeKind = 'declined' | 'expired' | 'blocked';

export interface InviteOutcome {
  kind: InviteOutcomeKind;
  targetSession: number | null;
}

export interface GameState {
  incomingInvite: IncomingInvite | null;
  activeMatch: ActiveMatch | null;
  view: DeathrollView | null;
  ended: EndedMatch | null;
  lastError: string | null;
  turnDeadline: number | null;
  /** Length of the current turn window in ms (shrinks to 5s during escalation). */
  turnWindowMs: number;
  /** True while the match is in escalation (timeout penalty) mode. */
  penalty: boolean;
  /** Challenger-facing result of the last outgoing invite; null when none. */
  inviteOutcome: InviteOutcome | null;
  /** True after Accept is pressed until the match starts (or the invite ends). */
  accepting: boolean;
  clearInviteOutcome: () => void;
  invite: (targetSessionId: number) => void;
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
  const [turnWindowMs, setTurnWindowMs] = useState<number>(DEFAULT_TURN_MS);
  const [penalty, setPenalty] = useState<boolean>(false);
  const [inviteOutcome, setInviteOutcome] = useState<InviteOutcome | null>(null);
  const [accepting, setAccepting] = useState<boolean>(false);
  const outgoingInviteRef = useRef<{ targetSession: number } | null>(null);

  // Refs so bridge handlers (registered once) can read current values.
  const myUserIdRef = useRef(myUserId);
  myUserIdRef.current = myUserId;
  const activeMatchRef = useRef<ActiveMatch | null>(activeMatch);
  activeMatchRef.current = activeMatch;
  const incomingInviteRef = useRef<IncomingInvite | null>(incomingInvite);
  incomingInviteRef.current = incomingInvite;
  const viewRef = useRef<DeathrollView | null>(view);
  viewRef.current = view;
  const acceptingRef = useRef(accepting);
  acceptingRef.current = accepting;

  useEffect(() => {
    const handleInvited = (data: unknown) => {
      const d = data as { matchId?: number; gameType?: string; from?: number; inviteMs?: number };
      if (d.matchId == null || d.from == null) return;
      setIncomingInvite({ matchId: d.matchId, gameType: d.gameType ?? 'deathroll', from: d.from, inviteMs: d.inviteMs });
    };

    const handleStarted = (data: unknown) => {
      const d = data as { matchId?: number; gameType?: string; views?: unknown; turnMs?: number };
      if (d.matchId == null) return;
      setActiveMatch({ matchId: d.matchId, gameType: d.gameType ?? incomingInviteRef.current?.gameType ?? 'deathroll' });
      setIncomingInvite(null);
      setEnded(null);
      setView(pickMyView(d.views, myUserIdRef.current));
      const windowMs = d.turnMs ?? DEFAULT_TURN_MS;
      setTurnWindowMs(windowMs);
      setPenalty(false);
      setTurnDeadline(Date.now() + windowMs);
      outgoingInviteRef.current = null;
      setAccepting(false);
    };

    const handleStateUpdated = (data: unknown) => {
      const d = data as { matchId?: number; views?: unknown; turnMs?: number; penalty?: boolean };
      // Ignore late/stray updates from a match that is no longer the active one
      // (e.g. a rapid rematch) so they can't corrupt the board or reset the timer.
      const active = activeMatchRef.current;
      if (d.matchId != null && active && d.matchId !== active.matchId) return;
      const nextView = pickMyView(d.views, myUserIdRef.current);
      if (nextView) setView(nextView);
      const windowMs = d.turnMs ?? DEFAULT_TURN_MS;
      setTurnWindowMs(windowMs);
      setPenalty(d.penalty ?? false);
      setTurnDeadline(Date.now() + windowMs);
    };

    const handleEnded = (data: unknown) => {
      const d = data as { matchId?: number; abandoned?: boolean; reason?: string; winnerId?: number };
      // Prefer the server-supplied winnerId (authoritative, and correct even for
      // forfeits where the local view has no loserId). Fall back to deriving it
      // from the local view for older servers that omit it.
      let winnerId: number | undefined = d.winnerId;
      if (winnerId == null) {
        const currentView = viewRef.current;
        if (currentView?.loserId != null) {
          winnerId = currentView.players.find(p => p !== currentView.loserId);
        }
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
      setPenalty(false);
      setAccepting(false);
    };

    const resolveOutgoing = (kind: InviteOutcomeKind) => {
      const out = outgoingInviteRef.current;
      // Recipient side: an incoming invite was open -> just clear it, no outcome.
      if (incomingInviteRef.current) {
        setIncomingInvite(null);
      }
      // Challenger side: we had an outgoing invite -> show the outcome.
      if (out) {
        setInviteOutcome({ kind, targetSession: out.targetSession });
        outgoingInviteRef.current = null;
      }
      setActiveMatch(null);
      setTurnDeadline(null);
      setPenalty(false);
      setAccepting(false);
    };

    const handleDeclined = () => resolveOutgoing('declined');
    const handleExpired = () => resolveOutgoing('expired');

    const handleActionRejected = (data: unknown) => {
      const d = data as { reason?: string };
      setLastError(d.reason || 'That action was rejected.');
    };

    const handleError = (data: unknown) => {
      const d = data as { error?: string; reason?: string };
      const msg = d.error || 'A game error occurred.';
      // Accept could not complete (e.g. invite already gone) — re-enable the button.
      setAccepting(false);
      // In the WebView client, a rejected invite (e.g. a blocked target) comes
      // back as a game.error rather than a rejected invite() promise. If we have
      // a pending outgoing invite and the server flagged it as blocked, surface it
      // as the friendly "blocked" outcome instead of a raw error. Prefer the
      // structured reason code; fall back to matching the message for old servers.
      const isBlocked = d.reason === 'blocked' || /isn't accepting challenges/i.test(msg);
      if (outgoingInviteRef.current && isBlocked) {
        setInviteOutcome({ kind: 'blocked', targetSession: outgoingInviteRef.current.targetSession });
        outgoingInviteRef.current = null;
        return;
      }
      setLastError(msg);
    };

    bridge.on('game.invited', handleInvited);
    bridge.on('game.started', handleStarted);
    bridge.on('game.stateUpdated', handleStateUpdated);
    bridge.on('game.ended', handleEnded);
    bridge.on('game.declined', handleDeclined);
    bridge.on('game.expired', handleExpired);
    bridge.on('game.actionRejected', handleActionRejected);
    bridge.on('game.error', handleError);

    return () => {
      bridge.off('game.invited', handleInvited);
      bridge.off('game.started', handleStarted);
      bridge.off('game.stateUpdated', handleStateUpdated);
      bridge.off('game.ended', handleEnded);
      bridge.off('game.declined', handleDeclined);
      bridge.off('game.expired', handleExpired);
      bridge.off('game.actionRejected', handleActionRejected);
      bridge.off('game.error', handleError);
    };
  }, []);

  const invite = useCallback((targetSessionId: number) => {
    // Block starting a new duel while one is already in progress or pending, so a
    // user can't stack challenges (the server enforces this authoritatively too).
    if (activeMatchRef.current) {
      setLastError('You already have a game in progress.');
      return;
    }
    if (outgoingInviteRef.current) {
      setLastError('You already have a pending challenge.');
      return;
    }
    if (incomingInviteRef.current) {
      setLastError('Respond to your pending challenge first.');
      return;
    }
    outgoingInviteRef.current = { targetSession: targetSessionId };
    setInviteOutcome(null);
    gamesApi.invite(targetSessionId, 'deathroll').catch(e => {
      // A blocked target comes back as a rejected invite; surface it as an outcome.
      // Prefer the server's structured reason code (GameApiError.reason); fall back
      // to matching the message text for older servers.
      const msg = e instanceof Error ? e.message : 'Failed to send invite.';
      const reason = e instanceof gamesApi.GameApiError ? e.reason : undefined;
      if (reason === 'blocked' || /isn't accepting challenges/i.test(msg)) {
        setInviteOutcome({ kind: 'blocked', targetSession: outgoingInviteRef.current?.targetSession ?? null });
        outgoingInviteRef.current = null;
      } else {
        setLastError(msg);
        outgoingInviteRef.current = null;
      }
    });
  }, []);

  const acceptInvite = useCallback(() => {
    const inv = incomingInviteRef.current;
    if (!inv) return;
    // Guard against a double-click sending two accepts before game.started clears
    // the invite. accepting is reset on started/declined/expired/error.
    if (acceptingRef.current) return;
    setAccepting(true);
    gamesApi.respond(inv.matchId, true).catch(e => {
      setAccepting(false);
      setLastError(e instanceof Error ? e.message : 'Failed to accept invite.');
    });
  }, []);

  const declineInvite = useCallback(() => {
    const inv = incomingInviteRef.current;
    setIncomingInvite(null);
    setAccepting(false);
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
  const clearInviteOutcome = useCallback(() => setInviteOutcome(null), []);

  return {
    incomingInvite,
    activeMatch,
    view,
    ended,
    lastError,
    turnDeadline,
    turnWindowMs,
    penalty,
    inviteOutcome,
    accepting,
    clearInviteOutcome,
    invite,
    acceptInvite,
    declineInvite,
    roll,
    forfeit,
    dismissEnded,
    clearError,
  };
}
