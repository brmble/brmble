import bridge from '../bridge';

export interface GameStats {
  wins: number;
  losses: number;
  draws: number;
  abandons: number;
  gamesPlayed: number;
  winRatio: number;
}

export interface GameSettings {
  challengesBlocked: boolean;
}

/** Per-game head-to-head record from the requesting user's perspective. */
export interface HeadToHeadGame {
  gameType: string;
  wins: number;
  losses: number;
  draws: number;
  gamesPlayed: number;
}

/** Lifetime head-to-head totals vs one opponent, plus a per-game breakdown. */
export interface HeadToHeadStats {
  wins: number;
  losses: number;
  draws: number;
  gamesPlayed: number;
  winRatio: number;
  games: HeadToHeadGame[];
}

/** Optional per-game invite options (e.g. RPS best-of length). */
export interface InviteOptions {
  bestOf?: number;
}

export type EstimateMethod =
  | 'fullMedian'
  | 'conditionalRemaining'
  | 'fullMedianFallback'
  | 'readyWindow'
  | 'insufficient';

export interface DuelPlayer {
  userId: number;
  sessionId: number;
  displayName: string;
  ready: boolean;
}

export interface DurationEstimate {
  status: 'known' | 'unknown';
  milliseconds: number | null;
  sampleCount: number;
  method: EstimateMethod;
  approximate: boolean;
}

export interface EstimateSegment {
  gameType: string;
  format: string;
  rulesetVersion: number;
  sampleCount: number;
  method: EstimateMethod;
}

export interface QueueEta {
  status: 'known' | 'unknown';
  estimatedStartAt: string | null;
  milliseconds: number | null;
  approximate: boolean;
  segments: EstimateSegment[];
}

export interface ActiveDuel {
  matchId: number;
  status: 'starting' | 'live';
  startedAt: string;
  players: DuelPlayer[];
  gameType: string;
  format: string;
  rulesetVersion: number;
  remaining: DurationEstimate;
  estimatedDuration: DurationEstimate;
}

export interface ReadyCheck {
  reservationId: number;
  expiresAt: string;
  players: DuelPlayer[];
  gameType: string;
  format: string;
  rulesetVersion: number;
  estimatedDuration: DurationEstimate;
}

export interface QueuedDuel {
  reservationId: number;
  position: number;
  players: DuelPlayer[];
  gameType: string;
  format: string;
  rulesetVersion: number;
  eta: QueueEta;
  estimatedDuration: DurationEstimate;
}

export interface DuelQueueSnapshot {
  schemaVersion: 1;
  generation: number;
  revision: number;
  channelId: number;
  generatedAt: string;
  calculationTimeMs: number;
  active: ActiveDuel | null;
  readyCheck: ReadyCheck | null;
  queue: QueuedDuel[];
}

/**
 * What a non-participant may see of a live Deathroll match. Player ids here are
 * Mumble SESSION ids (the engine's own state keys), NOT db user ids — resolve
 * them against `SpectatorSnapshot.players[].sessionId`.
 */
export interface DeathrollSpectatorView {
  kind: 'deathroll';
  players: number[];
  currentPlayer: number | null;
  ceiling: number;
  lastRoll: number | null;
  finished: boolean;
  loserId: number | null;
}

/** A resolved RPS round. Throws are public only once the round is over. */
export interface RpsResolvedRound {
  roundNumber: number;
  sequence: number;
  pick0: string;
  pick1: string;
  winnerId: number | null;
  tie: boolean;
}

/**
 * What a non-participant may see of a live RPS match. `committed` carries WHETHER
 * each player has thrown, never WHAT. There is deliberately no `picks`, `myPick`
 * or `opponentPicked`: resolved throws exist only inside `lastRound`.
 * Player ids are Mumble SESSION ids.
 */
export interface RpsSpectatorView {
  kind: 'rps';
  players: number[];
  bestOf: number;
  targetWins: number;
  roundNumber: number;
  roundWins: number[];
  committed: boolean[];
  finished: boolean;
  winnerId: number | null;
  lastRound: RpsResolvedRound | null;
}

export type SpectatorView = DeathrollSpectatorView | RpsSpectatorView;

export function isRpsSpectatorView(view: SpectatorView): view is RpsSpectatorView {
  return view.kind === 'rps';
}

export interface SpectatorSnapshot {
  schemaVersion: 1;
  matchId: number;
  channelId: number;
  gameType: string;
  format: string;
  rulesetVersion: number;
  players: DuelPlayer[];
  sequence: number;
  generatedAt: string;
  view: SpectatorView;
}

/** `match` is null when the channel is idle. That is a SUCCESSFUL subscription. */
export interface SpectatorSubscribeResponse {
  channelId: number;
  match: SpectatorSnapshot | null;
}

export interface SpectatorMatchEndedEvent {
  schemaVersion: 1;
  matchId: number;
  channelId: number;
  reason: 'completed' | 'forfeited';
  finalSequence: number;
  outcome: { winnerId: number | null; loserId: number | null; draw: boolean };
}

