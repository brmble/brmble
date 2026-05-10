# Brmblegotchi Companion Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy sidebar pet with a true companion overlay that surfaces current-channel chat, DMs, join/leave events, moderation events, and active speakers in `Full Companion` and `Minimal` modes.

**Architecture:** Keep `src/Brmble.Web/src/App.tsx` as the single live source of truth for Matrix, Mumble, and current-channel context. Add a pure overlay model in the web app that normalizes only overlay-safe events, then publish serialized `overlay.sync` snapshots through the native bridge to a second always-on-top WebView2 overlay window. Build two presentation shells (`Minimal` and `Full Companion`) against the same snapshot contract, and treat the current `Brmblegotchi.tsx` pet logic as legacy-only state that is tolerated in storage but no longer mounted.

**Tech Stack:** React 19, TypeScript, Vitest, WebView2, C#/.NET 10, MSTest, existing `bridge.ts`, existing Matrix/Mumble integrations.

---

## Assumptions

- This plan assumes `Interface -> In-Game Overlay` means a real native always-on-top overlay window, not an in-app panel.
- Matrix activity should not be duplicated in a second web client. The main webview owns Matrix and forwards normalized overlay snapshots to the overlay webview.
- Legacy `brmblegotchi` storage stays readable during the rollout, but hunger, cleanliness, growth, care actions, and the sidebar pet UI stop defining the shipped experience.

## File Structure

### Web files

- Modify: `src/Brmble.Web/src/App.tsx`
  Responsibility: own live overlay settings state, wire the publisher into Mumble and Matrix event flow, stop mounting the legacy sidebar pet.
- Modify: `src/Brmble.Web/src/hooks/useMatrixClient.ts`
  Responsibility: expose optional incoming channel/DM message taps so the overlay can hear Matrix activity without duplicating the SDK.
- Modify: `src/Brmble.Web/src/hooks/useMatrixClient.test.ts`
  Responsibility: lock the new Matrix activity callback behavior.
- Modify: `src/Brmble.Web/src/components/SettingsModal/InterfaceSettingsTypes.ts`
  Responsibility: define the persisted overlay settings contract.
- Modify: `src/Brmble.Web/src/components/SettingsModal/InterfaceSettingsTab.tsx`
  Responsibility: replace the placeholder overlay UI with the real settings surface.
- Modify: `src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx`
  Responsibility: merge defaults, persist overlay settings, and forward live changes to `App.tsx`.
- Modify: `src/Brmble.Web/src/components/OnboardingWizard/OnboardingWizard.tsx`
  Responsibility: update Brmblegotchi copy so onboarding no longer advertises a sidebar pet.
- Create: `src/Brmble.Web/src/components/CompanionOverlay/overlayTypes.ts`
  Responsibility: shared overlay event, speaker, mode, and snapshot types.
- Create: `src/Brmble.Web/src/components/CompanionOverlay/overlayModel.ts`
  Responsibility: pure normalization helpers, bounded queue logic, speaker decay, and visual-state derivation.
- Create: `src/Brmble.Web/src/components/CompanionOverlay/overlayModel.test.ts`
  Responsibility: unit coverage for queue bounds, filtering, fallbacks, speaker decay, and state derivation.
- Create: `src/Brmble.Web/src/hooks/useCompanionOverlayPublisher.ts`
  Responsibility: hold the live overlay snapshot in the main app and publish `overlay.sync` bridge payloads.
- Create: `src/Brmble.Web/src/hooks/useCompanionOverlayPublisher.test.ts`
  Responsibility: verify `overlay.sync` publishing and disabled-state behavior.
- Create: `src/Brmble.Web/src/components/CompanionOverlay/useOverlayBridgeState.ts`
  Responsibility: consume `overlay.sync` in the overlay webview.
- Create: `src/Brmble.Web/src/components/CompanionOverlay/OverlayApp.tsx`
  Responsibility: top-level overlay app that switches between `Minimal` and `Full Companion`.
- Create: `src/Brmble.Web/src/components/CompanionOverlay/CompanionOverlayRoot.tsx`
  Responsibility: mode selection, empty-state guard, common theme wrapper.
- Create: `src/Brmble.Web/src/components/CompanionOverlay/MinimalOverlay.tsx`
  Responsibility: compact speaker-first shell.
- Create: `src/Brmble.Web/src/components/CompanionOverlay/FullCompanionOverlay.tsx`
  Responsibility: companion-led shell with sprite, attached bubble, and nearby speaker stack.
- Create: `src/Brmble.Web/src/components/CompanionOverlay/SpeakerStack.tsx`
  Responsibility: stable 2-3 name speaker list shared by both modes.
- Create: `src/Brmble.Web/src/components/CompanionOverlay/EventFeed.tsx`
  Responsibility: reusable event-line renderer.
- Create: `src/Brmble.Web/src/components/CompanionOverlay/CompanionSprite.tsx`
  Responsibility: map overlay visual states to restrained sprite poses, reusing legacy art as a first-pass migration path.
- Create: `src/Brmble.Web/src/components/CompanionOverlay/CompanionOverlay.css`
  Responsibility: shared overlay layout, positioning, motion, and shell styles.
- Create: `src/Brmble.Web/src/components/CompanionOverlay/InterfaceSettingsTab.test.tsx`
  Responsibility: lock the new overlay settings controls.
- Create: `src/Brmble.Web/src/components/CompanionOverlay/MinimalOverlay.test.tsx`
  Responsibility: speaker rendering and compact event-feed coverage.
- Create: `src/Brmble.Web/src/components/CompanionOverlay/FullCompanionOverlay.test.tsx`
  Responsibility: mode-specific full-shell rendering coverage.
- Create: `src/Brmble.Web/src/components/CompanionOverlay/OverlayApp.test.tsx`
  Responsibility: snapshot consumption, mode switching, and hidden-overlay behavior.
- Create: `src/Brmble.Web/src/overlay-main.tsx`
  Responsibility: separate WebView2 entrypoint for the native overlay window.
- Create: `src/Brmble.Web/overlay.html`
  Responsibility: second HTML entry so Vite emits a dedicated overlay document.

### Native client files

- Modify: `src/Brmble.Client/Program.cs`
  Responsibility: initialize the native overlay host, relay `overlay.sync`, and keep overlay lifetime aligned with the main app.
