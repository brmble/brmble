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

export async function respond(matchId: number, accept: boolean): Promise<void> {
  if (isWebViewBridgeAvailable()) {
    bridge.send('game.respond', { matchId, accept });
    return;
  }

  const response = await fetch('/games/respond', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ matchId, accept }),
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
