/**
 * Every game type this client build can render.
 *
 * This is the ONE place a game type is declared on the client. Adding an entry
 * here turns three `default:` branches into compile errors — the participant board
 * picker in App, the spectator board picker in SpectatorActivity, and any future
 * switch that uses `assertNever`. That is deliberate: two of those sites used to
 * fail silently, so a forgotten branch shipped as a feature that quietly did the
 * wrong thing. Do not widen this to `string`.
 */
export const GAME_TYPES = ['deathroll', 'rps'] as const;

export type GameType = (typeof GAME_TYPES)[number];

/** Narrows an untrusted server-supplied string to a type this build can render. */
export function isGameType(value: string | null | undefined): value is GameType {
  return value != null && (GAME_TYPES as readonly string[]).includes(value);
}
