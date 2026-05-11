import type { OverlaySettings } from '../SettingsModal/InterfaceSettingsTypes';
import type { CompanionOverlayEvent, CompanionOverlaySnapshot, CompanionSpeakerEntry, OverlayEventKind, OverlayVisualState } from './overlayTypes';

const MAX_EVENTS = 8;
const MAX_VISIBLE_SPEAKERS = 3;
const SPEAKER_DECAY_MS = 2_500;
const EVENT_TTL_MS = 5_000;
const QUIET_AFTER_MS = 15_000;

const UNKNOWN_USER = 'Unknown user';
const MESSAGE_UNAVAILABLE = 'Message unavailable';

function safeName(name: string | null | undefined): string {
  return name?.trim() || UNKNOWN_USER;
}

function safeMessage(text: string | null | undefined): string {
  return text?.trim() || MESSAGE_UNAVAILABLE;
}

function deriveVisualState(
  events: CompanionOverlayEvent[],
  speakers: CompanionSpeakerEntry[],
  now: number,
  latestKind?: OverlayEventKind,
): OverlayVisualState {
  if (speakers.length > 0) return 'speaking-nearby';
  if (latestKind === 'direct-message') return 'dm';
  if (latestKind === 'user-kicked' || latestKind === 'user-banned') return 'moderation-alert';
  if (latestKind === 'channel-message') return 'message';

  const lastEvent = events[events.length - 1];
  if (!lastEvent || now - lastEvent.timestamp > QUIET_AFTER_MS) return 'quiet';
  return 'idle';
}

export function createOverlaySnapshot(currentChannelId: string | null, currentChannelName = ''): CompanionOverlaySnapshot {
  return {
    currentChannelId,
    currentChannelName,
    recentEvents: [],
    activeSpeakers: [],
    visualState: 'quiet',
    lastActivityAt: 0,
  };
}

export function appendOverlayEvent(
  snapshot: CompanionOverlaySnapshot,
  event: CompanionOverlayEvent,
  settings: OverlaySettings,
): CompanionOverlaySnapshot {
  const inCurrentChannel = !event.channelId || event.channelId === snapshot.currentChannelId;
  const allowed =
    (event.kind === 'channel-message' && settings.showChannelMessages && inCurrentChannel)
    || (event.kind === 'direct-message' && settings.showDirectMessages)
    || ((event.kind === 'user-joined' || event.kind === 'user-left') && settings.showJoinLeaveEvents && inCurrentChannel)
    || ((event.kind === 'user-kicked' || event.kind === 'user-banned') && settings.showModerationEvents && inCurrentChannel);

  if (!allowed) {
    return snapshot;
  }

  const nextEvents = [...snapshot.recentEvents, event].slice(-MAX_EVENTS);
  return {
    ...snapshot,
    recentEvents: nextEvents,
    visualState: deriveVisualState(nextEvents, snapshot.activeSpeakers, event.timestamp, event.kind),
    lastActivityAt: event.timestamp,
  };
}

export function setSpeakerActivity(
  snapshot: CompanionOverlaySnapshot,
  speaker: { session: number; name: string; channelId: number },
  speaking: boolean,
  now: number,
): CompanionOverlaySnapshot {
  const name = safeName(speaker.name);
  const next = snapshot.activeSpeakers.filter((entry) => entry.session !== speaker.session);

  if (speaking) {
    next.push({
      session: speaker.session,
      name,
      channelId: speaker.channelId,
      isSpeaking: true,
      startedAt: now,
      lastSpokeAt: now,
      expiresAt: now + SPEAKER_DECAY_MS,
    });
  } else {
    const existing = snapshot.activeSpeakers.find((entry) => entry.session === speaker.session);
    if (existing) {
      next.push({
        ...existing,
        name,
        isSpeaking: false,
        lastSpokeAt: now,
        expiresAt: now + SPEAKER_DECAY_MS,
      });
    }
  }

  next.sort((a, b) => b.lastSpokeAt - a.lastSpokeAt);

  return {
    ...snapshot,
    activeSpeakers: next.slice(0, MAX_VISIBLE_SPEAKERS),
    visualState: deriveVisualState(snapshot.recentEvents, next, now),
    lastActivityAt: now,
  };
}

export function pruneOverlaySnapshot(snapshot: CompanionOverlaySnapshot, now: number): CompanionOverlaySnapshot {
  const recentEvents = snapshot.recentEvents
    .filter((event) => now - event.timestamp < EVENT_TTL_MS)
    .slice(-MAX_EVENTS);

  const activeSpeakers = snapshot.activeSpeakers
    .filter((entry) => entry.expiresAt > now)
    .sort((a, b) => b.lastSpokeAt - a.lastSpokeAt)
    .slice(0, MAX_VISIBLE_SPEAKERS);

  // Return original snapshot when nothing changed to prevent unnecessary React updates
  if (
    recentEvents.length === snapshot.recentEvents.length &&
    activeSpeakers.length === snapshot.activeSpeakers.length &&
    recentEvents.every((event, i) => event === snapshot.recentEvents[i]) &&
    activeSpeakers.every((speaker, i) => speaker === snapshot.activeSpeakers[i])
  ) {
    return snapshot;
  }

  return {
    ...snapshot,
    recentEvents,
    activeSpeakers,
    visualState: deriveVisualState(recentEvents, activeSpeakers, now),
  };
}

export function createChannelMessageOverlayEvent(input: {
  actorName: string;
  text: string;
  channelId: string;
  currentChannelId: string | null;
  timestamp: number;
}): CompanionOverlayEvent {
  const actor = safeName(input.actorName);
  const message = safeMessage(input.text);
  return {
    id: `evt-${input.timestamp}-channel-message`,
    kind: 'channel-message',
    actorName: actor,
    line: `${actor}: ${message}`,
    timestamp: input.timestamp,
    channelId: input.channelId,
  };
}

export function createMembershipOverlayEvent(input: {
  kind: 'user-joined' | 'user-left' | 'user-kicked' | 'user-banned';
  actorName: string;
  currentChannelId: string | null;
  eventChannelId: string;
  timestamp: number;
}): CompanionOverlayEvent {
  const actor = safeName(input.actorName);
  const lineByKind: Record<typeof input.kind, string> = {
    'user-joined': `${actor} joined the channel`,
    'user-left': `${actor} left the channel`,
    'user-kicked': `${actor} was kicked`,
    'user-banned': `${actor} was banned`,
  };

  return {
    id: `evt-${input.timestamp}-${input.kind}`,
    kind: input.kind,
    actorName: actor,
    line: lineByKind[input.kind],
    timestamp: input.timestamp,
    channelId: input.eventChannelId,
  };
}
