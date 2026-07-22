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

function isWebViewBridgeAvailable(): boolean {
  return !!(window as Window & { chrome?: { webview?: unknown } }).chrome?.webview;
}

async function unwrap(response: Response): Promise<void> {
  if (response.ok) {
    return;
  }
  throw new Error(response.statusText || `Request failed (${response.status}).`);
}

export async function invite(targetSessionId: number, gameType: string): Promise<void> {
  if (isWebViewBridgeAvailable()) {
    bridge.send('game.invite', { targetSessionId, gameType });
    return;
  }

  const response = await fetch('/games/invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetSessionId, gameType }),
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
    throw new Error(response.statusText || `Request failed (${response.status}).`);
  }
  return response.json() as Promise<GameStats>;
}

export async function getGameSettings(): Promise<GameSettings> {
  if (isWebViewBridgeAvailable()) {
    return bridgeRequest<GameSettings>({ action: 'settings-get' });
  }

  const response = await fetch('/games/settings');
  if (!response.ok) {
    throw new Error(response.statusText || `Request failed (${response.status}).`);
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
    throw new Error(response.statusText || `Request failed (${response.status}).`);
  }
  return response.json() as Promise<GameSettings>;
}
