# Main Panel Regions And Conversation Tabs — Design

Date: 2026-08-19
Status: Approved for planning
Branch: `feature/main-panel-regions`

## Problem

Brmble's main panel has no owner. Optional surfaces were added one at a time, each bringing its own splitter, and they now compete without coordination.

- Collaborative paint renders in a `VerticalSplitPane` **outside** `ChatPanel`, persisted under `brmble-paint-split`, bounded 20–80%.
- Screen share renders in `.chat-split-video` **inside** `ChatPanel`, persisted under `brmble-screenshare-split`, bounded 20–80%.
- Chat messages are `flex: 1` — the residual, and therefore the surface that always loses.

The two splitters nest. With both dragged to their maximum, chat receives roughly 4% of the panel minus header and input. Both panes additionally carry hard floors (`min-height: 100px` and `calc(var(--space-3xl) * 2)`) that can exceed their own percentage allocation. Adding a duel or spectator surface would introduce a third uncoordinated competitor.

Underneath the layout problem is a modelling problem. The UI has exactly one channel identity, `currentChannelId` (`App.tsx:1032`), and it means the **viewed** channel. The joined voice channel has no state at all; it is re-derived ad hoc as `users.find(u => u.self)?.channelId` (`App.tsx:4340`). The workspace reducer's foreground variant, `{ kind: 'channel' }` (`workspace/workspaceState.ts:2`), carries no channel id whatsoever.

Features consequently bind to whichever identity their author reached for, producing four live defects:

| Site | Binds to | Defect |
|---|---|---|
| Paint survival guard `App.tsx:1371-1379` | viewed | Browsing another channel silently closes a live paint canvas |
| Share watch + discovery `App.tsx:477`, `App.tsx:4432-4437` | viewed | After clicking another channel you can no longer watch your own channel's share, although you can still publish into it |
| Challenge context item `ChannelTree.tsx:635-651` | viewed | Offered where `DuelOrchestrator.cs:121-125` will reject it; hidden where it would succeed |
| Sidebar current highlight `ChannelTree.tsx:285` | viewed | No pixel anywhere in the app indicates which channel the user is actually in |

## Goal

Give the main panel a single owner built on an explicit distinction between **presence** (the channel you are in) and **conversation** (what you are reading), and land it as one PR.

## Non-goals

Deliberately excluded, to be built on top of this work in a later project:

- `SpectatorService`, privacy-safe `SpectatorView` on `IGameEngine`, and spectator boards
- The duel activity chip, `DuelActivity`, and retirement of `DuelQueueModal`
- Arena Knockoff and the continuous-simulation runtime
- Tiling more than one activity simultaneously
- Persisting open tabs across sessions

Note that `docs/superpowers/plans/2026-07-25-generic-spectator-and-foreground-activity.md` must not be executed as written. Its server half survives into the follow-up project largely intact; its client half — the foreground hook, the `ChatPanel` slot, and screen-share pause/restore — is superseded by this design. That plan predates collaborative paint entirely.

---

## Architecture

### 1. State model

Two named concepts replace the single overloaded `currentChannelId`.

**Presence.** `joinedChannelId` is promoted from an ad-hoc derivation into one named selector. Every presence-bound feature reads only this value.

**Conversation.** An explicit open-tab model owned by `workspace/workspaceState.ts`:

```ts
type Conversation =
  | { kind: 'channel'; channelId: string }
  | { kind: 'dm'; contactId: string };

interface ConversationState {
  conversations: Conversation[];   // [0] is the home tab when one exists
  activeConversation: Conversation;
}
```

`conversations[0]` is the home tab, derived from `joinedChannelId`. It is marked, has no close control, and is pinned outside the scroll container. All later entries were opened by an explicit click.

Removed from the reducer: `foreground`, `messagesPanelExpanded`, `previousContent`, `remoteWatchCount`, and the events `TOGGLE_MESSAGES_PANEL`, `OPEN_MESSAGES_PANEL`, `REMOTE_WATCH_COUNT_CHANGED`, `SELECT_CHANNEL`, `SELECT_DM`, `SELECTED_DM_INVALIDATED`.