export type SpectatorCloseReason =
  | 'unsubscribed' | 'authorizationLost' | 'disconnected' | 'channelRemoved';

/**
 * NOTE: unlike `SpectatorSnapshot` and `SpectatorMatchEndedEvent`, the close event
 * carries NO `schemaVersion` — that is deliberate in the server contract, not an
 * oversight. Consequence for consumers: `game.spectatorClosed` cannot be
 * version-gated the way the other two inbound events can. Guard it on the shape of
 * `channelId`/`reason` instead, and never assume a `schemaVersion` field is present.
 */
export interface SpectatorClosedEvent {
  channelId: number;
  reason: SpectatorCloseReason;
}

function isWebViewBridgeAvailable(): boolean {
  return !!(window as Window & { chrome?: { webview?: unknown } }).chrome?.webview;
}

/**
 * Error thrown by the fetch (non-WebView) API paths. Carries the server's
 * structured `reason` code (e.g. `"blocked"`) so callers can branch on a stable
 * code instead of pattern-matching the human message.
 */
export class GameApiError extends Error {
  readonly reason?: string;
  constructor(message: string, reason?: string) {
    super(message);
    this.name = 'GameApiError';
    this.reason = reason;
  }
}

/**
 * Builds a {@link GameApiError} from a failed response, preferring the server's
 * JSON `{ error, reason }` body over the bare status text (which discards the
 * actionable message and the reason code).
 */
async function toGameApiError(response: Response): Promise<GameApiError> {
  const fallback = response.statusText || `Request failed (${response.status}).`;
  try {
    const body = await response.json();
    if (body && typeof body === 'object') {
      const { error, reason } = body as { error?: unknown; reason?: unknown };
      return new GameApiError(
        typeof error === 'string' && error ? error : fallback,
        typeof reason === 'string' ? reason : undefined,
      );
    }
  } catch {
    // Non-JSON body — fall through to the status-text fallback.
  }
  return new GameApiError(fallback);
}

async function unwrap(response: Response): Promise<void> {
  if (response.ok) {
    return;
  }
  throw await toGameApiError(response);
}

export async function invite(
  targetSessionId: number,
  gameType: string,
  options?: InviteOptions,
): Promise<void> {
  const payload = options ? { targetSessionId, gameType, options } : { targetSessionId, gameType };
  if (isWebViewBridgeAvailable()) {
    bridge.send('game.invite', payload);
    return;
  }

  const response = await fetch('/games/invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return unwrap(response);
}

export async function respondOffer(offerId: number, accept: boolean): Promise<void> {
  if (isWebViewBridgeAvailable()) {
    bridge.send('game.respond', { offerId, accept });
    return;
  }

  const response = await fetch('/games/respond', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ offerId, accept }),
  });
  return unwrap(response);
}

export async function cancelOffer(offerId: number): Promise<void> {
  if (isWebViewBridgeAvailable()) {
    bridge.send('game.cancelOffer', { offerId });
    return;
  }

  const response = await fetch('/games/offers/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ offerId }),
  });
  return unwrap(response);
}

export async function respondReady(reservationId: number, ready: boolean): Promise<void> {
  if (isWebViewBridgeAvailable()) {
    bridge.send('game.ready', { reservationId, ready });
    return;
  }

  const response = await fetch('/games/ready', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reservationId, ready }),
  });
  return unwrap(response);
}

export async function requestRematch(sourceMatchId: number): Promise<void> {
  if (isWebViewBridgeAvailable()) {
    bridge.send('game.rematch', { sourceMatchId });
    return;
  }

  const response = await fetch('/games/rematch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceMatchId }),
  });
  return unwrap(response);
}

export async function sendAction(matchId: number, action: Record<string, unknown>): Promise<void> {
  if (isWebViewBridgeAvailable()) {
    bridge.send('game.action', { matchId, action });
    return;
  }

  const response = await fetch('/games/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ matchId, action }),
  });
  return unwrap(response);
}

export async function forfeit(matchId: number): Promise<void> {
  if (isWebViewBridgeAvailable()) {
    bridge.send('game.forfeit', { matchId });
    return;
  }

  const response = await fetch('/games/forfeit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ matchId }),
  });
  return unwrap(response);
}

let nextRequestId = 1;

interface BridgeResponse {
  requestId?: number;
  success?: boolean;
  body?: string;
  statusCode?: number;
  error?: string;
}

const BRIDGE_REQUEST_TIMEOUT_MS = 15000;

/**
 * Sends a `games.request` over the bridge and resolves the parsed `games.response`
 * body correlated by `requestId`. Guards against the two ways this pattern can hang
 * forever: a client that never replies (timeout) and a malformed body that throws
 * synchronously during parse (wrapped so the promise rejects instead of silently
 * hanging). Always cleans up the listener and timer.
 */
