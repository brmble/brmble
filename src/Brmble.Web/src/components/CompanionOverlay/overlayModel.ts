import type { OverlaySettings } from '../SettingsModal/InterfaceSettingsTypes';
import type {
  CompanionId,
  CompanionOverlayEvent,
  CompanionOverlaySnapshot,
  CompanionSpeakerCandidate,
  CompanionSpeakerEntry,
  OverlayEventKind,
  OverlayVisualState,
} from './overlayTypes';

const MAX_EVENTS = 8;
const MAX_VISIBLE_SPEAKERS = 3;
const SPEAKER_DECAY_MS = 3_000;
const SPEAKER_ACTIVE_MS = 50_000;
const EVENT_TTL_MS = 5_000;
const QUIET_AFTER_MS = 15_000;
const CHAT_DISPLAY_MS = 5_000;
const JOIN_LEAVE_DISPLAY_MS = 3_000;
const SPEAKER_ELIGIBLE_AFTER_MS = 500;
const MAX_CHAT_QUEUE = 20;
const MAX_EVENT_QUEUE = 10;
const MAX_SPEAKER_CANDIDATES = 30;
const SPEAKER_CANDIDATE_PRUNE_MS = 60_000;
let speakerArrivalOrder = 0;

const UNKNOWN_USER = 'Unknown user';
const MESSAGE_UNAVAILABLE = 'Message unavailable';

function createDefaultFullCompanionState(): CompanionOverlaySnapshot['fullCompanion'] {
  return {
    activeDisplay: null,
    chatQueue: [],
    eventQueue: [],
    speakerCandidates: [],
    companionsByUser: {},
    localUser: {
      session: 0,
      name: 'You',
      companionId: 'clip',
    },
    flags: {
      localMuted: false,
      liveUserSessions: [],
    },
  };
}

function safeName(name: string | null | undefined): string {
  return name?.trim() || UNKNOWN_USER;
}

function safeMessage(text: string | null | undefined): string {
  return text?.trim() || MESSAGE_UNAVAILABLE;
}

function isChatEvent(event: CompanionOverlayEvent): boolean {
  return event.kind === 'channel-message' || event.kind === 'direct-message';
}

function isJoinLeaveEvent(event: CompanionOverlayEvent): boolean {
  return event.kind === 'user-joined' || event.kind === 'user-left' || event.kind === 'user-muted' || event.kind === 'user-unmuted';
}

function displayNameFromEvent(event: CompanionOverlayEvent): string {
  return safeName(event.actorName);
}

function representedSessionForName(
  state: CompanionOverlaySnapshot['fullCompanion'],
  name: string,
): number {
  const match = Object.values(state.companionsByUser).find((entry) => entry.name === name);
  return match?.session ?? state.localUser.session;
}

function resolveCompanionId(
  state: CompanionOverlaySnapshot['fullCompanion'],
  representedSession: number,
): CompanionId {
  if (representedSession === state.localUser.session) {
    return state.localUser.companionId;
  }

  return state.companionsByUser[representedSession]?.companionId ?? state.localUser.companionId;
}

function displayFromEvent(
  snapshot: CompanionOverlaySnapshot,
  event: CompanionOverlayEvent,
  now: number,
): CompanionOverlaySnapshot['fullCompanion']['activeDisplay'] {
  const representedName = displayNameFromEvent(event);
  const representedSession = representedSessionForName(snapshot.fullCompanion, representedName);
  const companion = snapshot.fullCompanion.companionsByUser[representedSession];
  const companionId = resolveCompanionId(snapshot.fullCompanion, representedSession);
  const isProxy = !companion?.companionId && representedSession !== snapshot.fullCompanion.localUser.session;
  const isLocal = representedSession === snapshot.fullCompanion.localUser.session;
  const kind = event.kind === 'user-joined' ? 'join' : event.kind === 'user-left' ? 'leave' : 'chat';

  return {
    id: event.id,
    kind,
    representedSession,
    representedName,
    companionId,
    row: 4,
    bubble: event.line,
    startedAt: now,
    expiresAt: now + (kind === 'chat' ? CHAT_DISPLAY_MS : JOIN_LEAVE_DISPLAY_MS),
    isProxy,
    badges: {
      muted: isLocal && snapshot.fullCompanion.flags.localMuted,
      live: snapshot.fullCompanion.flags.liveUserSessions.includes(representedSession),
    },
  };
}