- Modify: `src/Brmble.Client/Win32Window.cs`
  Responsibility: add helpers for a transparent, topmost, click-through overlay window.
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`
  Responsibility: emit a dedicated moderation event for non-self kicks and bans.
- Create: `src/Brmble.Client/Overlay/CompanionOverlayHost.cs`
  Responsibility: own the overlay HWND, second WebView2 controller, visibility toggling, and forwarded payload delivery.
- Create: `src/Brmble.Client/Overlay/CompanionOverlayRelay.cs`
  Responsibility: cache the latest `overlay.sync` payload and flush it whenever the overlay bridge becomes ready.
- Create: `tests/Brmble.Client.Tests/Services/MumbleAdapterModerationEventTests.cs`
  Responsibility: verify kick/ban moderation payloads for non-self users.
- Create: `tests/Brmble.Client.Tests/Overlay/CompanionOverlayRelayTests.cs`
  Responsibility: verify latest-payload caching and ready-state flushing without touching HWND APIs.

### Legacy files to leave untouched for now

- Leave in place temporarily: `src/Brmble.Web/src/components/Brmblegotchi/Brmblegotchi.tsx`
- Leave in place temporarily: `src/Brmble.Web/src/components/Brmblegotchi/Brmblegotchi.css`
- Leave in place temporarily: existing `brmblegotchi-state` and `brmblegotchi-position` localStorage keys

The first ship should stop mounting the old widget but not delete the files until the overlay is stable.

### Task 1: Expand the persisted overlay settings contract

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/InterfaceSettingsTypes.ts`
- Modify: `src/Brmble.Web/src/components/SettingsModal/InterfaceSettingsTab.tsx`
- Modify: `src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx`
- Modify: `src/Brmble.Web/src/App.tsx`
- Test: `src/Brmble.Web/src/components/CompanionOverlay/InterfaceSettingsTab.test.tsx`

- [ ] **Step 1: Write the failing interface-settings test**

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InterfaceSettingsTab } from '../SettingsModal/InterfaceSettingsTab';
import { DEFAULT_APPEARANCE, DEFAULT_OVERLAY, DEFAULT_BRMBLEGOTCHI } from '../SettingsModal/InterfaceSettingsTypes';

describe('InterfaceSettingsTab overlay controls', () => {
  it('renders overlay mode and event toggles and forwards changes', () => {
    const onOverlayChange = vi.fn();

    render(
      <InterfaceSettingsTab
        appearanceSettings={DEFAULT_APPEARANCE}
        overlaySettings={DEFAULT_OVERLAY}
        brmblegotchiSettings={DEFAULT_BRMBLEGOTCHI}
        onAppearanceChange={vi.fn()}
        onOverlayChange={onOverlayChange}
        onBrmblegotchiChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByLabelText('Enable Companion Overlay'));
    fireEvent.click(screen.getByRole('button', { name: 'Minimal' }));
    fireEvent.click(screen.getByLabelText('Show Direct Messages'));

    expect(onOverlayChange).toHaveBeenCalledWith(expect.objectContaining({
      overlayEnabled: true,
      mode: 'minimal',
      showDirectMessages: false,
    }));
  });
});
```

- [ ] **Step 2: Run the new test to verify it fails**

Run (from `src/Brmble.Web`): `npm run test -- src/components/CompanionOverlay/InterfaceSettingsTab.test.tsx`

Expected: FAIL because `OverlaySettings` only contains `overlayEnabled`, the labels do not exist yet, and the interface tab still shows the placeholder copy.

- [x] **Step 3: Expand the settings contract and wire it into `App.tsx`**

```ts
export type CompanionOverlayMode = 'full' | 'minimal';

export interface OverlaySettings {
  overlayEnabled: boolean;
  mode: CompanionOverlayMode;
  showChannelMessages: boolean;
  showDirectMessages: boolean;
  showJoinLeaveEvents: boolean;
  showModerationEvents: boolean;
  showActiveSpeakers: boolean;
}

export const DEFAULT_OVERLAY: OverlaySettings = {
  overlayEnabled: false,
  mode: 'minimal',
  showChannelMessages: true,
  showDirectMessages: true,
  showJoinLeaveEvents: true,
  showModerationEvents: true,
  showActiveSpeakers: true,
};
```

```tsx
const [overlaySettings, setOverlaySettingsState] = useState<OverlaySettings>(() => {
  try {
    const stored = localStorage.getItem('brmble-settings');
    if (!stored) return DEFAULT_OVERLAY;
    const parsed = JSON.parse(stored);
    return { ...DEFAULT_OVERLAY, ...(parsed.overlay ?? {}) };
  } catch {
    return DEFAULT_OVERLAY;
  }
});

const setOverlaySettings = useCallback((next: OverlaySettings) => {
  setOverlaySettingsState(next);
  try {
    const stored = localStorage.getItem('brmble-settings');
    const parsed = stored ? JSON.parse(stored) : {};
    parsed.overlay = next;
    localStorage.setItem('brmble-settings', JSON.stringify(parsed));
  } catch { /* ignore */ }
}, []);
```

```tsx
<div className="settings-section">
  <h3 className="heading-section settings-section-title">In-Game Overlay</h3>
  <div className="settings-item settings-toggle">
    <label htmlFor="overlay-enabled">Enable Companion Overlay</label>
    <label className="brmble-toggle">
      <input
        id="overlay-enabled"
        type="checkbox"
        checked={overlaySettings.overlayEnabled}
        onChange={() => onOverlayChange({ ...overlaySettings, overlayEnabled: !overlaySettings.overlayEnabled })}
      />
      <span className="brmble-toggle-slider"></span>
    </label>
  </div>
  <div className="settings-item">
    <label>Overlay Mode</label>
    <Select
      value={overlaySettings.mode}
      onChange={(mode) => onOverlayChange({ ...overlaySettings, mode: (mode as 'full' | 'minimal') ?? 'minimal' })}
      options={[
        { value: 'full', label: 'Full Companion' },
        { value: 'minimal', label: 'Minimal' },
      ]}
    />
  </div>
</div>
```

- [x] **Step 4: Run the focused settings test and the existing audio-settings smoke test**

Run (from `src/Brmble.Web`): `npm run test -- src/components/CompanionOverlay/InterfaceSettingsTab.test.tsx src/components/SettingsModal/AudioSettingsTab.test.tsx`

Expected: PASS. The new overlay settings test should pass, and the unrelated audio settings test should stay green to confirm the tab still renders correctly.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/components/SettingsModal/InterfaceSettingsTypes.ts src/Brmble.Web/src/components/SettingsModal/InterfaceSettingsTab.tsx src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx src/Brmble.Web/src/App.tsx src/Brmble.Web/src/components/CompanionOverlay/InterfaceSettingsTab.test.tsx
git commit -m "feat(overlay): add companion overlay settings contract"
```

