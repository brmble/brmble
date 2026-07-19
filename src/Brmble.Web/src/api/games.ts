import bridge from '../bridge';

export interface GameStats {
  wins: number;
  losses: number;
  draws: number;
  abandons: number;
  gamesPlayed: number;
  winRatio: number;
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

export async function invite(targetUserId: number, gameType: string): Promise<void> {
  if (isWebViewBridgeAvailable()) {
    bridge.send('game.invite', { targetUserId, gameType });
    return;
  }

  const response = await fetch('/games/invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetUserId, gameType }),
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

export async function getStats(
  gameType: string,
  window?: 'week' | 'month' | 'all',
): Promise<GameStats> {
  if (isWebViewBridgeAvailable()) {
    const requestId = nextRequestId++;

    return new Promise<GameStats>((resolve, reject) => {
      const cleanup = () => {
        bridge.off('games.response', handleResponse);
      };

      const handleResponse = (data: unknown) => {
        const response = data as {
          requestId?: number;
          success?: boolean;
          body?: string;
          statusCode?: number;
          error?: string;
        };

        if (response.requestId !== requestId) return;

        cleanup();
        if (response.success && response.body) {
          resolve(JSON.parse(response.body) as GameStats);
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
      const payload: Record<string, unknown> = { action: 'stats', requestId, gameType };
      if (window) {
        payload.window = window;
      }
      bridge.send('games.request', payload);
    });
  }

  const query = window && window !== 'all' ? `?window=${window}` : '';
  const response = await fetch(`/games/stats/${encodeURIComponent(gameType)}${query}`);
  if (!response.ok) {
    throw new Error(response.statusText || `Request failed (${response.status}).`);
  }
  return response.json() as Promise<GameStats>;
}
