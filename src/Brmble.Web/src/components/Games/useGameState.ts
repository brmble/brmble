import { useCallback, useEffect, useRef, useState } from 'react';
import bridge from '../../bridge';
import * as gamesApi from '../../api/games';

/** Fallback turn window in ms if the server omits `turnMs` (normal turn). */
const DEFAULT_TURN_MS = 15000;

// Game types this client build knows how to render. Invites for anything else are
// auto-declined so an outdated peer can't open the wrong modal. Forward-compat only.
const SUPPORTED_GAMES = ['deathroll', 'rps'];

/** Per-player Deathroll view (engine PublicView, camelCase). */
export interface DeathrollView {
  players: number[];
  currentPlayer: number | null;
  ceiling: number;
  lastRoll: number | null;
  finished: boolean;
  loserId: number | null;
}

/** Resolved result of the most recent RPS round (both picks revealed). */
export interface RpsLastRound {
  roundNumber: number;
  /** Monotonic sequence over every resolution (ties included) — used to detect a
   *  new round to reveal even when the decisive roundNumber didn't advance. */
  seq: number;
  p0: number;
  pick0: string;
  p1: number;
  pick1: string;
  winnerId: number | null;
  tie: boolean;
}

/** Per-player RPS view (engine PublicView, camelCase). The opponent's current pick
 * is hidden (`opponentPicked` boolean only) until the round resolves. */
export interface RpsView {
  players: number[];
  bestOf: number;
  targetWins: number;
  roundNumber: number;
  roundWins: number[];
  finished: boolean;
  winnerId: number | null;
  myPick: string | null;
  opponentPicked: boolean;
  lastRound: RpsLastRound | null;
}

/** Any game's per-player view. Modals narrow this to their own game's shape. */
export type GameView = DeathrollView | RpsView;