function bridgeRequest<T>(
  payload: Record<string, unknown>,
  timeoutMs = BRIDGE_REQUEST_TIMEOUT_MS,
): Promise<T> {
  const requestId = nextRequestId++;
  return new Promise<T>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      bridge.off('games.response', handleResponse);
      if (timer !== undefined) clearTimeout(timer);
    };

    const handleResponse = (data: unknown) => {
      const response = data as BridgeResponse;
      if (response.requestId !== requestId) return;
      cleanup();

      if (response.success && response.body) {
        try {
          resolve(JSON.parse(response.body) as T);
        } catch (err) {
          reject(err instanceof Error ? err : new Error('Failed to parse response.'));
        }
        return;
      }

      reject(
        new Error(
          response.error ||
            (response.statusCode ? `Request failed (${response.statusCode}).` : 'Request failed.'),
        ),
      );
    };

    bridge.on('games.response', handleResponse);
    timer = setTimeout(() => {
      cleanup();
      reject(new Error('Request timed out.'));
    }, timeoutMs);
    bridge.send('games.request', { ...payload, requestId });
  });
}

export async function getQueueSnapshot(): Promise<DuelQueueSnapshot> {
  if (isWebViewBridgeAvailable()) {
    return bridgeRequest<DuelQueueSnapshot>({ action: 'queue' });
  }

  const response = await fetch('/games/queue');
  if (!response.ok) {
    throw await toGameApiError(response);
  }
  return response.json() as Promise<DuelQueueSnapshot>;
}

export async function getStats(
  gameType: string,
  window?: 'week' | 'month' | 'all',
): Promise<GameStats> {
  if (isWebViewBridgeAvailable()) {
    const payload: Record<string, unknown> = { action: 'stats', gameType };
    if (window) {
      payload.window = window;
    }
    return bridgeRequest<GameStats>(payload);
  }

  const query = window && window !== 'all' ? `?window=${window}` : '';
  const response = await fetch(`/games/stats/${encodeURIComponent(gameType)}${query}`);
  if (!response.ok) {
    throw await toGameApiError(response);
  }
  return response.json() as Promise<GameStats>;
}

export async function getGameSettings(): Promise<GameSettings> {
  if (isWebViewBridgeAvailable()) {
    return bridgeRequest<GameSettings>({ action: 'settings-get' });
  }

  const response = await fetch('/games/settings');
  if (!response.ok) {
    throw await toGameApiError(response);
  }
  return response.json() as Promise<GameSettings>;
}

export async function setGameSettings(settings: GameSettings): Promise<GameSettings> {
  if (isWebViewBridgeAvailable()) {
    return bridgeRequest<GameSettings>({
      action: 'settings-set',
      challengesBlocked: settings.challengesBlocked,
    });
  }

  const response = await fetch('/games/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!response.ok) {
    throw await toGameApiError(response);
  }
  return response.json() as Promise<GameSettings>;
}

/**
 * Lifetime head-to-head record vs the given opponent (identified by live Mumble
 * session id), from the requesting user's perspective. Returns an all-zero record
 * when the players have never met.
 */
export async function getHeadToHead(opponentSession: number): Promise<HeadToHeadStats> {
  if (isWebViewBridgeAvailable()) {
    return bridgeRequest<HeadToHeadStats>({ action: 'head-to-head', opponentSession });
  }

  const response = await fetch(`/games/head-to-head/${encodeURIComponent(opponentSession)}`);
  if (!response.ok) {
    throw await toGameApiError(response);
  }
  return response.json() as Promise<HeadToHeadStats>;
}

/**
 * Subscribes to a CHANNEL, not a match: frames keep arriving match after match
 * until you unsubscribe, move channel, or disconnect. Uses the games.request
 * tunnel rather than the fire-and-forget POST path because it returns a body.
 *
 * Rejects with a {@link GameApiError} carrying the server's `reason`
 * (`notPresent` | `notSameChannel`) on the fetch path. The bridge path rejects
 * with a plain Error whose message is the server's human-readable text, because
 * the shared `games.response` envelope does not carry the reason code.
 */
export async function subscribeSpectator(channelId: number): Promise<SpectatorSubscribeResponse> {
  if (isWebViewBridgeAvailable()) {
    return bridgeRequest<SpectatorSubscribeResponse>({ action: 'spectate-subscribe', channelId });
  }

  const response = await fetch('/games/spectators/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelId }),
  });
  if (!response.ok) {
    throw await toGameApiError(response);
  }
  return response.json() as Promise<SpectatorSubscribeResponse>;
}

/** Stops the caller's spectator subscription. Idempotent server-side. */
export async function unsubscribeSpectator(): Promise<void> {
  if (isWebViewBridgeAvailable()) {
    await bridgeRequest<{ unsubscribed: boolean }>({ action: 'spectate-unsubscribe' });
    return;
  }

  const response = await fetch('/games/spectators/unsubscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  return unwrap(response);
}