function idleDisplay(
  snapshot: CompanionOverlaySnapshot,
  now: number,
): CompanionOverlaySnapshot['fullCompanion']['activeDisplay'] {
  const local = snapshot.fullCompanion.localUser;
  return {
    id: 'idle-local',
    kind: 'idle',
    representedSession: local.session,
    representedName: local.name,
    companionId: local.companionId,
    row: 1,
    bubble: null,
    startedAt: now,
    expiresAt: null,
    isProxy: false,
    badges: {
      muted: snapshot.fullCompanion.flags.localMuted,
      live: snapshot.fullCompanion.flags.liveUserSessions.includes(local.session),
    },
  };
}

function candidateToDisplay(
  snapshot: CompanionOverlaySnapshot,
  candidate: CompanionSpeakerCandidate,
  now: number,
): CompanionOverlaySnapshot['fullCompanion']['activeDisplay'] {
  const companion = snapshot.fullCompanion.companionsByUser[candidate.session];
  const companionId = resolveCompanionId(snapshot.fullCompanion, candidate.session);
  const isProxy = !companion?.companionId && candidate.session !== snapshot.fullCompanion.localUser.session;
  const isLocal = candidate.session === snapshot.fullCompanion.localUser.session;

  return {
    id: `speaking-${candidate.session}`,
    kind: 'speaking',
    representedSession: candidate.session,
    representedName: candidate.name,
    companionId,
    row: 9,
    bubble: null,
    startedAt: now,
    expiresAt: null,
    isProxy,
    badges: {
      muted: isLocal && snapshot.fullCompanion.flags.localMuted,
      live: snapshot.fullCompanion.flags.liveUserSessions.includes(candidate.session),
    },
  };
}

function eligibleSpeaker(snapshot: CompanionOverlaySnapshot, now: number): CompanionSpeakerCandidate | null {
  if (snapshot.fullCompanion.flags.localMuted) return null;

  const activeSessions = new Set(snapshot.activeSpeakers.filter((speaker) => speaker.isSpeaking).map((speaker) => speaker.session));
  return snapshot.fullCompanion.speakerCandidates
    .filter((candidate) => activeSessions.has(candidate.session))
    .filter((candidate) => candidate.eligibleAt <= now)
    .sort((a, b) => a.eligibleAt - b.eligibleAt || a.arrivalOrder - b.arrivalOrder)[0] ?? null;
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
    fullCompanion: createDefaultFullCompanionState(),
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
    || ((event.kind === 'user-joined' || event.kind === 'user-left' || event.kind === 'user-muted' || event.kind === 'user-unmuted') && settings.showJoinLeaveEvents && inCurrentChannel)
    || ((event.kind === 'user-kicked' || event.kind === 'user-banned') && settings.showModerationEvents && inCurrentChannel);

  if (!allowed) {
    return snapshot;
  }

  const now = event.timestamp;
  const nextEvents = [...snapshot.recentEvents, event].slice(-MAX_EVENTS);
  let nextFullCompanion = snapshot.fullCompanion;
  if (isChatEvent(event)) {
    const active = snapshot.fullCompanion.activeDisplay;
    nextFullCompanion = {
      ...snapshot.fullCompanion,
      chatQueue: active?.kind === 'chat'
        ? [...snapshot.fullCompanion.chatQueue, event]
        : active && active.kind !== 'idle'
          ? [...snapshot.fullCompanion.chatQueue, event]
          : snapshot.fullCompanion.chatQueue,
      activeDisplay: !active || active.kind === 'idle' ? displayFromEvent(snapshot, event, now) : active,
    };
  } else if (isJoinLeaveEvent(event)) {
    const active = snapshot.fullCompanion.activeDisplay;
    nextFullCompanion = {
      ...snapshot.fullCompanion,
      eventQueue: active && active.kind !== 'idle'
        ? [...snapshot.fullCompanion.eventQueue, event]
        : snapshot.fullCompanion.eventQueue,
      activeDisplay: !active || active.kind === 'idle' ? displayFromEvent(snapshot, event, now) : active,
    };
  }

  return {
    ...snapshot,
    recentEvents: nextEvents,
    visualState: deriveVisualState(nextEvents, snapshot.activeSpeakers, event.timestamp, event.kind),
    lastActivityAt: event.timestamp,
    fullCompanion: nextFullCompanion,
  };
}

