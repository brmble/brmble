# Main Panel Regions And Conversation Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Brmble main panel a single owner: participating in a game fills the whole panel, and otherwise the panel splits into a channel activity region on top and a tabbed conversation region below.

**Architecture:** Replace the single overloaded `currentChannelId` with two named concepts — presence (`joinedChannelId`) and conversation (an explicit tab list in the workspace reducer). Every presence-bound feature rebinds to `joinedChannelId`, which fixes four live defects. The two nested splitters collapse into one `VerticalSplitPane`, the two-slide `.content-slider` collapses into one `ChatPanel` driven by the active tab, and `DMContactList` becomes a permanently visible directory.

**Tech Stack:** React 19, TypeScript 5.9, Vitest + Testing Library, CSS custom-property design tokens, Vite.

**Spec:** `docs/superpowers/specs/2026-08-19-main-panel-regions-and-conversation-tabs-design.md`

## Global Constraints

- Working directory for all frontend commands is `src/Brmble.Web`. Run tests with `npm test -- --run <path>`.
- Read `docs/UI_GUIDE.md` before touching any UI. Never hardcode colours, font sizes, font families, spacing, border radius, shadows, or transition values — use existing CSS custom-property tokens. Add new tokens rather than literals.
- Never commit directly to `main`. All work lands on branch `feature/main-panel-regions`.
- TDD throughout: write the failing test, watch it fail, write the minimal implementation, watch it pass, commit.
- Strict ordering constraint from the spec: Tasks 1–7 (state model and rebinds) must be complete and green before any layout task (8 onward) begins.
- Split bounds are 20–80% with a 50% default and a 5% keyboard step — these already exist in `VerticalSplitPane` and must not be redefined.
- Backgrounded screen-share grace period is exactly 10 seconds, expressed as one named constant.
- Existing icon names are available from `components/Icon/Icon.tsx`; `x` already exists. Do not add duplicate icon definitions.
- Do not create a toast system. Notifications use the existing top-right `<Notification>` with `useNotificationQueue`.

---

## File Structure

### New modules

- `src/Brmble.Web/src/workspace/conversation.ts` — the `Conversation` type plus key and equality helpers. No React, no storage.
- `src/Brmble.Web/src/workspace/presence.ts` — `selectJoinedChannelId`, the single derivation of the joined voice channel.
- `src/Brmble.Web/src/workspace/conversationStorage.ts` — per-server persistence and validated restore of open tabs.
- `src/Brmble.Web/src/workspace/mainPanelMode.ts` — `'game' | 'split'` selection.
- `src/Brmble.Web/src/workspace/channelActivity.ts` — activity list and stage selection rules.
- `src/Brmble.Web/src/components/ChannelActivityRegion/ChannelActivityRegion.tsx` + `.module.css` — chip header and single stage.
- `src/Brmble.Web/src/components/ConversationTabStrip/ConversationTabStrip.tsx` + `.module.css` — the tab strip.

### Rewritten

- `src/Brmble.Web/src/workspace/workspaceState.ts` — conversation tab model replaces `foreground` / `messagesPanelExpanded` / `remoteWatchCount`.

### Modified

- `src/Brmble.Web/src/App.tsx` — the bulk of the wiring.
- `src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx` + `ChatPanel.css` — bespoke splitter and screen-share slot removed.
- `src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx` — presence marker, challenge gate, badge ownership.
- `src/Brmble.Web/src/components/DMContactList/DMContactList.tsx` + `.css` — always visible, narrow rail, badge ownership.
- `src/Brmble.Web/src/hooks/useScreenShare.ts` — grace-period hide/restore.
- `src/Brmble.Web/src/index.css` — new layout tokens.
- `docs/UI_GUIDE.md` — three new patterns, two rewritten.

### Deleted

- `.chat-split-video`, `.chat-split-divider` and their handlers in `ChatPanel.tsx`; the `.chat-split-*` CSS block.
- `.content-slider` / `.content-slide` markup in `App.tsx` and their CSS in `App.css`.
- `DMContactList`'s `visible` prop and expand/collapse control.

---

## Task 1: Conversation Identity

**Files:**
- Create: `src/Brmble.Web/src/workspace/conversation.ts`
- Test: `src/Brmble.Web/src/workspace/conversation.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Conversation`, `conversationKey(c: Conversation): string`, `sameConversation(a: Conversation, b: Conversation): boolean`, `isChannelConversation(c: Conversation): c is { kind: 'channel'; channelId: string }`. Every later task uses these; tabs are identified by key strings, never by object reference.

- [ ] **Step 1: Write the failing test**

```ts
// src/Brmble.Web/src/workspace/conversation.test.ts
import { describe, expect, it } from 'vitest';
import { conversationKey, isChannelConversation, sameConversation, type Conversation } from './conversation';

describe('conversation identity', () => {
  it('keys channels and dms into disjoint namespaces', () => {
    expect(conversationKey({ kind: 'channel', channelId: '7' })).toBe('channel:7');
    expect(conversationKey({ kind: 'dm', contactId: '@val:example.com' })).toBe('dm:@val:example.com');
    expect(conversationKey({ kind: 'channel', channelId: 'server-root' })).toBe('channel:server-root');
  });

  it('never collides a channel id with a contact id', () => {
    const channel: Conversation = { kind: 'channel', channelId: '7' };
    const dm: Conversation = { kind: 'dm', contactId: '7' };
    expect(conversationKey(channel)).not.toBe(conversationKey(dm));
    expect(sameConversation(channel, dm)).toBe(false);
  });

  it('compares by value, not reference', () => {
    expect(sameConversation({ kind: 'channel', channelId: '7' }, { kind: 'channel', channelId: '7' })).toBe(true);
    expect(sameConversation({ kind: 'channel', channelId: '7' }, { kind: 'channel', channelId: '8' })).toBe(false);
  });

  it('narrows channel conversations', () => {
    const c: Conversation = { kind: 'channel', channelId: '7' };
    expect(isChannelConversation(c)).toBe(true);
    expect(isChannelConversation({ kind: 'dm', contactId: 'a' })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run src/workspace/conversation.test.ts`
Working directory: `src/Brmble.Web`
Expected: FAIL — cannot resolve `./conversation`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/Brmble.Web/src/workspace/conversation.ts
export type Conversation =
  | { kind: 'channel'; channelId: string }
  | { kind: 'dm'; contactId: string };

export function conversationKey(conversation: Conversation): string {
  return conversation.kind === 'channel'
    ? `channel:${conversation.channelId}`
    : `dm:${conversation.contactId}`;
}

export function sameConversation(a: Conversation, b: Conversation): boolean {
  return conversationKey(a) === conversationKey(b);
}