Added: `JOINED_CHANNEL_CHANGED`, `OPEN_CONVERSATION`, `CLOSE_CONVERSATION`, `ACTIVATE_CONVERSATION`, `CONVERSATION_INVALIDATED`.

**Rebinds.** Paint survival, share watching and discovery, and challenge-menu eligibility all move to `joinedChannelId`. The sidebar renders two distinct signals: an active-conversation highlight and a separate presence marker for the joined channel.

**Server root.** At `channelId === 0` / `'server-root'` there is no channel chat. No home tab exists in that state; the strip contains only browsed tabs, and may be empty.

### 2. Main panel modes

**Game mode** occupies the entire main panel: no activity chips, no tab strip, no chat. It is entered by opening the Neon-D solo idle game, or by *participating* in a channel minigame.

This brings existing surfaces into scope. `DeathrollModal` and `RpsModal` are modal overlays today and become the fullscreen game surface. `NeonDGame` already replaces `<main>` (`App.tsx:4870`) but does so as a special case governed by three ad-hoc suppression rules; it becomes an ordinary instance of this mode.

Game mode is exited when the match reaches a terminal state or the player forfeits, or when the user closes Neon-D. On exit the panel returns to split mode with the activity region and tab strip in the state they held before entry; a paint session or screen share that was live continues running underneath and is restored, not torn down. The existing rule where an active paint session suppresses Neon-D (`App.tsx:4870`) is removed — game mode simply takes precedence.

Accepted cost: chat is unavailable while playing. Voice is unaffected.

**Split mode** renders the channel activity region above the conversation region, separated by one divider.

A single splitter replaces two. `brmble-paint-split` and `brmble-screenshare-split` are retired in favour of one key, defaulting to 50%, bounded 20–80%. The surviving implementation is `VerticalSplitPane`; `ChatPanel`'s bespoke splitter is deleted along with its defects — mouse rather than pointer events, `aria-valuemin=0 / aria-valuemax=100` against true bounds of 20/80, no `:focus-visible` style, no clamp on read, and hardcoded `100px` / `4px` values that violate the token rule.

When the joined channel has no activity the region does not render at all and chat receives the full panel.

### 3. Channel activity region

A header showing the joined channel and one chip per live activity, above a stage rendering exactly one activity.

Chips in this PR: **screen share** and **paint**. The duel chip requires `SpectatorService`, which does not exist, and belongs to the follow-up project.

Focus rules:

- The first activity to appear takes the stage.
- Later activities light a chip but never steal the stage.
- An explicit chip click always wins.

A backgrounded screen share stays subscribed for a grace period of 10 seconds, defined as a single named constant, so quick switching is instant; after that it unsubscribes to stop decoding and downloading a stream nobody is watching. Restoration reconciles shares that ended while hidden. Watched list, order, focus, receive quality, room membership and local publishing are never altered by this mechanism.

### 4. Conversation region

A tab strip above a single `ChatPanel` instance.

**Identity and dedupe.** Channel tabs key on `channelId`, DM tabs on `contactId`. Clicking an already-open conversation activates its tab instead of duplicating it.

**Home retarget.** When `joinedChannelId` changes, the home slot retargets to the new channel. If that channel was already open as a browsed tab it is absorbed into home rather than appearing twice. The previous home is dropped: presence retargets the pinned slot and never creates history.

**Tab creation.** Only an explicit click to read a channel or a user creates a tab. Every such click creates a permanent tab; there are no preview tabs.

**Overflow.** Labels shrink toward a minimum legible width with ellipsis, with the active and home tabs retaining more width than the rest. Below that minimum, shrinking stops and the strip scrolls horizontally. The home tab is pinned outside the scroll container. Counts of off-screen unread are surfaced on the scroll affordances.

