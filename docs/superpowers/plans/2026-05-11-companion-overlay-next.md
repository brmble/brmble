# Companion Overlay Next Design Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve the existing companion overlay so `Full Companion` is driven by a single active companion display with chat, speaking, join/leave, idle, mute, and live-state priority rules while preserving `Minimal` mode.

**Architecture:** Keep the existing bridge-facing `CompanionOverlaySnapshot` and native overlay relay intact, then extend the web overlay model with a pure full-mode display orchestrator. `MinimalOverlay` continues to render from `recentEvents` and `activeSpeakers`; `FullCompanionOverlay` resolves an `activeDisplay` from snapshot queues, speaker candidates, companion lookup data, and local flags. `CompanionSprite` changes from generic visual-state image selection to atlas-row rendering with badge overlays.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, existing WebView2 overlay bridge, existing `OverlaySettings` persistence in `brmble-settings`.

---

## Assumptions

- Companion atlas assets for the first implementation can live in `src/Brmble.Web/src/assets/Companions/` and use imported static assets, because Vite already supports image imports.
- Remote-user companion ownership is modeled now but defaults to proxy behavior until profile/config data arrives later.
- The local user's companion selection is a setting named `myCompanion`, stored on `OverlaySettings`, with an initial built-in option named `cat`.
- `showActiveSpeakers: false` continues to disable speaker-driven overlay behavior in both modes.
- Live state is derived from screen-share state already held in `App.tsx`; when exact user streaming ownership is unavailable in the current code, wire the model with a `liveUserSessions` array and feed it from the best existing local/remote share state available during execution.

## File Structure

### Model and Types

- Modify: `src/Brmble.Web/src/components/CompanionOverlay/overlayTypes.ts`
  Responsibility: define companion IDs, atlas rows, display item kinds, full-mode queue state, companion lookup entries, and snapshot flags while keeping existing fields for Minimal mode.
- Modify: `src/Brmble.Web/src/components/CompanionOverlay/overlayModel.ts`
  Responsibility: preserve existing event filtering and speaker decay, add pure queue/orchestrator helpers for Full Companion, and expose deterministic time-based pruning.
- Modify: `src/Brmble.Web/src/components/CompanionOverlay/overlayModel.test.ts`
  Responsibility: lock the required priority, duration, speaker threshold, mute, cooldown, and live badge behavior.

### Full Companion Rendering

- Modify: `src/Brmble.Web/src/components/CompanionOverlay/CompanionSprite.tsx`
  Responsibility: render a selected companion atlas at row 1, 4, or 9 and show muted/live badges.
- Modify: `src/Brmble.Web/src/components/CompanionOverlay/FullCompanionOverlay.tsx`
  Responsibility: use the orchestrator result instead of `visualState`, render exactly one main companion, and keep `SpeakerStack` as supportive UI.
- Modify: `src/Brmble.Web/src/components/CompanionOverlay/CompanionOverlay.css`
  Responsibility: add atlas background positioning and badge styles without changing Minimal layout semantics.
- Modify: `src/Brmble.Web/src/components/CompanionOverlay/FullCompanionOverlay.test.tsx`
  Responsibility: assert idle, chat, speaking, join/leave, badge, and single-main-companion rendering.
- Leave unchanged except if tests expose a bug: `src/Brmble.Web/src/components/CompanionOverlay/MinimalOverlay.tsx`
  Responsibility: preserve current Minimal mode behavior.
- Modify only for regression coverage: `src/Brmble.Web/src/components/CompanionOverlay/MinimalOverlay.test.tsx`
  Responsibility: prove Minimal does not depend on companion assets or full-mode display state.

### Settings and Publisher Wiring

- Modify: `src/Brmble.Web/src/components/SettingsModal/InterfaceSettingsTypes.ts`
  Responsibility: add `myCompanion` to `OverlaySettings` and `DEFAULT_OVERLAY`.
- Modify: `src/Brmble.Web/src/components/SettingsModal/InterfaceSettingsTab.tsx`
  Responsibility: render `My Companion` only for Full Companion settings and persist changes through `onOverlayChange`.
- Modify: `src/Brmble.Web/src/components/CompanionOverlay/InterfaceSettingsTab.test.tsx`
  Responsibility: cover the new setting and existing toggles.
- Modify: `src/Brmble.Web/src/App.tsx`
  Responsibility: feed the snapshot with local session/name, companion lookup defaults, local mute flag, active/live user sessions, and existing chat/speaker/join/leave events.
- Modify: `src/Brmble.Web/src/hooks/useCompanionOverlayPublisher.test.ts`
  Responsibility: assert the extended snapshot is still published through `overlay.sync`.
- Modify if type errors require it: `src/Brmble.Web/src/components/CompanionOverlay/useOverlayBridgeState.ts`
  Responsibility: consume the extended snapshot shape without runtime transformation.

## Implementation Tasks

### Task 1: Extend Overlay Types And Snapshot Defaults

**Files:**
- Modify: `src/Brmble.Web/src/components/CompanionOverlay/overlayTypes.ts`
- Modify: `src/Brmble.Web/src/components/CompanionOverlay/overlayModel.ts`
- Test: `src/Brmble.Web/src/components/CompanionOverlay/overlayModel.test.ts`

- [ ] **Step 1: Write the failing snapshot-default test**

Add this test to `describe('overlayModel', ...)` in `src/Brmble.Web/src/components/CompanionOverlay/overlayModel.test.ts`:

```ts
it('creates full companion defaults for local idle display', () => {
  const snapshot = createOverlaySnapshot('7', 'Raid');

  expect(snapshot.fullCompanion).toEqual({
    activeDisplay: null,
    chatQueue: [],
    eventQueue: [],
    speakerCandidates: [],
    companionsByUser: {},
    localUser: {
      session: 0,
      name: 'You',
      companionId: 'cat',
    },
    flags: {
      localMuted: false,
      liveUserSessions: [],
    },
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `src/Brmble.Web`:

```bash
npm run test -- src/components/CompanionOverlay/overlayModel.test.ts
```

Expected: FAIL with a TypeScript or assertion error because `fullCompanion` is not defined on `CompanionOverlaySnapshot`.

- [ ] **Step 3: Add the full-mode types**

In `src/Brmble.Web/src/components/CompanionOverlay/overlayTypes.ts`, keep all existing exports and add these exports below `CompanionSpeakerEntry`:

```ts
export type CompanionAtlasRow = 1 | 4 | 9;
export type CompanionDisplayKind = 'idle' | 'chat' | 'speaking' | 'join' | 'leave';
export type CompanionId = 'cat';

export interface CompanionLookupEntry {
  session: number;
  name: string;
  companionId?: CompanionId;
  isProxy?: boolean;
}

export interface FullCompanionDisplay {
  id: string;
  kind: CompanionDisplayKind;
  representedSession: number;
  representedName: string;
  companionId: CompanionId;
  row: CompanionAtlasRow;
  bubble: string | null;
  startedAt: number;
  expiresAt: number | null;
  isProxy: boolean;
  badges: {
    muted: boolean;
    live: boolean;
  };
}

export interface CompanionSpeakerCandidate {
  session: number;
  name: string;
  channelId: number;
  startedAt: number;
  eligibleAt: number;
  lastSpokeAt: number;
  stoppedAt: number | null;
  arrivalOrder: number;
}

export interface FullCompanionState {
  activeDisplay: FullCompanionDisplay | null;
  chatQueue: CompanionOverlayEvent[];
  eventQueue: CompanionOverlayEvent[];
  speakerCandidates: CompanionSpeakerCandidate[];
  companionsByUser: Record<number, CompanionLookupEntry>;
  localUser: {
    session: number;
    name: string;
    companionId: CompanionId;
  };
  flags: {
    localMuted: boolean;
    liveUserSessions: number[];
  };
}
```

Then extend `CompanionOverlaySnapshot` with:

```ts
  fullCompanion: FullCompanionState;
```

- [ ] **Step 4: Add snapshot defaults**

In `src/Brmble.Web/src/components/CompanionOverlay/overlayModel.ts`, add this helper near the constants:

```ts
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
      companionId: 'cat',
    },
    flags: {
      localMuted: false,
      liveUserSessions: [],
    },
  };
}
```

Update `createOverlaySnapshot` to include the new field:

```ts
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
```

- [ ] **Step 5: Update existing test fixtures**

In `FullCompanionOverlay.test.tsx`, `MinimalOverlay.test.tsx`, and `OverlayApp.test.tsx`, replace hand-written snapshots with `createOverlaySnapshot(...)` plus object spreading. Use this pattern:

```ts
const snapshot = {
  ...createOverlaySnapshot('7', 'Raid'),
  visualState: 'speaking-nearby' as const,
  lastActivityAt: 100,
  activeSpeakers: [
    { session: 1, name: 'Milo', channelId: 7, isSpeaking: true, startedAt: 1, lastSpokeAt: 5, expiresAt: 10 },
  ],
};
```

- [ ] **Step 6: Run the model and overlay tests**

Run from `src/Brmble.Web`:

```bash
npm run test -- src/components/CompanionOverlay/overlayModel.test.ts src/components/CompanionOverlay/FullCompanionOverlay.test.tsx src/components/CompanionOverlay/MinimalOverlay.test.tsx src/components/CompanionOverlay/OverlayApp.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/Brmble.Web/src/components/CompanionOverlay/overlayTypes.ts src/Brmble.Web/src/components/CompanionOverlay/overlayModel.ts src/Brmble.Web/src/components/CompanionOverlay/overlayModel.test.ts src/Brmble.Web/src/components/CompanionOverlay/FullCompanionOverlay.test.tsx src/Brmble.Web/src/components/CompanionOverlay/MinimalOverlay.test.tsx src/Brmble.Web/src/components/CompanionOverlay/OverlayApp.test.tsx
git commit -m "feat: extend companion overlay snapshot model"
```

### Task 2: Add Full Companion Queue And Priority Orchestrator

**Files:**
- Modify: `src/Brmble.Web/src/components/CompanionOverlay/overlayModel.ts`
- Test: `src/Brmble.Web/src/components/CompanionOverlay/overlayModel.test.ts`

- [ ] **Step 1: Write failing priority and duration tests**

Add these tests to `overlayModel.test.ts`:

```ts
it('shows idle with local companion on row 1 when no work is pending', () => {
  const snapshot = resolveFullCompanionDisplay(createOverlaySnapshot('7', 'Raid'), 1_000);

  expect(snapshot.fullCompanion.activeDisplay).toEqual(expect.objectContaining({
    kind: 'idle',
    representedSession: 0,
    representedName: 'You',
    companionId: 'cat',
    row: 1,
    bubble: null,
    expiresAt: null,
  }));
});