### Task 2: Build the pure overlay event and speaker model

**Files:**
- Create: `src/Brmble.Web/src/components/CompanionOverlay/overlayTypes.ts`
- Create: `src/Brmble.Web/src/components/CompanionOverlay/overlayModel.ts`
- Test: `src/Brmble.Web/src/components/CompanionOverlay/overlayModel.test.ts`

- [ ] **Step 1: Write failing model tests for queue bounds, fallbacks, and speaker decay**

```ts
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_OVERLAY } from '../SettingsModal/InterfaceSettingsTypes';
import {
  appendOverlayEvent,
  createChannelMessageOverlayEvent,
  createMembershipOverlayEvent,
  createOverlaySnapshot,
  pruneOverlaySnapshot,
  setSpeakerActivity,
} from './overlayModel';

describe('overlayModel', () => {
  it('keeps only the newest 8 events', () => {
    let snapshot = createOverlaySnapshot('7', 'Raid');

    for (let i = 0; i < 10; i += 1) {
      snapshot = appendOverlayEvent(
        snapshot,
        createMembershipOverlayEvent({
          kind: 'user-joined',
          actorName: `User ${i}`,
          currentChannelId: '7',
          eventChannelId: '7',
          timestamp: 1_000 + i,
        }),
        DEFAULT_OVERLAY
      );
    }

    expect(snapshot.recentEvents).toHaveLength(8);
    expect(snapshot.recentEvents[0].line).toBe('User 2 joined the channel');
    expect(snapshot.recentEvents[7].line).toBe('User 9 joined the channel');
  });

  it('uses safe fallback names and speaker decay', () => {
    let snapshot = createOverlaySnapshot('7', 'Raid');
    snapshot = appendOverlayEvent(
      snapshot,
      createChannelMessageOverlayEvent({
        actorName: '',
        text: '',
        channelId: '7',
        currentChannelId: '7',
        timestamp: 2_000,
      }),
      DEFAULT_OVERLAY
    );
    snapshot = setSpeakerActivity(snapshot, { session: 11, name: '', channelId: 7 }, true, 3_000);
    snapshot = setSpeakerActivity(snapshot, { session: 11, name: '', channelId: 7 }, false, 4_000);
    snapshot = pruneOverlaySnapshot(snapshot, 6_600);

    expect(snapshot.recentEvents[0].line).toBe('Unknown user: Message unavailable');
    expect(snapshot.activeSpeakers).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the model test to verify it fails**

Run (from `src/Brmble.Web`): `npm run test -- src/components/CompanionOverlay/overlayModel.test.ts`

Expected: FAIL because the model files do not exist yet.

- [x] **Step 3: Implement the pure snapshot contract and reducer helpers**

```ts
export type OverlayEventKind =
  | 'channel-message'
  | 'direct-message'
  | 'user-joined'
  | 'user-left'
  | 'user-kicked'
  | 'user-banned';

export type OverlayVisualState =
  | 'idle'
  | 'message'
  | 'dm'
  | 'moderation-alert'
  | 'speaking-nearby'
  | 'quiet';

export interface CompanionOverlayEvent {
  id: string;
  kind: OverlayEventKind;
  actorName: string;
  targetName?: string;
  line: string;
  timestamp: number;
  channelId?: string;
}

export interface CompanionSpeakerEntry {
  session: number;
  name: string;
  channelId: number;
  startedAt: number;
  lastSpokeAt: number;
  expiresAt: number;
}