export function updateFullCompanionContext(
  snapshot: CompanionOverlaySnapshot,
  context: {
    localUser?: Partial<CompanionOverlaySnapshot['fullCompanion']['localUser']>;
    companionsByUser?: CompanionOverlaySnapshot['fullCompanion']['companionsByUser'];
    localMuted?: boolean;
    liveUserSessions?: number[];
  },
): CompanionOverlaySnapshot {
  const nextLocalUser = {
    ...snapshot.fullCompanion.localUser,
    ...context.localUser,
  };
  const nextFullCompanion = {
    ...snapshot.fullCompanion,
    companionsByUser: context.companionsByUser ?? snapshot.fullCompanion.companionsByUser,
    localUser: nextLocalUser,
    flags: {
      ...snapshot.fullCompanion.flags,
      localMuted: context.localMuted ?? snapshot.fullCompanion.flags.localMuted,
      liveUserSessions: context.liveUserSessions ?? snapshot.fullCompanion.flags.liveUserSessions,
    },
  };
  const activeDisplay = nextFullCompanion.activeDisplay;
  const localCompanionChanged = context.localUser?.companionId !== undefined
    && context.localUser.companionId !== snapshot.fullCompanion.localUser.companionId;
  const flagsChanged = context.localMuted !== undefined || context.liveUserSessions !== undefined;
  
  let nextActiveDisplay = activeDisplay;
  
  // Keep the active display's representedSession in sync with the local user if it was representing the local user
  if (nextActiveDisplay && nextActiveDisplay.representedSession === snapshot.fullCompanion.localUser.session) {
    nextActiveDisplay = {
      ...nextActiveDisplay,
      representedSession: nextLocalUser.session,
      isProxy: false,
    };
  }
  
  // Update companionId if local user's companion changed
  if (localCompanionChanged && nextActiveDisplay && (nextActiveDisplay.representedSession === nextLocalUser.session || nextActiveDisplay.isProxy)) {
    nextActiveDisplay = {
      ...nextActiveDisplay,
      companionId: nextLocalUser.companionId,
    };
  }
  
  // Recompute badges if flags changed or if we just synced the session
  if (nextActiveDisplay && (flagsChanged || nextActiveDisplay.representedSession !== activeDisplay?.representedSession)) {
    const isLocal = nextActiveDisplay.representedSession === nextLocalUser.session;
    nextActiveDisplay = {
      ...nextActiveDisplay,
      badges: {
        muted: isLocal && nextFullCompanion.flags.localMuted,
        live: nextFullCompanion.flags.liveUserSessions.includes(nextActiveDisplay.representedSession),
      },
    };
  }

  return {
    ...snapshot,
    fullCompanion: {
      ...nextFullCompanion,
      activeDisplay: nextActiveDisplay,
    },
  };
}