it('chat preempts idle and expires after five seconds', () => {
  let snapshot = createOverlaySnapshot('7', 'Raid');
  snapshot = appendOverlayEvent(
    snapshot,
    createChannelMessageOverlayEvent({
      actorName: 'Milo',
      text: 'Heads up',
      channelId: '7',
      currentChannelId: '7',
      timestamp: 2_000,
    }),
    DEFAULT_OVERLAY,
  );

  snapshot = resolveFullCompanionDisplay(snapshot, 2_000);

  expect(snapshot.fullCompanion.activeDisplay).toEqual(expect.objectContaining({
    kind: 'chat',
    representedName: 'Milo',
    row: 4,
    bubble: 'Milo: Heads up',
    expiresAt: 7_000,
  }));

  snapshot = resolveFullCompanionDisplay(snapshot, 7_001);

  expect(snapshot.fullCompanion.activeDisplay).toEqual(expect.objectContaining({
    kind: 'idle',
    row: 1,
  }));
});

it('serializes multiple chats through the chat queue', () => {
  let snapshot = createOverlaySnapshot('7', 'Raid');
  snapshot = appendOverlayEvent(snapshot, {
    id: 'chat-1',
    kind: 'channel-message',
    actorName: 'Milo',
    line: 'Milo: first',
    timestamp: 1_000,
    channelId: '7',
  }, DEFAULT_OVERLAY);
  snapshot = resolveFullCompanionDisplay(snapshot, 1_000);
  snapshot = appendOverlayEvent(snapshot, {
    id: 'chat-2',
    kind: 'channel-message',
    actorName: 'Qy',
    line: 'Qy: second',
    timestamp: 1_100,
    channelId: '7',
  }, DEFAULT_OVERLAY);

  expect(snapshot.fullCompanion.activeDisplay?.bubble).toBe('Milo: first');
  expect(snapshot.fullCompanion.chatQueue.map((event) => event.line)).toEqual(['Qy: second']);

  snapshot = resolveFullCompanionDisplay(snapshot, 6_001);

  expect(snapshot.fullCompanion.activeDisplay).toEqual(expect.objectContaining({
    kind: 'chat',
    representedName: 'Qy',
    bubble: 'Qy: second',
    startedAt: 6_001,
    expiresAt: 11_001,
  }));
});
```

Update the import list in `overlayModel.test.ts` to include:

```ts
  resolveFullCompanionDisplay,
```

- [ ] **Step 2: Run the tests to verify they fail**

Run from `src/Brmble.Web`:

```bash
npm run test -- src/components/CompanionOverlay/overlayModel.test.ts
```

Expected: FAIL because `resolveFullCompanionDisplay` does not exist and events are not queued for full mode.

- [ ] **Step 3: Add orchestrator constants and helpers**

In `overlayModel.ts`, add these constants near the existing timing constants:

```ts
const CHAT_DISPLAY_MS = 5_000;
const JOIN_LEAVE_DISPLAY_MS = 3_000;
const SPEAKER_ELIGIBLE_AFTER_MS = 500;
const SPEAKER_COOLDOWN_MS = 3_000;
let speakerArrivalOrder = 0;
```

Add these helpers below `safeMessage`:

```ts
function isChatEvent(event: CompanionOverlayEvent): boolean {
  return event.kind === 'channel-message' || event.kind === 'direct-message';
}

function isJoinLeaveEvent(event: CompanionOverlayEvent): boolean {
  return event.kind === 'user-joined' || event.kind === 'user-left';
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

function displayFromEvent(
  snapshot: CompanionOverlaySnapshot,
  event: CompanionOverlayEvent,
  now: number,
): CompanionOverlaySnapshot['fullCompanion']['activeDisplay'] {
  const representedName = displayNameFromEvent(event);
  const representedSession = representedSessionForName(snapshot.fullCompanion, representedName);
  const companion = snapshot.fullCompanion.companionsByUser[representedSession];
  const companionId = companion?.companionId ?? snapshot.fullCompanion.localUser.companionId;
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

function idleDisplay(snapshot: CompanionOverlaySnapshot, now: number): CompanionOverlaySnapshot['fullCompanion']['activeDisplay'] {
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
```

- [ ] **Step 4: Queue full-mode events in `appendOverlayEvent`**

In `appendOverlayEvent`, after `const nextEvents = ...`, add:

```ts
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
      activeDisplay: !active || active.kind === 'idle' ? displayFromEvent(snapshot, event, event.timestamp) : active,
    };
  } else if (isJoinLeaveEvent(event)) {
    const active = snapshot.fullCompanion.activeDisplay;
    nextFullCompanion = {
      ...snapshot.fullCompanion,
      eventQueue: active && active.kind !== 'idle'
        ? [...snapshot.fullCompanion.eventQueue, event]
        : snapshot.fullCompanion.eventQueue,
      activeDisplay: !active || active.kind === 'idle' ? displayFromEvent(snapshot, event, event.timestamp) : active,
    };
  }
```

Then return `fullCompanion: nextFullCompanion` in the returned snapshot:

```ts
    fullCompanion: nextFullCompanion,
```

- [ ] **Step 5: Add `resolveFullCompanionDisplay`**

Add this export near `pruneOverlaySnapshot`:

```ts
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

  return {
    ...snapshot,
    fullCompanion: nextState,
  };
}
```

- [ ] **Step 6: Run the model tests**

Run from `src/Brmble.Web`:

```bash
npm run test -- src/components/CompanionOverlay/overlayModel.test.ts
```

Expected: PASS for the new idle/chat queue tests and all existing overlay model tests.

- [ ] **Step 7: Commit**

```bash
git add src/Brmble.Web/src/components/CompanionOverlay/overlayModel.ts src/Brmble.Web/src/components/CompanionOverlay/overlayModel.test.ts
git commit -m "feat: add full companion display orchestration"
```

### Task 3: Add Speaker Threshold, Priority, Mute, And Cooldown Rules

**Files:**
- Modify: `src/Brmble.Web/src/components/CompanionOverlay/overlayModel.ts`
- Test: `src/Brmble.Web/src/components/CompanionOverlay/overlayModel.test.ts`

- [ ] **Step 1: Write failing speaker tests**

Add these tests to `overlayModel.test.ts`:

```ts
it('promotes speakers only after half a second of continuous speech', () => {
  let snapshot = createOverlaySnapshot('7', 'Raid');
  snapshot = setSpeakerActivity(snapshot, { session: 11, name: 'Milo', channelId: 7 }, true, 1_000);

  snapshot = resolveFullCompanionDisplay(snapshot, 1_499);
  expect(snapshot.fullCompanion.activeDisplay?.kind).toBe('idle');

  snapshot = resolveFullCompanionDisplay(snapshot, 1_500);
  expect(snapshot.fullCompanion.activeDisplay).toEqual(expect.objectContaining({
    kind: 'speaking',
    representedSession: 11,
    representedName: 'Milo',
    row: 9,
    bubble: null,
  }));
});

