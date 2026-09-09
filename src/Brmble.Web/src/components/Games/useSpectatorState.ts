import { useCallback, useEffect, useRef, useState } from 'react';
import bridge from '../../bridge';
import * as gamesApi from '../../api/games';
import type {
  SpectatorCloseReason,
  SpectatorClosedEvent,
  SpectatorMatchEndedEvent,
  SpectatorSnapshot,
} from '../../api/games';

export interface SpectatorState {
  /** The channel being watched, or null. Spectating is a CHANNEL mode. */
  spectatingChannelId: number | null;
  /** The latest frame, or null when the channel is idle. */
  match: SpectatorSnapshot | null;
  /** Set when the staged match ended; cleared when the next match's first frame arrives. */
  ended: SpectatorMatchEndedEvent | null;
  /** Why the server closed the subscription, if it did. */
  closeReason: SpectatorCloseReason | null;
  startSpectating: (channelId: number) => Promise<void>;
  stopSpectating: () => void;
  reset: () => void;
}

const CLOSE_REASONS: readonly SpectatorCloseReason[] = [
  'unsubscribed', 'authorizationLost', 'disconnected', 'channelRemoved',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object';
}

/**
 * Spectating is a CHANNEL mode, not a match view: you opt in once and keep
 * watching match after match until you stop, move channel, or disconnect. The
 * server holds the subscription; this hook holds the projection of it.
 *
 * Guard structure deliberately mirrors useDuelQueueState (schema version, channel
 * identity, monotonic revision) so the two hooks read alike.
 *
 * Note on payload shape: the inbound `game.spectatorSnapshot` event is a strict
 * SUPERSET of the `SpectatorSnapshot` type — the server's event record declares a
 * `Type` discriminator that `MumbleAdapter` forwards verbatim, and which the
 * interface (correct for `SpectatorSubscribeResponse.match`) does not declare. So
 * every guard below checks STRUCTURE — the fields actually consumed — and never an
 * exact shape, which would reject the real wire payload.
 */
export function useSpectatorState(): SpectatorState {
  const [spectatingChannelId, setSpectatingChannelId] = useState<number | null>(null);
  const [match, setMatch] = useState<SpectatorSnapshot | null>(null);
  const [ended, setEnded] = useState<SpectatorMatchEndedEvent | null>(null);
  const [closeReason, setCloseReason] = useState<SpectatorCloseReason | null>(null);

  // Mirrors `spectatingChannelId` for the bridge handlers, which are registered once
  // and must see the current channel without being torn down and re-registered on
  // every change. Written only by the mutators below, never during render.
  const channelRef = useRef<number | null>(null);
  // Monotonic gate. Sequences are per MATCH, so a new match id resets the mark —
  // that is how the next match flows in with no resubscribe.
  const positionRef = useRef<{ matchId: number; sequence: number } | null>(null);
  // Bumped by every mutation so a subscribe that resolves after the user already
  // stopped, moved channel, or started a different subscribe cannot land.
  const epochRef = useRef(0);
  const mountedRef = useRef(true);

  const clear = useCallback(() => {
    epochRef.current++;
    channelRef.current = null;
    positionRef.current = null;
    setSpectatingChannelId(null);
    setMatch(null);
    setEnded(null);
  }, []);

  const reset = useCallback(() => {
    clear();
    setCloseReason(null);
  }, [clear]);

  const startSpectating = useCallback(async (channelId: number) => {
    const epoch = ++epochRef.current;
    const response = await gamesApi.subscribeSpectator(channelId);
    if (!mountedRef.current || epochRef.current !== epoch) return;
    // Trust the server's echoed channel over the requested one: it is the channel
    // the subscription was actually opened against.
    channelRef.current = response.channelId;
    positionRef.current = response.match
      ? { matchId: response.match.matchId, sequence: response.match.sequence }
      : null;
    setCloseReason(null);
    setEnded(null);
    setSpectatingChannelId(response.channelId);
    // A null match is a SUCCESSFUL subscription to an idle channel.
    setMatch(response.match);
  }, []);

  const stopSpectating = useCallback(() => {
    // Clear locally first: the chip must disappear on click, not on a round trip.
    clear();
    setCloseReason(null);
    void gamesApi.unsubscribeSpectator().catch(() => {
      // Best effort. Presence teardown will clear a stranded subscription, and a
      // fresh subscribe replaces it outright.
    });
  }, [clear]);

  useEffect(() => {
    mountedRef.current = true;

    const handleSnapshot = (data: unknown) => {
      if (!isRecord(data)) return;
      const frame = data as unknown as Partial<SpectatorSnapshot>;
      if (channelRef.current == null
        || frame.schemaVersion !== 1
        || frame.channelId !== channelRef.current
        || typeof frame.matchId !== 'number'
        || typeof frame.sequence !== 'number'
        || frame.view == null) return;

      const position = positionRef.current;
      const isNewMatch = position == null || position.matchId !== frame.matchId;
      if (!isNewMatch && frame.sequence <= position.sequence) return;

      positionRef.current = { matchId: frame.matchId, sequence: frame.sequence };
      // A new match clears the previous match's result: the Ended stage yields to
      // the live board the moment the next match's first frame lands.
      if (isNewMatch) setEnded(null);
      setMatch(frame as SpectatorSnapshot);
    };

    const handleMatchEnded = (data: unknown) => {
      if (!isRecord(data)) return;
      const event = data as unknown as Partial<SpectatorMatchEndedEvent>;
      if (channelRef.current == null
        || event.schemaVersion !== 1
        || event.channelId !== channelRef.current
        || typeof event.matchId !== 'number') return;
      // Deliberately does NOT clear `match`: the Ended stage shows the same board
      // with its result until the next match starts. And it does NOT stop
      // spectating — a match ending ends a match, not a subscription.
      setEnded(event as SpectatorMatchEndedEvent);
    };

    const handleClosed = (data: unknown) => {
      if (!isRecord(data)) return;
      const event = data as unknown as Partial<SpectatorClosedEvent>;
      // NO schema-version check here, and that is deliberate: unlike the other two
      // inbound events, `game.spectatorClosed` carries no `schemaVersion` at all per
      // the server contract. Demanding one would silently drop every close event and
      // strand the UI in a spectating state forever. Guard on channel identity
      // instead — a close for a channel we are not watching is not ours.
      if (channelRef.current == null || event.channelId !== channelRef.current) return;
      clear();
      setCloseReason(
        CLOSE_REASONS.includes(event.reason as SpectatorCloseReason)
          ? event.reason as SpectatorCloseReason
          : 'disconnected',
      );
    };

    // Reconnecting or moving channel requires an explicit fresh subscribe: the
    // server does not restore a subscription, so neither do we.
    const handleVoiceReset = () => { reset(); };

    bridge.on('game.spectatorSnapshot', handleSnapshot);
    bridge.on('game.spectatorMatchEnded', handleMatchEnded);
    bridge.on('game.spectatorClosed', handleClosed);
    bridge.on('voice.connected', handleVoiceReset);
    bridge.on('voice.channelChanged', handleVoiceReset);
    return () => {
      mountedRef.current = false;
      bridge.off('game.spectatorSnapshot', handleSnapshot);
      bridge.off('game.spectatorMatchEnded', handleMatchEnded);
      bridge.off('game.spectatorClosed', handleClosed);
      bridge.off('voice.connected', handleVoiceReset);
      bridge.off('voice.channelChanged', handleVoiceReset);
    };
  }, [clear, reset]);

  return { spectatingChannelId, match, ended, closeReason, startSpectating, stopSpectating, reset };
}