export function setSpeakerActivity(
  snapshot: CompanionOverlaySnapshot,
  speaker: { session: number; name: string; channelId: number },
  speaking: boolean,
  now: number,
): CompanionOverlaySnapshot {
  const name = safeName(speaker.name);
  if (snapshot.fullCompanion.flags.localMuted) {
    return {
      ...snapshot,
      activeSpeakers: [],
      fullCompanion: {
        ...snapshot.fullCompanion,
        speakerCandidates: [],
        activeDisplay: snapshot.fullCompanion.activeDisplay?.kind === 'speaking'
          ? null
          : snapshot.fullCompanion.activeDisplay,
      },
      visualState: deriveVisualState(snapshot.recentEvents, [], now),
      lastActivityAt: now,
    };
  }

  const next = snapshot.activeSpeakers.filter((entry) => entry.session !== speaker.session);

  if (speaking) {
    next.push({
      session: speaker.session,
      name,
      channelId: speaker.channelId,
      isSpeaking: true,
      startedAt: now,
      lastSpokeAt: now,
      expiresAt: now + SPEAKER_ACTIVE_MS,
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
  const existingCandidate = snapshot.fullCompanion.speakerCandidates.find((entry) => entry.session === speaker.session);
  const remainingCandidates = snapshot.fullCompanion.speakerCandidates.filter((entry) => entry.session !== speaker.session);
  const speakerCandidates = speaking
    ? [
      ...remainingCandidates,
      {
        session: speaker.session,
        name,
        channelId: speaker.channelId,
        startedAt: existingCandidate?.startedAt ?? now,
        eligibleAt: (existingCandidate?.startedAt ?? now) + SPEAKER_ELIGIBLE_AFTER_MS,
        lastSpokeAt: now,
        stoppedAt: null,
        arrivalOrder: existingCandidate?.arrivalOrder ?? speakerArrivalOrder++,
      },
    ]
    : existingCandidate
      ? [
        ...remainingCandidates,
        {
          ...existingCandidate,
          name,
          lastSpokeAt: now,
          stoppedAt: now,
        },
      ]
      : remainingCandidates;

  return {
    ...snapshot,
    activeSpeakers: next.slice(0, MAX_VISIBLE_SPEAKERS),
    fullCompanion: {
      ...snapshot.fullCompanion,
      speakerCandidates,
      activeDisplay: !speaking && snapshot.fullCompanion.activeDisplay?.kind === 'speaking' && snapshot.fullCompanion.activeDisplay.representedSession === speaker.session
        ? null
        : snapshot.fullCompanion.activeDisplay,
    },
    visualState: deriveVisualState(snapshot.recentEvents, next, now),
    lastActivityAt: now,
  };
}

export function pruneOverlaySnapshot(snapshot: CompanionOverlaySnapshot, now: number): CompanionOverlaySnapshot {
  const recentEvents = snapshot.recentEvents
    .filter((event) => now - event.timestamp < EVENT_TTL_MS)
    .slice(-MAX_EVENTS);

  const activeSpeakers = snapshot.activeSpeakers
    .map((entry) => {
      // If still speaking, extend expiry to prevent disappearing during long continuous voice
      if (entry.isSpeaking && entry.expiresAt - now < SPEAKER_ACTIVE_MS) {
        return {
          ...entry,
          expiresAt: now + SPEAKER_ACTIVE_MS,
        };
      }
      return entry;
    })
    .filter((entry) => entry.expiresAt > now)
    .sort((a, b) => b.lastSpokeAt - a.lastSpokeAt)
    .slice(0, MAX_VISIBLE_SPEAKERS);

  // Prune fullCompanion queues and candidates
  const chatQueue = snapshot.fullCompanion.chatQueue.slice(-MAX_CHAT_QUEUE);
  const eventQueue = snapshot.fullCompanion.eventQueue.slice(-MAX_EVENT_QUEUE);
  const speakerCandidates = snapshot.fullCompanion.speakerCandidates
    .filter((candidate) => !candidate.stoppedAt || now - candidate.stoppedAt < SPEAKER_CANDIDATE_PRUNE_MS)
    .slice(-MAX_SPEAKER_CANDIDATES);

  // Return original snapshot when nothing changed to prevent unnecessary React updates
  if (
    recentEvents.length === snapshot.recentEvents.length &&
    activeSpeakers.length === snapshot.activeSpeakers.length &&
    chatQueue.length === snapshot.fullCompanion.chatQueue.length &&
    eventQueue.length === snapshot.fullCompanion.eventQueue.length &&
    speakerCandidates.length === snapshot.fullCompanion.speakerCandidates.length &&
    recentEvents.every((event, i) => event === snapshot.recentEvents[i]) &&
    activeSpeakers.every((speaker, i) => speaker === snapshot.activeSpeakers[i]) &&
    chatQueue.every((event, i) => event === snapshot.fullCompanion.chatQueue[i]) &&
    eventQueue.every((event, i) => event === snapshot.fullCompanion.eventQueue[i]) &&
    speakerCandidates.every((candidate, i) => candidate === snapshot.fullCompanion.speakerCandidates[i])
  ) {
    return snapshot;
  }

  return {
    ...snapshot,
    recentEvents,
    activeSpeakers,
    visualState: deriveVisualState(recentEvents, activeSpeakers, now),
    fullCompanion: {
      ...snapshot.fullCompanion,
      chatQueue,
      eventQueue,
      speakerCandidates,
    },
  };
}

export function resolveFullCompanionDisplay(snapshot: CompanionOverlaySnapshot, now: number): CompanionOverlaySnapshot {
  const active = snapshot.fullCompanion.activeDisplay;
  const activeExpired = active?.expiresAt !== null && active?.expiresAt !== undefined && active.expiresAt <= now;
  let nextState = snapshot.fullCompanion;

  if (activeExpired) {
    nextState = { ...nextState, activeDisplay: null };
  }

  if (!nextState.activeDisplay && nextState.chatQueue.length > 0) {
    const [nextChat, ...remaining] = nextState.chatQueue;
    const nextSnapshot = { ...snapshot, fullCompanion: { ...nextState, chatQueue: remaining } };
    return {
      ...nextSnapshot,
      fullCompanion: {
        ...nextSnapshot.fullCompanion,
        activeDisplay: displayFromEvent(nextSnapshot, nextChat, now),
      },
    };
  }

  const currentActive = nextState.activeDisplay;
  const canReplaceForSpeaking = !currentActive || currentActive.kind === 'idle' || currentActive.kind === 'join' || currentActive.kind === 'leave';
  const speaker = canReplaceForSpeaking ? eligibleSpeaker({ ...snapshot, fullCompanion: nextState }, now) : null;
  if (speaker) {
    return {
      ...snapshot,
      fullCompanion: {
        ...nextState,
        activeDisplay: candidateToDisplay({ ...snapshot, fullCompanion: nextState }, speaker, now),
      },
    };
  }

  if (!nextState.activeDisplay && nextState.eventQueue.length > 0) {
    const [nextEvent, ...remaining] = nextState.eventQueue;
    const nextSnapshot = { ...snapshot, fullCompanion: { ...nextState, eventQueue: remaining } };
    return {
      ...nextSnapshot,
      fullCompanion: {
        ...nextSnapshot.fullCompanion,
        activeDisplay: displayFromEvent(nextSnapshot, nextEvent, now),
      },
    };
  }

  if (!nextState.activeDisplay) {
    nextState = {
      ...nextState,
      activeDisplay: idleDisplay({ ...snapshot, fullCompanion: nextState }, now),
    };
  }

  if (nextState === snapshot.fullCompanion) {
    return snapshot;
  }

  return {
    ...snapshot,
    fullCompanion: nextState,
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
  kind: 'user-joined' | 'user-left' | 'user-kicked' | 'user-banned' | 'user-muted' | 'user-unmuted';
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
    'user-muted': `${actor} muted themselves`,
    'user-unmuted': `${actor} unmuted themselves`,
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

export function createServerMembershipOverlayEvent(input: {
  kind: 'user-joined' | 'user-left';
  actorName: string;
  line: string;
  timestamp: number;
}): CompanionOverlayEvent {
  const actor = safeName(input.actorName);
  const line = safeMessage(input.line);

  return {
    id: `evt-${input.timestamp}-${input.kind}-server`,
    kind: input.kind,
    actorName: actor,
    line,
    timestamp: input.timestamp,
  };
}