it('keeps chat ahead of eligible speakers', () => {
  let snapshot = createOverlaySnapshot('7', 'Raid');
  snapshot = appendOverlayEvent(snapshot, {
    id: 'chat-1',
    kind: 'channel-message',
    actorName: 'Qy',
    line: 'Qy: hold on',
    timestamp: 1_000,
    channelId: '7',
  }, DEFAULT_OVERLAY);
  snapshot = setSpeakerActivity(snapshot, { session: 11, name: 'Milo', channelId: 7 }, true, 1_100);
  snapshot = resolveFullCompanionDisplay(snapshot, 1_700);

  expect(snapshot.fullCompanion.activeDisplay).toEqual(expect.objectContaining({
    kind: 'chat',
    representedName: 'Qy',
  }));
});

it('queues join and leave behind chat and speaking', () => {
  let snapshot = createOverlaySnapshot('7', 'Raid');
  snapshot = setSpeakerActivity(snapshot, { session: 11, name: 'Milo', channelId: 7 }, true, 1_000);
  snapshot = resolveFullCompanionDisplay(snapshot, 1_500);
  snapshot = appendOverlayEvent(snapshot, {
    id: 'join-1',
    kind: 'user-joined',
    actorName: 'Kira',
    line: 'Kira joined the channel',
    timestamp: 1_600,
    channelId: '7',
  }, DEFAULT_OVERLAY);

  expect(snapshot.fullCompanion.activeDisplay?.kind).toBe('speaking');
  expect(snapshot.fullCompanion.eventQueue.map((event) => event.line)).toEqual(['Kira joined the channel']);
});

it('local mute suppresses speaker displays and active speaking indicators only', () => {
  let snapshot = updateFullCompanionContext(createOverlaySnapshot('7', 'Raid'), {
    localMuted: true,
  });
  snapshot = setSpeakerActivity(snapshot, { session: 11, name: 'Milo', channelId: 7 }, true, 1_000);
  snapshot = resolveFullCompanionDisplay(snapshot, 1_600);

  expect(snapshot.fullCompanion.activeDisplay?.kind).toBe('idle');
  expect(snapshot.activeSpeakers).toHaveLength(0);

  snapshot = appendOverlayEvent(snapshot, {
    id: 'chat-1',
    kind: 'channel-message',
    actorName: 'Milo',
    line: 'Milo: still visible',
    timestamp: 2_000,
    channelId: '7',
  }, DEFAULT_OVERLAY);

  expect(snapshot.fullCompanion.activeDisplay).toEqual(expect.objectContaining({
    kind: 'chat',
    bubble: 'Milo: still visible',
  }));
});

it('keeps stopped speakers cooling in indicators before removing them', () => {
  let snapshot = createOverlaySnapshot('7', 'Raid');
  snapshot = setSpeakerActivity(snapshot, { session: 11, name: 'Milo', channelId: 7 }, true, 1_000);
  snapshot = setSpeakerActivity(snapshot, { session: 11, name: 'Milo', channelId: 7 }, false, 1_600);

  expect(snapshot.activeSpeakers).toEqual([
    expect.objectContaining({
      session: 11,
      isSpeaking: false,
      expiresAt: 4_600,
    }),
  ]);

  snapshot = pruneOverlaySnapshot(snapshot, 4_601);

  expect(snapshot.activeSpeakers).toHaveLength(0);
});
```

Update the import list to include:

```ts
  updateFullCompanionContext,
```

- [ ] **Step 2: Run the tests to verify they fail**

Run from `src/Brmble.Web`:

```bash
npm run test -- src/components/CompanionOverlay/overlayModel.test.ts
```

Expected: FAIL because speaker candidates, local mute, and speaker display priority are not fully implemented.

- [ ] **Step 3: Add context updater**

Add this export to `overlayModel.ts`:

```ts
export function updateFullCompanionContext(
  snapshot: CompanionOverlaySnapshot,
  context: {
    localUser?: Partial<CompanionOverlaySnapshot['fullCompanion']['localUser']>;
    companionsByUser?: CompanionOverlaySnapshot['fullCompanion']['companionsByUser'];
    localMuted?: boolean;
    liveUserSessions?: number[];
  },
): CompanionOverlaySnapshot {
  return {
    ...snapshot,
    fullCompanion: {
      ...snapshot.fullCompanion,
      companionsByUser: context.companionsByUser ?? snapshot.fullCompanion.companionsByUser,
      localUser: {
        ...snapshot.fullCompanion.localUser,
        ...context.localUser,
      },
      flags: {
        ...snapshot.fullCompanion.flags,
        localMuted: context.localMuted ?? snapshot.fullCompanion.flags.localMuted,
        liveUserSessions: context.liveUserSessions ?? snapshot.fullCompanion.flags.liveUserSessions,
      },
    },
  };
}
```

- [ ] **Step 4: Update `setSpeakerActivity` for candidates and mute**

At the start of `setSpeakerActivity`, after `const name = safeName(speaker.name);`, add:

```ts
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
```

Before the final `return` in `setSpeakerActivity`, create `speakerCandidates`:

```ts
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
```

Include this in the returned snapshot:

```ts
    fullCompanion: {
      ...snapshot.fullCompanion,
      speakerCandidates,
      activeDisplay: !speaking && snapshot.fullCompanion.activeDisplay?.kind === 'speaking' && snapshot.fullCompanion.activeDisplay.representedSession === speaker.session
        ? null
        : snapshot.fullCompanion.activeDisplay,
    },