export interface CompanionOverlaySnapshot {
  currentChannelId: string | null;
  currentChannelName: string;
  recentEvents: CompanionOverlayEvent[];
  activeSpeakers: CompanionSpeakerEntry[];
  visualState: OverlayVisualState;
  lastActivityAt: number;
}
```

```ts
const MAX_EVENTS = 8;
const MAX_VISIBLE_SPEAKERS = 3;
const SPEAKER_DECAY_MS = 2_500;
const QUIET_AFTER_MS = 15_000;

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
  const safeName = speaker.name.trim() || 'Unknown user';
  const next = snapshot.activeSpeakers.filter(entry => entry.session !== speaker.session);

  if (speaking) {
    next.push({
      session: speaker.session,
      name: safeName,
      channelId: speaker.channelId,
      startedAt: now,
      lastSpokeAt: now,
      expiresAt: now + SPEAKER_DECAY_MS,
    });
  } else {
    const existing = snapshot.activeSpeakers.find(entry => entry.session === speaker.session);
    if (existing) {
      next.push({ ...existing, name: safeName, lastSpokeAt: now, expiresAt: now + SPEAKER_DECAY_MS });
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
```

- [x] **Step 4: Run the model test**

Run (from `src/Brmble.Web`): `npm run test -- src/components/CompanionOverlay/overlayModel.test.ts`

Expected: PASS. The queue should cap at 8, message text should fall back safely, and silent speakers should disappear after the grace window.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/components/CompanionOverlay/overlayTypes.ts src/Brmble.Web/src/components/CompanionOverlay/overlayModel.ts src/Brmble.Web/src/components/CompanionOverlay/overlayModel.test.ts
git commit -m "feat(overlay): add shared companion overlay model"
```

### Task 3: Tap Matrix room timelines for overlay-worthy channel and DM activity

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useMatrixClient.ts`
- Modify: `src/Brmble.Web/src/hooks/useMatrixClient.test.ts`

- [ ] **Step 1: Write the failing Matrix callback test**

```ts
it('calls onDirectMessage only for incoming DM messages', async () => {
  const onDirectMessage = vi.fn();

  renderHook(() => useMatrixClient(credentials, { onDirectMessage }));

  await act(async () => {
    emitTimelineEvent({
      roomId: '!dm:example.com',
      sender: '@alice:example.com',
      body: 'ping',
    });
  });

  expect(onDirectMessage).toHaveBeenCalledWith(
    '@alice:example.com',
    expect.objectContaining({ sender: 'Alice', content: 'ping' })
  );
});
```

- [ ] **Step 2: Run the Matrix-client test to verify it fails**

Run (from `src/Brmble.Web`): `npm run test -- src/hooks/useMatrixClient.test.ts`

Expected: FAIL because `useMatrixClient` does not accept overlay callback options yet.

- [x] **Step 3: Extend `useMatrixClient` with optional incoming-message taps**

```ts
export interface MatrixClientOptions {
  onChannelMessage?: (channelId: string, message: ChatMessage) => void;
  onDirectMessage?: (matrixUserId: string, message: ChatMessage) => void;
}

export function useMatrixClient(
  credentials: MatrixCredentials | null,
  options: MatrixClientOptions = {},
) {
  const { onChannelMessage, onDirectMessage } = options;
```

```ts
if (channelId) {
  const message = transformEventToChatMessage(event, room, channelId, clientRef.current);
  if (!message) return;

  if (message.senderMatrixUserId !== credentials?.userId) {
    onChannelMessage?.(channelId, message);
  }

  setLastMessages(prev => {
    const existing = prev.get(channelId);
    if (existing && existing.ts >= message.timestamp.getTime()) return prev;
    const next = new Map(prev);
    next.set(channelId, {
      content: message.content,
      ts: message.timestamp.getTime(),
      sender: message.sender,
    });
    return next;
  });
}
```

```ts
const dmMessage = transformEventToChatMessage(event, room, dmUserId, clientRef.current);
if (!dmMessage) return;

if (dmMessage.senderMatrixUserId !== credentials?.userId) {
  onDirectMessage?.(dmUserId, dmMessage);
}
```

- [ ] **Step 4: Re-run the Matrix-client test**

Run (from `src/Brmble.Web`): `npm run test -- src/hooks/useMatrixClient.test.ts`

Expected: PASS. The new callbacks should fire only for incoming messages, not local echoes.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/hooks/useMatrixClient.ts src/Brmble.Web/src/hooks/useMatrixClient.test.ts
git commit -m "feat(overlay): tap matrix timelines for companion overlay"
```

### Task 4: Publish normalized overlay snapshots from the main app

**Files:**
- Create: `src/Brmble.Web/src/hooks/useCompanionOverlayPublisher.ts`
- Test: `src/Brmble.Web/src/hooks/useCompanionOverlayPublisher.test.ts`
- Modify: `src/Brmble.Web/src/App.tsx`

- [ ] **Step 1: Write the failing publisher test**

```ts
import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import bridge from '../bridge';
import { DEFAULT_OVERLAY } from '../components/SettingsModal/InterfaceSettingsTypes';
import { useCompanionOverlayPublisher } from './useCompanionOverlayPublisher';

vi.mock('../bridge', () => ({
  default: { send: vi.fn() },
}));

describe('useCompanionOverlayPublisher', () => {
  it('publishes overlay.sync snapshots for DMs and speakers', () => {
    const { result } = renderHook(() =>
      useCompanionOverlayPublisher({
        settings: { ...DEFAULT_OVERLAY, overlayEnabled: true },
        currentChannelId: '7',
        currentChannelName: 'Raid',
      })
    );

    act(() => {
      result.current.publishDirectMessage({ actorName: 'Qy', text: 'how are you', timestamp: 4_000 });
      result.current.publishSpeakerActivity({ session: 12, name: 'Milo', channelId: 7 }, true, 4_100);
    });

    expect(bridge.send).toHaveBeenLastCalledWith(
      'overlay.sync',
      expect.objectContaining({
        enabled: true,
        snapshot: expect.objectContaining({
          visualState: 'speaking-nearby',
        }),
      })
    );
  });
});
```

- [ ] **Step 2: Run the publisher test to verify it fails**

Run (from `src/Brmble.Web`): `npm run test -- src/hooks/useCompanionOverlayPublisher.test.ts`

Expected: FAIL because the hook does not exist yet.

- [x] **Step 3: Implement the publisher hook and wire it into `App.tsx`**

```ts
export function useCompanionOverlayPublisher(args: {
  settings: OverlaySettings;
  currentChannelId: string | null;
  currentChannelName: string;
}) {
  const { settings, currentChannelId, currentChannelName } = args;
  const [snapshot, setSnapshot] = useState(() => createOverlaySnapshot(currentChannelId, currentChannelName));

  useEffect(() => {
    setSnapshot(prev => ({
      ...prev,
      currentChannelId,
      currentChannelName,
      activeSpeakers: prev.activeSpeakers.filter(entry => String(entry.channelId) === currentChannelId),
    }));
  }, [currentChannelId, currentChannelName]);

  const pushSnapshot = useCallback((next: CompanionOverlaySnapshot) => {
    setSnapshot(next);
    bridge.send('overlay.sync', {
      enabled: settings.overlayEnabled,
      mode: settings.mode,
      settings,
      snapshot: next,
    });
  }, [settings]);

  const publishDirectMessage = useCallback((input: { actorName: string; text: string; timestamp: number }) => {
    const next = appendOverlayEvent(
      snapshotRef.current,
      createDirectMessageOverlayEvent(input),
      settings,
    );
    pushSnapshot(next);
  }, [pushSnapshot, settings]);
```

```tsx
const overlayPublisher = useCompanionOverlayPublisher({
  settings: overlaySettings,
  currentChannelId: currentChannelId ?? null,
  currentChannelName,
});

const matrixClient = useMatrixClient(matrixCredentials, {
  onChannelMessage: (channelId, message) => {
    if (channelId !== currentChannelIdRef.current) return;
    overlayPublisher.publishChannelMessage({
      actorName: message.sender,
      text: message.content,
      channelId,
      timestamp: message.timestamp.getTime(),
    });
  },
  onDirectMessage: (_matrixUserId, message) => {
    overlayPublisher.publishDirectMessage({
      actorName: message.sender,
      text: message.content,
      timestamp: message.timestamp.getTime(),
    });
  },
});
```

```tsx
if (!isPrivateMessage && d.channelIds && d.channelIds.length > 0) {
  const channelId = String(d.channelIds[0]);
  if (channelId === currentChannelIdRef.current) {
    overlayPublisher.publishChannelMessage({
      actorName: senderName,
      text: messageMedia.text,
      channelId,
      timestamp: Date.now(),
    });
  }
}

if (d.certHash) {
  overlayPublisher.publishDirectMessage({
    actorName: senderName,
    text: plainText || d.message,
    timestamp: Date.now(),
  });
}
```

- [ ] **Step 4: Run the publisher test and the existing DM-store regression tests**

Run (from `src/Brmble.Web`): `npm run test -- src/hooks/useCompanionOverlayPublisher.test.ts src/hooks/useDMStore.test.ts`

Expected: PASS. The new publisher test should pass, and the DM store should remain stable.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/hooks/useCompanionOverlayPublisher.ts src/Brmble.Web/src/hooks/useCompanionOverlayPublisher.test.ts src/Brmble.Web/src/App.tsx
git commit -m "feat(overlay): publish live companion overlay snapshots"
```

### Task 5: Emit dedicated moderation events for kicks and bans

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`
- Create: `tests/Brmble.Client.Tests/Services/MumbleAdapterModerationEventTests.cs`
- Modify: `src/Brmble.Web/src/App.tsx`

- [ ] **Step 1: Write the failing client moderation-event test**

```cs
using Brmble.Client.Services.Voice;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using MumbleProto;
using MumbleSharp;

namespace Brmble.Client.Tests.Services;

[TestClass]
public class MumbleAdapterModerationEventTests
{
    [TestMethod]
    public void UserRemove_ForOtherUsersBan_EmitsVoiceUserModerated()
    {
        var bridge = NativeBridgeTestHarness.Create();
        var adapter = MumbleAdapterTestHarness.CreateWithBridge(bridge);
        var connection = new MumbleConnection(new System.Net.IPEndPoint(System.Net.IPAddress.Loopback, 64738), adapter, voiceSupport: false);
        adapter.Initialise(connection);

        adapter.ChannelState(new ChannelState { ChannelId = 1, Name = "General" });
        adapter.UserState(new UserState { Session = 7, Name = "Me", ChannelId = 1 });
        adapter.UserState(new UserState { Session = 8, Name = "Kira", ChannelId = 1 });
        adapter.UserState(new UserState { Session = 9, Name = "Milo", ChannelId = 1 });
        adapter.ServerSync(new ServerSync { Session = 7 });

        adapter.UserRemove(new UserRemove { Session = 9, Actor = 8, Ban = true, Reason = "Spam" });

        var sent = NativeBridgeTestHarness.DrainMessages(bridge).FindAll(m => m.Type == "voice.userModerated");
        Assert.AreEqual(1, sent.Count);
        StringAssert.Contains(sent[0].DataJson, "\"reason\":\"banned\"");
        StringAssert.Contains(sent[0].DataJson, "\"targetName\":\"Milo\"");
        StringAssert.Contains(sent[0].DataJson, "\"actorName\":\"Kira\"");
    }
}
```

- [ ] **Step 2: Run the client test to verify it fails**

Run (from repo root): `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj`

Expected: FAIL because `voice.userModerated` is not emitted yet.

- [x] **Step 3: Emit `voice.userModerated` for non-self removals and listen for it in `App.tsx`**

```cs
else if (userName != null)
{
    var actorName = "the server";
    if (userRemove.ShouldSerializeActor() && UserDictionary.TryGetValue(userRemove.Actor, out var actor))
    {
        actorName = actor.Name ?? "Unknown";
    }

    _bridge?.Send("voice.userModerated", new
    {
        session = userRemove.Session,
        targetName = userName,
        actorName,
        reason = userRemove.Ban == true ? "banned" : "kicked",
        channelId,
        message = userRemove.Reason
    });

    SendSystemMessage($"{userName} disconnected from the server", "userLeft");
}
```

```tsx
const onVoiceUserModerated = ((data: unknown) => {
  const d = data as {
    targetName?: string;
    actorName?: string;
    reason?: 'kicked' | 'banned';
    channelId?: number;
    message?: string;
  } | undefined;

  if (!d?.reason) return;

  overlayPublisher.publishModerationEvent({
    kind: d.reason === 'banned' ? 'user-banned' : 'user-kicked',
    actorName: d.actorName ?? 'Unknown user',
    targetName: d.targetName ?? 'Unknown user',
    eventChannelId: d.channelId != null ? String(d.channelId) : undefined,
    currentChannelId: currentChannelIdRef.current ?? undefined,
    timestamp: Date.now(),
  });
});
```

- [ ] **Step 4: Re-run the client test suite**

Run (from repo root): `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj`

Expected: PASS. The new moderation test should pass, and the existing removal tests should remain green.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs tests/Brmble.Client.Tests/Services/MumbleAdapterModerationEventTests.cs src/Brmble.Web/src/App.tsx
git commit -m "feat(overlay): surface kick and ban moderation events"
```

### Task 6: Add the native overlay host and latest-snapshot relay

**Files:**
- Create: `src/Brmble.Client/Overlay/CompanionOverlayRelay.cs`
- Create: `src/Brmble.Client/Overlay/CompanionOverlayHost.cs`
- Modify: `src/Brmble.Client/Program.cs`
- Modify: `src/Brmble.Client/Win32Window.cs`
- Create: `tests/Brmble.Client.Tests/Overlay/CompanionOverlayRelayTests.cs`

- [ ] **Step 1: Write the failing relay test**

```cs
using Brmble.Client.Overlay;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Overlay;

[TestClass]
public class CompanionOverlayRelayTests
{
    [TestMethod]
    public void UpdateSync_WhenSinkAttaches_FlushesLatestPayloadOnly()
    {
        var sink = new RecordingOverlaySink();
        var relay = new CompanionOverlayRelay();

        relay.UpdateSync("{\"enabled\":true,\"snapshot\":{\"visualState\":\"message\"}}");
        relay.UpdateSync("{\"enabled\":true,\"snapshot\":{\"visualState\":\"dm\"}}");
        relay.Attach(sink);

        Assert.AreEqual(1, sink.Payloads.Count);
        StringAssert.Contains(sink.Payloads[0], "\"visualState\":\"dm\"");
    }
}
```

- [ ] **Step 2: Run the client tests to verify the relay test fails**

Run (from repo root): `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj`

Expected: FAIL because the relay and host files do not exist yet.

- [x] **Step 3: Implement the relay, transparent overlay HWND, and `overlay.sync` bridge handler**

```cs
public interface IOverlaySink
{
    void PushPayload(string payloadJson);
    void SetVisible(bool visible);
}

public sealed class CompanionOverlayRelay
{
    private string? _latestPayloadJson;
    private IOverlaySink? _sink;

    public void Attach(IOverlaySink sink)
    {
        _sink = sink;
        if (_latestPayloadJson is not null)
        {
            _sink.PushPayload(_latestPayloadJson);
        }
    }

    public void UpdateSync(string payloadJson)
    {
        _latestPayloadJson = payloadJson;
        _sink?.PushPayload(payloadJson);
        _sink?.SetVisible(!payloadJson.Contains("\"enabled\":false", StringComparison.Ordinal));
    }
}
```

```cs
_overlayRelay = new CompanionOverlayRelay();
_overlayHost = await CompanionOverlayHost.CreateAsync(useDevServer, _overlayRelay);

_bridge!.RegisterHandler("overlay.sync", data =>
{
    _overlayRelay.UpdateSync(data.GetRawText());
    return Task.CompletedTask;
});
```

```cs
public static IntPtr CreateOverlay(string className, string title, Win32Window.WndProc wndProc)
{
    return CreateWindowEx(
        WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_LAYERED | WS_EX_TRANSPARENT,
        className,
        title,
        WS_POPUP,
        0,
        0,
        1920,
        1080,
        IntPtr.Zero,
        IntPtr.Zero,
        IntPtr.Zero,
        IntPtr.Zero);
}
```

- [ ] **Step 4: Re-run the client test suite**

Run (from repo root): `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj`

Expected: PASS. The relay test should pass, and the rest of the client suite should remain green.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Client/Overlay/CompanionOverlayRelay.cs src/Brmble.Client/Overlay/CompanionOverlayHost.cs src/Brmble.Client/Program.cs src/Brmble.Client/Win32Window.cs tests/Brmble.Client.Tests/Overlay/CompanionOverlayRelayTests.cs
git commit -m "feat(overlay): add native companion overlay host"
```

### Task 7: Create the overlay web entrypoint and bridge-state consumer

**Files:**
- Create: `src/Brmble.Web/overlay.html`
- Create: `src/Brmble.Web/src/overlay-main.tsx`
- Create: `src/Brmble.Web/src/components/CompanionOverlay/useOverlayBridgeState.ts`
- Create: `src/Brmble.Web/src/components/CompanionOverlay/OverlayApp.tsx`
- Create: `src/Brmble.Web/src/components/CompanionOverlay/OverlayApp.test.tsx`

- [ ] **Step 1: Write the failing overlay-app test**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OverlayApp } from './OverlayApp';

describe('OverlayApp', () => {
  it('renders nothing when the overlay is disabled', () => {
    render(<OverlayApp initialState={{ enabled: false, mode: 'minimal', snapshot: null }} />);
    expect(screen.queryByTestId('companion-overlay-root')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the overlay-app test to verify it fails**

Run (from `src/Brmble.Web`): `npm run test -- src/components/CompanionOverlay/OverlayApp.test.tsx`

Expected: FAIL because the overlay entrypoint files do not exist yet.

- [x] **Step 3: Add the dedicated overlay HTML/TSX entry and a bridge-state hook**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Brmble Companion Overlay</title>
    <script type="module" src="/src/overlay-main.tsx"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
```

```tsx
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary label="OverlayApp">
      <OverlayApp />
    </ErrorBoundary>
  </StrictMode>,
);
```

```ts
export function useOverlayBridgeState() {
  const [state, setState] = useState<{
    enabled: boolean;
    mode: 'full' | 'minimal';
    settings: OverlaySettings | null;
    snapshot: CompanionOverlaySnapshot | null;
  }>({
    enabled: false,
    mode: 'minimal',
    settings: null,
    snapshot: null,
  });

  useEffect(() => {
    const handleSync = (data: unknown) => {
      const next = data as typeof state;
      setState(next);
    };

    bridge.on('overlay.sync', handleSync);
    return () => bridge.off('overlay.sync', handleSync);
  }, []);

  return state;
}
```

- [x] **Step 4: Re-run the overlay-app test**

Run (from `src/Brmble.Web`): `npm run test -- src/components/CompanionOverlay/OverlayApp.test.tsx`

Expected: PASS. Disabled overlay state should produce no rendered shell.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/overlay.html src/Brmble.Web/src/overlay-main.tsx src/Brmble.Web/src/components/CompanionOverlay/useOverlayBridgeState.ts src/Brmble.Web/src/components/CompanionOverlay/OverlayApp.tsx src/Brmble.Web/src/components/CompanionOverlay/OverlayApp.test.tsx
git commit -m "feat(overlay): add overlay web entrypoint"
```

### Task 8: Build the `Minimal` presentation shell

**Files:**
- Create: `src/Brmble.Web/src/components/CompanionOverlay/CompanionOverlayRoot.tsx`
- Create: `src/Brmble.Web/src/components/CompanionOverlay/MinimalOverlay.tsx`
- Create: `src/Brmble.Web/src/components/CompanionOverlay/SpeakerStack.tsx`
- Create: `src/Brmble.Web/src/components/CompanionOverlay/EventFeed.tsx`
- Create: `src/Brmble.Web/src/components/CompanionOverlay/CompanionOverlay.css`
- Create: `src/Brmble.Web/src/components/CompanionOverlay/MinimalOverlay.test.tsx`

- [ ] **Step 1: Write the failing minimal-shell test**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MinimalOverlay } from './MinimalOverlay';

describe('MinimalOverlay', () => {
  it('shows the top three speakers and recent event lines', () => {
    render(
      <MinimalOverlay
        snapshot={{
          currentChannelId: '7',
          currentChannelName: 'Raid',
          visualState: 'speaking-nearby',
          lastActivityAt: 100,
          activeSpeakers: [
            { session: 1, name: 'Milo', channelId: 7, startedAt: 1, lastSpokeAt: 5, expiresAt: 10 },
            { session: 2, name: 'Qy', channelId: 7, startedAt: 1, lastSpokeAt: 4, expiresAt: 10 },
            { session: 3, name: 'Kira', channelId: 7, startedAt: 1, lastSpokeAt: 3, expiresAt: 10 },
          ],
          recentEvents: [
            { id: 'e1', kind: 'direct-message', actorName: 'Qy', line: 'DM from Qy: how are you', timestamp: 99 },
          ],
        }}
      />
    );

    expect(screen.getByText('Milo')).toBeInTheDocument();
    expect(screen.getByText('Qy')).toBeInTheDocument();
    expect(screen.getByText('Kira')).toBeInTheDocument();
    expect(screen.getByText('DM from Qy: how are you')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the minimal-shell test to verify it fails**

Run (from `src/Brmble.Web`): `npm run test -- src/components/CompanionOverlay/MinimalOverlay.test.tsx`

Expected: FAIL because the shell components do not exist yet.

- [x] **Step 3: Implement the speaker-first minimal shell**

```tsx
export function SpeakerStack({ speakers }: { speakers: CompanionSpeakerEntry[] }) {
  return (
    <ol className="overlay-speaker-stack" aria-label="Active speakers">
      {speakers.slice(0, 3).map((speaker) => (
        <li key={speaker.session} className="overlay-speaker-pill">
          <span className="overlay-speaker-dot" />
          <span>{speaker.name}</span>
        </li>
      ))}
    </ol>
  );
}
```

```tsx
export function MinimalOverlay({ snapshot }: { snapshot: CompanionOverlaySnapshot }) {
  return (
    <section className="companion-overlay companion-overlay--minimal" data-testid="companion-overlay-root">
      <header className="overlay-panel-header">
        <span className="overlay-panel-label">Brmblegotchi</span>
        <span className="overlay-panel-channel">{snapshot.currentChannelName || 'Current channel'}</span>
      </header>
      <SpeakerStack speakers={snapshot.activeSpeakers} />
      <EventFeed events={snapshot.recentEvents.slice(-3)} />
    </section>
  );
}
```

```css
.companion-overlay--minimal {
  position: fixed;
  right: 24px;
  bottom: 24px;
  width: min(360px, calc(100vw - 48px));
  padding: 14px;
  border: 1px solid color-mix(in srgb, var(--border-primary) 82%, white 18%);
  border-radius: 18px;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--bg-elevated) 86%, white 14%), color-mix(in srgb, var(--bg-deep) 92%, black 8%)),
    radial-gradient(circle at top right, color-mix(in srgb, var(--accent-primary) 22%, transparent), transparent 55%);
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.32);
}
```

- [x] **Step 4: Run the minimal-shell test**

Run (from `src/Brmble.Web`): `npm run test -- src/components/CompanionOverlay/MinimalOverlay.test.tsx`

Expected: PASS. The speaker stack should render the visible names, and the event line should be readable.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/components/CompanionOverlay/CompanionOverlayRoot.tsx src/Brmble.Web/src/components/CompanionOverlay/MinimalOverlay.tsx src/Brmble.Web/src/components/CompanionOverlay/SpeakerStack.tsx src/Brmble.Web/src/components/CompanionOverlay/EventFeed.tsx src/Brmble.Web/src/components/CompanionOverlay/CompanionOverlay.css src/Brmble.Web/src/components/CompanionOverlay/MinimalOverlay.test.tsx
git commit -m "feat(overlay): add minimal companion overlay shell"
```

### Task 9: Build the `Full Companion` presentation shell

**Files:**
- Create: `src/Brmble.Web/src/components/CompanionOverlay/CompanionSprite.tsx`
- Create: `src/Brmble.Web/src/components/CompanionOverlay/FullCompanionOverlay.tsx`
- Create: `src/Brmble.Web/src/components/CompanionOverlay/FullCompanionOverlay.test.tsx`
- Modify: `src/Brmble.Web/src/components/CompanionOverlay/OverlayApp.tsx`

- [ ] **Step 1: Write the failing full-shell test**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FullCompanionOverlay } from './FullCompanionOverlay';

describe('FullCompanionOverlay', () => {
  it('renders the companion bubble and nearby speakers', () => {
    render(
      <FullCompanionOverlay
        snapshot={{
          currentChannelId: '7',
          currentChannelName: 'Raid',
          visualState: 'dm',
          lastActivityAt: 100,
          activeSpeakers: [
            { session: 1, name: 'Milo', channelId: 7, startedAt: 1, lastSpokeAt: 5, expiresAt: 10 },
          ],
          recentEvents: [
            { id: 'e1', kind: 'direct-message', actorName: 'Qy', line: 'DM from Qy: how are you', timestamp: 99 },
          ],
        }}
      />
    );

    expect(screen.getByText('DM from Qy: how are you')).toBeInTheDocument();
    expect(screen.getByText('Milo')).toBeInTheDocument();
    expect(screen.getByAltText('Brmblegotchi companion')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the full-shell test to verify it fails**

Run (from `src/Brmble.Web`): `npm run test -- src/components/CompanionOverlay/FullCompanionOverlay.test.tsx`

Expected: FAIL because the full-shell components do not exist yet.

- [x] **Step 3: Implement the full shell and map overlay states to restrained sprite poses**

```tsx
export function CompanionSprite({ visualState }: { visualState: OverlayVisualState }) {
  const spriteByState: Record<OverlayVisualState, string> = {
    idle: catIdleSprite,
    message: catSmileSprite,
    dm: catHappySprite,
    'moderation-alert': catPlaySprite,
    'speaking-nearby': catIdleSprite,
    quiet: catSleepSprite,
  };

  return (
    <img
      className={`companion-sprite companion-sprite--${visualState}`}
      src={spriteByState[visualState]}
      alt="Brmblegotchi companion"
    />
  );
}
```

```tsx
export function FullCompanionOverlay({ snapshot }: { snapshot: CompanionOverlaySnapshot }) {
  const latestEvent = snapshot.recentEvents[snapshot.recentEvents.length - 1] ?? null;

  return (
    <section className="companion-overlay companion-overlay--full" data-testid="companion-overlay-root">
      <div className="companion-anchor">
        <CompanionSprite visualState={snapshot.visualState} />
        {latestEvent && (
          <aside className="companion-bubble" aria-live="polite">
            <p>{latestEvent.line}</p>
          </aside>
        )}
      </div>
      <SpeakerStack speakers={snapshot.activeSpeakers} />
    </section>
  );
}
```

```css
.companion-overlay--full {
  position: fixed;
  right: 28px;
  bottom: 22px;
  display: grid;
  gap: 12px;
  justify-items: end;
}

.companion-bubble {
  max-width: min(320px, calc(100vw - 96px));
  padding: 12px 14px;
  border-radius: 18px 18px 6px 18px;
  background: color-mix(in srgb, var(--bg-elevated) 90%, white 10%);
  border: 1px solid color-mix(in srgb, var(--accent-primary) 35%, var(--border-primary) 65%);
}
```

- [x] **Step 4: Run the full-shell test**

Run (from `src/Brmble.Web`): `npm run test -- src/components/CompanionOverlay/FullCompanionOverlay.test.tsx`

Expected: PASS. The shell should show the companion sprite, the latest event bubble, and the nearby speaker stack.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/components/CompanionOverlay/CompanionSprite.tsx src/Brmble.Web/src/components/CompanionOverlay/FullCompanionOverlay.tsx src/Brmble.Web/src/components/CompanionOverlay/FullCompanionOverlay.test.tsx src/Brmble.Web/src/components/CompanionOverlay/OverlayApp.tsx
git commit -m "feat(overlay): add full companion presentation shell"
```

### Task 10: Remove the legacy sidebar pet from the shipped experience and update copy

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`
- Modify: `src/Brmble.Web/src/components/SettingsModal/InterfaceSettingsTab.tsx`
- Modify: `src/Brmble.Web/src/components/OnboardingWizard/OnboardingWizard.tsx`
- Test: `src/Brmble.Web/src/components/CompanionOverlay/OverlayApp.test.tsx`

- [ ] **Step 1: Write the failing copy-and-mount test**

```tsx
it('does not mount the legacy sidebar pet and uses companion overlay copy', () => {
  render(<App />);

  expect(screen.queryByText('Show the Brmblegotchi virtual pet companion.')).toBeNull();
  expect(screen.queryByLabelText('Enable Pet')).toBeNull();
});
```

- [ ] **Step 2: Run the targeted overlay and app tests to verify they fail**

Run (from `src/Brmble.Web`): `npm run test -- src/components/CompanionOverlay/OverlayApp.test.tsx src/App.screenShareStart.test.ts`

Expected: FAIL because the old Brmblegotchi section and mount still exist.

- [x] **Step 3: Stop mounting `Brmblegotchi.tsx` and update all user-facing copy**

```tsx
// Remove this line from App.tsx:
// <Brmblegotchi enabled={brmblegotchiEnabled} onOpenSettings={() => { setSettingsTab('appearance'); setShowSettings(true); }} />
```

```tsx
<p className="settings-hint">
  Keep a small Brmblegotchi companion overlay on top of games and desktop apps for current-channel activity, DMs, moderation, and speakers.
</p>
```

```tsx
<p className="wizard-setting-description">
  Show Brmblegotchi as a companion overlay for speakers, DMs, and channel activity.
</p>
```

- [x] **Step 4: Re-run the targeted tests**

Run (from `src/Brmble.Web`): `npm run test -- src/components/CompanionOverlay/OverlayApp.test.tsx src/App.screenShareStart.test.ts`

Expected: PASS. The overlay shell tests should remain green, and removing the sidebar pet should not break unrelated App flows.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/App.tsx src/Brmble.Web/src/components/SettingsModal/InterfaceSettingsTab.tsx src/Brmble.Web/src/components/OnboardingWizard/OnboardingWizard.tsx
git commit -m "feat(overlay): retire legacy sidebar brmblegotchi mount"
```

### Task 11: Verify the complete overlay flow end to end

**Files:**
- Test: `src/Brmble.Web/src/components/CompanionOverlay/overlayModel.test.ts`
- Test: `src/Brmble.Web/src/hooks/useMatrixClient.test.ts`
- Test: `src/Brmble.Web/src/hooks/useCompanionOverlayPublisher.test.ts`
- Test: `src/Brmble.Web/src/components/CompanionOverlay/MinimalOverlay.test.tsx`
- Test: `src/Brmble.Web/src/components/CompanionOverlay/FullCompanionOverlay.test.tsx`
- Test: `src/Brmble.Web/src/components/CompanionOverlay/OverlayApp.test.tsx`
- Test: `tests/Brmble.Client.Tests/Services/MumbleAdapterModerationEventTests.cs`
- Test: `tests/Brmble.Client.Tests/Overlay/CompanionOverlayRelayTests.cs`

- [ ] **Step 1: Run the focused web overlay suite**

Run (from `src/Brmble.Web`): `npm run test -- src/components/CompanionOverlay/overlayModel.test.ts src/hooks/useMatrixClient.test.ts src/hooks/useCompanionOverlayPublisher.test.ts src/components/CompanionOverlay/MinimalOverlay.test.tsx src/components/CompanionOverlay/FullCompanionOverlay.test.tsx src/components/CompanionOverlay/OverlayApp.test.tsx`

Expected: PASS. This confirms the shared model, Matrix taps, bridge publishing, and both presentation shells.

- [ ] **Step 2: Run the client test suite**

Run (from repo root): `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj`

Expected: PASS. The moderation event and relay tests should pass alongside the existing client tests.

- [x] **Step 3: Run the web production build**

Run (from `src/Brmble.Web`): `npm run build`

Expected: PASS with emitted `index.html` and `overlay.html`. This confirms the second HTML entry is included in the packaged web output.

- [ ] **Step 4: Manual verification in the desktop app**

```text
1. Launch Brmble and connect to a server with at least two users in a voice channel.
2. Open Settings -> Interface -> In-Game Overlay.
3. Enable Companion Overlay and confirm the native overlay window appears immediately.
4. Switch between Minimal and Full Companion and confirm presentation changes without losing queued events or current speakers.
5. Send a message in the current voice channel and confirm the overlay shows "Name: message".
6. Receive a DM and confirm the overlay shows "DM from Name: message" even if the DM panel is closed.
7. Have a user join and leave the current channel; confirm both lines render once.
8. Kick or ban a non-self user and confirm the moderation line renders with plain factual wording.
9. Have 4+ users speak in rapid succession and confirm only the 2-3 most recent names remain visible without flicker.
10. Disable the overlay and confirm the native window hides immediately and does not flash stale events when re-enabled.
```

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/overlay.html src/Brmble.Web/src/overlay-main.tsx src/Brmble.Web/src/App.tsx src/Brmble.Web/src/hooks/useMatrixClient.ts src/Brmble.Web/src/hooks/useCompanionOverlayPublisher.ts src/Brmble.Web/src/components/SettingsModal/InterfaceSettingsTypes.ts src/Brmble.Web/src/components/SettingsModal/InterfaceSettingsTab.tsx src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx src/Brmble.Web/src/components/OnboardingWizard/OnboardingWizard.tsx src/Brmble.Web/src/components/CompanionOverlay src/Brmble.Client/Program.cs src/Brmble.Client/Win32Window.cs src/Brmble.Client/Services/Voice/MumbleAdapter.cs src/Brmble.Client/Overlay tests/Brmble.Client.Tests/Services/MumbleAdapterModerationEventTests.cs tests/Brmble.Client.Tests/Overlay/CompanionOverlayRelayTests.cs
git commit -m "test(overlay): verify companion overlay end to end"
```

## Notes for the implementer

- Do not extend `src/Brmble.Web/src/components/Brmblegotchi/Brmblegotchi.tsx` with overlay logic. Reuse its sprite assets only through `CompanionSprite.tsx` when the new full-shell art is not ready yet.
- Keep overlay event text plain and factual. Expressiveness belongs in pose, motion, and framing, not in rewritten message content.
- Prefer one serialized `overlay.sync` payload over a family of tiny bridge events. The relay and the overlay webview stay much simpler that way.
- Keep the queue bounded and the speaker list decayed. The feature succeeds or fails on low-noise behavior.
- Treat missing data defensively:
  `Unknown user`
  `Message unavailable`
  no invented moderation targets
- Keep `settings.brmblegotchi.theme` readable during the migration so the full shell can reuse existing sprite families while the old pet UI is retired.