export function isChannelConversation(
  conversation: Conversation,
): conversation is { kind: 'channel'; channelId: string } {
  return conversation.kind === 'channel';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run src/workspace/conversation.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/workspace/conversation.ts src/Brmble.Web/src/workspace/conversation.test.ts
git commit -m "feat: add conversation identity helpers"
```

---

## Task 2: Presence Selector

The joined voice channel is currently re-derived ad hoc in at least three places (`App.tsx:4340`, `App.tsx:3370`, `App.tsx:4468-4470`). This task gives it one name.

**Files:**
- Create: `src/Brmble.Web/src/workspace/presence.ts`
- Test: `src/Brmble.Web/src/workspace/presence.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `selectJoinedChannelId(users: PresenceUser[]): string | null` where `PresenceUser = { self?: boolean; channelId?: number }`. Returns `'server-root'` for channel `0`, the stringified id otherwise, and `null` when no self user exists. This string is directly comparable with the existing `currentChannelId` string values.

- [ ] **Step 1: Write the failing test**

```ts
// src/Brmble.Web/src/workspace/presence.test.ts
import { describe, expect, it } from 'vitest';
import { selectJoinedChannelId } from './presence';

describe('selectJoinedChannelId', () => {
  it('returns the stringified channel of the self user', () => {
    expect(selectJoinedChannelId([
      { channelId: 3 },
      { self: true, channelId: 7 },
    ])).toBe('7');
  });

  it('maps the root channel to server-root', () => {
    expect(selectJoinedChannelId([{ self: true, channelId: 0 }])).toBe('server-root');
  });

  it('returns null when there is no self user', () => {
    expect(selectJoinedChannelId([{ channelId: 7 }])).toBeNull();
    expect(selectJoinedChannelId([])).toBeNull();
  });

  it('returns null when the self user has no channel', () => {
    expect(selectJoinedChannelId([{ self: true }])).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run src/workspace/presence.test.ts`
Expected: FAIL — cannot resolve `./presence`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/Brmble.Web/src/workspace/presence.ts
export interface PresenceUser {
  self?: boolean;
  channelId?: number;
}

export const SERVER_ROOT_CHANNEL_ID = 'server-root';

export function selectJoinedChannelId(users: PresenceUser[]): string | null {
  const self = users.find(user => user.self);
  if (!self || self.channelId == null) return null;
  return self.channelId === 0 ? SERVER_ROOT_CHANNEL_ID : String(self.channelId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run src/workspace/presence.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/workspace/presence.ts src/Brmble.Web/src/workspace/presence.test.ts
git commit -m "feat: add joined channel presence selector"
```

---

## Task 3: Conversation Tab Reducer

This replaces `workspaceState.ts` wholesale. The old file's `foreground`, `messagesPanelExpanded`, `previousContent` and `remoteWatchCount` all disappear, along with the events `REMOTE_WATCH_COUNT_CHANGED`, `TOGGLE_MESSAGES_PANEL`, `OPEN_MESSAGES_PANEL`, `SELECT_CHANNEL`, `SELECT_DM` and `SELECTED_DM_INVALIDATED`. The existing `workspaceState.test.ts` is replaced entirely — do not try to preserve its cases, they test behaviour that is being deleted on purpose.

**Files:**
- Modify: `src/Brmble.Web/src/workspace/workspaceState.ts` (full rewrite, currently 114 lines)
- Test: `src/Brmble.Web/src/workspace/workspaceState.test.ts` (full rewrite)

**Interfaces:**
- Consumes: `Conversation`, `conversationKey` from Task 1.
- Produces:
  - `WorkspaceState { joinedChannelId: string | null; tabs: Conversation[]; activeKey: string | null }`
  - `createWorkspaceState(): WorkspaceState`
  - `workspaceReducer(state, event): WorkspaceState`
  - Events: `{ type: 'JOINED_CHANNEL_CHANGED'; channelId: string | null }`, `{ type: 'OPEN_CONVERSATION'; conversation: Conversation }`, `{ type: 'CLOSE_CONVERSATION'; key: string }`, `{ type: 'ACTIVATE_CONVERSATION'; key: string }`, `{ type: 'CONVERSATION_INVALIDATED'; key: string }`, `{ type: 'RESTORE_CONVERSATIONS'; conversations: Conversation[] }`, `{ type: 'WORKSPACE_RESET' }`
  - Selectors: `selectHomeKey(state): string | null`, `selectActiveConversation(state): Conversation | null`, `isHomeKey(state, key): boolean`

Behaviour contract, in prose so the implementer does not have to infer it from tests:

- `tabs[0]` is the home tab whenever `joinedChannelId` is non-null. Home is never closable.
- `JOINED_CHANNEL_CHANGED` drops the previous home, absorbs any existing tab matching the new home so it cannot appear twice, and prepends the new home. Non-home tabs keep their relative order. If the active tab was the old home, or was the tab that got absorbed, active becomes the new home.
- `OPEN_CONVERSATION` activates an existing tab rather than duplicating it; otherwise appends and activates.
- `CLOSE_CONVERSATION` and `CONVERSATION_INVALIDATED` are the same operation. Both are ignored for the home key. If the closed tab was active, activation moves to the right neighbour, else the left, else home.
- `RESTORE_CONVERSATIONS` replaces the non-home tabs and activates home.
- `WORKSPACE_RESET` reduces to home only, or to an empty strip when disconnected.

- [ ] **Step 1: Write the failing test**

```ts
// src/Brmble.Web/src/workspace/workspaceState.test.ts
import { describe, expect, it } from 'vitest';
import { conversationKey, type Conversation } from './conversation';
import {
  createWorkspaceState,
  isHomeKey,
  selectActiveConversation,
  selectHomeKey,
  workspaceReducer,
  type WorkspaceState,
} from './workspaceState';

const channel = (id: string): Conversation => ({ kind: 'channel', channelId: id });
const dm = (id: string): Conversation => ({ kind: 'dm', contactId: id });
const keys = (state: WorkspaceState) => state.tabs.map(conversationKey);

const joined = (id: string | null, base = createWorkspaceState()) =>
  workspaceReducer(base, { type: 'JOINED_CHANNEL_CHANGED', channelId: id });

describe('workspace conversation tabs', () => {
  it('starts empty and disconnected', () => {
    const state = createWorkspaceState();
    expect(state).toEqual({ joinedChannelId: null, tabs: [], activeKey: null });
    expect(selectHomeKey(state)).toBeNull();
    expect(selectActiveConversation(state)).toBeNull();
  });

  it('creates a pinned home tab when joining a channel', () => {
    const state = joined('7');
    expect(keys(state)).toEqual(['channel:7']);
    expect(state.activeKey).toBe('channel:7');
    expect(isHomeKey(state, 'channel:7')).toBe(true);
  });

  it('keeps a home tab at server root', () => {
    const state = joined('server-root');
    expect(keys(state)).toEqual(['channel:server-root']);
    expect(selectHomeKey(state)).toBe('channel:server-root');
  });

  it('appends and activates an opened conversation', () => {
    let state = joined('7');
    state = workspaceReducer(state, { type: 'OPEN_CONVERSATION', conversation: channel('9') });
    state = workspaceReducer(state, { type: 'OPEN_CONVERSATION', conversation: dm('@val:example.com') });
    expect(keys(state)).toEqual(['channel:7', 'channel:9', 'dm:@val:example.com']);
    expect(state.activeKey).toBe('dm:@val:example.com');
  });

  it('activates rather than duplicating an already open conversation', () => {
    let state = joined('7');
    state = workspaceReducer(state, { type: 'OPEN_CONVERSATION', conversation: channel('9') });
    state = workspaceReducer(state, { type: 'OPEN_CONVERSATION', conversation: dm('a') });
    state = workspaceReducer(state, { type: 'OPEN_CONVERSATION', conversation: channel('9') });
    expect(keys(state)).toEqual(['channel:7', 'channel:9', 'dm:a']);
    expect(state.activeKey).toBe('channel:9');
  });

  it('replaces the home tab when the joined channel changes and leaves browsed tabs alone', () => {
    let state = joined('7');
    state = workspaceReducer(state, { type: 'OPEN_CONVERSATION', conversation: channel('9') });
    state = workspaceReducer(state, { type: 'JOINED_CHANNEL_CHANGED', channelId: '12' });
    expect(keys(state)).toEqual(['channel:12', 'channel:9']);
    expect(selectHomeKey(state)).toBe('channel:12');
  });

  it('absorbs a browsed tab that becomes the new home instead of showing it twice', () => {
    let state = joined('7');
    state = workspaceReducer(state, { type: 'OPEN_CONVERSATION', conversation: channel('9') });
    state = workspaceReducer(state, { type: 'OPEN_CONVERSATION', conversation: dm('a') });
    state = workspaceReducer(state, { type: 'JOINED_CHANNEL_CHANGED', channelId: '9' });
    expect(keys(state)).toEqual(['channel:9', 'dm:a']);
    expect(state.activeKey).toBe('channel:9');
  });

  it('moves activation to the new home when the old home was active', () => {
    let state = joined('7');
    state = workspaceReducer(state, { type: 'OPEN_CONVERSATION', conversation: channel('9') });
    state = workspaceReducer(state, { type: 'ACTIVATE_CONVERSATION', key: 'channel:7' });
    state = workspaceReducer(state, { type: 'JOINED_CHANNEL_CHANGED', channelId: '12' });
    expect(state.activeKey).toBe('channel:12');
  });

  it('keeps activation on a browsed tab across a channel move', () => {
    let state = joined('7');
    state = workspaceReducer(state, { type: 'OPEN_CONVERSATION', conversation: channel('9') });
    state = workspaceReducer(state, { type: 'JOINED_CHANNEL_CHANGED', channelId: '12' });
    expect(state.activeKey).toBe('channel:9');
  });

  it('refuses to close the home tab', () => {
    let state = joined('7');
    state = workspaceReducer(state, { type: 'CLOSE_CONVERSATION', key: 'channel:7' });
    expect(keys(state)).toEqual(['channel:7']);
  });

  it('activates the right neighbour when closing the active tab', () => {
    let state = joined('7');
    state = workspaceReducer(state, { type: 'OPEN_CONVERSATION', conversation: channel('9') });
    state = workspaceReducer(state, { type: 'OPEN_CONVERSATION', conversation: dm('a') });
    state = workspaceReducer(state, { type: 'ACTIVATE_CONVERSATION', key: 'channel:9' });
    state = workspaceReducer(state, { type: 'CLOSE_CONVERSATION', key: 'channel:9' });
    expect(keys(state)).toEqual(['channel:7', 'dm:a']);
    expect(state.activeKey).toBe('dm:a');
  });

  it('falls back to the left neighbour when closing the last tab', () => {
    let state = joined('7');
    state = workspaceReducer(state, { type: 'OPEN_CONVERSATION', conversation: channel('9') });
    state = workspaceReducer(state, { type: 'OPEN_CONVERSATION', conversation: dm('a') });
    state = workspaceReducer(state, { type: 'CLOSE_CONVERSATION', key: 'dm:a' });
    expect(state.activeKey).toBe('channel:9');
  });

  it('leaves activation alone when closing an inactive tab', () => {
    let state = joined('7');
    state = workspaceReducer(state, { type: 'OPEN_CONVERSATION', conversation: channel('9') });
    state = workspaceReducer(state, { type: 'OPEN_CONVERSATION', conversation: dm('a') });
    state = workspaceReducer(state, { type: 'CLOSE_CONVERSATION', key: 'channel:9' });
    expect(state.activeKey).toBe('dm:a');
  });

  it('treats invalidation as a close', () => {
    let state = joined('7');
    state = workspaceReducer(state, { type: 'OPEN_CONVERSATION', conversation: dm('a') });
    state = workspaceReducer(state, { type: 'CONVERSATION_INVALIDATED', key: 'dm:a' });
    expect(keys(state)).toEqual(['channel:7']);
    expect(state.activeKey).toBe('channel:7');
  });

  it('restores non-home tabs and activates home', () => {
    let state = joined('7');
    state = workspaceReducer(state, {
      type: 'RESTORE_CONVERSATIONS',
      conversations: [channel('9'), dm('a'), channel('7')],
    });
    expect(keys(state)).toEqual(['channel:7', 'channel:9', 'dm:a']);
    expect(state.activeKey).toBe('channel:7');
  });

  it('drops every tab and the home tab on disconnect', () => {
    let state = joined('7');
    state = workspaceReducer(state, { type: 'OPEN_CONVERSATION', conversation: dm('a') });
    state = workspaceReducer(state, { type: 'JOINED_CHANNEL_CHANGED', channelId: null });
    expect(selectHomeKey(state)).toBeNull();
    expect(keys(state)).toEqual(['dm:a']);
    state = workspaceReducer(state, { type: 'WORKSPACE_RESET' });
    expect(keys(state)).toEqual([]);
    expect(state.activeKey).toBeNull();
  });

  it('returns the same state object when nothing changes', () => {
    const state = joined('7');
    expect(workspaceReducer(state, { type: 'JOINED_CHANNEL_CHANGED', channelId: '7' })).toBe(state);
    expect(workspaceReducer(state, { type: 'ACTIVATE_CONVERSATION', key: 'channel:7' })).toBe(state);
    expect(workspaceReducer(state, { type: 'CLOSE_CONVERSATION', key: 'channel:404' })).toBe(state);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run src/workspace/workspaceState.test.ts`
Expected: FAIL — `createWorkspaceState` returns the old shape and none of the new events exist.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/Brmble.Web/src/workspace/workspaceState.ts
import { conversationKey, type Conversation } from './conversation';

export interface WorkspaceState {
  joinedChannelId: string | null;
  tabs: Conversation[];
  activeKey: string | null;
}

export type WorkspaceEvent =
  | { type: 'JOINED_CHANNEL_CHANGED'; channelId: string | null }
  | { type: 'OPEN_CONVERSATION'; conversation: Conversation }
  | { type: 'CLOSE_CONVERSATION'; key: string }
  | { type: 'ACTIVATE_CONVERSATION'; key: string }
  | { type: 'CONVERSATION_INVALIDATED'; key: string }
  | { type: 'RESTORE_CONVERSATIONS'; conversations: Conversation[] }
  | { type: 'WORKSPACE_RESET' };

export const createWorkspaceState = (): WorkspaceState => ({
  joinedChannelId: null,
  tabs: [],
  activeKey: null,
});

export const selectHomeKey = (state: WorkspaceState): string | null =>
  state.joinedChannelId === null ? null : `channel:${state.joinedChannelId}`;

export const isHomeKey = (state: WorkspaceState, key: string): boolean =>
  selectHomeKey(state) === key;

export const selectActiveConversation = (state: WorkspaceState): Conversation | null =>
  state.tabs.find(tab => conversationKey(tab) === state.activeKey) ?? null;

function withoutKey(tabs: Conversation[], key: string | null): Conversation[] {
  if (key === null) return tabs;
  return tabs.filter(tab => conversationKey(tab) !== key);
}

function closeTab(state: WorkspaceState, key: string): WorkspaceState {
  if (isHomeKey(state, key)) return state;
  const index = state.tabs.findIndex(tab => conversationKey(tab) === key);
  if (index === -1) return state;

  const tabs = state.tabs.filter((_, position) => position !== index);
  if (state.activeKey !== key) return { ...state, tabs };

  const neighbour = tabs[index] ?? tabs[index - 1] ?? null;
  const fallback = neighbour ? conversationKey(neighbour) : selectHomeKey(state);
  return { ...state, tabs, activeKey: fallback };
}

export const workspaceReducer = (
  state: WorkspaceState,
  event: WorkspaceEvent,
): WorkspaceState => {
  switch (event.type) {
    case 'JOINED_CHANNEL_CHANGED': {
      if (event.channelId === state.joinedChannelId) return state;

      const previousHomeKey = selectHomeKey(state);
      const rest = withoutKey(state.tabs, previousHomeKey);

      if (event.channelId === null) {
        const activeKey = state.activeKey === previousHomeKey
          ? (rest[0] ? conversationKey(rest[0]) : null)
          : state.activeKey;
        return { joinedChannelId: null, tabs: rest, activeKey };
      }

      const home: Conversation = { kind: 'channel', channelId: event.channelId };
      const homeKey = conversationKey(home);
      const absorbed = rest.some(tab => conversationKey(tab) === homeKey);
      const tabs = [home, ...withoutKey(rest, homeKey)];
      const activeKey = state.activeKey === previousHomeKey || state.activeKey === null || absorbed && state.activeKey === homeKey
        ? homeKey
        : tabs.some(tab => conversationKey(tab) === state.activeKey)
          ? state.activeKey
          : homeKey;

      return { joinedChannelId: event.channelId, tabs, activeKey };
    }

    case 'OPEN_CONVERSATION': {
      const key = conversationKey(event.conversation);
      if (state.tabs.some(tab => conversationKey(tab) === key)) {
        return state.activeKey === key ? state : { ...state, activeKey: key };
      }
      return { ...state, tabs: [...state.tabs, event.conversation], activeKey: key };
    }

    case 'ACTIVATE_CONVERSATION': {
      if (state.activeKey === event.key) return state;
      if (!state.tabs.some(tab => conversationKey(tab) === event.key)) return state;
      return { ...state, activeKey: event.key };
    }

    case 'CLOSE_CONVERSATION':
    case 'CONVERSATION_INVALIDATED':
      return closeTab(state, event.key);

    case 'RESTORE_CONVERSATIONS': {
      const homeKey = selectHomeKey(state);
      const home = state.tabs.find(tab => conversationKey(tab) === homeKey);
      const seen = new Set<string>(homeKey ? [homeKey] : []);
      const restored: Conversation[] = [];
      for (const conversation of event.conversations) {
        const key = conversationKey(conversation);
        if (seen.has(key)) continue;
        seen.add(key);
        restored.push(conversation);
      }
      const tabs = home ? [home, ...restored] : restored;
      return { ...state, tabs, activeKey: homeKey ?? (tabs[0] ? conversationKey(tabs[0]) : null) };
    }

    case 'WORKSPACE_RESET': {
      const homeKey = selectHomeKey(state);
      const home = state.tabs.find(tab => conversationKey(tab) === homeKey);
      return { ...state, tabs: home ? [home] : [], activeKey: home ? homeKey : null };
    }
  }
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run src/workspace/workspaceState.test.ts`
Expected: PASS, 17 tests.

- [ ] **Step 5: Confirm the scale of the breakage before proceeding**

Run: `npx tsc -b --noEmit`
Expected: FAIL, with errors in `App.tsx` for every removed field and event. This is the expected blast radius — record the error count, it is the checklist for Task 7.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Web/src/workspace/workspaceState.ts src/Brmble.Web/src/workspace/workspaceState.test.ts
git commit -m "feat: replace workspace foreground state with conversation tabs"
```

---

## Task 4: Validated Per-Server Tab Persistence

Stored tabs are never trusted. A channel may have been deleted, chat permission revoked, or a DM contact may no longer resolve. The home tab is always recomputed from live presence and is never restored from storage.

**Files:**
- Create: `src/Brmble.Web/src/workspace/conversationStorage.ts`
- Test: `src/Brmble.Web/src/workspace/conversationStorage.test.ts`

**Interfaces:**
- Consumes: `Conversation`, `conversationKey` from Task 1.
- Produces: `saveConversationTabs(serverId: string, tabs: Conversation[]): void`, `loadConversationTabs(serverId: string, isValid: (c: Conversation) => boolean): Conversation[]`, `conversationStorageKey(serverId: string): string`.

- [ ] **Step 1: Write the failing test**

```ts
// src/Brmble.Web/src/workspace/conversationStorage.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import type { Conversation } from './conversation';
import {
  conversationStorageKey,
  loadConversationTabs,
  saveConversationTabs,
} from './conversationStorage';

const channel = (id: string): Conversation => ({ kind: 'channel', channelId: id });
const dm = (id: string): Conversation => ({ kind: 'dm', contactId: id });
const always = () => true;

describe('conversation tab persistence', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips tabs for a server', () => {
    saveConversationTabs('server-a', [channel('9'), dm('@val:example.com')]);
    expect(loadConversationTabs('server-a', always)).toEqual([channel('9'), dm('@val:example.com')]);
  });

  it('scopes storage per server', () => {
    saveConversationTabs('server-a', [channel('9')]);
    saveConversationTabs('server-b', [channel('4')]);
    expect(loadConversationTabs('server-a', always)).toEqual([channel('9')]);
    expect(loadConversationTabs('server-b', always)).toEqual([channel('4')]);
    expect(conversationStorageKey('server-a')).not.toBe(conversationStorageKey('server-b'));
  });

  it('returns an empty list when nothing is stored', () => {
    expect(loadConversationTabs('server-a', always)).toEqual([]);
  });

  it('drops conversations the validator rejects', () => {
    saveConversationTabs('server-a', [channel('9'), channel('404'), dm('gone')]);
    const restored = loadConversationTabs('server-a', c =>
      c.kind === 'channel' ? c.channelId === '9' : false);
    expect(restored).toEqual([channel('9')]);
  });

  it('resets to empty on malformed json', () => {
    localStorage.setItem(conversationStorageKey('server-a'), '{not json');
    expect(loadConversationTabs('server-a', always)).toEqual([]);
  });

  it('resets to empty on an unexpected version', () => {
    localStorage.setItem(conversationStorageKey('server-a'), JSON.stringify({ version: 99, tabs: [channel('9')] }));
    expect(loadConversationTabs('server-a', always)).toEqual([]);
  });

  it('discards structurally invalid entries without discarding valid ones', () => {
    localStorage.setItem(conversationStorageKey('server-a'), JSON.stringify({
      version: 1,
      tabs: [channel('9'), { kind: 'channel' }, { kind: 'wormhole', id: 1 }, null, dm('a')],
    }));
    expect(loadConversationTabs('server-a', always)).toEqual([channel('9'), dm('a')]);
  });

  it('deduplicates repeated keys', () => {
    saveConversationTabs('server-a', [channel('9'), channel('9'), dm('a')]);
    expect(loadConversationTabs('server-a', always)).toEqual([channel('9'), dm('a')]);
  });

  it('survives a storage write failure without throwing', () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error('quota'); };
    expect(() => saveConversationTabs('server-a', [channel('9')])).not.toThrow();
    Storage.prototype.setItem = original;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run src/workspace/conversationStorage.test.ts`
Expected: FAIL — cannot resolve `./conversationStorage`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/Brmble.Web/src/workspace/conversationStorage.ts
import { conversationKey, type Conversation } from './conversation';

const STORAGE_VERSION = 1;
const STORAGE_PREFIX = 'brmble-conversation-tabs';

export function conversationStorageKey(serverId: string): string {
  return `${STORAGE_PREFIX}:${serverId}`;
}

function isConversation(value: unknown): value is Conversation {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { kind?: unknown; channelId?: unknown; contactId?: unknown };
  if (candidate.kind === 'channel') return typeof candidate.channelId === 'string';
  if (candidate.kind === 'dm') return typeof candidate.contactId === 'string';
  return false;
}

function dedupe(conversations: Conversation[]): Conversation[] {
  const seen = new Set<string>();
  const result: Conversation[] = [];
  for (const conversation of conversations) {
    const key = conversationKey(conversation);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(conversation);
  }
  return result;
}

export function saveConversationTabs(serverId: string, tabs: Conversation[]): void {
  try {
    localStorage.setItem(
      conversationStorageKey(serverId),
      JSON.stringify({ version: STORAGE_VERSION, tabs: dedupe(tabs) }),
    );
  } catch {
    // Persistence is best-effort; a full or unavailable store must never break the UI.
  }
}

export function loadConversationTabs(
  serverId: string,
  isValid: (conversation: Conversation) => boolean,
): Conversation[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(conversationStorageKey(serverId));
  } catch {
    return [];
  }
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (typeof parsed !== 'object' || parsed === null) return [];
  const payload = parsed as { version?: unknown; tabs?: unknown };
  if (payload.version !== STORAGE_VERSION || !Array.isArray(payload.tabs)) return [];

  return dedupe(payload.tabs.filter(isConversation)).filter(isValid);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run src/workspace/conversationStorage.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/workspace/conversationStorage.ts src/Brmble.Web/src/workspace/conversationStorage.test.ts
git commit -m "feat: persist conversation tabs per server with validated restore"
```

---

## Task 5: Wire App To Presence And Tabs

Task 3 deliberately broke the build. This task makes it compile again by replacing every consumer of the deleted workspace fields. The visible layout is intentionally **unchanged** at the end of this task — the old `.content-slider` and both old splitters are still in place. Only the state underneath is new.

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`
- Modify: `src/Brmble.Web/src/components/DMContactList/DMContactList.tsx` (call sites only)
- Test: `src/Brmble.Web/src/App.conversationTabs.test.tsx` (create)

**Interfaces:**
- Consumes: everything produced by Tasks 1–4.
- Produces: in `App.tsx`, `joinedChannelId: string | null`, `activeConversation: Conversation | null`, and `activeChannelChatId: string | undefined` (the channel id the `ChatPanel` should render, or `undefined` when the active conversation is a DM). Later layout tasks consume these three names.

Replacements, one per broken reference:

| Deleted | Replacement |
|---|---|
| `workspace.foreground.kind === 'dm'` | `activeConversation?.kind === 'dm'` |
| `showChannelConversation` | `activeConversation?.kind === 'channel'` |
| `foregroundDmContactId` | `activeConversation?.kind === 'dm' ? activeConversation.contactId : null` |
| `messagesPanelExpanded` | literal `true` for now; removed entirely in Task 14 |
| `dispatchWorkspace({ type: 'SELECT_CHANNEL' })` | `dispatchWorkspace({ type: 'OPEN_CONVERSATION', conversation: { kind: 'channel', channelId } })` |
| `dispatchWorkspace({ type: 'SELECT_DM', contactId })` | `dispatchWorkspace({ type: 'OPEN_CONVERSATION', conversation: { kind: 'dm', contactId } })` |
| `dispatchWorkspace({ type: 'SELECTED_DM_INVALIDATED' })` | `dispatchWorkspace({ type: 'CONVERSATION_INVALIDATED', key: conversationKey({ kind: 'dm', contactId }) })` |
| `dispatchWorkspace({ type: 'REMOTE_WATCH_COUNT_CHANGED', count })` | delete the dispatch and the effect that raised it |
| `dispatchWorkspace({ type: 'TOGGLE_MESSAGES_PANEL' })` / `OPEN_MESSAGES_PANEL` | delete; `toggleMessagesPanel` keeps only its `setShowGame(false)` behaviour until Task 14 removes it |
| `dispatchWorkspace({ type: 'CONNECTION_WORKSPACE_READY' })` | `dispatchWorkspace({ type: 'WORKSPACE_RESET' })` |

- [ ] **Step 1: Write the failing test**

```tsx
// src/Brmble.Web/src/App.conversationTabs.test.tsx
import { describe, expect, it } from 'vitest';
import { conversationKey } from './workspace/conversation';
import { selectJoinedChannelId } from './workspace/presence';
import {
  createWorkspaceState,
  selectActiveConversation,
  selectHomeKey,
  workspaceReducer,
} from './workspace/workspaceState';

// Presence and tabs must agree: whatever selectJoinedChannelId reports is the home tab.
describe('App presence and tab wiring contract', () => {
  it('derives the home tab from the self user channel', () => {
    const joinedChannelId = selectJoinedChannelId([{ channelId: 3 }, { self: true, channelId: 7 }]);
    const state = workspaceReducer(createWorkspaceState(), { type: 'JOINED_CHANNEL_CHANGED', channelId: joinedChannelId });
    expect(selectHomeKey(state)).toBe('channel:7');
  });

  it('opens a browsed channel without disturbing presence', () => {
    let state = workspaceReducer(createWorkspaceState(), { type: 'JOINED_CHANNEL_CHANGED', channelId: '7' });
    state = workspaceReducer(state, { type: 'OPEN_CONVERSATION', conversation: { kind: 'channel', channelId: '9' } });
    expect(state.joinedChannelId).toBe('7');
    expect(selectHomeKey(state)).toBe('channel:7');
    expect(conversationKey(selectActiveConversation(state)!)).toBe('channel:9');
  });

  it('invalidates a dm by key', () => {
    let state = workspaceReducer(createWorkspaceState(), { type: 'JOINED_CHANNEL_CHANGED', channelId: '7' });
    state = workspaceReducer(state, { type: 'OPEN_CONVERSATION', conversation: { kind: 'dm', contactId: 'a' } });
    state = workspaceReducer(state, { type: 'CONVERSATION_INVALIDATED', key: conversationKey({ kind: 'dm', contactId: 'a' }) });
    expect(state.tabs.map(conversationKey)).toEqual(['channel:7']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run src/App.conversationTabs.test.tsx`
Expected: FAIL — the suite cannot compile while `App.tsx` still references deleted workspace fields.

- [ ] **Step 3: Derive presence and the active conversation in App**

Replace the ad-hoc derivation at `App.tsx:4340` and add the new derived values near the workspace reducer usage (around `App.tsx:1687`):

```tsx
import { conversationKey, type Conversation } from './workspace/conversation';
import { selectJoinedChannelId } from './workspace/presence';
import { loadConversationTabs, saveConversationTabs } from './workspace/conversationStorage';
import { selectActiveConversation, selectHomeKey } from './workspace/workspaceState';

const joinedChannelId = selectJoinedChannelId(users);
const activeConversation = selectActiveConversation(workspace);
const activeChannelChatId = activeConversation?.kind === 'channel'
  ? activeConversation.channelId
  : undefined;
```

Keep `selfVoiceChannelId` as a thin alias during this task so unrelated call sites keep compiling:

```tsx
const selfVoiceChannelId = joinedChannelId === null || joinedChannelId === 'server-root'
  ? undefined
  : Number(joinedChannelId);
```

- [ ] **Step 4: Feed presence changes into the reducer**

```tsx
useEffect(() => {
  dispatchWorkspace({ type: 'JOINED_CHANNEL_CHANGED', channelId: joinedChannelId });
}, [joinedChannelId]);
```

Delete the two `setCurrentChannelId('server-root')` side effects at `App.tsx:2156` and `App.tsx:2716` that exist only to make the viewed channel follow a voice move — presence now drives the home tab directly. Keep `setCurrentChannelName` updates; the name is still needed for display.

- [ ] **Step 5: Restore and persist tabs**

```tsx
useEffect(() => {
  if (!connected || !serverId) return;
  const restored = loadConversationTabs(serverId, conversation =>
    conversation.kind === 'dm'
      ? true
      : canOpenChannelChat(conversation.channelId, channels));
  dispatchWorkspace({ type: 'RESTORE_CONVERSATIONS', conversations: restored });
}, [connected, serverId]);
```

Restore must run once the channel list has arrived, otherwise every channel tab is rejected as unknown. Guard on the channel list being non-empty, and keep the effect's dependency array free of `channels` so a later roster update cannot re-trigger a restore that would discard tabs the user opened since connecting.

```tsx
useEffect(() => {
  if (!connected || !serverId) return;
  const homeKey = selectHomeKey(workspace);
  saveConversationTabs(serverId, workspace.tabs.filter(tab => conversationKey(tab) !== homeKey));
}, [connected, serverId, workspace.tabs, workspace.joinedChannelId]);
```

`serverId` is the stable identifier of the connected server already available in App's connection state. If no such stable value exists, use the server host and port joined by a colon — it must not be the user-editable label.

- [ ] **Step 6: Replace every remaining broken reference**

Work through the table above. `handleSelectChannel` (`App.tsx:3428-3440`) keeps its permission check via `getChannelSelectionOutcome` and its `setShowGame(false)`, but its terminal action becomes an `OPEN_CONVERSATION` dispatch rather than `setCurrentChannelId` plus `SELECT_CHANNEL`. Leave `currentChannelId` in place for now as a derived alias so untouched call sites still work:

```tsx
const currentChannelId = activeChannelChatId;
```

- [ ] **Step 7: Verify the build and the whole suite**

Run: `npx tsc -b --noEmit`
Expected: PASS, zero errors.

Run: `npm test -- --run`
Expected: PASS. Tests asserting the deleted Messages-panel auto-collapse behaviour will fail; delete those cases — the behaviour is intentionally gone. Tests asserting DM slide transitions still pass because the layout is unchanged.

- [ ] **Step 8: Commit**

```bash
git add src/Brmble.Web/src
git commit -m "refactor: drive App from presence and conversation tabs"
```

---

## Task 6: Bug Fix — Paint No Longer Closes When Browsing

Paint sessions are created against the joined channel (`App.tsx:4650`) but kept alive against the viewed channel (`App.tsx:1371-1379`), so clicking any other channel silently destroys a live canvas.

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx:1371-1379`, and the two assignments to `activePaintChannelIdRef` at `App.tsx:4740` and `App.tsx:4802`
- Test: `src/Brmble.Web/src/App.paintPresence.test.tsx` (create)

**Interfaces:**
- Consumes: `joinedChannelId` from Task 5.
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

```tsx
// src/Brmble.Web/src/App.paintPresence.test.tsx
import { describe, expect, it } from 'vitest';
import { shouldKeepPaintSession } from './App';

describe('paint session survival', () => {
  it('survives while the user stays in the channel that owns the session', () => {
    expect(shouldKeepPaintSession({ connectionStatus: 'connected', sessionChannelId: '7', joinedChannelId: '7' })).toBe(true);
  });

  it('survives while the user browses another channel', () => {
    expect(shouldKeepPaintSession({ connectionStatus: 'connected', sessionChannelId: '7', joinedChannelId: '7' })).toBe(true);
  });

  it('ends when the user moves to a different voice channel', () => {
    expect(shouldKeepPaintSession({ connectionStatus: 'connected', sessionChannelId: '7', joinedChannelId: '12' })).toBe(false);
  });

  it('ends when the user leaves voice entirely', () => {
    expect(shouldKeepPaintSession({ connectionStatus: 'connected', sessionChannelId: '7', joinedChannelId: null })).toBe(false);
    expect(shouldKeepPaintSession({ connectionStatus: 'connected', sessionChannelId: '7', joinedChannelId: 'server-root' })).toBe(false);
  });

  it('ends when the connection drops', () => {
    expect(shouldKeepPaintSession({ connectionStatus: 'disconnected', sessionChannelId: '7', joinedChannelId: '7' })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run src/App.paintPresence.test.tsx`
Expected: FAIL — `shouldKeepPaintSession` is not exported from `App.tsx`.

- [ ] **Step 3: Extract and rebind the guard**

Export a pure predicate from `App.tsx`, alongside the other exported pure helpers such as `canOpenChannelChat` at `App.tsx:694`:

```tsx
export function shouldKeepPaintSession(input: {
  connectionStatus: string;
  sessionChannelId: string | undefined;
  joinedChannelId: string | null;
}): boolean {
  if (input.connectionStatus !== 'connected') return false;
  if (input.joinedChannelId === null || input.joinedChannelId === 'server-root') return false;
  return input.sessionChannelId === input.joinedChannelId;
}
```

Rewrite the effect at `App.tsx:1371-1379` to use it:

```tsx
if (!shouldKeepPaintSession({
  connectionStatus,
  sessionChannelId: activePaintChannelIdRef.current,
  joinedChannelId,
})) {
  activePaintSessionIdRef.current = null;
  setActivePaintSessionId(null);
  activePaintChannelIdRef.current = undefined;
}
```

Change both writers so the ref records the channel that actually owns the session. At `App.tsx:4740` and `App.tsx:4802`, replace `activePaintChannelIdRef.current = currentChannelId` with `activePaintChannelIdRef.current = joinedChannelId ?? undefined`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run src/App.paintPresence.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/App.tsx src/Brmble.Web/src/App.paintPresence.test.tsx
git commit -m "fix: keep paint sessions alive while browsing another channel"
```

---

## Task 7: Bug Fix — Screen Share Follows Presence

Publishing is gated on the joined channel (`App.tsx:4340-4341`) but watching and discovery are gated on the viewed channel (`App.tsx:477-480`, `App.tsx:4432-4437`). The asymmetry means clicking another channel makes your own channel's share unwatchable.

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx:477-480` (`canWatchShareFromChannel`), `App.tsx:4432-4437` (discovery effect), `App.tsx:4526` (call site)
- Test: `src/Brmble.Web/src/App.sharePresence.test.tsx` (create)

**Interfaces:**
- Consumes: `joinedChannelId` from Task 5.
- Produces: `canWatchShareFromChannel(joinedChannelId: string | null, shareRoomName: string): boolean` — the first parameter changes meaning from viewed to joined. The signature shape is unchanged, so update the existing tests rather than adding a parallel helper.

- [ ] **Step 1: Write the failing test**

```tsx
// src/Brmble.Web/src/App.sharePresence.test.tsx
import { describe, expect, it } from 'vitest';
import { canWatchShareFromChannel } from './App';

describe('canWatchShareFromChannel', () => {
  it('allows watching a share published into the joined channel', () => {
    expect(canWatchShareFromChannel('7', 'channel-7')).toBe(true);
  });

  it('still allows it while the user browses a different channel', () => {
    // The viewed channel is irrelevant now; only presence matters.
    expect(canWatchShareFromChannel('7', 'channel-7')).toBe(true);
  });

  it('rejects a share from any other channel', () => {
    expect(canWatchShareFromChannel('7', 'channel-9')).toBe(false);
  });

  it('rejects when not in a channel', () => {
    expect(canWatchShareFromChannel(null, 'channel-7')).toBe(false);
    expect(canWatchShareFromChannel('server-root', 'channel-7')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run src/App.sharePresence.test.tsx`
Expected: FAIL — the third case passes by accident but the null/`server-root` case and the parameter meaning do not match; the existing `App.test.tsx` cases for this helper also fail once rebound.

- [ ] **Step 3: Rebind the helper and its callers**

```tsx
export function canWatchShareFromChannel(
  joinedChannelId: string | null,
  shareRoomName: string,
): boolean {
  if (!joinedChannelId || joinedChannelId === 'server-root') return false;
  return shareRoomName === `channel-${joinedChannelId}`;
}
```

Update the call site at `App.tsx:4526` to pass `joinedChannelId`. Change the discovery effect at `App.tsx:4432-4437` to depend on presence rather than selection:

```tsx
useEffect(() => {
  setScreenShareNotification(null);
  notifQueueRef.current.unregister('screen-share');
  requestActiveShareDiscoveryRef.current?.(joinedChannelId ?? undefined);
}, [joinedChannelId]);
```

`requestActiveShareDiscovery` at `App.tsx:4406-4422` keeps its existing `'server-root'` branch, which now means "not in a channel" and correctly yields the `{ scope: 'all' }` target.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run src/App.sharePresence.test.tsx src/App.test.tsx`
Expected: PASS. Update any existing case in `App.test.tsx` that passed a viewed channel id — the argument is now the joined channel.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/App.tsx src/Brmble.Web/src/App.sharePresence.test.tsx src/Brmble.Web/src/App.test.tsx
git commit -m "fix: bind screen share watching and discovery to the joined channel"
```

---

## Task 8: Bug Fix — Challenge Gate And Sidebar Presence Marker

The challenge context item is gated on the viewed channel (`ChannelTree.tsx:635-651`) while the server requires the same voice channel (`DuelOrchestrator.cs:121-125`), so it is offered where it will be rejected and hidden where it would succeed. Separately, the sidebar `current` highlight follows the viewed channel (`ChannelTree.tsx:285`), leaving no indication anywhere of which channel the user is in.

**Files:**
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx`
- Modify: `src/Brmble.Web/src/components/Sidebar/Sidebar.tsx` (prop threading)
- Modify: `src/Brmble.Web/src/App.tsx` (prop wiring at `App.tsx:4816`, `App.tsx:4837`)
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.css`
- Test: `src/Brmble.Web/src/components/Sidebar/ChannelTree.test.tsx`

**Interfaces:**
- Consumes: `joinedChannelId` from Task 5.
- Produces: `ChannelTree` gains `joinedChannelId?: number` alongside the existing `currentChannelId?: number`. `currentChannelId` keeps its meaning — the active conversation — and gains no new responsibility.

- [ ] **Step 1: Write the failing test**

```tsx
// added to src/Brmble.Web/src/components/Sidebar/ChannelTree.test.tsx
it('marks the joined channel separately from the active conversation', () => {
  render(<ChannelTree {...props} currentChannelId={9} joinedChannelId={7} />);
  expect(screen.getByRole('treeitem', { name: /General/ })).toHaveClass('channel-row--joined');
  expect(screen.getByRole('treeitem', { name: /Random/ })).toHaveClass('current');
  expect(screen.getByRole('treeitem', { name: /Random/ })).not.toHaveClass('channel-row--joined');
});

it('offers Challenge only for users in the joined channel', () => {
  const { rerender } = render(
    <ChannelTree {...props} currentChannelId={9} joinedChannelId={7} users={[brmbleUserInChannel(7)]} />,
  );
  fireEvent.contextMenu(screen.getByText('Alice'));
  expect(screen.getByRole('menuitem', { name: /Challenge/ })).toBeInTheDocument();

  rerender(<ChannelTree {...props} currentChannelId={9} joinedChannelId={12} users={[brmbleUserInChannel(7)]} />);
  fireEvent.contextMenu(screen.getByText('Alice'));
  expect(screen.queryByRole('menuitem', { name: /Challenge/ })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run src/components/Sidebar/ChannelTree.test.tsx`
Expected: FAIL — `joinedChannelId` is not a prop and `channel-row--joined` does not exist.

- [ ] **Step 3: Add the prop, the marker, and the corrected gate**

Add `joinedChannelId?: number` to `ChannelTreeProps`. At the channel row (`ChannelTree.tsx:285`, `:303`) keep `isCurrentChannel` bound to `currentChannelId` and add a second, independent flag:

```tsx
const isJoinedChannel = joinedChannelId === channel.id;
// className: [..., isCurrentChannel && 'current', isJoinedChannel && 'channel-row--joined']
```

Replace the eligibility check at `ChannelTree.tsx:635-651`:

```tsx
const eligible = !!target?.isBrmbleClient
  && contextMenu.channelId != null
  && contextMenu.channelId === joinedChannelId;
```

In `ChannelTree.css`, style `.channel-row--joined` using existing tokens only — a left accent border drawn with `var(--accent-primary)` and no new colour literals. The marker must be distinguishable from `.current` without relying on colour alone; add a visually hidden suffix to the row's accessible name, for example `<span className="sr-only"> (you are here)</span>`.

Thread `joinedChannelId` through `Sidebar.tsx` and pass it from `App.tsx` next to the existing `currentChannelId` prop at `App.tsx:4816`:

```tsx
joinedChannelId={joinedChannelId && joinedChannelId !== 'server-root' ? Number(joinedChannelId) : undefined}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run src/components/Sidebar/ChannelTree.test.tsx`
Expected: PASS, including the pre-existing cases.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/components/Sidebar src/Brmble.Web/src/App.tsx
git commit -m "fix: gate duel challenges on presence and mark the joined channel"
```

- [ ] **Step 6: Gate — state phase complete**

Run: `npx tsc -b --noEmit` and `npm test -- --run`
Expected: both PASS. Do not begin Task 9 until this gate is green; the spec's ordering constraint exists to keep the layout work off unstable state.

---

## Task 9: Main Panel Mode Selection

**Files:**
- Create: `src/Brmble.Web/src/workspace/mainPanelMode.ts`
- Test: `src/Brmble.Web/src/workspace/mainPanelMode.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type MainPanelMode = 'game' | 'split'` and `selectMainPanelMode(input: { idleGameOpen: boolean; participatingMatchId: string | null }): MainPanelMode`. Note the input is *participation*, not spectating — watching a duel never takes the panel.

- [ ] **Step 1: Write the failing test**

```ts
// src/Brmble.Web/src/workspace/mainPanelMode.test.ts
import { describe, expect, it } from 'vitest';
import { selectMainPanelMode } from './mainPanelMode';

describe('selectMainPanelMode', () => {
  it('splits when nothing is being played', () => {
    expect(selectMainPanelMode({ idleGameOpen: false, participatingMatchId: null })).toBe('split');
  });

  it('takes the panel for the idle game', () => {
    expect(selectMainPanelMode({ idleGameOpen: true, participatingMatchId: null })).toBe('game');
  });

  it('takes the panel while participating in a match', () => {
    expect(selectMainPanelMode({ idleGameOpen: false, participatingMatchId: 'match-1' })).toBe('game');
  });

  it('prefers the match when both are somehow set', () => {
    expect(selectMainPanelMode({ idleGameOpen: true, participatingMatchId: 'match-1' })).toBe('game');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run src/workspace/mainPanelMode.test.ts`
Expected: FAIL — cannot resolve `./mainPanelMode`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/Brmble.Web/src/workspace/mainPanelMode.ts
export type MainPanelMode = 'game' | 'split';

export function selectMainPanelMode(input: {
  idleGameOpen: boolean;
  participatingMatchId: string | null;
}): MainPanelMode {
  return input.participatingMatchId !== null || input.idleGameOpen ? 'game' : 'split';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run src/workspace/mainPanelMode.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/workspace/mainPanelMode.ts src/Brmble.Web/src/workspace/mainPanelMode.test.ts
git commit -m "feat: add main panel mode selection"
```

---

## Task 10: Game Mode Takes The Whole Panel

`NeonDGame` already replaces `<main>` (`App.tsx:4870`) but as a special case suppressed by paint. `DeathrollModal` and `RpsModal` are modal overlays. All three become the same thing: the sole content of the main panel.

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx` (render block `App.tsx:4869-4951`, and the modal render sites for Deathroll and RPS)
- Test: `src/Brmble.Web/src/App.gameMode.test.tsx` (create)

**Interfaces:**
- Consumes: `selectMainPanelMode` from Task 9, `useGameState`'s existing active-match value.
- Produces: `mainPanelMode` in `App.tsx`, consumed by Tasks 14 and 17.

- [ ] **Step 1: Write the failing test**

```tsx
// src/Brmble.Web/src/App.gameMode.test.tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MainPanel } from './components/MainPanel/MainPanel';

// MainPanel is the extracted render decision; App composes it.
describe('main panel game mode', () => {
  const base = {
    activityRegion: <div>activity</div>,
    conversationRegion: <div>conversation</div>,
    gameSurface: <div>game surface</div>,
  };

  it('renders the split layout when not playing', () => {
    render(<MainPanel {...base} mode="split" />);
    expect(screen.getByText('activity')).toBeInTheDocument();
    expect(screen.getByText('conversation')).toBeInTheDocument();
    expect(screen.queryByText('game surface')).not.toBeInTheDocument();
  });

  it('renders only the game surface when playing', () => {
    render(<MainPanel {...base} mode="game" />);
    expect(screen.getByText('game surface')).toBeInTheDocument();
    expect(screen.queryByText('activity')).not.toBeInTheDocument();
    expect(screen.queryByText('conversation')).not.toBeInTheDocument();
  });

  it('omits the activity region entirely when there is no activity', () => {
    render(<MainPanel {...base} mode="split" activityRegion={null} />);
    expect(screen.queryByText('activity')).not.toBeInTheDocument();
    expect(screen.getByText('conversation')).toBeInTheDocument();
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run src/App.gameMode.test.tsx`
Expected: FAIL — `components/MainPanel/MainPanel` does not exist.

- [ ] **Step 3: Create the MainPanel component**

```tsx
// src/Brmble.Web/src/components/MainPanel/MainPanel.tsx
import type { ReactNode } from 'react';
import { VerticalSplitPane } from '../VerticalSplitPane/VerticalSplitPane';
import type { MainPanelMode } from '../../workspace/mainPanelMode';

export const MAIN_PANEL_SPLIT_STORAGE_KEY = 'brmble-main-split';

interface MainPanelProps {
  mode: MainPanelMode;
  activityRegion: ReactNode | null;
  conversationRegion: ReactNode;
  gameSurface: ReactNode;
}

export function MainPanel({ mode, activityRegion, conversationRegion, gameSurface }: MainPanelProps) {
  if (mode === 'game') return <>{gameSurface}</>;

  return (
    <VerticalSplitPane
      top={activityRegion}
      storageKey={MAIN_PANEL_SPLIT_STORAGE_KEY}
      label="Resize channel activity and conversation"
    >
      {conversationRegion}
    </VerticalSplitPane>
  );
}
```

`VerticalSplitPane` already renders neither the top pane nor the divider when `top` is `null`, which satisfies the third test without extra code.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run src/App.gameMode.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 5: Wire App to MainPanel and retire the game special cases**

Replace the `showGame && !activePaintSessionId ? <NeonDGame/> : <div className="content-slider">…` block at `App.tsx:4869-4951` with a `<MainPanel>`. Compute the mode:

```tsx
const participatingMatchId = activeGameMatch?.matchId ?? null;
const mainPanelMode = selectMainPanelMode({ idleGameOpen: showGame, participatingMatchId });
```

`gameSurface` renders `NeonDGame` when `showGame` is set, otherwise the participant surface for the active match — the existing `DeathrollModal` and `RpsModal` bodies, rendered inline rather than inside `div.modal-overlay`. Remove `role="dialog"`, `aria-modal`, the overlay click-to-close, and the focus trap from both; a full-panel surface is not a dialog. Keep their close and forfeit controls.

Delete the paint suppression: the condition becomes `mainPanelMode === 'game'`, with no `!activePaintSessionId` term. Delete the `setShowGame(false)` calls at `App.tsx:3434` and `App.tsx:1715`; leaving game mode is now driven by closing the game or the match ending, not by unrelated navigation.

Add the exit effect so a finished match returns to split mode:

```tsx
useEffect(() => {
  if (participatingMatchId === null) return;
  if (activeGameMatch?.state === 'complete') setShowGame(false);
}, [participatingMatchId, activeGameMatch?.state]);
```

Paint and screen share continue running underneath and are simply re-rendered when the mode returns to `split`; nothing tears them down.

- [ ] **Step 6: Verify**

Run: `npx tsc -b --noEmit` and `npm test -- --run`
Expected: PASS. Delete cases in existing Deathroll/RPS modal tests that assert `role="dialog"` or overlay dismissal; keep every case covering game behaviour.

- [ ] **Step 7: Commit**

```bash
git add src/Brmble.Web/src
git commit -m "feat: give active games the whole main panel"
```

---

## Task 11: Activity Stage Selection Rules

The stage shows exactly one activity. First to appear wins, later arrivals never steal it, an explicit choice always wins, and a departing activity hands over rather than leaving the region blank.

**Files:**
- Create: `src/Brmble.Web/src/workspace/channelActivity.ts`
- Test: `src/Brmble.Web/src/workspace/channelActivity.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type ChannelActivityKind = 'screen-share' | 'paint'` and `selectStage(input: { available: ChannelActivityKind[]; explicit: ChannelActivityKind | null; previous: ChannelActivityKind | null }): ChannelActivityKind | null`. Task 17 adds `'duel'` to the union in the follow-up project; the function must not special-case any member.

- [ ] **Step 1: Write the failing test**

```ts
// src/Brmble.Web/src/workspace/channelActivity.test.ts
import { describe, expect, it } from 'vitest';
import { selectStage } from './channelActivity';

describe('selectStage', () => {
  it('returns nothing when the channel is quiet', () => {
    expect(selectStage({ available: [], explicit: null, previous: null })).toBeNull();
  });

  it('stages the first activity to appear', () => {
    expect(selectStage({ available: ['screen-share'], explicit: null, previous: null })).toBe('screen-share');
  });

  it('does not let a later activity steal the stage', () => {
    expect(selectStage({ available: ['screen-share', 'paint'], explicit: null, previous: 'screen-share' })).toBe('screen-share');
  });

  it('honours an explicit choice', () => {
    expect(selectStage({ available: ['screen-share', 'paint'], explicit: 'paint', previous: 'screen-share' })).toBe('paint');
  });

  it('ignores an explicit choice that is no longer available', () => {
    expect(selectStage({ available: ['screen-share'], explicit: 'paint', previous: null })).toBe('screen-share');
  });

  it('hands over when the staged activity ends', () => {
    expect(selectStage({ available: ['paint'], explicit: null, previous: 'screen-share' })).toBe('paint');
  });

  it('returns nothing when the last activity ends', () => {
    expect(selectStage({ available: [], explicit: 'paint', previous: 'paint' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run src/workspace/channelActivity.test.ts`
Expected: FAIL — cannot resolve `./channelActivity`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/Brmble.Web/src/workspace/channelActivity.ts
export type ChannelActivityKind = 'screen-share' | 'paint';

export function selectStage(input: {
  available: ChannelActivityKind[];
  explicit: ChannelActivityKind | null;
  previous: ChannelActivityKind | null;
}): ChannelActivityKind | null {
  if (input.available.length === 0) return null;
  if (input.explicit && input.available.includes(input.explicit)) return input.explicit;
  if (input.previous && input.available.includes(input.previous)) return input.previous;
  return input.available[0];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run src/workspace/channelActivity.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/workspace/channelActivity.ts src/Brmble.Web/src/workspace/channelActivity.test.ts
git commit -m "feat: add channel activity stage selection"
```

---

## Task 12: Channel Activity Region

**Files:**
- Create: `src/Brmble.Web/src/components/ChannelActivityRegion/ChannelActivityRegion.tsx`
- Create: `src/Brmble.Web/src/components/ChannelActivityRegion/ChannelActivityRegion.module.css`
- Modify: `src/Brmble.Web/src/index.css` (add `--activity-stage-min-height`)
- Test: `src/Brmble.Web/src/components/ChannelActivityRegion/ChannelActivityRegion.test.tsx`

**Interfaces:**
- Consumes: `ChannelActivityKind` from Task 11.
- Produces: `ChannelActivityRegion` with props `{ channelName: string; activities: { kind: ChannelActivityKind; label: string }[]; stage: ChannelActivityKind | null; onSelect: (kind: ChannelActivityKind) => void; children: ReactNode }`. `children` is the staged surface, chosen by the caller.

- [ ] **Step 1: Write the failing test**

```tsx
// src/Brmble.Web/src/components/ChannelActivityRegion/ChannelActivityRegion.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ChannelActivityRegion } from './ChannelActivityRegion';

const activities = [
  { kind: 'screen-share' as const, label: 'Screen share' },
  { kind: 'paint' as const, label: 'Paint' },
];

describe('ChannelActivityRegion', () => {
  it('names the channel and lists every live activity', () => {
    render(
      <ChannelActivityRegion channelName="General" activities={activities} stage="screen-share" onSelect={vi.fn()}>
        <div>stage content</div>
      </ChannelActivityRegion>,
    );
    expect(screen.getByRole('region', { name: 'General activity' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Screen share' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Paint' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByText('stage content')).toBeInTheDocument();
  });

  it('reports an explicit selection', () => {
    const onSelect = vi.fn();
    render(
      <ChannelActivityRegion channelName="General" activities={activities} stage="screen-share" onSelect={onSelect}>
        <div>stage content</div>
      </ChannelActivityRegion>,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Paint' }));
    expect(onSelect).toHaveBeenCalledWith('paint');
  });

  it('renders a single chip without a switcher affordance disappearing', () => {
    render(
      <ChannelActivityRegion channelName="General" activities={[activities[0]]} stage="screen-share" onSelect={vi.fn()}>
        <div>stage content</div>
      </ChannelActivityRegion>,
    );
    expect(screen.getAllByRole('tab')).toHaveLength(1);
  });

  it('moves between chips with the arrow keys', () => {
    const onSelect = vi.fn();
    render(
      <ChannelActivityRegion channelName="General" activities={activities} stage="screen-share" onSelect={onSelect}>
        <div>stage content</div>
      </ChannelActivityRegion>,
    );
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Screen share' }), { key: 'ArrowRight' });
    expect(onSelect).toHaveBeenCalledWith('paint');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run src/components/ChannelActivityRegion/ChannelActivityRegion.test.tsx`
Expected: FAIL — component does not exist.

- [ ] **Step 3: Write the component**

```tsx
// src/Brmble.Web/src/components/ChannelActivityRegion/ChannelActivityRegion.tsx
import type { ReactNode } from 'react';
import type { ChannelActivityKind } from '../../workspace/channelActivity';
import styles from './ChannelActivityRegion.module.css';

interface ChannelActivityRegionProps {
  channelName: string;
  activities: { kind: ChannelActivityKind; label: string }[];
  stage: ChannelActivityKind | null;
  onSelect: (kind: ChannelActivityKind) => void;
  children: ReactNode;
}

export function ChannelActivityRegion({
  channelName,
  activities,
  stage,
  onSelect,
  children,
}: ChannelActivityRegionProps) {
  const move = (index: number, delta: number) => {
    const next = activities[(index + delta + activities.length) % activities.length];
    if (next) onSelect(next.kind);
  };

  return (
    <section className={styles.region} aria-label={`${channelName} activity`}>
      <header className={styles.header}>
        <span className={styles.channelName}>{channelName}</span>
        <div className={styles.chips} role="tablist" aria-label="Channel activities">
          {activities.map((activity, index) => (
            <button
              key={activity.kind}
              type="button"
              role="tab"
              aria-selected={stage === activity.kind}
              tabIndex={stage === activity.kind ? 0 : -1}
              className={`${styles.chip} ${stage === activity.kind ? styles.chipActive : ''}`}
              onClick={() => onSelect(activity.kind)}
              onKeyDown={event => {
                if (event.key === 'ArrowRight') { event.preventDefault(); move(index, 1); }
                if (event.key === 'ArrowLeft') { event.preventDefault(); move(index, -1); }
              }}
            >
              {activity.label}
            </button>
          ))}
        </div>
      </header>
      <div className={styles.stage}>{children}</div>
    </section>
  );
}
```

- [ ] **Step 4: Write the stylesheet and the token**

Add to the `:root` block of `src/Brmble.Web/src/index.css`, beside the other layout tokens:

```css
--activity-stage-min-height: 8rem;
```

```css
/* src/Brmble.Web/src/components/ChannelActivityRegion/ChannelActivityRegion.module.css */
.region { display: flex; flex: 1; flex-direction: column; min-height: 0; min-width: 0; overflow: hidden; }
.header { display: flex; align-items: center; gap: var(--space-xs); padding: var(--space-2xs) var(--space-sm); background: var(--bg-elevated); flex: none; }
.channelName { font-weight: 600; }
.chips { display: flex; gap: var(--space-2xs); flex-wrap: wrap; min-width: 0; }
.chip { padding: var(--space-2xs) var(--space-xs); border: none; border-radius: var(--radius-pill); background: var(--bg-subtle); color: var(--text-secondary); cursor: pointer; transition: background var(--transition-fast); }
.chip:hover { background: var(--bg-hover); }
.chip:focus-visible { outline: 2px solid var(--accent-primary); outline-offset: 2px; }
.chipActive { background: var(--accent-primary); color: var(--text-on-accent); }
.stage { flex: 1; min-height: var(--activity-stage-min-height); display: flex; min-width: 0; overflow: hidden; }
```

Use the exact token names present in `src/Brmble.Web/src/themes/_template.css`. If `--radius-pill`, `--bg-subtle`, `--bg-hover` or `--text-on-accent` are not defined there, substitute the nearest existing token rather than inventing a literal, and record the substitution in the commit message.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- --run src/components/ChannelActivityRegion/ChannelActivityRegion.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Web/src/components/ChannelActivityRegion src/Brmble.Web/src/index.css
git commit -m "feat: add the channel activity region"
```

---

## Task 13: Grace-Period Hide For Backgrounded Shares

When a share leaves the stage it stays subscribed for 10 seconds so quick switching is instant, then unsubscribes to stop decoding and downloading. Watched list, order, focus, receive quality, room membership and local publishing must be untouched throughout.

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useScreenShare.ts`
- Test: `src/Brmble.Web/src/hooks/useScreenShare.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `setRemoteScreenSharesHidden(hidden: boolean): void` on the `useScreenShare` return value, and the exported constant `REMOTE_HIDE_GRACE_MS = 10_000`.

- [ ] **Step 1: Write the failing test**

```ts
// added to src/Brmble.Web/src/hooks/useScreenShare.test.ts
import { REMOTE_HIDE_GRACE_MS } from './useScreenShare';

it('keeps a hidden share subscribed during the grace period', async () => {
  vi.useFakeTimers();
  const { result } = await connectedViewerAndPublisher({ focusedUserId: 10, quality: 'medium' });
  act(() => result.current.setRemoteScreenSharesHidden(true));
  act(() => { vi.advanceTimersByTime(REMOTE_HIDE_GRACE_MS - 1); });
  expect(publicationFor(10).setSubscribed).not.toHaveBeenCalledWith(false);
  vi.useRealTimers();
});

it('unsubscribes once the grace period elapses', async () => {
  vi.useFakeTimers();
  const { result } = await connectedViewerAndPublisher({ focusedUserId: 10, quality: 'medium' });
  act(() => result.current.setRemoteScreenSharesHidden(true));
  act(() => { vi.advanceTimersByTime(REMOTE_HIDE_GRACE_MS); });
  expect(publicationFor(10).setSubscribed).toHaveBeenCalledWith(false);
  vi.useRealTimers();
});

it('cancels the pending unsubscribe when the share returns to the stage', async () => {
  vi.useFakeTimers();
  const { result } = await connectedViewerAndPublisher({ focusedUserId: 10, quality: 'medium' });
  act(() => result.current.setRemoteScreenSharesHidden(true));
  act(() => { vi.advanceTimersByTime(REMOTE_HIDE_GRACE_MS - 1); });
  act(() => result.current.setRemoteScreenSharesHidden(false));
  act(() => { vi.advanceTimersByTime(REMOTE_HIDE_GRACE_MS); });
  expect(publicationFor(10).setSubscribed).not.toHaveBeenCalledWith(false);
  vi.useRealTimers();
});

it('preserves viewer state while hidden and after restoring', async () => {
  vi.useFakeTimers();
  const { result } = await connectedViewerAndPublisher({ focusedUserId: 10, quality: 'medium' });
  act(() => result.current.setRemoteScreenSharesHidden(true));
  act(() => { vi.advanceTimersByTime(REMOTE_HIDE_GRACE_MS); });
  expect(result.current.viewerQualities.get(10)).toBe('medium');
  expect(result.current.focusedShare?.userId).toBe(10);
  expect(result.current.watchingShares).toHaveLength(1);
  expect(mockRoom.disconnect).not.toHaveBeenCalled();
  expect(mockRoom.localParticipant.setScreenShareEnabled).not.toHaveBeenCalledWith(false);
  expect(result.current.isSharing).toBe(true);
  vi.useRealTimers();
});

it('drops a share that ended while hidden instead of resubscribing to it', async () => {
  vi.useFakeTimers();
  const { result } = await connectedViewerAndPublisher({ focusedUserId: 10, quality: 'medium' });
  act(() => result.current.setRemoteScreenSharesHidden(true));
  act(() => { vi.advanceTimersByTime(REMOTE_HIDE_GRACE_MS); });
  act(() => emitScreenShareStopped(10));
  act(() => result.current.setRemoteScreenSharesHidden(false));
  expect(result.current.watchingShares).toHaveLength(0);
  vi.useRealTimers();
});

it('immediately unsubscribes a share published while hidden', async () => {
  vi.useFakeTimers();
  const { result } = await connectedViewerAndPublisher({ focusedUserId: 10, quality: 'medium' });
  act(() => result.current.setRemoteScreenSharesHidden(true));
  act(() => { vi.advanceTimersByTime(REMOTE_HIDE_GRACE_MS); });
  act(() => emitTrackPublished(10, Track.Source.ScreenShare));
  expect(publicationFor(10).setSubscribed).toHaveBeenLastCalledWith(false);
  vi.useRealTimers();
});

it('clears the pending timer on unmount', async () => {
  vi.useFakeTimers();
  const { result, unmount } = await connectedViewerAndPublisher({ focusedUserId: 10, quality: 'medium' });
  act(() => result.current.setRemoteScreenSharesHidden(true));
  unmount();
  expect(() => vi.advanceTimersByTime(REMOTE_HIDE_GRACE_MS)).not.toThrow();
  vi.useRealTimers();
});
```

Extend the existing LiveKit mock in this file with `RoomEvent.TrackPublished` and helpers `publicationFor(userId)`, `emitTrackPublished(userId, source)` and `emitScreenShareStopped(userId)` if they are not already present.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run src/hooks/useScreenShare.test.ts`
Expected: FAIL — `setRemoteScreenSharesHidden` and `REMOTE_HIDE_GRACE_MS` do not exist.

- [ ] **Step 3: Implement the hide lifecycle**

```ts
export const REMOTE_HIDE_GRACE_MS = 10_000;
```

Add three refs beside the existing screen-share refs: `hiddenRef` (boolean target), `hideTimerRef` (`ReturnType<typeof setTimeout> | null`), and `hideGenerationRef` (number, incremented on every hide/restore and on room lifecycle reset). Reuse the existing `intentionalPublicationGenerationRef` pattern so a delayed `TrackUnsubscribed` from an older generation cannot remove logical state or disconnect the room.

```ts
const applyHidden = useCallback((hidden: boolean) => {
  hiddenRef.current = hidden;
  const generation = ++hideGenerationRef.current;
  if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null; }

  if (!hidden) {
    forEachWatchedScreenPublication((pub, share) => {
      intentionalPublicationGenerationRef.current.set(pub.trackSid, generation);
      pub.setSubscribed(true);
    });
    reconcileEndedShares();
    return;
  }

  hideTimerRef.current = setTimeout(() => {
    if (generation !== hideGenerationRef.current || !hiddenRef.current) return;
    forEachWatchedScreenPublication((pub, share) => {
      intentionalPublicationGenerationRef.current.set(pub.trackSid, generation);
      pub.setSubscribed(false);
      if (pub.source === Track.Source.ScreenShareAudio) detachRemoteAudio(share.userId);
    });
    setRemoteVideoEls(new Map());
  }, REMOTE_HIDE_GRACE_MS);
}, [forEachWatchedScreenPublication, detachRemoteAudio, reconcileEndedShares]);

const setRemoteScreenSharesHidden = useCallback((hidden: boolean) => {
  if (hiddenRef.current === hidden) return;
  applyHidden(hidden);
}, [applyHidden]);
```

In the `TrackPublished` and `TrackSubscribed` handlers, if `hiddenRef.current` is true and the grace period has already elapsed, stamp the SID with the current generation and call `setSubscribed(false)` instead of attaching. `screenShare.stopped` remains authoritative and removes logical state immediately regardless of hidden state. Clear `hideTimerRef` in the existing unmount cleanup and wherever the room lifecycle resets. No code path in this API may call `localParticipant.setScreenShareEnabled(false)`.

Export `setRemoteScreenSharesHidden` from the hook's return object.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run src/hooks/useScreenShare.test.ts src/components/ScreenShareGrid/ScreenShareGrid.test.tsx src/components/ScreenShareGrid/ScreenShareTile.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/hooks/useScreenShare.ts src/Brmble.Web/src/hooks/useScreenShare.test.ts
git commit -m "feat: hide backgrounded remote shares after a grace period"
```

---

## Task 14: One Splitter, One Activity Region

`ChatPanel` currently owns a second splitter for screen share. This task deletes it and moves screen share into the activity region, leaving exactly one split in the main panel.

**Files:**
- Modify: `src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx` (delete lines 66-67, 201-251, 253-254 gating, 889-921)
- Modify: `src/Brmble.Web/src/components/ChatPanel/ChatPanel.css` (delete the block at lines 450-472)
- Modify: `src/Brmble.Web/src/App.tsx`
- Test: `src/Brmble.Web/src/components/ChatPanel/ChatPanel.test.tsx`, `src/Brmble.Web/src/App.activityRegion.test.tsx` (create)

**Interfaces:**
- Consumes: `ChannelActivityRegion` (Task 12), `selectStage` (Task 11), `setRemoteScreenSharesHidden` (Task 13), `MainPanel` (Task 10).
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

```tsx
// src/Brmble.Web/src/App.activityRegion.test.tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderConnectedApp } from './testing/appHarness';

describe('channel activity region', () => {
  it('shows no region and no divider in a quiet channel', () => {
    renderConnectedApp({ joinedChannelId: '7' });
    expect(screen.queryByRole('region', { name: /activity/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
  });

  it('stages a screen share and offers paint as a chip', async () => {
    const user = userEvent.setup();
    const { screenShare } = renderConnectedApp({ joinedChannelId: '7', watchedShares: [shareFrom(10)], paintSessionId: 'p1' });
    expect(screen.getByRole('tab', { name: 'Screen share' })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('tab', { name: 'Paint' }));
    expect(screen.getByRole('tab', { name: 'Paint' })).toHaveAttribute('aria-selected', 'true');
    expect(screenShare.setRemoteScreenSharesHidden).toHaveBeenLastCalledWith(true);
  });

  it('restores the share when it returns to the stage', async () => {
    const user = userEvent.setup();
    const { screenShare } = renderConnectedApp({ joinedChannelId: '7', watchedShares: [shareFrom(10)], paintSessionId: 'p1' });
    await user.click(screen.getByRole('tab', { name: 'Paint' }));
    await user.click(screen.getByRole('tab', { name: 'Screen share' }));
    expect(screenShare.setRemoteScreenSharesHidden).toHaveBeenLastCalledWith(false);
  });

  it('never renders the activity region at server root', () => {
    renderConnectedApp({ joinedChannelId: 'server-root', watchedShares: [shareFrom(10)] });
    expect(screen.queryByRole('region', { name: /activity/ })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run src/App.activityRegion.test.tsx`
Expected: FAIL — the activity region is not wired and screen share still renders inside `ChatPanel`.

- [ ] **Step 3: Strip the splitter out of ChatPanel**

Delete from `ChatPanel.tsx`: `SPLIT_STORAGE_KEY` and `DEFAULT_SPLIT` (lines 66-67), the `splitPercent` state and `isDraggingRef` (lines 201-205), the drag handler (lines 223-251), the `hasScreenShare` gate (line 253), the `div.chat-split-video` and `div.chat-split-divider` render (lines 889-921). Delete the `.chat-split-video` / `.chat-split-divider` block from `ChatPanel.css` (lines 450-472).

Remove the now-unused screen-share props from `ChatPanelProps` (lines 34-43): `watchingShares`, `focusedShare`, `remoteVideoEls`, `roomQuality`, `shareQualities`, `viewerQualities`, `onFocusShare`, `onCloseShare`, `onViewerQualityChange`. Keep `screenShareViewerMode` and the `'new-window'` overlay path (lines 256-413) exactly as it is — the detached window is out of scope and must keep working.

Delete the corresponding assertions from `ChatPanel.test.tsx`, including any that reference the divider's `aria-valuemin`/`aria-valuemax`.

- [ ] **Step 4: Wire the region in App**

```tsx
const availableActivities = useMemo<ChannelActivityKind[]>(() => {
  const kinds: ChannelActivityKind[] = [];
  if (hasWatchableShare) kinds.push('screen-share');
  if (activePaintSessionId) kinds.push('paint');
  return kinds;
}, [hasWatchableShare, activePaintSessionId]);

const [explicitActivity, setExplicitActivity] = useState<ChannelActivityKind | null>(null);
const previousStageRef = useRef<ChannelActivityKind | null>(null);
const stage = selectStage({
  available: availableActivities,
  explicit: explicitActivity,
  previous: previousStageRef.current,
});
useEffect(() => { previousStageRef.current = stage; }, [stage]);

useEffect(() => {
  screenShare.setRemoteScreenSharesHidden(stage !== 'screen-share');
}, [stage, screenShare]);
```

The region renders only when `joinedChannelId` is a real channel and `availableActivities.length > 0`; otherwise pass `activityRegion={null}` to `MainPanel`, which already omits both pane and divider.

- [ ] **Step 5: Migrate the storage keys**

On first render, remove `brmble-paint-split` and `brmble-screenshare-split` from `localStorage`. Do not migrate their values; `brmble-main-split` starts at the 50% default because it now governs a different pair of surfaces.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- --run src/App.activityRegion.test.tsx src/components/ChatPanel/ChatPanel.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/Brmble.Web/src
git commit -m "refactor: move screen share into the channel activity region"
```

---

## Task 15: Conversation Tab Strip

**Files:**
- Create: `src/Brmble.Web/src/components/ConversationTabStrip/ConversationTabStrip.tsx`
- Create: `src/Brmble.Web/src/components/ConversationTabStrip/ConversationTabStrip.module.css`
- Test: `src/Brmble.Web/src/components/ConversationTabStrip/ConversationTabStrip.test.tsx`

**Interfaces:**
- Consumes: `Conversation`, `conversationKey` from Task 1.
- Produces: `ConversationTabStrip` with props:

```ts
interface ConversationTabItem {
  conversation: Conversation;
  key: string;              // conversationKey(conversation)
  label: string;            // channel name or contact display name
  isHome: boolean;
  unreadCount: number;      // 0 when none or unavailable
  mentionCount: number;
}

interface ConversationTabStripProps {
  tabs: ConversationTabItem[];
  activeKey: string | null;
  onActivate: (key: string) => void;
  onClose: (key: string) => void;
}
```

- [ ] **Step 1: Write the failing test**

```tsx
// src/Brmble.Web/src/components/ConversationTabStrip/ConversationTabStrip.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ConversationTabStrip } from './ConversationTabStrip';

const home = {
  conversation: { kind: 'channel' as const, channelId: '7' },
  key: 'channel:7', label: 'General', isHome: true, unreadCount: 0, mentionCount: 0,
};
const browsed = {
  conversation: { kind: 'channel' as const, channelId: '9' },
  key: 'channel:9', label: 'Random', isHome: false, unreadCount: 3, mentionCount: 0,
};
const contact = {
  conversation: { kind: 'dm' as const, contactId: 'a' },
  key: 'dm:a', label: 'Alice', isHome: false, unreadCount: 0, mentionCount: 1,
};

const renderStrip = (overrides = {}) => {
  const props = { tabs: [home, browsed, contact], activeKey: 'channel:7', onActivate: vi.fn(), onClose: vi.fn(), ...overrides };
  render(<ConversationTabStrip {...props} />);
  return props;
};

describe('ConversationTabStrip', () => {
  it('renders every tab with the home tab first and selected state', () => {
    renderStrip();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map(tab => tab.textContent)).toEqual([
      expect.stringContaining('General'),
      expect.stringContaining('Random'),
      expect.stringContaining('Alice'),
    ]);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('gives the home tab no close control', () => {
    renderStrip();
    expect(screen.queryByRole('button', { name: 'Close General' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close Random' })).toBeInTheDocument();
  });

  it('marks the home tab in its accessible name', () => {
    renderStrip();
    expect(screen.getByRole('tab', { name: /General \(you are here\)/ })).toBeInTheDocument();
  });

  it('activates on click', () => {
    const props = renderStrip();
    fireEvent.click(screen.getByRole('tab', { name: /Random/ }));
    expect(props.onActivate).toHaveBeenCalledWith('channel:9');
  });

  it('closes without activating', () => {
    const props = renderStrip();
    fireEvent.click(screen.getByRole('button', { name: 'Close Random' }));
    expect(props.onClose).toHaveBeenCalledWith('channel:9');
    expect(props.onActivate).not.toHaveBeenCalled();
  });

  it('shows unread and mention counts', () => {
    renderStrip();
    expect(screen.getByRole('tab', { name: /Random/ })).toHaveTextContent('3');
    expect(screen.getByRole('tab', { name: /Alice/ })).toHaveTextContent('@1');
  });

  it('hides a zero unread count', () => {
    renderStrip({ tabs: [home] });
    expect(screen.getByRole('tab', { name: /General/ })).not.toHaveTextContent('0');
  });

  it('moves between tabs with the arrow keys', () => {
    const props = renderStrip();
    fireEvent.keyDown(screen.getByRole('tab', { name: /General/ }), { key: 'ArrowRight' });
    expect(props.onActivate).toHaveBeenCalledWith('channel:9');
  });

  it('wraps at both ends', () => {
    const props = renderStrip({ activeKey: 'dm:a' });
    fireEvent.keyDown(screen.getByRole('tab', { name: /Alice/ }), { key: 'ArrowRight' });
    expect(props.onActivate).toHaveBeenCalledWith('channel:7');
  });

  it('closes the focused tab with Delete but never the home tab', () => {
    const props = renderStrip({ activeKey: 'channel:9' });
    fireEvent.keyDown(screen.getByRole('tab', { name: /Random/ }), { key: 'Delete' });
    expect(props.onClose).toHaveBeenCalledWith('channel:9');
    fireEvent.keyDown(screen.getByRole('tab', { name: /General/ }), { key: 'Delete' });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when there are no tabs', () => {
    render(<ConversationTabStrip tabs={[]} activeKey={null} onActivate={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run src/components/ConversationTabStrip/ConversationTabStrip.test.tsx`
Expected: FAIL — component does not exist.

- [ ] **Step 3: Write the component**

```tsx
// src/Brmble.Web/src/components/ConversationTabStrip/ConversationTabStrip.tsx
import type { Conversation } from '../../workspace/conversation';
import { Icon } from '../Icon/Icon';
import styles from './ConversationTabStrip.module.css';

export interface ConversationTabItem {
  conversation: Conversation;
  key: string;
  label: string;
  isHome: boolean;
  unreadCount: number;
  mentionCount: number;
}

interface ConversationTabStripProps {
  tabs: ConversationTabItem[];
  activeKey: string | null;
  onActivate: (key: string) => void;
  onClose: (key: string) => void;
}

export function ConversationTabStrip({ tabs, activeKey, onActivate, onClose }: ConversationTabStripProps) {
  if (tabs.length === 0) return null;

  const move = (index: number, delta: number) => {
    const next = tabs[(index + delta + tabs.length) % tabs.length];
    if (next) onActivate(next.key);
  };

  return (
    <div className={styles.strip} role="tablist" aria-label="Conversations">
      {tabs.map((tab, index) => (
        <div key={tab.key} className={`${styles.tab} ${activeKey === tab.key ? styles.active : ''} ${tab.isHome ? styles.home : ''}`}>
          <button
            type="button"
            role="tab"
            aria-selected={activeKey === tab.key}
            tabIndex={activeKey === tab.key ? 0 : -1}
            className={styles.label}
            onClick={() => onActivate(tab.key)}
            onKeyDown={event => {
              if (event.key === 'ArrowRight') { event.preventDefault(); move(index, 1); }
              if (event.key === 'ArrowLeft') { event.preventDefault(); move(index, -1); }
              if (event.key === 'Delete' && !tab.isHome) { event.preventDefault(); onClose(tab.key); }
            }}
          >
            <span className={styles.text}>{tab.label}</span>
            {tab.isHome && <span className="sr-only"> (you are here)</span>}
            {tab.mentionCount > 0 && <span className={styles.mention}>@{tab.mentionCount}</span>}
            {tab.mentionCount === 0 && tab.unreadCount > 0 && <span className={styles.unread}>{tab.unreadCount}</span>}
          </button>
          {!tab.isHome && (
            <button
              type="button"
              className={styles.close}
              aria-label={`Close ${tab.label}`}
              onClick={() => onClose(tab.key)}
            >
              <Icon name="x" size={10} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Write the stylesheet**

```css
/* src/Brmble.Web/src/components/ConversationTabStrip/ConversationTabStrip.module.css */
.strip { display: flex; align-items: stretch; gap: var(--space-2xs); padding: var(--space-2xs) var(--space-2xs) 0; background: var(--bg-elevated); flex: none; min-width: 0; }
.tab { display: flex; align-items: center; border-radius: var(--radius-md) var(--radius-md) 0 0; background: var(--bg-subtle); min-width: 0; }
.tab:hover { background: var(--bg-hover); }
.active { background: var(--bg-deep); font-weight: 600; }
.home { background: var(--bg-subtle); }
.label { display: flex; align-items: center; gap: var(--space-2xs); padding: var(--space-2xs) var(--space-xs); border: none; background: none; color: inherit; font: inherit; cursor: pointer; min-width: 0; }
.label:focus-visible { outline: 2px solid var(--accent-primary); outline-offset: -2px; }
.text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.unread, .mention { border-radius: var(--radius-pill); padding: 0 var(--space-2xs); font-size: var(--font-size-xs); }
.unread { background: var(--accent-danger); color: var(--text-on-accent); }
.mention { background: var(--accent-warning); color: var(--text-on-accent); }
.close { display: flex; align-items: center; border: none; background: none; color: var(--text-secondary); cursor: pointer; padding: 0 var(--space-2xs); }
.close:hover { color: var(--text-primary); }
.close:focus-visible { outline: 2px solid var(--accent-primary); outline-offset: -2px; }
```

Substitute the nearest existing token wherever one of these names is absent from `src/Brmble.Web/src/themes/_template.css`. Introduce no colour, size or radius literals.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- --run src/components/ConversationTabStrip/ConversationTabStrip.test.tsx`
Expected: PASS, 11 tests.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Web/src/components/ConversationTabStrip
git commit -m "feat: add the conversation tab strip"
```

---

## Task 16: Tab Strip Overflow

Labels shrink to a minimum legible width first; below that the strip scrolls, with the home tab pinned outside the scroll container so it never scrolls away.

**Files:**
- Modify: `src/Brmble.Web/src/components/ConversationTabStrip/ConversationTabStrip.tsx`
- Modify: `src/Brmble.Web/src/components/ConversationTabStrip/ConversationTabStrip.module.css`
- Modify: `src/Brmble.Web/src/index.css` (add `--conversation-tab-min-width`, `--conversation-tab-max-width`)
- Test: `src/Brmble.Web/src/components/ConversationTabStrip/ConversationTabStrip.overflow.test.tsx` (create)

**Interfaces:**
- Consumes: Task 15's props, unchanged. No new props.
- Produces: nothing new. Overflow is purely presentational.

- [ ] **Step 1: Write the failing test**

```tsx
// src/Brmble.Web/src/components/ConversationTabStrip/ConversationTabStrip.overflow.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ConversationTabStrip } from './ConversationTabStrip';

const tab = (n: number) => ({
  conversation: { kind: 'channel' as const, channelId: String(n) },
  key: `channel:${n}`, label: `channel-number-${n}`, isHome: false, unreadCount: 0, mentionCount: 0,
});
const home = {
  conversation: { kind: 'channel' as const, channelId: '0' },
  key: 'channel:0', label: 'General', isHome: true, unreadCount: 0, mentionCount: 0,
};

describe('ConversationTabStrip overflow', () => {
  it('keeps the home tab outside the scrolling container', () => {
    render(<ConversationTabStrip tabs={[home, ...Array.from({ length: 30 }, (_, i) => tab(i + 1))]}
      activeKey="channel:0" onActivate={vi.fn()} onClose={vi.fn()} />);
    const scroller = screen.getByTestId('conversation-tab-scroller');
    expect(within(scroller).queryByRole('tab', { name: /General/ })).not.toBeInTheDocument();
    expect(within(scroller).getAllByRole('tab')).toHaveLength(30);
  });

  it('exposes the scroller as horizontally scrollable and keyboard reachable', () => {
    render(<ConversationTabStrip tabs={[home, ...Array.from({ length: 30 }, (_, i) => tab(i + 1))]}
      activeKey="channel:0" onActivate={vi.fn()} onClose={vi.fn()} />);
    const scroller = screen.getByTestId('conversation-tab-scroller');
    expect(scroller).toHaveAttribute('tabindex', '0');
    expect(scroller).toHaveAttribute('aria-label', 'Scroll conversations');
  });

  it('truncates long labels rather than wrapping', () => {
    render(<ConversationTabStrip tabs={[home, tab(1)]} activeKey="channel:0" onActivate={vi.fn()} onClose={vi.fn()} />);
    const label = screen.getByText('channel-number-1');
    expect(label.className).toMatch(/text/);
  });

  it('still renders a single home tab without a scroller wrapper collapsing it', () => {
    render(<ConversationTabStrip tabs={[home]} activeKey="channel:0" onActivate={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('tab', { name: /General/ })).toBeInTheDocument();
    expect(within(screen.getByTestId('conversation-tab-scroller')).queryAllByRole('tab')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run src/components/ConversationTabStrip/ConversationTabStrip.overflow.test.tsx`
Expected: FAIL — there is no scroller element.

- [ ] **Step 3: Split the strip into pinned home and scroller**

Render the home tab, when present, as a direct child of `.strip`, and every other tab inside:

```tsx
<div
  className={styles.scroller}
  data-testid="conversation-tab-scroller"
  tabIndex={0}
  role="group"
  aria-label="Scroll conversations"
>
  {rest.map(/* … same tab markup … */)}
</div>
```

Keep one `role="tablist"` on the outer `.strip` so home and scrolled tabs remain a single tab set for assistive technology. Arrow-key movement continues to traverse the combined list, so `move` must index into `tabs`, not into `rest`.

- [ ] **Step 4: Add the tokens and the shrink rules**

Add to `:root` in `src/Brmble.Web/src/index.css`:

```css
--conversation-tab-min-width: 4.5rem;
--conversation-tab-max-width: 12rem;
```

```css
.scroller { display: flex; gap: var(--space-2xs); overflow-x: auto; scrollbar-width: thin; min-width: 0; flex: 1; }
.scroller:focus-visible { outline: 2px solid var(--accent-primary); outline-offset: -2px; }
.tab { flex: 0 1 auto; min-width: var(--conversation-tab-min-width); max-width: var(--conversation-tab-max-width); }
.active, .home { flex-shrink: 0.5; }
```

`flex: 0 1 auto` with a `min-width` produces exactly the specified behaviour: tabs shrink until they hit the minimum, after which the scroller overflows and scrolls.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- --run src/components/ConversationTabStrip`
Expected: PASS, all 15 tests across both files.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Web/src/components/ConversationTabStrip src/Brmble.Web/src/index.css
git commit -m "feat: shrink then scroll conversation tabs on overflow"
```

---

## Task 17: One ChatPanel, Driven By The Active Tab

This deletes the two-slide `.content-slider` and its transform animation. A single `ChatPanel` renders whatever the active tab points at, channel or DM.

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx` (render block, `App.tsx:4873-4949`)
- Modify: `src/Brmble.Web/src/App.css` (delete `.content-slider` / `.content-slide` rules at lines 70-93)
- Test: `src/Brmble.Web/src/App.conversationRegion.test.tsx` (create)

**Interfaces:**
- Consumes: `ConversationTabStrip` (Tasks 15–16), workspace tabs and `activeConversation` (Task 5), `MainPanel` (Task 10).
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

```tsx
// src/Brmble.Web/src/App.conversationRegion.test.tsx
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderConnectedApp } from './testing/appHarness';

describe('conversation region', () => {
  it('shows only the home tab on connect', () => {
    renderConnectedApp({ joinedChannelId: '7', channels: [{ id: 7, name: 'General' }] });
    expect(screen.getAllByRole('tab')).toHaveLength(1);
    expect(screen.getByRole('tab', { name: /General \(you are here\)/ })).toBeInTheDocument();
  });

  it('opens a tab when browsing another channel and switches the chat body', async () => {
    const user = userEvent.setup();
    renderConnectedApp({ joinedChannelId: '7', channels: [{ id: 7, name: 'General' }, { id: 9, name: 'Random' }] });
    await user.click(screen.getByRole('treeitem', { name: /Random/ }));
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getByRole('tab', { name: /Random/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByPlaceholderText('Message #Random')).toBeInTheDocument();
  });

  it('opens a dm in the same strip', async () => {
    const user = userEvent.setup();
    renderConnectedApp({ joinedChannelId: '7', dmContacts: [{ id: 'a', name: 'Alice' }] });
    await user.click(screen.getByRole('button', { name: /Alice/ }));
    expect(screen.getByRole('tab', { name: /Alice/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('replaces the home tab when the user moves voice channel', async () => {
    const { moveSelfToChannel } = renderConnectedApp({
      joinedChannelId: '7', channels: [{ id: 7, name: 'General' }, { id: 12, name: 'Gaming' }],
    });
    moveSelfToChannel(12);
    expect(screen.getByRole('tab', { name: /Gaming \(you are here\)/ })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /General/ })).not.toBeInTheDocument();
  });

  it('keeps browsed tabs across a voice channel move', async () => {
    const user = userEvent.setup();
    const { moveSelfToChannel } = renderConnectedApp({
      joinedChannelId: '7', channels: [{ id: 7, name: 'General' }, { id: 9, name: 'Random' }, { id: 12, name: 'Gaming' }],
    });
    await user.click(screen.getByRole('treeitem', { name: /Random/ }));
    moveSelfToChannel(12);
    expect(screen.getByRole('tab', { name: /Random/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Gaming \(you are here\)/ })).toBeInTheDocument();
  });

  it('closes a tab and falls back to a neighbour', async () => {
    const user = userEvent.setup();
    renderConnectedApp({ joinedChannelId: '7', channels: [{ id: 7, name: 'General' }, { id: 9, name: 'Random' }] });
    await user.click(screen.getByRole('treeitem', { name: /Random/ }));
    await user.click(screen.getByRole('button', { name: 'Close Random' }));
    expect(screen.queryByRole('tab', { name: /Random/ })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /General/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('restores persisted tabs on reconnect and drops invalid ones', () => {
    renderConnectedApp({
      joinedChannelId: '7',
      channels: [{ id: 7, name: 'General' }, { id: 9, name: 'Random' }],
      persistedTabs: [{ kind: 'channel', channelId: '9' }, { kind: 'channel', channelId: '404' }],
    });
    expect(screen.getByRole('tab', { name: /Random/ })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(2);
  });

  it('keeps a browsed channel writable when the server permits it', async () => {
    const user = userEvent.setup();
    renderConnectedApp({
      joinedChannelId: '7',
      channels: [{ id: 7, name: 'General' }, { id: 9, name: 'Random', canSendChat: true }],
    });
    await user.click(screen.getByRole('treeitem', { name: /Random/ }));
    expect(screen.getByPlaceholderText('Message #Random')).toBeEnabled();
  });

  it('blocks sending in a browsed channel the server disallows', async () => {
    const user = userEvent.setup();
    renderConnectedApp({
      joinedChannelId: '7',
      channels: [{ id: 7, name: 'General' }, { id: 9, name: 'Random', canSendChat: false }],
    });
    await user.click(screen.getByRole('treeitem', { name: /Random/ }));
    expect(screen.getByPlaceholderText('Message #Random')).toBeDisabled();
  });

  it('shows the root chat as the home tab at server root', () => {
    renderConnectedApp({ joinedChannelId: 'server-root', serverLabel: 'Brmble' });
    expect(screen.getByRole('tab', { name: /Brmble \(you are here\)/ })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /activity/ })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run src/App.conversationRegion.test.tsx`
Expected: FAIL — the tab strip is not rendered and the two-slide layout is still present.

- [ ] **Step 3: Build the conversation region**

Replace the `.content-slider` block with a single region composed of the strip and one `ChatPanel`:

```tsx
const conversationRegion = (
  <div className="conversation-region">
    <ConversationTabStrip
      tabs={conversationTabItems}
      activeKey={workspace.activeKey}
      onActivate={key => dispatchWorkspace({ type: 'ACTIVATE_CONVERSATION', key })}
      onClose={key => dispatchWorkspace({ type: 'CLOSE_CONVERSATION', key })}
    />
    <ChatPanel {...chatPanelPropsForActiveConversation} />
  </div>
);
```

`conversationTabItems` maps `workspace.tabs` to `ConversationTabItem`, resolving each label from `channels` or from the DM contact list, and marking `isHome` with `isHomeKey(workspace, key)`. A channel whose name cannot be resolved falls back to the channel id so a tab is never blank.

`chatPanelPropsForActiveConversation` selects between the existing channel props and the existing DM props based on `activeConversation.kind`. Both prop sets already exist at `App.tsx:4889-4919` and `App.tsx:4922-4948`; this task chooses between them instead of rendering both.

Delete `foregroundDmContact`, `foregroundDmMessages` (`App.tsx:1691-1704`), `showDmConversation`, `showChannelConversation`, `isDmMode`, and the `.content-slider` / `.content-slide` CSS. Remove the `aria-hidden` / `inert` handling with them — there is no longer a hidden slide.

`ChatPanel`'s `.chat-header` keeps its existing title. The presence signal now lives on the tab, not in the header, so no header change is required by this task.

- [ ] **Step 4: Wire tab creation to the existing entry points**

`handleSelectChannel` (`App.tsx:3428-3440`) dispatches `OPEN_CONVERSATION` with a channel conversation, retaining its `getChannelSelectionOutcome` permission check. `DMContactList`'s `onSelectContact` dispatches `OPEN_CONVERSATION` with a DM conversation. Neither joins voice; `onJoinChannel` is untouched.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- --run src/App.conversationRegion.test.tsx`
Expected: PASS, 11 tests.

The root-chat case relies on `canOpenChannelChat` and `canSendToChannelChat` already returning `true` for `'server-root'` (`App.tsx:696`, `App.tsx:703`). Root chat is not Matrix-backed — `getChannelMatrixRoomId` returns `null` for it (`App.tsx:719`) — so its tab has no unread badge source and must render no badge rather than a zero.

Run: `npm test -- --run`
Expected: PASS. Delete any remaining case that asserts slide transitions, `dm-active`, or `inert` slides.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Web/src
git commit -m "feat: render one chat panel driven by the active conversation tab"
```

---

## Task 18: Permanently Visible User Panel

**Files:**
- Modify: `src/Brmble.Web/src/components/DMContactList/DMContactList.tsx`
- Modify: `src/Brmble.Web/src/components/DMContactList/DMContactList.css`
- Modify: `src/Brmble.Web/src/App.tsx`, `src/Brmble.Web/src/App.css`
- Modify: `src/Brmble.Web/src/components/Header/Header.tsx` (remove the panel toggle control)
- Test: `src/Brmble.Web/src/components/DMContactList/DMContactList.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `DMContactList` loses its `visible` and `onToggleVisibility` props. Its remaining props are unchanged.

- [ ] **Step 1: Write the failing test**

```tsx
// added to src/Brmble.Web/src/components/DMContactList/DMContactList.test.tsx
it('renders without a visibility toggle', () => {
  render(<DMContactList {...props} />);
  expect(screen.queryByRole('button', { name: /Collapse Messages panel/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Expand Messages panel/ })).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Messages' })).toBeInTheDocument();
});

it('always shows unread counts', () => {
  render(<DMContactList {...props} contacts={[{ id: 'a', name: 'Alice', unreadCount: 4 }]} />);
  expect(screen.getByText('4')).toBeInTheDocument();
});

it('keeps unread counts in the narrow rail', () => {
  document.documentElement.style.setProperty('--force-narrow', '1');
  render(<DMContactList {...props} contacts={[{ id: 'a', name: 'Alice', unreadCount: 4 }]} />);
  expect(screen.getByText('4')).toBeInTheDocument();
  document.documentElement.style.removeProperty('--force-narrow');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run src/components/DMContactList/DMContactList.test.tsx`
Expected: FAIL — the toggle button still renders and `showUnread` still gates on `visible`.

- [ ] **Step 3: Remove the visibility model**

Delete the `visible` prop from `DMContactListProps` (line 16) and every use of it (lines 19, 44-51, 65, 93-94, 100). Delete `onToggleVisibility` and the header toggle button. Delete the `showUnread` gate so counts always render.

In `App.tsx` delete `messagesPanelExpanded`, `toggleMessagesPanel` (`App.tsx:1714-1717`), the `app-body--messages-collapsed` class (`App.tsx:4811`) and the `workspace-conversation--with-panel` modifier (`App.tsx:4855`), replacing them with a static three-column `.app-body` layout. Remove the corresponding Header prop and control.

- [ ] **Step 4: Add the width-driven rail**

In `DMContactList.css`, collapse the panel to a compact rail below a breakpoint. This is presentation only — no state, no toggle, no JavaScript:

```css
@media (max-width: 60rem) {
  .dm-contact-list { width: var(--dm-rail-width); }
  .dm-contact-list .dm-contact-name,
  .dm-contact-list .dm-contact-list-header h3,
  .dm-contact-list .dm-contact-search { display: none; }
  .dm-contact-list .dm-contact-unread { position: absolute; inset-block-start: 0; inset-inline-end: 0; }
}
```

Add `--dm-rail-width` to `:root` in `index.css` beside `--sidebar-width`. Each contact entry keeps an accessible name via `aria-label` so the rail remains usable when the visible text is hidden.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- --run src/components/DMContactList/DMContactList.test.tsx src/App.dmDirectoryBehavior.test.tsx`
Expected: PASS. Delete the cases in `App.dmDirectoryBehavior.test.tsx` that assert panel auto-collapse during remote watching and DM foreground fallback — both behaviours are intentionally gone.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Web/src
git commit -m "feat: keep the user panel permanently visible with a narrow rail"
```

---

## Task 19: One Badge Per Conversation

An unread conversation must be announced in exactly one place. Once it is open as a tab, the tab owns its badge and the sidebar row or contact entry goes quiet.

**Files:**
- Create: `src/Brmble.Web/src/workspace/unreadOwnership.ts`
- Test: `src/Brmble.Web/src/workspace/unreadOwnership.test.ts`
- Modify: `src/Brmble.Web/src/App.tsx` (the `channelUnreads` memo at `App.tsx:4302-4316` and `dmContactsWithUnreads` at `App.tsx:1759-1769`)

**Interfaces:**
- Consumes: `Conversation`, `conversationKey` from Task 1.
- Produces: `suppressOpenConversations<T>(entries: Map<string, T>, openKeys: Set<string>, keyOf: (id: string) => string): Map<string, T>` — returns a new map with every entry whose conversation is open removed. Aggregate counts such as the OS badge are computed *before* suppression and are unaffected.

- [ ] **Step 1: Write the failing test**

```ts
// src/Brmble.Web/src/workspace/unreadOwnership.test.ts
import { describe, expect, it } from 'vitest';
import { suppressOpenConversations } from './unreadOwnership';

describe('suppressOpenConversations', () => {
  const keyOf = (id: string) => `channel:${id}`;

  it('removes entries whose conversation is open', () => {
    const result = suppressOpenConversations(new Map([['7', 3], ['9', 1]]), new Set(['channel:7']), keyOf);
    expect([...result.keys()]).toEqual(['9']);
  });

  it('leaves everything when nothing is open', () => {
    const result = suppressOpenConversations(new Map([['7', 3]]), new Set(), keyOf);
    expect([...result.keys()]).toEqual(['7']);
  });

  it('does not mutate the input', () => {
    const input = new Map([['7', 3]]);
    suppressOpenConversations(input, new Set(['channel:7']), keyOf);
    expect(input.size).toBe(1);
  });

  it('returns an empty map when every conversation is open', () => {
    const result = suppressOpenConversations(new Map([['7', 3]]), new Set(['channel:7']), keyOf);
    expect(result.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run src/workspace/unreadOwnership.test.ts`
Expected: FAIL — cannot resolve `./unreadOwnership`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/Brmble.Web/src/workspace/unreadOwnership.ts
export function suppressOpenConversations<T>(
  entries: Map<string, T>,
  openKeys: Set<string>,
  keyOf: (id: string) => string,
): Map<string, T> {
  const result = new Map<string, T>();
  for (const [id, value] of entries) {
    if (openKeys.has(keyOf(id))) continue;
    result.set(id, value);
  }
  return result;
}
```

- [ ] **Step 4: Apply it at both badge sources**

In `App.tsx`, compute the open key set once:

```tsx
const openConversationKeys = useMemo(
  () => new Set(workspace.tabs.map(conversationKey)),
  [workspace.tabs],
);
```

Wrap `channelUnreads` before it is passed to `Sidebar` (`App.tsx:4837`):

```tsx
const sidebarChannelUnreads = suppressOpenConversations(
  channelUnreads, openConversationKeys, id => `channel:${id}`);
```

Do the same for the DM contact list, suppressing `unreadCount` for open contacts. Compute `totalDmUnreadCount` (`App.tsx:1747-1756`) and the OS badge (`App.tsx:3719`) from the **unsuppressed** values — the aggregate must still count conversations that happen to be open in a background tab.

Feed the unsuppressed per-conversation counts into `conversationTabItems` so the tab shows what the sidebar no longer does.

- [ ] **Step 5: Write the integration test**

```tsx
// added to src/Brmble.Web/src/App.conversationRegion.test.tsx
it('moves an unread badge from the sidebar to the tab when a conversation is opened', async () => {
  const user = userEvent.setup();
  renderConnectedApp({
    joinedChannelId: '7',
    channels: [{ id: 7, name: 'General' }, { id: 9, name: 'Random' }],
    unreads: { '9': { notificationCount: 3, highlightCount: 0 } },
  });
  expect(within(screen.getByRole('treeitem', { name: /Random/ })).getByText('3')).toBeInTheDocument();
  await user.click(screen.getByRole('treeitem', { name: /Random/ }));
  expect(within(screen.getByRole('treeitem', { name: /Random/ })).queryByText('3')).not.toBeInTheDocument();
  expect(screen.getByRole('tab', { name: /Random/ })).toBeInTheDocument();
});
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- --run src/workspace/unreadOwnership.test.ts src/App.conversationRegion.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/Brmble.Web/src
git commit -m "feat: give an open conversation tab sole ownership of its unread badge"
```

---

## Task 20: Documentation And Final Verification

**Files:**
- Modify: `docs/UI_GUIDE.md`

**Interfaces:**
- Consumes: everything.
- Produces: the patterns future UI work is required to follow.

- [ ] **Step 1: Add the Main Panel Region pattern**

Under Component Patterns, add `Main Panel Region Pattern` with these exact rules:

1. The main panel has exactly two modes. In `game` mode a single game surface fills it entirely — no activity chips, no tab strip, no chat. In `split` mode the channel activity region sits above the conversation region, separated by one `VerticalSplitPane` keyed `brmble-main-split`.
2. Game mode is entered by participating in a game, never by spectating one. Opening the solo idle game is participation.
3. The channel activity region is bound to the joined voice channel and to nothing else. It never renders at server root, and never renders when the channel has no activity — in that case the panel has no upper pane and no divider.
4. The activity region stages exactly one activity. Chips list everything live; the first activity to appear takes the stage, later arrivals never steal it, and an explicit chip click always wins.
5. A backgrounded screen share stays subscribed for a 10-second grace period, then unsubscribes. Watched list, order, focus, receive quality, room membership and local publishing are never changed by staging.
6. No component may introduce a second splitter inside the main panel.

- [ ] **Step 2: Add the Conversation Tab Strip pattern**

1. The strip is a single `role="tablist"`. The home tab is first, is derived from the joined voice channel, has no close control, and is pinned outside the scroll container.
2. Moving voice channel replaces the home tab. A browsed tab for the new channel is absorbed rather than duplicated. Presence never creates history.
3. Only an explicit click to read a channel or a user creates a tab, and every such click creates a permanent tab. There are no preview tabs.
4. Overflow shrinks labels to `--conversation-tab-min-width` with ellipsis, then scrolls horizontally.
5. An open conversation's unread badge lives on its tab; its sidebar row or contact entry shows nothing. Aggregate counts are computed before suppression.
6. Tabs persist per server and are validated on restore. The home tab is never restored from storage.

- [ ] **Step 3: Rewrite the affected existing sections**

Update `Vertical Split Pane Pattern` to state that the main panel has exactly one split and to name `brmble-main-split`. Update `Minigame Modal Pattern` to record that participant surfaces are full-panel and are not dialogs — they carry no `role="dialog"`, no `aria-modal`, and no overlay dismissal. Leave the temporary duel-queue-modal guidance in place; the follow-up minigame project retires it.

- [ ] **Step 4: Full verification**

Run, from `src/Brmble.Web`:

```bash
npx tsc -b --noEmit
npm run lint
npm test -- --run
npm run build
```

From the repository root:

```bash
dotnet build
dotnet test
```

Expected: all PASS. The .NET side is untouched by this plan; run it to prove that.

- [ ] **Step 5: Manual verification checklist**

Confirm by hand, since none of these are covered by automated tests:

- Drag the single divider; reload; the size persists.
- Start a paint session, click another channel to read it, confirm the canvas survives.
- Watch a screen share, browse another channel, confirm the share is still watchable.
- Switch from share to paint and back within 10 seconds; the picture returns instantly.
- Switch to paint, wait 15 seconds, switch back; the picture reacquires.
- Open the idle game; confirm it fills the panel and that paint underneath survives closing it.
- Narrow the window past the breakpoint; confirm the user panel becomes a rail and unread counts remain visible.
- Verify all of the above in Classic and Retro Terminal themes.

- [ ] **Step 6: Commit**

```bash
git add docs/UI_GUIDE.md
git commit -m "docs: document main panel region and conversation tab patterns"
```

---

## Self-Review Notes

Recorded so the executor knows these were considered rather than missed.

- **`currentChannelId` is deliberately retired in two stages.** Task 5 keeps it as a derived alias so the build survives; Task 17 removes the alias when the last consumer goes. Do not try to delete it in Task 5.
- **`ChannelActivityKind` will gain `'duel'`** in the follow-up minigame project. `selectStage` must stay agnostic — no member of the union may be special-cased.
- **The `'new-window'` screen-share overlay is untouched.** It bypasses React and the modal shell today and continues to; the grace-period logic applies only to in-app viewing.
- **Aggregate unread counts are computed before suppression.** Suppressing the OS badge for open tabs would hide activity while the window is not focused.
- **Task 3 intentionally leaves the tree red** until Task 5. The `tsc` run in Task 3 Step 5 exists to size the work, not to pass.
- **Two names in Task 10 must be confirmed against the codebase before use.** `activeGameMatch` stands for whatever `components/Games/useGameState.ts` exposes as the local user's current match, and `serverId` in Task 5 stands for the stable identifier of the connected server. Neither name is asserted to exist — read the source, use the real name, and do not invent a new state variable for either.
- **Test harness.** Tasks 14, 17 and 19 assume a `src/testing/appHarness.tsx` exposing `renderConnectedApp`. If no equivalent helper exists in the repository, build it as the first step of Task 14 rather than duplicating connection setup across three suites.