```

- [ ] **Step 5: Add speaker display helpers**

Add these helpers to `overlayModel.ts`:

```ts
function candidateToDisplay(
  snapshot: CompanionOverlaySnapshot,
  candidate: CompanionSpeakerCandidate,
  now: number,
): CompanionOverlaySnapshot['fullCompanion']['activeDisplay'] {
  const companion = snapshot.fullCompanion.companionsByUser[candidate.session];
  const companionId = companion?.companionId ?? snapshot.fullCompanion.localUser.companionId;
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
```

- [ ] **Step 6: Promote eligible speakers in `resolveFullCompanionDisplay`**

In `resolveFullCompanionDisplay`, after the chat queue block and before the event queue block, add:

```ts
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
```

- [ ] **Step 7: Run the model tests**

Run from `src/Brmble.Web`:

```bash
npm run test -- src/components/CompanionOverlay/overlayModel.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/Brmble.Web/src/components/CompanionOverlay/overlayModel.ts src/Brmble.Web/src/components/CompanionOverlay/overlayModel.test.ts
git commit -m "feat: prioritize companion speaker displays"
```

### Task 4: Render Atlas Rows And Badges In Full Companion

**Files:**
- Modify: `src/Brmble.Web/src/components/CompanionOverlay/CompanionSprite.tsx`
- Modify: `src/Brmble.Web/src/components/CompanionOverlay/FullCompanionOverlay.tsx`
- Modify: `src/Brmble.Web/src/components/CompanionOverlay/CompanionOverlay.css`
- Test: `src/Brmble.Web/src/components/CompanionOverlay/FullCompanionOverlay.test.tsx`

- [ ] **Step 1: Write failing rendering tests**

Replace the current `FullCompanionOverlay.test.tsx` with:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createOverlaySnapshot, resolveFullCompanionDisplay, updateFullCompanionContext } from './overlayModel';
import { FullCompanionOverlay } from './FullCompanionOverlay';

describe('FullCompanionOverlay', () => {
  it('renders one idle local companion from atlas row 1 without a bubble', () => {
    const snapshot = resolveFullCompanionDisplay(createOverlaySnapshot('7', 'Raid'), 1_000);

    render(<FullCompanionOverlay snapshot={snapshot} position="bottom-left" />);

    expect(screen.getByTestId('companion-overlay-root')).toHaveClass('companion-overlay--position-bottom-left');
    expect(screen.getAllByTestId('companion-sprite')).toHaveLength(1);
    expect(screen.getByTestId('companion-sprite')).toHaveAttribute('data-row', '1');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('renders chat bubble and badges for active display', () => {
    let snapshot = updateFullCompanionContext(createOverlaySnapshot('7', 'Raid'), {
      localMuted: true,
      liveUserSessions: [0],
    });
    snapshot = {
      ...snapshot,
      fullCompanion: {
        ...snapshot.fullCompanion,
        activeDisplay: {
          id: 'chat-1',
          kind: 'chat',
          representedSession: 0,
          representedName: 'You',
          companionId: 'cat',
          row: 4,
          bubble: 'You: hello',
          startedAt: 1_000,
          expiresAt: 6_000,
          isProxy: false,
          badges: {
            muted: true,
            live: true,
          },
        },
      },
    };

    render(<FullCompanionOverlay snapshot={snapshot} position="bottom-left" />);

    expect(screen.getByTestId('companion-sprite')).toHaveAttribute('data-row', '4');
    expect(screen.getByText('You: hello')).toBeInTheDocument();
    expect(screen.getByLabelText('Muted')).toBeInTheDocument();
    expect(screen.getByLabelText('Live')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the rendering test to verify it fails**

Run from `src/Brmble.Web`:

```bash
npm run test -- src/components/CompanionOverlay/FullCompanionOverlay.test.tsx
```

Expected: FAIL because `CompanionSprite` still takes `visualState` and does not expose `data-row` or badges.

- [ ] **Step 3: Rewrite `CompanionSprite`**

Replace `src/Brmble.Web/src/components/CompanionOverlay/CompanionSprite.tsx` with:

```tsx
import catAtlas from '../../assets/Sprites/Cat/cat_idle.png';
import type { CompanionAtlasRow, CompanionId } from './overlayTypes';

const atlasByCompanion: Record<CompanionId, string> = {
  cat: catAtlas,
};

export function CompanionSprite({
  companionId,
  row,
  badges,
}: {
  companionId: CompanionId;
  row: CompanionAtlasRow;
  badges: {
    muted: boolean;
    live: boolean;
  };
}) {
  return (
    <div className="companion-sprite-frame">
      <div
        className="companion-sprite companion-sprite--atlas"
        data-testid="companion-sprite"
        data-companion-id={companionId}
        data-row={row}
        role="img"
        aria-label="Brmblegotchi companion"
        style={{
          backgroundImage: `url(${atlasByCompanion[companionId]})`,
          backgroundPositionY: `-${row - 1}00%`,
        }}
      />
      <div className="companion-badges" aria-label="Companion badges">
        {badges.muted && <span className="companion-badge companion-badge--muted" aria-label="Muted">M</span>}
        {badges.live && <span className="companion-badge companion-badge--live" aria-label="Live">LIVE</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Rewrite `FullCompanionOverlay` to use active display**

Replace `src/Brmble.Web/src/components/CompanionOverlay/FullCompanionOverlay.tsx` with:

```tsx
import type { CompanionOverlaySnapshot } from './overlayTypes';
import type { OverlaySettings } from '../SettingsModal/InterfaceSettingsTypes';
import { CompanionSprite } from './CompanionSprite';
import { SpeakerStack } from './SpeakerStack';

export function FullCompanionOverlay({
  snapshot,
  position,
}: {
  snapshot: CompanionOverlaySnapshot;
  position: OverlaySettings['position'];
}) {
  const display = snapshot.fullCompanion.activeDisplay;

  if (!display) {
    return null;
  }

  return (
    <section
      className={`companion-overlay companion-overlay--full companion-overlay--position-${position}`}
      data-testid="companion-overlay-root"
    >
      <div className="companion-anchor">
        <CompanionSprite companionId={display.companionId} row={display.row} badges={display.badges} />
        {display.bubble && (
          <aside className="companion-bubble" role="status" aria-live="polite">
            <p>{display.bubble}</p>
          </aside>
        )}
      </div>
      <SpeakerStack speakers={snapshot.activeSpeakers} />
    </section>
  );
}
```

- [ ] **Step 5: Add sprite and badge CSS**

In `CompanionOverlay.css`, replace the existing `.companion-sprite` block:

```css
.companion-sprite {
  width: 120px;
  image-rendering: pixelated;
}
```

with:

```css
.companion-sprite-frame {
  position: relative;
  width: 120px;
  height: 120px;
}

.companion-sprite {
  width: 120px;
  height: 120px;
  image-rendering: pixelated;
}

.companion-sprite--atlas {
  background-repeat: no-repeat;
  background-size: 100% 900%;
}

.companion-badges {
  position: absolute;
  top: -8px;
  right: -8px;
  display: flex;
  gap: 4px;
}

.companion-badge {
  display: inline-flex;
  min-width: 20px;
  height: 20px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  padding: 0 6px;
  background: rgba(0, 0, 0, 0.72);
  color: white;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-shadow: none;
}

.companion-badge--muted {
  background: rgba(230, 74, 74, 0.88);
}

.companion-badge--live {
  background: rgba(64, 188, 111, 0.88);
}
```

- [ ] **Step 6: Run the rendering test**

Run from `src/Brmble.Web`:

```bash
npm run test -- src/components/CompanionOverlay/FullCompanionOverlay.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/Brmble.Web/src/components/CompanionOverlay/CompanionSprite.tsx src/Brmble.Web/src/components/CompanionOverlay/FullCompanionOverlay.tsx src/Brmble.Web/src/components/CompanionOverlay/CompanionOverlay.css src/Brmble.Web/src/components/CompanionOverlay/FullCompanionOverlay.test.tsx
git commit -m "feat: render full companion atlas display"
```

### Task 5: Wire Full Companion Context From App State

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`
- Modify: `src/Brmble.Web/src/components/CompanionOverlay/overlayModel.ts`
- Test: `src/Brmble.Web/src/hooks/useCompanionOverlayPublisher.test.ts`

- [ ] **Step 1: Write failing publisher test for extended snapshot**

In `src/Brmble.Web/src/hooks/useCompanionOverlayPublisher.test.ts`, add:

```ts
it('publishes full companion context in overlay.sync payload', () => {
  const snapshot = updateFullCompanionContext(createOverlaySnapshot('7', 'Raid'), {
    localUser: {
      session: 42,
      name: 'Local',
      companionId: 'cat',
    },
    companionsByUser: {
      99: {
        session: 99,
        name: 'Milo',
        companionId: 'cat',
      },
    },
    localMuted: true,
    liveUserSessions: [42],
  });

  renderHook(() => useCompanionOverlayPublisher({ ...DEFAULT_OVERLAY, overlayEnabled: true }, snapshot));

  expect(bridge.send).toHaveBeenCalledWith('overlay.sync', expect.objectContaining({
    snapshot: expect.objectContaining({
      fullCompanion: expect.objectContaining({
        localUser: expect.objectContaining({ session: 42, name: 'Local' }),
        flags: expect.objectContaining({ localMuted: true, liveUserSessions: [42] }),
      }),
    }),
  }));
});
```

Update imports in that file:

```ts
import { createOverlaySnapshot, updateFullCompanionContext } from '../components/CompanionOverlay/overlayModel';
```

- [ ] **Step 2: Run publisher test**

Run from `src/Brmble.Web`:

```bash
npm run test -- src/hooks/useCompanionOverlayPublisher.test.ts
```

Expected: PASS if Task 3 added `updateFullCompanionContext`; if it fails, fix the import/export before continuing.

- [ ] **Step 3: Import context helpers in `App.tsx`**

Add `resolveFullCompanionDisplay` and `updateFullCompanionContext` to the existing overlay model imports in `src/Brmble.Web/src/App.tsx`:

```ts
  resolveFullCompanionDisplay,
  updateFullCompanionContext,
```

- [ ] **Step 4: Update the pruning interval to resolve full display**

Replace the interval callback at lines around `527-529`:

```ts
      setOverlaySnapshot((prev) => pruneOverlaySnapshot(prev, Date.now()));
```

with:

```ts
      setOverlaySnapshot((prev) => resolveFullCompanionDisplay(pruneOverlaySnapshot(prev, Date.now()), Date.now()));
```

Also replace the immediate prune at overlay enable:

```ts
    setOverlaySnapshot((prev) => pruneOverlaySnapshot(prev, Date.now()));
```

with:

```ts
    setOverlaySnapshot((prev) => resolveFullCompanionDisplay(pruneOverlaySnapshot(prev, Date.now()), Date.now()));
```

- [ ] **Step 5: Add context sync effect**

After the existing `useEffect` that updates `currentChannelId/currentChannelName`, add:

```ts
  useEffect(() => {
    const localUser = users.find((user) => user.self);
    const companionsByUser = Object.fromEntries(
      users
        .filter((user) => user.session !== undefined)
        .map((user) => [
          user.session,
          {
            session: user.session,
            name: user.name || 'Unknown user',
            companionId: 'cat' as const,
            isProxy: false,
          },
        ]),
    );
    const liveUserSessions = isSharingRef.current && localUser?.session !== undefined
      ? [localUser.session]
      : [];

    setOverlaySnapshot((prev) => updateFullCompanionContext(prev, {
      localUser: {
        session: localUser?.session ?? selfSession ?? 0,
        name: localUser?.name || username || 'You',
        companionId: overlaySettings.myCompanion,
      },
      companionsByUser,
      localMuted: selfMuted,
      liveUserSessions,
    }));
  }, [overlaySettings.myCompanion, selfMuted, selfSession, username, users]);
```

If TypeScript reports that `User.session` can be undefined despite the filter, rewrite the map body with an explicit guard:

```ts
    const companionsByUser = users.reduce<CompanionOverlaySnapshot['fullCompanion']['companionsByUser']>((acc, user) => {
      if (user.session === undefined) return acc;
      acc[user.session] = {
        session: user.session,
        name: user.name || 'Unknown user',
        companionId: 'cat',
        isProxy: false,
      };
      return acc;
    }, {});
```

- [ ] **Step 6: Resolve display immediately after event mutations**

For each `setOverlaySnapshot((prev) => appendOverlayEvent(...))` or `setOverlaySnapshot((prev) => setSpeakerActivity(...))` in `App.tsx`, wrap the result with `resolveFullCompanionDisplay(next, Date.now())`.

Use this pattern for chat:

```ts
      setOverlaySnapshot((prev) => {
        const now = Date.now();
        const next = appendOverlayEvent(
          prev,
          createChannelMessageOverlayEvent({
            actorName: message.sender,
            text: message.content,
            channelId,
            currentChannelId: prev.currentChannelId,
            timestamp: message.timestamp.getTime(),
          }),
          settings,
        );
        return resolveFullCompanionDisplay(next, now);
      });
```

Use this pattern for speaker activity:

```ts
              const next = setSpeakerActivity(
                prev,
                { session: d.session, name: user.name, channelId: speakerChannelId },
                true,
                Date.now(),
              );
              return resolveFullCompanionDisplay(next, Date.now());
```

- [ ] **Step 7: Run focused web tests**

Run from `src/Brmble.Web`:

```bash
npm run test -- src/hooks/useCompanionOverlayPublisher.test.ts src/components/CompanionOverlay/overlayModel.test.ts src/components/CompanionOverlay/FullCompanionOverlay.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/Brmble.Web/src/App.tsx src/Brmble.Web/src/hooks/useCompanionOverlayPublisher.test.ts
git commit -m "feat: wire companion context into overlay snapshots"
```

### Task 6: Add My Companion Setting

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/InterfaceSettingsTypes.ts`
- Modify: `src/Brmble.Web/src/components/SettingsModal/InterfaceSettingsTab.tsx`
- Test: `src/Brmble.Web/src/components/CompanionOverlay/InterfaceSettingsTab.test.tsx`

- [ ] **Step 1: Write failing settings test**

Add this assertion sequence to the existing `renders overlay mode and event toggles and forwards changes` test after the overlay mode selection:

```ts
    fireEvent.click(screen.getByText('My Companion').closest('.settings-item')!.querySelector('[role="combobox"]')!);
    fireEvent.click(screen.getByRole('option', { name: 'Cat' }));
```

Add this expectation after the existing `onOverlayChange` expectations:

```ts
    expect(onOverlayChange).toHaveBeenCalledWith(expect.objectContaining({
      myCompanion: 'cat',
    }));
```

- [ ] **Step 2: Run the settings test to verify it fails**

Run from `src/Brmble.Web`:

```bash
npm run test -- src/components/CompanionOverlay/InterfaceSettingsTab.test.tsx
```

Expected: FAIL because `myCompanion` and the `My Companion` select do not exist.

- [ ] **Step 3: Extend `OverlaySettings`**

In `InterfaceSettingsTypes.ts`, add the import-free type:

```ts
export type CompanionSelection = 'cat';
```

Add this property to `OverlaySettings`:

```ts
  myCompanion: CompanionSelection;
```

Add the default:

```ts
  myCompanion: 'cat',
```

- [ ] **Step 4: Add setting handler**

In `InterfaceSettingsTab.tsx`, update the type import to include `CompanionSelection`.

Add this handler near the other overlay handlers:

```ts
  const handleMyCompanionChange = (companion: string) => {
    const validCompanion: CompanionSelection = companion === 'cat' ? companion : 'cat';
    onOverlayChange({ ...overlaySettings, myCompanion: validCompanion });
  };
```

- [ ] **Step 5: Render the `My Companion` select**

Place this block immediately after the Overlay Mode setting:

```tsx
        {overlaySettings.mode === 'full' && (
          <div className="settings-item">
            <label>My Companion</label>
            <Select
              value={overlaySettings.myCompanion}
              onChange={handleMyCompanionChange}
              options={[
                { value: 'cat', label: 'Cat' },
              ]}
            />
          </div>
        )}
```

- [ ] **Step 6: Run the settings test**

Run from `src/Brmble.Web`:

```bash
npm run test -- src/components/CompanionOverlay/InterfaceSettingsTab.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/Brmble.Web/src/components/SettingsModal/InterfaceSettingsTypes.ts src/Brmble.Web/src/components/SettingsModal/InterfaceSettingsTab.tsx src/Brmble.Web/src/components/CompanionOverlay/InterfaceSettingsTab.test.tsx
git commit -m "feat: add companion selection setting"
```

### Task 7: Preserve Minimal Mode Boundary

**Files:**
- Modify: `src/Brmble.Web/src/components/CompanionOverlay/MinimalOverlay.test.tsx`
- Modify only if the test fails: `src/Brmble.Web/src/components/CompanionOverlay/MinimalOverlay.tsx`

- [ ] **Step 1: Add regression test that Minimal ignores full companion display**

Add this test to `MinimalOverlay.test.tsx`:

```tsx
it('does not render full companion active display data', () => {
  const snapshot = {
    ...createOverlaySnapshot('7', 'Raid'),
    fullCompanion: {
      ...createOverlaySnapshot('7', 'Raid').fullCompanion,
      activeDisplay: {
        id: 'chat-1',
        kind: 'chat' as const,
        representedSession: 99,
        representedName: 'Milo',
        companionId: 'cat' as const,
        row: 4 as const,
        bubble: 'Milo: full mode only',
        startedAt: 1_000,
        expiresAt: 6_000,
        isProxy: false,
        badges: {
          muted: false,
          live: false,
        },
      },
    },
    recentEvents: [
      { id: 'e1', kind: 'user-joined' as const, actorName: 'Kira', line: 'Kira joined the channel', timestamp: 1_000, channelId: '7' },
    ],
  };

  render(<MinimalOverlay snapshot={snapshot} position="top-left" />);

  expect(screen.queryByText('Milo: full mode only')).toBeNull();
  expect(screen.queryByTestId('companion-sprite')).toBeNull();
  expect(screen.getByText('Kira joined the channel')).toBeInTheDocument();
});
```

Add `createOverlaySnapshot` to the imports:

```ts
import { createOverlaySnapshot } from './overlayModel';
```

- [ ] **Step 2: Run Minimal tests**

Run from `src/Brmble.Web`:

```bash
npm run test -- src/components/CompanionOverlay/MinimalOverlay.test.tsx
```

Expected: PASS. If it fails because `MinimalOverlay` reads `fullCompanion`, remove that dependency from `MinimalOverlay`.

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/CompanionOverlay/MinimalOverlay.test.tsx src/Brmble.Web/src/components/CompanionOverlay/MinimalOverlay.tsx
git commit -m "test: preserve minimal companion overlay boundary"
```

### Task 8: Final Verification And Build

**Files:**
- Verify only unless failures require fixes.

- [ ] **Step 1: Run all companion overlay tests**

Run from `src/Brmble.Web`:

```bash
npm run test -- src/components/CompanionOverlay/overlayModel.test.ts src/components/CompanionOverlay/FullCompanionOverlay.test.tsx src/components/CompanionOverlay/MinimalOverlay.test.tsx src/components/CompanionOverlay/OverlayApp.test.tsx src/components/CompanionOverlay/InterfaceSettingsTab.test.tsx src/hooks/useCompanionOverlayPublisher.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run the web build**

Run from repository root:

```bash
npm run build
```

Expected: PASS with TypeScript and Vite build completing successfully.

- [ ] **Step 3: Run client overlay relay tests**

Run from repository root:

```bash
dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter CompanionOverlayRelayTests
```

Expected: PASS. This confirms the bridge relay still accepts the extended payload shape as an opaque string.

- [ ] **Step 4: Manual smoke test in app**

Run the app using the project’s normal local launch flow, enable `Interface -> In-Game Overlay`, choose `Full Companion`, and verify:

```text
Idle: one companion is visible with no bubble.
Channel chat: one companion switches to row 4 with the message bubble for about 5 seconds.
Multiple chats: second chat waits until the first expires.
Speaking: a speaker appears only after about 0.5 seconds and uses row 9.
Mute: local mute suppresses speaker switching and speaker indicators, while chat still displays.
Join/leave: join and leave messages wait behind chat/speaking and display for about 3 seconds.
Minimal: Minimal mode still shows speaker pills and event feed only, with no companion sprite.
```

- [ ] **Step 5: Commit final fixes if any**

If verification required changes:

```bash
git add src/Brmble.Web/src/components/CompanionOverlay src/Brmble.Web/src/components/SettingsModal src/Brmble.Web/src/hooks src/Brmble.Web/src/App.tsx
git commit -m "fix: stabilize companion overlay orchestration"
```

If verification required no changes, do not create an empty commit.

## Self-Review

- Spec coverage: The plan covers the mode boundary, single active companion, automatic source selection, atlas row contract, active display/queues/speaker candidates, display priority, chat duration, speaking threshold, join/leave duration, idle fallback, muted/live badges, settings addition, UI boundary, and migration away from `visualState` in Full Companion.
- Placeholder scan: The plan contains no red-flag placeholder phrasing. Each implementation step names exact files, commands, expected results, and concrete code.
- Type consistency: The plan consistently uses `fullCompanion`, `activeDisplay`, `chatQueue`, `eventQueue`, `speakerCandidates`, `CompanionAtlasRow`, `CompanionId`, `myCompanion`, `resolveFullCompanionDisplay`, and `updateFullCompanionContext`.