**Unread.** Once a conversation is open as a tab its badge lives on the tab and the corresponding sidebar row or user-panel entry goes quiet, so each unread conversation is announced in exactly one place. The active tab marks read; background tabs accumulate. Mention badges retain their distinct treatment.

**Closing** a tab activates the right neighbour, else the left, else home.

**Invalidation.** `CONVERSATION_INVALIDATED` closes a tab whose conversation is no longer readable — a channel removed, chat permission lost per `canOpenChannelChat`, or a DM contact closed. If the invalidated tab was active, activation falls through to the same neighbour rule. Invalidating the joined channel is not possible; a channel removal moves the user, which retargets home instead.

**Sending.** A browsed channel tab remains writable wherever `canOpenChannelChat` allows it today. Reading a channel you are not in does not restrict sending, and this design does not change that.

**Accessibility.** `role="tablist"` with roving tabindex and arrow-key navigation; close controls reachable from the keyboard. This replaces `.content-slider`, so the 400ms slide transition that `ChatPanel` scroll restoration currently has to outlast is removed.

**Persistence.** Tabs are session-only and reset to home on disconnect.

### 5. DM merge and the right panel

`.content-slider` and its two `.content-slide` children are deleted. One `ChatPanel` instance renders whatever `activeConversation` points at, channel or DM.

`DMContactList` becomes permanently visible alongside the channel tree, exactly as the left sidebar is, and ceases to be a reading surface — clicking a contact opens a tab. Its `visible` prop, expand/collapse control, and visibility-driven focus effects are removed. `dmStore.selectedContact` collapses into the tab model, taking `foregroundDmContact` and `foregroundDmMessages` with it; those exist only to keep an outgoing slide rendering during a transition that no longer occurs.

---

## Design tokens and documentation

New tokens are required for stage minimum height and tab minimum width. No hardcoded colours, sizes, spacing, radii or transitions are introduced; the existing `min-height: 100px` violation is removed rather than replicated.

`docs/UI_GUIDE.md` gains a Main Panel Region pattern, a Conversation Tab Strip pattern, and a Game Takeover pattern. Its existing Vertical Split Pane Pattern and Minigame Modal Pattern sections are rewritten, and the temporary duel-queue-modal guidance is left in place until the follow-up project retires it.

## Testing

- Reducer tests covering every tab operation, home retarget, absorb-on-retarget, close-neighbour selection, and server-root behaviour.
- Tab strip component tests for shrink, scroll, close, unread and mention badges, and keyboard navigation.
- `VerticalSplitPane` consumer tests for the single main-panel split, including the removal of the old keys.
- Screen-share tests for grace-period unsubscribe, restoration, and reconciliation of shares that ended while hidden, asserting that watched list, focus, quality, room membership and local publishing are untouched.
- Game mode tests confirming Neon-D and an active Deathroll or RPS match take the full main panel.
- Integration tests asserting the three defects directly: browsing another channel does not close paint; the joined channel's share remains watchable while reading elsewhere; the challenge item appears exactly where the server would accept it.

## Risks

The change runs through the centre of `App.tsx`, which is 5,545 lines and owns nearly all affected state. The agreed mitigation is strict internal ordering within the single PR: the state model and rebinds land and go green before any layout moves, then the regions, then the tab strip and DM merge.

Removing `DMContactList`'s collapse behaviour permanently widens the app's minimum comfortable width. Responsive behaviour at narrow widths must be verified, including Classic and Retro Terminal themes.

## Decisions recorded

| Decision | Choice |
|---|---|
| Activity region binding | Always the joined voice channel |
| Activities on screen at once | Exactly one; chips switch |
| Conversation surface | Tab strip |
| DMs in the strip | Yes; content-slider removed |
| Home tab on channel move | Replaced, not demoted |
| Game participation | Fills the entire main panel |
| Right user panel | Always visible; toggle removed |
| Preview tabs | No; every click opens a permanent tab |
| Backgrounded share | Grace period, then unsubscribe |
| Unread badges | Tab wins once the conversation is open |
| PR shape | One PR, strictly ordered internally |