/** Narrows a {@link GameView} to the RPS shape (by a distinctive RPS-only field). */
export function isRpsView(view: GameView | null): view is RpsView {
  return !!view && 'roundWins' in view;
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

/** Challenger-facing pending outgoing invite (waiting for the opponent to answer). */
export interface OutgoingInvite {
  matchId: number | null;
  targetSession: number;
  gameType: string;
  inviteMs?: number;
}

export interface EndedMatch {
  matchId: number;
  gameType: string;
  abandoned?: boolean;
  reason?: string;
  winnerId?: number;
  draw?: boolean;
}

export type InviteOutcomeKind = 'declined' | 'expired' | 'blocked';

export interface InviteOutcome {
  kind: InviteOutcomeKind;
  targetSession: number | null;
}

export interface GameState {
  incomingInvite: IncomingInvite | null;
  activeMatch: ActiveMatch | null;
  view: GameView | null;
  ended: EndedMatch | null;
  lastError: string | null;
  turnDeadline: number | null;
  /** Length of the current turn window in ms (shrinks to 5s during escalation). */
  turnWindowMs: number;
  /** True while the match is in escalation (timeout penalty) mode. */
  penalty: boolean;
  /** Challenger-facing result of the last outgoing invite; null when none. */
  inviteOutcome: InviteOutcome | null;
  /** Challenger-facing pending outgoing invite; null when none is in flight. */
  outgoingInvite: OutgoingInvite | null;
  /** True after Accept is pressed until the match starts (or the invite ends). */
  accepting: boolean;
  clearInviteOutcome: () => void;
  invite: (targetSessionId: number, gameType?: string, options?: gamesApi.InviteOptions) => void;
  cancelInvite: () => void;
  acceptInvite: () => void;
  declineInvite: () => void;
  /** Sends a raw game action for the active match (generic across games). */
  sendAction: (action: Record<string, unknown>) => void;
  /** Deathroll convenience wrapper around {@link sendAction}. */
  roll: () => void;
  forfeit: () => void;
  dismissEnded: () => void;
  clearError: () => void;
  /** Clears all game state (e.g. on voice disconnect) without server calls. */
  reset: () => void;
}

interface ViewEntry {
  userId: number;
  view: GameView;
}

function pickMyView(views: unknown, myUserId: number): GameView | null {
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
  const [view, setView] = useState<GameView | null>(null);
  const [ended, setEnded] = useState<EndedMatch | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [turnDeadline, setTurnDeadline] = useState<number | null>(null);
  const [turnWindowMs, setTurnWindowMs] = useState<number>(DEFAULT_TURN_MS);
  const [penalty, setPenalty] = useState<boolean>(false);
  const [inviteOutcome, setInviteOutcome] = useState<InviteOutcome | null>(null);
  const [outgoingInvite, setOutgoingInvite] = useState<OutgoingInvite | null>(null);
  const [accepting, setAccepting] = useState<boolean>(false);
  const outgoingInviteRef = useRef<OutgoingInvite | null>(null);
  // Set when the local user cancels their own pending invite. The server responds
  // to our forfeit with a `game.expired`, which would otherwise be misreported as
  // "opponent didn't respond". This flag suppresses that outcome exactly once.
  const selfCanceledRef = useRef(false);

  // Refs so bridge handlers (registered once) can read current values.
  const myUserIdRef = useRef(myUserId);
  myUserIdRef.current = myUserId;
  const activeMatchRef = useRef<ActiveMatch | null>(activeMatch);
  activeMatchRef.current = activeMatch;
  const incomingInviteRef = useRef<IncomingInvite | null>(incomingInvite);
  incomingInviteRef.current = incomingInvite;
  const viewRef = useRef<GameView | null>(view);
  viewRef.current = view;
  const acceptingRef = useRef(accepting);
  acceptingRef.current = accepting;

  // Keeps both the reactive state and the handler-facing ref in sync.
  const setOutgoing = useCallback((next: OutgoingInvite | null) => {
    outgoingInviteRef.current = next;
    setOutgoingInvite(next);
  }, []);

  useEffect(() => {
    const handleInvited = (data: unknown) => {
      const d = data as { matchId?: number; gameType?: string; from?: number; inviteMs?: number };
      if (d.matchId == null || d.from == null) return;
      const gameType = d.gameType ?? 'deathroll';
      if (!SUPPORTED_GAMES.includes(gameType)) {
        // This client build doesn't know this game — decline instead of opening the
        // wrong modal. (Old clients that predate this check can't reach here.)
        gamesApi.respond(d.matchId, false).catch(() => {});
        return;
      }
      setIncomingInvite({ matchId: d.matchId, gameType, from: d.from, inviteMs: d.inviteMs });
    };

    // Challenger side: the server confirms our outgoing invite and supplies its
    // matchId (which the fire-and-forget WebView invite couldn't return). Fill in
    // the pending-invite state so the "waiting for opponent" UI and cancel work.
    const handleInvitePending = (data: unknown) => {
      const d = data as { matchId?: number; gameType?: string; target?: number; inviteMs?: number };
      if (d.matchId == null) return;
      const existing = outgoingInviteRef.current;
      setOutgoing({
        matchId: d.matchId,
        targetSession: d.target ?? existing?.targetSession ?? 0,
        gameType: d.gameType ?? existing?.gameType ?? 'deathroll',
        inviteMs: d.inviteMs,
      });
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
      setOutgoingInvite(null);
      setAccepting(false);
    };

    const handleStateUpdated = (data: unknown) => {
      const d = data as { matchId?: number; views?: unknown; turnMs?: number; turnStarted?: boolean; penalty?: boolean };
      // Ignore late/stray updates from a match that is no longer the active one
      // (e.g. a rapid rematch) so they can't corrupt the board or reset the timer.
      const active = activeMatchRef.current;
      if (d.matchId != null && active && d.matchId !== active.matchId) return;
      const nextView = pickMyView(d.views, myUserIdRef.current);
      if (nextView) setView(nextView);
      setPenalty(d.penalty ?? false);
      // Only (re)arm the countdown when the server actually started a new commit
      // window. In simultaneous games (RPS) the first player's pick emits a state
      // update WITHOUT restarting the shared window, so we must keep the running
      // deadline instead of resetting it to a fresh 15s. Default true for other
      // game types / older servers that omit the flag.
      if (d.turnStarted ?? true) {
        const windowMs = d.turnMs ?? DEFAULT_TURN_MS;
        setTurnWindowMs(windowMs);
        setTurnDeadline(Date.now() + windowMs);
      }
    };

    const handleEnded = (data: unknown) => {
      const d = data as { matchId?: number; gameType?: string; abandoned?: boolean; reason?: string; winnerId?: number; draw?: boolean };
      // Prefer the server-supplied winnerId (authoritative, and correct even for
      // forfeits where the local view has no loserId). Fall back to deriving it
      // from the local view for older servers that omit it.
      let winnerId: number | undefined = d.winnerId;
      if (winnerId == null && !d.draw) {
        const currentView = viewRef.current;
        if (currentView && !isRpsView(currentView) && currentView.loserId != null) {
          winnerId = currentView.players.find(p => p !== currentView.loserId);
        }
      }
      setEnded({
        matchId: d.matchId ?? activeMatchRef.current?.matchId ?? 0,
        gameType: d.gameType ?? activeMatchRef.current?.gameType ?? 'deathroll',
        abandoned: d.abandoned,
        reason: d.reason,
        winnerId,
        draw: d.draw,
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
        setOutgoing(null);
      }
      setActiveMatch(null);
      setTurnDeadline(null);
      setPenalty(false);
      setAccepting(false);
    };

    const handleDeclined = () => resolveOutgoing('declined');
    const handleExpired = () => {
      // A self-initiated cancel produces a server `game.expired`; don't surface it as
      // an "opponent didn't respond" outcome — just clear the (already-cleared) state.
      if (selfCanceledRef.current) {
        selfCanceledRef.current = false;
        setIncomingInvite(null);
        setOutgoing(null);
        setActiveMatch(null);
        setTurnDeadline(null);
        setPenalty(false);
        setAccepting(false);
        return;
      }
      resolveOutgoing('expired');
    };

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
        setOutgoing(null);
        return;
      }
      setLastError(msg);
    };

    bridge.on('game.invited', handleInvited);
    bridge.on('game.invitePending', handleInvitePending);
    bridge.on('game.started', handleStarted);
    bridge.on('game.stateUpdated', handleStateUpdated);
    bridge.on('game.ended', handleEnded);
    bridge.on('game.declined', handleDeclined);
    bridge.on('game.expired', handleExpired);
    bridge.on('game.actionRejected', handleActionRejected);
    bridge.on('game.error', handleError);

    return () => {
      bridge.off('game.invited', handleInvited);
      bridge.off('game.invitePending', handleInvitePending);
      bridge.off('game.started', handleStarted);
      bridge.off('game.stateUpdated', handleStateUpdated);
      bridge.off('game.ended', handleEnded);
      bridge.off('game.declined', handleDeclined);
      bridge.off('game.expired', handleExpired);
      bridge.off('game.actionRejected', handleActionRejected);
      bridge.off('game.error', handleError);
    };
  }, []);

  const invite = useCallback((targetSessionId: number, gameType: string = 'deathroll', options?: gamesApi.InviteOptions) => {
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
    // Optimistic pending state; the server's game.invitePending fills in the matchId.
    setOutgoing({ matchId: null, targetSession: targetSessionId, gameType });
    setInviteOutcome(null);
    gamesApi.invite(targetSessionId, gameType, options).catch(e => {
      // A blocked target comes back as a rejected invite; surface it as an outcome.
      // Prefer the server's structured reason code (GameApiError.reason); fall back
      // to matching the message text for older servers.
      const msg = e instanceof Error ? e.message : 'Failed to send invite.';
      const reason = e instanceof gamesApi.GameApiError ? e.reason : undefined;
      if (reason === 'blocked' || /isn't accepting challenges/i.test(msg)) {
        setInviteOutcome({ kind: 'blocked', targetSession: outgoingInviteRef.current?.targetSession ?? null });
        setOutgoing(null);
      } else {
        setLastError(msg);
        setOutgoing(null);
      }
    });
  }, [setOutgoing]);

  // Cancels a pending outgoing invite. Forfeiting a still-pending match cancels it
  // server-side (emitting game.expired), which clears our outgoing state via the
  // existing handler. Requires the matchId from game.invitePending.
  const cancelInvite = useCallback(() => {
    const out = outgoingInviteRef.current;
    if (!out) return;
    if (out.matchId == null) {
      // The pending confirmation hasn't arrived yet; just drop the local state.
      setOutgoing(null);
      return;
    }
    // Mark this as a self-cancel so the resulting server `game.expired` isn't shown
    // as "opponent didn't respond", and clear the pending UI optimistically.
    selfCanceledRef.current = true;
    setOutgoing(null);
    gamesApi.forfeit(out.matchId).catch(e => {
      selfCanceledRef.current = false;
      setLastError(e instanceof Error ? e.message : 'Failed to cancel invite.');
    });
  }, [setOutgoing]);

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

  const sendAction = useCallback((action: Record<string, unknown>) => {
    const match = activeMatchRef.current;
    if (!match) return;
    gamesApi.sendAction(match.matchId, action).catch(e => {
      setLastError(e instanceof Error ? e.message : 'Failed to send action.');
    });
  }, []);

  const roll = useCallback(() => {
    sendAction({ roll: true });
  }, [sendAction]);

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

  // Wipes all local game state without any server calls. Used on voice disconnect:
  // the server tears matches down on its side, so we just clear the UI (pending
  // invite notification, active modal, errors) rather than leaving stale state that
  // would produce spurious errors when actions can no longer reach the server.
  const reset = useCallback(() => {
    selfCanceledRef.current = false;
    setIncomingInvite(null);
    setActiveMatch(null);
    setView(null);
    setEnded(null);
    setLastError(null);
    setTurnDeadline(null);
    setPenalty(false);
    setInviteOutcome(null);
    setAccepting(false);
    setOutgoing(null);
  }, [setOutgoing]);

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
    outgoingInvite,
    accepting,
    clearInviteOutcome,
    invite,
    cancelInvite,
    acceptInvite,
    declineInvite,
    sendAction,
    roll,
    forfeit,
    dismissEnded,
    clearError,
    reset,
  };
}
