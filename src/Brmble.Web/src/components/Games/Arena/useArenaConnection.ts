import type {
  ArenaInputState,
  ArenaMatchClosed,
  ArenaSnapshot,
  ArenaWelcome,
} from './arenaProtocol';
import { parseServerMessage } from './arenaProtocol';
import {
  useRealtimeConnection,
  type PendingInput,
  type RealtimeCodec,
  type RealtimeConnection,
  type RealtimeConnectionStatus,
} from '../Realtime/useRealtimeConnection';

export type ArenaConnectionStatus = RealtimeConnectionStatus;
export type PendingArenaInput = PendingInput<ArenaInputState>;
export type ArenaConnection = RealtimeConnection<ArenaInputState, ArenaWelcome, ArenaSnapshot, ArenaMatchClosed>;

const neutralInput: ArenaInputState = {
  moveX: 0,
  moveY: 0,
  aimX: 32767,
  aimY: 0,
  charging: false,
  fireReleased: false,
  dash: false,
};

/**
 * The arena's contribution to the generic realtime connection: its input is two
 * axes (move, aim), a held button (charging) and two edges (fire, dash); the aim pair
 * is the direction the server budgets changes of; a heartbeat carries the held state
 * and the aim.
 */
export const arenaCodec: RealtimeCodec<ArenaInputState, ArenaWelcome, ArenaSnapshot, ArenaMatchClosed> = {
  neutral: neutralInput,
  heldOnly: input => {
    const { viewTick, ...held } = input;
    void viewTick;
    return { ...held, fireReleased: false, dash: false };
  },
  sameHeld: (left, right) => left.moveX === right.moveX && left.moveY === right.moveY && left.charging === right.charging,
  hasEdges: input => input.fireReleased || input.dash,
  direction: input => ({ x: input.aimX, y: input.aimY }),
  withDirection: (input, direction) => ({ ...input, aimX: direction.x, aimY: direction.y }),
  initialDirection: (welcome, sessionId) => {
    const self = welcome.state.players.find(player => player.sessionId === sessionId);
    return self ? { x: self.aimX, y: self.aimY } : null;
  },
  acknowledgedInput: (snapshot, sessionId) =>
    snapshot.players.find(player => player.sessionId === sessionId)?.acknowledgedInput,
  inputFields: input => ({ ...input }),
  heartbeatFields: input => ({
    moveX: input.moveX, moveY: input.moveY, aimX: input.aimX, aimY: input.aimY, charging: input.charging,
  }),
  parse: parseServerMessage,
};

export function useArenaConnection(options: { matchId: number; enabled: boolean }): ArenaConnection {
  return useRealtimeConnection(arenaCodec, options);
}
