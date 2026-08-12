# Brmble UI Contributor Guide

Audience: AI agents (Claude sessions) and human contributors building Brmble UI.
Format: Flat rulebook. Numbered rules, tables, do/don't examples. No fluff.

---

## 1. Quick Reference

| Resource | Path | Contents |
|---|---|---|
| Global tokens | `src/Brmble.Web/src/index.css` | 41 `:root` tokens (spacing, font sizes, layout, transitions, animations, heading scale) |
| Heading classes | `src/Brmble.Web/src/styles/headings.css` | 3-tier heading system |
| Theme template | `src/Brmble.Web/src/themes/_template.css` | 73 per-theme token slots with derivation formulas |
| Icon component | `src/Brmble.Web/src/components/Icon/Icon.tsx` | Centralized icon map + `<Icon>` component |

### Heading Classes (Quick)

| Class | Element | Size | Use |
|---|---|---|---|
| `.heading-title` | `<h2>` | 28px | Page titles, modal titles |
| `.heading-section` | `<h3>` | 18px | Uppercase section headers |
| `.heading-label` | `<h4>` | 10px | Uppercase italic sidebar labels |

### The Absolute Rule

**Never hardcode colors, font sizes, font families, spacing, border radius, shadows, or transition values. Always use CSS custom property tokens.**

### AI Agent UI Gate

Treat a task as UI work if it creates, changes, styles, or reviews anything user-visible. This includes prompts, confirmations, notifications, settings rows, help text, tooltips, empty/loading/error states, icons, screen share surfaces, sidebar rows, and copy inside UI components.

Before changing UI code:
1. Find the matching pattern in this guide.
2. Use the existing component/pattern rather than inventing a new one.
3. If no matching pattern exists, update this guide in the same branch before or alongside the UI change.

Do not create new UI systems, one-off component patterns, ad-hoc CSS, native browser dialogs, toast components, or hardcoded visual values.

---

## 2. Token System Rules

All visual properties must come from CSS custom properties. Two layers exist:

### Layer 1: Global Tokens (41 in `:root`, `index.css`)

| Group | Tokens | Range |
|---|---|---|
| Spacing | `--space-2xs` through `--space-3xl` | 4px - 64px (8 tokens) |
| Font sizes | `--text-2xs` through `--text-4xl` | 10px - 40px (9 tokens) |
| Layout | `--sidebar-width`, `--header-height`, component layout tokens | Shared layout dimensions and component-specific widths |
| Transitions | `--transition-fast`, `--transition-normal`, `--transition-slow` | 150ms, 250ms, 400ms (3 tokens) |
| Entrance animations | `--animation-fast/normal/slow`, `--stagger-step` | 150ms, 300ms, 400ms, 50ms (4 tokens) |
| Continuous animations | `--animation-blink` through `--animation-heartbeat` | 0.5s - 4s (9 tokens) |
| Heading scale | `--heading-title-size/color`, `--heading-section-size/color`, `--heading-label-size/color` | (6 tokens) |

### Layer 2: Per-Theme Tokens (73 in `_template.css`)

| Group | Count | Prefix |
|---|---|---|
| Backgrounds | 12 | `--bg-*` |
| Primary accent | 7 | `--accent-primary*` |
| Secondary accent | 3 | `--accent-secondary*` |
| Success accent | 3 | `--accent-success*` |
| Decorative accent | 4 | `--accent-decorative*`, `--bg-avatar-*` |
| Danger accent | 6 | `--accent-danger*` |
| Status | 1 | `--status-connected` |
| Text | 7 | `--text-*` |
| Borders & effects | 2 | `--border-*` |
| Glass | 3 | `--glass-*` |
| Shadows | 3 | `--shadow-*` |
| Glow | 3 | `--glow-*` |
| Border radius | 6 | `--radius-*` |
| Typography | 3 | `--font-*` |
| Heading scale | 6 | `--heading-*` |
| Theme features | 4 | `--theme-*` |

### Semantic Naming Convention

| Prefix | Purpose |
|---|---|
| `--bg-*` | Background colors and overlays |
| `--text-*` | Text colors |
| `--accent-*` | Accent colors (primary, secondary, success, danger, decorative) |
| `--radius-*` | Border radius values |
| `--space-*` | Spacing (padding, margin, gap) |
| `--transition-*` | Transition timing |
| `--glass-*` | Glass/frosted panel effects |
| `--shadow-*` | Box shadows and drop shadows |
| `--glow-*` | Glow spread radius |

### Do / Don't

| Don't | Do |
|---|---|
| `color: #f5f0e8` | `color: var(--text-primary)` |
| `background: rgba(61, 42, 92, 0.15)` | `background: var(--bg-surface)` |
| `border-radius: 8px` | `border-radius: var(--radius-md)` |
| `font-family: 'Cormorant Garamond'` | `font-family: var(--font-display)` |
| `transition: 150ms ease` | `transition: var(--transition-fast)` |
| `padding: 1rem` | `padding: var(--space-md)` |
| `box-shadow: 0 8px 32px rgba(0,0,0,0.4)` | `box-shadow: var(--shadow-elevated)` |

---

## 3. Heading System

Reference: `src/Brmble.Web/src/styles/headings.css`

### Tiers

| Tier | Class | Element | Size Token | Color Token | Style |
|---|---|---|---|---|---|
| Title | `.heading-title` | `<h2>` | `--heading-title-size` (28px) | `--heading-title-color` | `letter-spacing: 0.02em` |
| Section | `.heading-section` | `<h3>` | `--heading-section-size` (18px) | `--heading-section-color` | `text-transform: uppercase; letter-spacing: 0.05em` |
| Label | `.heading-label` | `<h4>` | `--heading-label-size` (10px) | `--heading-label-color` | `text-transform: uppercase; letter-spacing: 0.18em; font-style: italic` |

### Shared Properties (All Tiers)

```css
font-family: var(--font-display);
font-weight: 600;
margin: 0;
```

### Usage Pattern

Heading classes are combined with component-specific classes for spacing and positioning:

```jsx
<h2 className="heading-title modal-title">Settings</h2>
<h3 className="heading-section settings-section-title">Input</h3>
<h4 className="heading-label">Channels</h4>
```

### Exclusions (NOT Part of the Heading System)

- `.header-logo` in `Header.tsx` -- uses CSS gradient text fill, standalone branding element
- `.user-info-label` in `UserInfoDialog.tsx` -- form field label for volume/mute/comment, not a structural heading

---

## 4. Component Patterns

### Modal Pattern

Reference: `ConnectModal.tsx`, `SettingsModal.tsx`

```
div.modal-overlay
  div.[modal-name].glass-panel.animate-slide-up
    button.modal-close  (optional, SVG X icon)
    div.modal-header
      h2.heading-title.modal-title
      p.modal-subtitle
    [content area - form, tabs, etc.]
    div.[modal]-footer
      button.btn.btn-primary
```

Rules:
1. Overlay uses `div.modal-overlay` with `onClick={onClose}`
2. Modal container always has `.glass-panel.animate-slide-up`
3. Content area stops propagation: `onClick={(e) => e.stopPropagation()}`
4. Title is always `h2.heading-title.modal-title`

### Collaborative Paint Pattern

Reference: `components/Paint/`

Collaborative paint opens above channel chat and keeps the chat pane mounted. The header entry
point is an icon-only `btn btn-ghost btn-icon` using the `palette` icon. It is disabled whenever
the user cannot start paint **or** a paint session is already active; wrap the disabled button in
`Tooltip` so its active-session explanation remains available.

The paint editor uses the standard button classes: Undo is `btn-secondary`, Clear and End are
`btn-danger`, and Save to chat is `btn-primary`. Every action button uses `type="button"`.

Paint colors are a deliberate exception to the theme-color rule: swatches display the exact,
fixed palette value sent with the stroke so collaborators see the color that will be drawn.
Set each swatch's `--paint-swatch-color` from `PAINT_COLORS` and use that property for its
background. Do not substitute theme surface or accent tokens for a swatch's displayed color.
The fixed palette is White (`#ffffff`), Ink (`#111827`), Red (`#ef4444`), Amber (`#f59e0b`),
Green (`#22c55e`), and Blue (`#4ec9ff`); supported stroke widths are 3px, 6px, and 12px.

The paint setup dialog follows the shared modal shell and adds these accessibility requirements:

1. Move focus to the Cancel button on open and keep Tab / Shift+Tab focus within the dialog.
2. Escape and overlay click call the same cancel/close callback; the dialog content stops overlay propagation.
3. Cancel remains a visible `btn-secondary` button and Start paint is the `btn-primary` action.
4. Keep `role="dialog"`, `aria-modal="true"`, and an accessible dialog label.

### Vertical Split Pane Pattern

Reference: `components/VerticalSplitPane/VerticalSplitPane.tsx`

Use `VerticalSplitPane` when an optional top surface (such as paint) shares a vertical workspace
with a persistent lower surface (such as chat). Pass `top={null}` to hide the upper pane without
unmounting the lower content. Provide a descriptive `label` for the horizontal separator and a
stable `storageKey` so the 20-80% split persists locally.

The divider supports ArrowUp / ArrowDown keyboard resizing in 5% steps. Pointer drags must release
their document listeners on pointerup, pointercancel, window blur, and component unmount; do not
duplicate this listener lifecycle in a consumer.

### Minigame Modal Pattern

Reference: `components/Games/DeathrollModal.tsx`, `DeathrollModal.module.css`,
`components/Games/RpsModal.tsx`, `RpsModal.module.css`

Real-time minigame modals (e.g. Deathroll, Rock Paper Scissors) reuse the shared modal shell —
global `div.modal-overlay`, `.glass-panel.animate-slide-up`, `.modal-close`, `.modal-header`,
`h2.heading-title.modal-title` — and add game-specific content styling via a colocated
CSS module (`*.module.css`). Do not build a bespoke overlay/positioning system.

Each game gets its **own** modal component (Deathroll and RPS do not share a body). The
`view` prop is the generic `GameView` union from `useGameState`; each modal narrows it to its
own shape with the `isRpsView` guard and ignores views it doesn't understand. App picks which
modal to render from `activeMatch?.gameType ?? ended?.gameType`.

Rules:
1. Reuse the shared modal shell classes above; only game-board content (player rows,
   stat tiles, countdown bar, pick buttons, result banner) lives in the CSS module.
2. All module CSS uses tokens (`--bg-surface`, `--glass-border`, `--accent-primary`,
   `--radius-*`, `--space-*`, `--text-*`, `--font-*`) — no hardcoded visual values.
3. Turn countdowns render as a token-styled shrinking bar plus a seconds label; drive
   them with a local `setInterval` and clear it on unmount/when the match ends. The
   bar's window length comes from the server (`turnMs`), not a hardcoded constant, so
   escalation phases (e.g. Deathroll's 5s timeout-penalty turns) shrink correctly. In
   an escalation/penalty phase (`penalty` flag), swap the bar, seconds label, and the
   escalating stat (ceiling) to the danger tokens (`--accent-danger`,
   `--accent-danger-text`) to signal urgency — never hardcode a red value.
4. Action buttons use the shared `.btn` classes (`btn-primary` for the main action,
   `btn-danger` for forfeit). Disable the primary action when it is not the local
   player's turn.
5. **Simultaneous-commit games (RPS):** both players act at once, so there is no "your
   turn" gate — instead disable the pick buttons once the local player has committed
   (`myPick` set) and show a "waiting for opponent" hint. Keep the opponent's choice
   hidden (`opponentPicked` boolean only) until the round resolves (`lastRound`), then
   reveal both picks and the round outcome. Show running round wins against
   `targetWins` / `bestOf`. Pick buttons use `btn-secondary` at rest and `btn-primary`
   when selected (plus `aria-pressed`), each with its own choice icon (`rps-rock`,
   `rps-paper`, `rps-scissors`) so the options read as distinct, clickable controls.
6. **Reveal suspense (simultaneous-commit games):** a resolved round arrives instantly
   from the server (and, on the deciding round, `game.ended` immediately after — which
   nulls the view). Don't reveal the result raw. Freeze the pre-resolution board, run a
   short token-styled `3…2…1` countdown in the status area, then reveal the updated
   score, `lastRound`, and — only after the countdown — the end result banner. Gate this
   with local state (the raw `view` prop is the source of truth; a `display` copy lags
   during the reveal). Key the modal on the match id in App so this reveal state resets
   between matches.
7. A modal may show a **Head-to-head** panel (see the Head-to-head pattern) below the
   result, scoped to the current opponent.

### Minigame Invite Pattern

Incoming minigame invites use the shared top-right `<Notification>` + `useNotificationQueue`
(status `info`). The single primary action button is Accept; the `×` dismiss declines the
invite (`onDismiss` → decline). Do not add a separate "Decline" text button — `×` is the
decline affordance, per the Notification rules. Register the invite under a stable queue id
(`game-invite`) and unregister it from `onExited`.

The invite notification uses `duration={null}` — it has NO client auto-dismiss timer and
does NOT extend on hover. The server owns the 30s invite window and removes the invite by
emitting `game.expired` at timeout (distinct from `game.declined` when the recipient presses
`×`). Do not re-add a client-side timer to this notification.

The invite notification passes `countdownMs` (from the server `game.invited` payload's
`inviteMs`) to `<Notification>`. This renders a **visual-only** shrinking progress bar showing
the remaining accept window. It is purely cosmetic: it never auto-dismisses, never pauses on
hover, and never triggers `onDismiss` (which would decline). The server remains the sole owner
of the timeout via `game.expired`. Use `countdownMs` (not `duration`) whenever a notification
needs a visible countdown without client-side dismissal.

The per-user "Challenge to a duel" entry point is a `ContextMenu` item on the user row
(same menu as Direct Message / User Info), shown only when the target `isBrmbleClient` and
shares the local user's voice channel. It is a submenu of game types: **Deathroll** challenges
immediately; **Rock Paper Scissors** opens a further "Best of 3 / 5 / 7" submenu, each option
inviting with that best-of length (`invite(session, 'rps', { bestOf })`). The menu is assembled
by the shared `buildChallengeMenuItem` helper (`components/Games/challengeMenu.tsx`) and reused
by both `Sidebar` and `ChannelTree` — add new games there so both user-row menus stay in sync.

A player may only be queued or in one live game at a time, and the server refuses the
challenge if either side already holds a duel commitment. The entry is therefore rendered
**disabled** (`ContextMenuItem.disabled`, no `children`, so no empty flyout) when either
player is committed, and its label states the reason: `You're in a duel` when the local
player is the blocker (this takes precedence, since it blocks every challenge), otherwise
`<name> is in a duel`. Committed sessions come from the queue snapshot via
`collectCommittedSessions` (`components/Games/committedSessions.ts`) and are threaded down
as `committedDuelSessions` alongside `duelChannelIds`.

#### Challenger pending-invite notification

While an outgoing challenge is awaiting an answer, the challenger sees a single `info`
notification under the queue id `game-pending` (driven by `useGameState.outgoingInvite`), with a
`btn-danger` **Cancel** action that withdraws the challenge (`cancelInvite`). Like the incoming
invite it uses `duration={null}` + `countdownMs` (the server owns the window) — never a
client-side timer. `×`/Cancel both cancel. The matchId needed to cancel arrives from the
server's `game.invitePending` event (the fire-and-forget WebView invite can't return it).

#### Project 1 Duel Queue Pattern

The server allows only one live duel per channel. During project 1, a channel with an active duel
(including `starting`), ready check, or non-empty accepted-pair queue shows a swords badge button
(`<Icon name="swords">`, `--accent-primary`) in the channel row. App derives `duelChannelIds` from
complete `game.queueSnapshot` replacements and clears them on voice disconnect; do not use the old
`game.duelState` event or `channelBusy` UI state. Keep the button next to the access-lock icon and do
not invent a new row-status container. Activating it opens that channel's duel activity without
selecting or joining the channel.

Project 1's duel activity surface is a temporary shared modal using the standard token-styled modal
shell. It contains metadata only: active/starting pair, ready-check state, accepted pairs in server
order, game display name, format, and the server-provided static ETA (`About …` or exactly
`Unknown`). It does not locally decrement or derive ETAs.

Duel activity cards show two distinct server-owned values. `Estimated duration: ~25s` is that duel's
own expected length (server full-duration median; `Unknown` when the server has too few samples).
The live card additionally shows `Elapsed: 12s` and either `Ends in about 13s` or, past the estimate,
`6s over estimate` in `--accent-danger`. Queued cards show `Starts in about 50s` (cumulative, excludes
their own duration) or `Starts in: Unknown` when any earlier segment is unknown — showing each duel's
own estimate is what makes that propagation legible, so never invent a partial ETA. Elapsed and
over-estimate values tick once per second from the server `startedAt`; they are display-only and never
end, delay, or otherwise control a match.

Ready checks use one persistent top-right `warning` `<Notification>` under the stable id
`game-ready`. Show it only when the local participant is not ready. Its single primary action is
**Ready**; the `×` dismiss affordance declines. Its detail is two lines: the opponent pair, then
`Deathroll · 1v1 · Estimated duration: ~10s`. The pair label and the estimate come from
`components/Games/duelFormatting.ts` (`pairLabel`, `estimateText`); the game name comes from
`utils/games.ts` (`gameDisplayName`), and the format is raw snapshot data. The duel activity modal's
ready-check card calls the same helpers, so the wording of the pair and the estimate cannot drift
between the two — the layout can and does: the card also shows the ruleset version and puts the
estimate on its own line. Neither surface shows a start ETA, because participant readiness rather
than queue position controls advancement.

Incoming rematches use one persistent top-right `info` notification under `game-rematch`, with
**Accept** as the single primary action and `×` as decline. Both it and the ready check may show a
visual-only countdown derived from the server expiry and never own the authoritative timeout.
Derive `countdownMs` only from a present, parseable expiry — an absent or malformed `expiresAt`
must yield `undefined` (no bar), never `NaN`, and the value must be memoized per offer/reservation
identity so unrelated re-renders don't restart the bar animation.

A rejected duel command (`game.error` correlated to ready / rematch response / rematch request, or
a direct request rejection) is surfaced as one persistent top-right `error` notification under the
stable id `game-command-error`. Title names the failed operation (e.g. `Ready check failed`); the
detail is the server `reason`. It is **not** gated behind optional notification settings — errors
stay ungated per section 13. Dismissal is tracked by the hook's monotonic `commandError.revision`
so the next failure re-shows.

Rematch **requests** from the result modal are locked client-side on `sourceMatchId` the same way
Ready/Accept are locked, because `outgoingRematch` only arrives after the server answers. The lock
releases on a correlated `requestRematch` error or when the completed match changes.

Completed Deathroll and Rock Paper Scissors participant result modals place a secondary
**Rematch** action beside **Close**. A pending request disables that action and leaves the result
modal open.

#### Duel queue confirmation

When an accepted challenge enters the queue, each participant gets one `info` notification under the
stable id `game-queued`, titled `Added to duel queue`, with the opponent pair and a `Deathroll · 1v1`
game/format line as detail. It uses the default `info` auto-dismiss and has no actions; `×`
dismisses. A later reservation replaces it under the same id rather than stacking — hence a stable
id, not a per-reservation one: replacement happens without any dismissal in between, so a generated
id would never be unregistered and would leak a queue slot forever.

It is derived from queue snapshots, not from `game.accepted`: that event carries an `offerId` while
snapshots carry a `reservationId`, and the two do not correlate. A pair accepted into an idle channel
is promoted to a ready check before the snapshot is built, so it never appears queued and no
confirmation fires — the ready check is the confirmation in that case. The first snapshot per channel
**per session** is consumed as a baseline (`useQueuedDuelConfirmation` re-baselines whenever
`selfSession` changes, i.e. on reconnect), so reconnecting never replays an old confirmation.

Being a repeatable informational notification, it respects Notifications -> `Disable optional
notifications` and the `Duel queue updates` (`notificationDuelQueued`) category toggle. The gate is
applied before `register`, per section 13.

#### Missed ready check

An expired ready check is reported as one top-right `<Notification>` under the stable id
`game-ready-missed`, in one of two forms:

- `warning` / **Missed your duel** — detail `You did not ready up in time` then
  `<pair> removed from the queue`. Persistent.
- `info` / **Duel canceled** — detail `<opponent> did not ready up in time`. Auto-dismisses on
  the default `info` timer.

When neither player readied, both see the **Missed your duel** form.

The persistent form passes no `duration` prop: `warning` defaults to `duration: null`
(`Notification.tsx:53`). That is the point — the player who missed the check was away, so the
report has to survive until they come back. Do not "fix" it with an explicit duration.

Only `reason === 'expired'` on `game.commitmentCanceled` produces it. The handler allow-lists that
one reason rather than deny-listing the others, so a reason added server-side later cannot silently
start reporting itself as a missed check. The other reasons are `declined` (a deliberate refusal),
`disconnected`, `leftChannel`, `channelRemoved`, and `startFailed` — none of them are the player
failing to answer. Note that `startFailed` is published inline
(`DuelOrchestrator.cs:662`) rather than through `PublishReservationCancellationAsync`, so
enumerating that helper's callers does not give you the full reason list.

The ready state is captured from raw queue snapshots, not from App's derived `readyCheck`: that
value filters to checks the local player has **not** readied, so it goes null the instant they
press Ready and the "I readied, they didn't" case would never fire.

The **Duel canceled** form requires *both* that `localReadied` is true and that
`unreadyOpponents` is non-empty; everything else falls back to **Missed your duel**. Both parts
are load-bearing. `localReadied` carries the rule that missing your own check outranks the opponent
missing theirs — without it the neither-readied case wrongly blames the opponent, since they are in
`unreadyOpponents` too. The length check is the safety net: `pairLabel([])` returns an empty string,
so a degenerate capture falls back to the pair form instead of rendering a bare
" did not ready up in time". The registration effect and the render read the same derived flag.

The ready-check notification (`game-ready`) is suppressed while a missed report exists for the
**same reservation id**. Without that, the player saw a live "Ready to play?" with a running
countdown and an enabled Ready button next to "Missed your duel" — and that button was live but
dead: pressing it POSTed `games/ready` for a reservation the server had already dropped, got
rejected, and raised a third notification under `game-command-error`. `useDuelQueueState` does not
subscribe to `game.commitmentCanceled`, so the derived `readyCheck` only clears on the next
snapshot, and the server publishes the cancellation inline while deferring the snapshot rebuild to
an async worker lane (`DuelOrchestrator.ExpireReadyAsync`) — the cancellation usually wins that
race. Match on reservation id so a newer ready check is never suppressed.

It is **not** behind an optional notification setting, matching the other duel outcome
notifications: it is the outcome of an action the player took, not ambient information.

The queue holds accepted pairs, so an expired check drops the pair rather than returning either
player to their old position. Getting back in means a fresh challenge, which joins at the back.
That is by design, not a gap to paper over in the UI.

Project 1 adds no spectator board, screen-share pause or restore behavior, `ChatPanel` foreground
game state, or new toast system. Those belong to project 2.

#### Head-to-head record

Reference: `components/Games/HeadToHead.tsx`, `HeadToHead.css`

The `<HeadToHead opponentSession opponentName>` component shows the local user's lifetime record
versus one opponent (all games), with a per-game breakdown, fetched via `getHeadToHead` (server
resolves the local identity from the client certificate). It reuses the stat-tile / ratio visual
language of `GameStats` (tokens only) and renders loading / empty / error inline states. It
appears in two places: (1) below the result inside the active game modal, scoped to the current
opponent; (2) as a second **"Head-to-head"** tab in `UserInfoDialog` (shown only for other
users, not self). The dialog's tab bar uses `.user-info-tab` buttons styled like the
`GameStats` window toggle — active tab uses `--accent-primary`.

#### Challenger invite-outcome notifications

The challenger (not the recipient) sees exactly one of three replaceable `info` notifications
under the queue id `game-outcome`, driven by `useGameState.inviteOutcome`:

- **"Challenge declined"** — recipient pressed `×` (`game.declined`).
- **"No response"** — the 30s invite window expired with no answer (`game.expired`).
- **"Challenge blocked"** — recipient has "Block all challenges" enabled (the invite request
  is rejected server-side with the message `"This player isn't accepting challenges."`).

Because it is a generated/replaceable id, the App effect unregisters `game-outcome` before
re-registering it so only one outcome shows at a time (covered by the repeated-event test in
`hooks/useNotificationQueue.test.ts`). These use the default `info` 5s auto-dismiss.

#### Deathroll spectator feed (ephemeral chat)

Live Deathroll play is narrated into the match channel's chat as **ephemeral system
messages**, not notifications and not persistent chat. The server (`GameSessionManager`)
composes the copy and broadcasts a `game.feed` event (`{ channelId, text, … }`) to everyone
in the channel. App injects each line into the channel chat store via
`addMessage(...'system'..., 'game')` / `addMessageToStore(..., 'game')`, rendering with the
existing `MessageBubble` `isSystem` styling — reuse it, do not create a new game-log component.

`'game'` is registered in `EPHEMERAL_TYPES` (`useChatStore.ts`), so these lines are purged
from `localStorage` on reconnect and are **never** written to Matrix. A user who joins or
reconnects mid-match sees no backlog — the feed is strictly live. Game results are therefore
no longer posted to Matrix (the old `IGameAnnouncer`/`MatrixGameAnnouncer` path was removed).

Copy is emoji-led and playful: `⚔️` match start, `🎲` each roll / timeout, `💀` a losing
roll, `🏳️` a forfeit. Keep new game feed copy in this style and compose it server-side.

**Per-game avatar & sender.** Each `game.feed` payload carries a `gameType` (e.g. `deathroll`).
App threads it as the message `gameType` (`ChatMessage.gameType`), and uses it to set the
sender label to the game's display name (e.g. "Deathroll") instead of a generic "Game".
`<Avatar gameType=…>` renders a per-game icon (`avatar--game` variant) via the `<Icon>`
component instead of the Mumble/Brmble fallback. Game presentation (display name + icon) is
centralized in `src/Brmble.Web/src/utils/games.ts`. **To add a future game (e.g. Rock Paper
Scissors):** add its icon under the GAMES category in `Icon.tsx`, then add one entry to the
`GAME_META` map in `games.ts` — the feed label and avatar update automatically, no other
wiring needed.

#### Games settings tab

The **Games** settings tab (`GamesSettingsTab.tsx`) holds the server-backed "Block all
challenges" toggle and the (relocated) Deathroll stats. Deathroll stats are no longer shown in
the Profile tab. The toggle uses the standard `settings-item settings-toggle` + `brmble-toggle`
markup and persists via `getGameSettings`/`setGameSettings` (server-authoritative).


### Settings Tab Pattern

Reference: `AudioSettingsTab.tsx`

```
div.[tab-name]-tab
  div.settings-section
    h3.heading-section.settings-section-title
    div.settings-item
    div.settings-item.settings-toggle
    div.settings-item.settings-slider
  div.settings-section
    h3.heading-section.settings-section-title
    ...
```

Rules:
1. Each logical group is a `div.settings-section`
2. Section title is always `h3.heading-section.settings-section-title`
3. Each control row is `div.settings-item` with optional modifier (`.settings-toggle`, `.settings-slider`)
4. Do not hide normal-user settings inside sub-tabs or nested settings menus. Normal settings must be visible in the tab.
5. Admin settings are the only exception: admin-only tools may use sub-tabs because they are advanced, specialized workflows.
6. Do not add plain inline help paragraphs under settings controls. Settings rows stay compact; if a setting needs explanation, use `SettingsHelp`. Inline text is reserved for empty states, loading states, validation errors, and feature placeholders.
7. Settings `?` help uses `SettingsHelp` from `src/Brmble.Web/src/components/SettingsModal/SettingsHelp.tsx`. Do not create CSS-only `data-tooltip` spans or one-off `?` button markup in settings tabs.

### Companion Picker Pattern

The full companion overlay uses a sectioned picker instead of a flat select. The
Built-in section remains fixed above an independently scrollable Custom list.
Every custom row contains a lazy `192 x 234` thumbnail or placeholder, the
companion name, an uploader hint, and a selected state. Loading, empty,
unavailable, and ready are distinct states. Upload actions use
`<Icon name="upload">`. All picker dimensions and spacing use CSS custom
properties and shared UI tokens.

Custom rows use viewport observation before requesting thumbnails. Gallery
metadata and opening the picker never preload full atlases. Selecting a custom
companion requests only that companion's full atlas. Browser and server policy
enforce PNG/WebP type and server safety limits. An `8 x 9` equal-cell sprite
sheet remains guidance rather than a browser acceptance rule, and browser
preview is best-effort.

Settings help example:

```tsx
<div className="settings-label-group">
  <span className="settings-label">Resolution</span>
  <SettingsHelp content="Higher resolution uses more bandwidth" label="More information about resolution" />
</div>
```

### Sidebar Section Pattern

Reference: `Sidebar.tsx`

```
div.[section]-panel
  div.[section]-header
    h4.heading-label
    span.[section]-count
  div.[section]-list
    div.[item]-row
```

Example from `Sidebar.tsx`:
```
div.root-users-panel
  div.root-users-header
    h4.heading-label          "Connected"
    span.root-users-count
  div.root-users-list
    div.root-user-row
```

### Channel Tree User Row Layout

Reference: `ChannelTree.tsx`, `ChannelTree.css`, `Sidebar.tsx` (root users), `Sidebar.css`

User rows are visually indented under their channel to form a tree structure. The space to the left of the avatar is a **fixed-width status area** that doubles as tree indentation. **Both** channel-tree user rows and root-user rows (the "Connected" section in `Sidebar.tsx`) use the same layout pattern.

```
# Channel
  [Deafen] [Muted] [Avatar] Username (you) ● Sharing
  ╰─ 24px status ─╯
```

The `.user-status-area` container is **always 24px wide** (room for two 11px icons + 2px gap), with `justify-content: flex-end` so icons right-align against the avatar. When no icons are active, the 24px is empty space providing the tree indent. When icons appear, they fill from right to left within that fixed space. **Nothing outside the status area shifts.**

Channel-tree user rows use `paddingLeft: calc(4px + level * 20px)` for tree indentation. Root user rows use a fixed `padding-left: 16px`.

| Element | Class | Width | Behaviour |
|---|---|---|---|
| Status area | `.user-status-area` | 24px (fixed) | Always present; contains deafen/muted icons right-aligned |
| Avatar | `.avatar` | 20px | Always present, never moves |
| Username | `.user-name` / `.root-user-name` | flex: 1 | Always present, never moves |
| Self badge | `.self-badge` / `.root-self-badge` | auto | Only for self user |
| Brmble badge | `.brmble-badge` | 7px | Only if user has `matrixUserId` |
| Sharing badge | `.sharing-badge` | auto | Only if screen-sharing |

**Do**: Keep status icons inside `.user-status-area`. Icons are conditionally rendered but the container is always 24px.
**Don't**: Put icons outside the status area or change its width — this shifts the avatar and breaks the tree alignment.
**Don't**: Use the old `.root-user-status` / `.user-status-extra` / `.status-icon--mic` pattern — these have been removed.

### Prompt Pattern

Reference: `src/Brmble.Web/src/hooks/usePrompt.tsx`, `src/Brmble.Web/src/components/Prompt/Prompt.css`

Use the `confirm()` function for any action that requires a user decision before proceeding (e.g., destructive actions, conflict resolution). Do **not** use `window.confirm()` — it returns `false` immediately in WebView2.

Prompts and confirmations are UI work. Before adding confirmation copy, buttons, or branching behavior, follow this pattern instead of creating a custom modal or native browser dialog.

#### Setup (once, in App.tsx only)

```tsx
// App.tsx
import { usePrompt } from './hooks/usePrompt';

const { Prompt, PromptWithInput } = usePrompt();

return (
  <div className="app">
    {/* ... all other content ... */}
    <Prompt />
    <PromptWithInput />
  </div>
);
```

`usePrompt()` must only be called **once** in the tree (in `App.tsx`). It registers a module-level force-update so that `confirm()` and `prompt()` calls from any component trigger the correct re-render. Render `<Prompt />` and `<PromptWithInput />` exactly once, as the last children of the root `<div className="app">`, so both prompt variants render above all other content.

#### Usage (any component)

```tsx
import { confirm } from '../../hooks/usePrompt';

const result = await confirm({
  title: 'Are you sure?',
  message: 'This action cannot be undone.',
  confirmLabel: 'Delete',   // default: 'Confirm'
  cancelLabel: 'Cancel',    // default: 'Cancel'
});

if (result) {
  // user clicked Confirm
}
```

For destructive actions that benefit from visual identity, keep using the same
App-owned confirmation host and pass rich preview content:

```tsx
const result = await confirm({
  title: 'Remove custom companion?',
  message: 'This sprite will be removed for everyone and cannot be restored.',
  content: (
    <div className="custom-companion-confirmation">
      <img src={thumbnailUrl} alt={`${name} preview`} />
      <div>
        <strong>{name}</strong>
        <span>Uploaded by {uploaderName}</span>
      </div>
    </div>
  ),
  confirmLabel: 'Remove',
  destructive: true,
});
```

`message` and `content` may contain React nodes for confirmations. `content`
renders between the header and footer, and `destructive: true` changes the
confirmation action to `btn-danger`. Rich confirmations do not add another
prompt host or a feature-specific modal.

Use `prompt()` when the shared confirmation flow also needs a short text input, such as a reason or typed confirmation:

```tsx
import { prompt } from '../../hooks/usePrompt';

const result = await prompt({
  title: 'Remove Channel',
  message: 'Type "Remove" to confirm deleting "Secret".',
  placeholder: 'Remove',
  confirmLabel: 'Remove',
  cancelLabel: 'Cancel',
});

if (result === 'Remove') {
  // proceed with destructive action
}
```

Password input prompt example:

```tsx
const password = await prompt({
  title: 'Channel Password',
  message: 'Enter the password for Secret.',
  placeholder: 'Password',
  confirmLabel: 'Join',
  cancelLabel: 'Cancel',
  isPassword: true,
});

if (password) {
  // proceed with password-protected action
}
```

Use `prompt()` for one short text input only. For multi-field flows such as creating or editing a server profile, use the modal/form pattern instead of trying to extend `prompt()`.
Input prompt messages remain strings and input prompts do not accept rich
`content` or `destructive` options.

#### DOM structure

Confirmation prompt:

```
div.modal-overlay          (click → cancel)
  div.prompt.glass-panel.animate-slide-up   (stops propagation)
    div.modal-header
      h2.heading-title.modal-title
      div.modal-subtitle
    div.prompt-content             (optional rich preview)
    div.prompt-footer
      button.btn.btn-secondary   Cancel  (autoFocus, bottom-left)
      button.btn.btn-primary     Confirm (bottom-right, default)
      button.btn.btn-danger      Confirm (bottom-right, destructive only)
```

Input prompt:

```
div.modal-overlay          (click → cancel)
  div.prompt.glass-panel.animate-slide-up   (stops propagation)
    div.modal-header
      h2.heading-title.modal-title
      p.modal-subtitle
    div.prompt-input-container
      input.brmble-input
      button.password-toggle-btn   Icon eye/eye-off (password prompts only)
    div.prompt-footer
      button.btn.btn-secondary   Cancel
      button.btn.btn-primary     Action
```

Rules:
1. No close button — ESC and overlay click both cancel
2. Cancel is always `btn-secondary` on the left; Confirm is `btn-primary` by default and `btn-danger` only when `destructive: true`
3. `<Prompt />` and `<PromptWithInput />` must be the **last children** of the root `<div className="app">` so they render above all other content
4. Never call `usePrompt()` in more than one component — only the owner of the prompt host components should call it; all others use `confirm()` or `prompt()` directly
5. For typed confirmations or reason capture, use the shared `prompt()` / `<PromptWithInput />` flow instead of building a one-off modal
6. Do not use native `title` attributes on prompt controls; use accessible labels and the shared Tooltip pattern when hover help is needed
7. Password input prompts must use the same icon-only reveal pattern as `ServerList`: `Icon name="eye"` for hidden, `Icon name="eye-off"` for visible, shown only while the input or reveal button has focus
8. Rich preview confirmations still use the single App-owned prompt host; never mount a second host for feature-specific content

### Form Inputs

| Element | Class / Component | Notes |
|---|---|---|
| Text input | `input.brmble-input` | Global style in `index.css` |
| Select dropdown | `<Select>` component | Custom themed dropdown (see Select Pattern below) |
| Toggle switch | `label.brmble-toggle > input[type=checkbox] + span.brmble-toggle-slider` | 44x24px, track uses `--radius-lg`, knob uses `--radius-md` |

### Buttons

| Class | Use |
|---|---|
| `button.btn.btn-primary` | Primary actions (Connect, Save, Close) |
| `button.btn.btn-secondary` | Secondary actions |
| `button.btn.btn-ghost` | Tertiary/subtle actions |
| `button.btn.btn-danger` | Destructive actions (Disconnect, Ban) |
| `.btn-sm` | Small variant modifier (add to any btn) |
| `.btn-icon` | Icon-only button (36x36px square) |

### Tooltip Pattern

Reference: `src/Brmble.Web/src/components/Tooltip/Tooltip.tsx`

```tsx
import { Tooltip } from '../Tooltip/Tooltip';

<Tooltip content="Help text">
  <button>Hover me</button>
</Tooltip>

<Tooltip content={dynamicText} position="bottom">
  <span className="info-icon">?</span>
</Tooltip>

// Small buttons near edges — use align to prevent overflow
<Tooltip content="Leave Voice" position="bottom" align="start">
  <button className="btn btn-icon">...</button>
</Tooltip>

<Tooltip content="Settings" position="bottom" align="end">
  <button className="btn btn-icon">...</button>
</Tooltip>
```

Props:

| Prop | Type | Default | Description |
|---|---|---|---|
| `content` | `string` | required | Tooltip text (supports multi-line via `\n`) |
| `children` | `ReactElement` | required | Trigger element |
| `position` | `'top' \| 'bottom' \| 'left' \| 'right'` | `'top'` | Preferred position (auto-flips on overflow) |
| `align` | `'start' \| 'center' \| 'end'` | `'center'` | Anchor alignment relative to trigger. For top/bottom: horizontal (start=left edge, end=right edge). For left/right: vertical (start=top edge, end=bottom edge). Use `start` for left/top-edge elements, `end` for right/bottom-edge elements |
| `delay` | `number` | `400` | Hover delay in ms |

Rules:
1. **Never use `title` attribute** -- always use `<Tooltip>` for hover text
2. Tooltip uses theme tokens (`--bg-deep`, `--text-primary`, `--border-subtle`, `--radius-sm`) -- no hardcoded colors
3. Empty `content` renders children only (no tooltip)
4. Multi-line text uses `\n` -- CSS handles line breaks via `white-space: pre-line`
5. Tooltip renders via portal (`document.body`) to escape overflow containers
6. Accessible: `role="tooltip"`, `aria-describedby`, Escape key dismissal
7. For small trigger elements (e.g. `btn-icon`) near window edges, use `align="start"` or `align="end"` to prevent the tooltip from overflowing off-screen
8. **Disabled elements** don't fire mouse/focus events -- wrap them in a `<span>` or `<div>` and attach the Tooltip to the wrapper instead
9. In settings tabs, do not create raw `?` tooltip markup. Use `SettingsHelp`.

### Select Pattern

Reference: `src/Brmble.Web/src/components/Select/Select.tsx`, `Select.css`

```tsx
import { Select } from '../Select';

const options = [
  { value: 'option1', label: 'Option One' },
  { value: 'option2', label: 'Option Two' },
];

<Select
  value={selectedValue}
  onChange={setSelectedValue}
  options={options}
/>

// Disabled select (e.g. locked setting)
<Select value={val} onChange={setVal} options={opts} disabled />

// With placeholder for unset state
<Select value="" onChange={setVal} options={opts} placeholder="Choose..." />
```

Props:

| Prop | Type | Default | Description |
|---|---|---|---|
| `value` | `string` | required | Currently selected option value |
| `onChange` | `(value: string) => void` | required | Selection change callback |
| `options` | `SelectOption[]` | required | Array of `{ value, label }` objects |
| `disabled` | `boolean` | `false` | Disables the trigger button |
| `className` | `string` | `''` | Additional CSS classes on the wrapper |
| `placeholder` | `string` | `undefined` | Shown when no option matches `value` |
| `ariaLabel` | `string` | `undefined` | Accessible name for the trigger when there is no visible `<label>` |

#### DOM Structure

```
div.brmble-select
  button.brmble-select-trigger[role="combobox"]
    span  (selected label or placeholder)

// Portal to document.body (when open):
div.brmble-select-dropdown[role="listbox"]
  button.brmble-select-option[role="option"]  (one per option)
```

#### Keyboard Navigation

| Key | Action |
|---|---|
| `ArrowDown` / `ArrowUp` | Move highlight (wraps around) |
| `Home` / `End` | Jump to first / last option |
| `Enter` / `Space` | Select highlighted option |
| `Escape` | Close dropdown, return focus to trigger |
| Any letter | Type-ahead: jump to first matching option |

Rules:
1. **Always use `<Select>` instead of native `<select>`** -- native selects don't respect theme tokens
2. Dropdown renders via portal (`document.body`, or the active `document.fullscreenElement` when one is present so it stays visible over a fullscreen screen-share tile) to escape overflow containers -- follows the same pattern as ContextMenu and Tooltip
3. Position auto-flips above trigger if there isn't enough space below
4. Clicking outside or pressing Escape dismisses the dropdown
5. Full ARIA: `role="combobox"` on trigger, `role="listbox"` on dropdown, `role="option"` on items, `aria-expanded`, `aria-activedescendant`
6. Trigger and dropdown use theme tokens (`--bg-primary`, `--glass-border`, `--radius-md`, `--shadow-elevated`) -- no hardcoded values
7. **Disabled selects** with tooltips: wrap `<Select>` in a wrapper and attach `<Tooltip>` to the wrapper, since disabled buttons don't fire mouse events

---

### Screenshare Viewer Controls

Reference: `src/Brmble.Web/src/components/ScreenShareGrid/ScreenShareTile.tsx`, `ScreenShareTile.css`

Watched screen-share tiles expose viewer-side controls in the top-right `--controls` overlay, shown on hover for non-thumbnail tiles only. The overlay contains, left-to-right: a receive-quality `<Select>` (Auto / High / Medium / Low, defaulting to Auto) followed by the fullscreen button.

Rules:
1. **Reuse `<Select>`** for the quality dropdown — never a native select. Its portal dropdown escapes the tile's overflow, so it renders correctly inside the overlay.
2. **Stop click propagation**: wrap the `<Select>` in `.screen-share-tile-quality-select-wrapper` with `onClick={(e) => e.stopPropagation()}` so opening the dropdown doesn't toggle tile focus. Wrap that wrapper in a `<Tooltip>` explaining the control (viewers otherwise can't tell it controls *received* quality).
3. **Controls are viewer-only**: broadcaster encode settings (resolution, FPS, content type) live in the Screen Share settings tab, not on the tile.
4. Quality maps to LiveKit `RemoteTrackPublication.setVideoQuality`; `Auto` pins to HIGH and lets adaptive stream pick the best simulcast layer. Only render the control when an `onViewerQualityChange` handler is supplied.
5. All spacing/sizing uses tokens (`--space-*`, `--radius-*`) — no hardcoded values.

---

## 5. Theme Compatibility

### Core Principle

Every theme defines the same 73 tokens. If your UI only uses tokens, it automatically works across all 8 themes.

### Creating New Themes

Follow `_template.css` "3 Decisions" framework:
1. **Base Hue** -- HSL degree that tints all neutral surfaces
2. **Primary Accent** -- single hero hex color
3. **Text Warmth** -- warm / cool / tinted

### Retro Terminal Deviations

Retro Terminal (`retro-terminal.css`) breaks several assumptions that other themes share. Account for these:

| Property | Most Themes | Retro Terminal |
|---|---|---|
| Glass blur | `blur(6-12px)` | `blur(0px)` -- no blur at all |
| Border radius | `4-18px` range | `0-4px` range (near-zero) |
| Display font | Serif (Cormorant Garamond, etc.) | Monospace (VT323) -- wider characters |
| Body font | Sans-serif (Outfit, etc.) | Monospace (IBM Plex Mono) -- wider characters |
| `--heading-section-color` | `var(--accent-secondary)` | `var(--accent-primary)` (green) |
| `--heading-label-color` | `var(--text-muted)` | `var(--accent-primary-glow)` (green glow) |
| Mesh background | Radial gradients | `none` |

**Implications:**
- Do not rely on glass blur for readability -- content must be legible on flat backgrounds
- Do not assume rounded corners -- layouts must work with sharp edges
- Layouts must handle wider monospace characters without overflow

### Visual Testing Rule

**Check new UI against at minimum Classic and Retro Terminal themes before shipping.**

---

## 6. Typography

| Token | Use | Classic | Retro Terminal |
|---|---|---|---|
| `var(--font-display)` | Headings, avatars, large display text | Cormorant Garamond | VT323 |
| `var(--font-body)` | All body text, chat, settings, UI labels | Outfit | IBM Plex Mono |
| `var(--font-mono)` | Code blocks, badges, technical readouts | JetBrains Mono | JetBrains Mono |

**Rule: Never set `font-family` directly in component CSS. Always use the token.**

---

## 7. Interaction States

### Hover

- Background: use `--bg-hover` / `--bg-hover-light` / `--bg-hover-strong` for background changes
- Timing: `transition: var(--transition-fast)` (150ms)
- Prefer background changes + subtle transforms over border changes

### Active / Pressed

- `transform: scale(0.95)` for tactile feel
- Accent color swap (e.g. primary to secondary) for emphasis

### Focus

- Use `:focus-visible` only -- no focus rings on mouse click
- Dual-ring box-shadow pattern:
  ```css
  box-shadow: 0 0 0 2px var(--bg-deep), 0 0 0 4px var(--accent-primary);
  ```
- This is already set globally in `index.css` -- only override if a component needs different behavior

### Transition Tokens

| Token | Duration | Use |
|---|---|---|
| `--transition-fast` | 150ms | Hover states, micro-interactions |
| `--transition-normal` | 250ms | Modals, panel transitions |
| `--transition-slow` | 400ms | Page transitions |

---

## 8. Spatial Rules

### Spacing Scale

Use `--space-*` tokens for all padding, margin, and gap values.

| Token | Value |
|---|---|
| `--space-2xs` | 4px |
| `--space-xs` | 8px |
| `--space-sm` | 12px |
| `--space-md` | 16px |
| `--space-lg` | 24px |
| `--space-xl` | 32px |
| `--space-2xl` | 48px |
| `--space-3xl` | 64px |

### Border Radius Scale

Use `--radius-*` tokens. Do not assume rounded corners exist (Retro Terminal is near-zero).

| Token | Classic | Retro Terminal |
|---|---|---|
| `--radius-xs` | 4px | 0px |
| `--radius-sm` | 6px | 0px |
| `--radius-md` | 8px | 2px |
| `--radius-lg` | 12px | 2px |
| `--radius-xl` | 16px | 4px |
| `--radius-full` | 50% | 50% |

### Negative Space

Intentional negative space is a design principle. Let content breathe. Do not pack elements tightly. Use `--space-md` (16px) or larger as default component padding. Use `--space-sm` (12px) minimum between related items within a group.

---

## 9. Logo & Brand Assets

### Source File

`src/Brmble.Web/src/assets/brmble-logo.svg` — 1024x1024 viewBox, 35 paths, `currentColor` fill.

### BrmbleLogo Component

Reference: `src/Brmble.Web/src/components/Header/BrmbleLogo.tsx`, `BrmbleLogo.css`

```tsx
<BrmbleLogo size={32} />              // Header (hover animation)
<BrmbleLogo size={192} heartbeat />   // Welcome screen (continuous pulse)
```

Props:
| Prop | Type | Default | Use |
|---|---|---|---|
| `size` | `number` | `32` | Width/height in px |
| `heartbeat` | `boolean` | `false` | Enable continuous pulse animation |
| `className` | `string` | `''` | Additional CSS classes |

### Ring Architecture

Paths are grouped into 4 concentric rings by distance from center (512,512):

| Ring | Class | Paths | Movement | Gradient |
|---|---|---|---|---|
| Center | `.logo-ring-center` | 1 | None (fixed) | Yes |
| Inner | `.logo-ring-inner` | 6 | Smallest | Yes |
| Middle | `.logo-ring-middle` | 10 | Moderate | Yes |
| Outer | `.logo-ring-outer` | 18 | Largest | Yes |

Each path has `--dx`/`--dy` CSS custom properties (unit vector from center to path start point) used for directional translation.

### Animation Modes

**Hover** (default): Rings translate outward along their `--dx`/`--dy` vectors. All elements receive the same gradient transition from `--text-primary` to `--accent-secondary`.

**Heartbeat** (`heartbeat` prop): Continuous double-beat pulse (*thump-thump* ... rest). Duration controlled by `--animation-heartbeat` token. All elements share the same uniform gradient pulse.

### SVG Gradient ID Collisions

Multiple `<BrmbleLogo>` instances on the same page cause SVG gradient `id` collisions. The component solves this with a `useState`-based instance counter generating unique prefixes, passed to CSS via `--grad-center`, `--grad-inner`, `--grad-middle`, `--grad-outer` custom properties.

**Rule: Never use bare string IDs for SVG gradients/filters/clips. Always generate unique IDs per component instance.**

---

## 10. Animation & Motion

### Token Categories

| Category | Tokens | Use |
|---|---|---|
| Transitions | `--transition-fast/normal/slow` | Hover states, modals, page transitions |
| Entrance | `--animation-fast/normal/slow`, `--stagger-step` | One-shot slide/fade-in |
| Continuous | `--animation-blink` through `--animation-heartbeat` | Looping UI animations |

### Rules

1. **All animation durations must use tokens.** If no existing token fits, add a new one to `:root` in `index.css` and to the `prefers-reduced-motion` override block.
2. **`prefers-reduced-motion` must be respected.** Continuous animations in `index.css` are zeroed out globally. Component-level `@keyframes` should also have a `prefers-reduced-motion: reduce` fallback that sets `animation: none`.
3. **Hover animations use CSS transitions** via `transition` property with `--transition-*` tokens. Do not use `@keyframes` for hover effects.
4. **Continuous animations use `@keyframes`** with `--animation-*` tokens for duration. Always set `will-change` on animated properties.
5. **`color-mix(in srgb, ...)`** is the preferred method for intermediate color blends between theme tokens (e.g. 60% of `--text-primary` mixed with 40% of `--accent-secondary`).

### SVG Fill Transitions

SVG `fill` cannot transition between `currentColor` and `url(#gradient)`. The workaround:

1. Define gradient `<stop>` elements whose `stop-color` starts as `--text-primary` (visually identical to `currentColor`)
2. Transition the `stop-color` to the target color on hover/animation
3. Apply the gradient `fill` via CSS custom property: `fill: var(--grad-inner)`

This gives the appearance of transitioning from solid to gradient.

---

## 11. Icon System

Reference: `src/Brmble.Web/src/components/Icon/Icon.tsx`

Brmble uses a centralized `<Icon>` component backed by a name-to-SVG-paths map. All standard UI icons live in one file, ensuring consistency and deduplication.

### Usage

```tsx
import { Icon } from '../Icon/Icon';

<Icon name="mic" />              // 16px default
<Icon name="mic" size={28} />    // Custom size
<Icon name="mic-off" size={14} className="status-icon" />
```

### Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `name` | `IconName` | required | Icon key from the icon map |
| `size` | `number` | `16` | Width & height in px |
| `className` | `string` | — | Additional CSS class |
| `style` | `CSSProperties` | — | Inline styles |
| `...rest` | `SVGProps` | — | Any valid SVG attribute |

The component sets `aria-hidden="true"` automatically. Color inherits from `currentColor` (theme-compatible by default).

### Available Icons (by category)

| Category | Icons | Notes |
|---|---|---|
| **Voice** | `mic`, `mic-off`, `headphones`, `headphones-off`, `phone-off` | Audio & call controls |
| **Media** | `monitor`, `monitor-off`, `minimize-2`, `maximize-2` | Screen share & fullscreen |
| **Chat** | `message-square`, `message-circle` | Message bubble variants |
| **Server** | `server`, `globe`, `folder`, `lock`, `unlock`, `key-round`, `shield`, `star`, `ban`, `triangle-right` | Infrastructure, moderation, and restricted channel access states (`lock` denied, `unlock` allowed, `key-round` password-protected) |
| **UI — Actions** | `x`, `search`, `plus`, `check`, `send`, `upload`, `refresh-cw`, `arrow-right`, `eye`, `eye-off`, `chevron-up`, `chevron-down`, `chevron-left`, `chevron-right`, `info`, `info-filled` | Generic interactive icons |
| **UI — Objects** | `user`, `settings`, `save`, `palette`, `moon` | Profiles, preferences, idle indicator |
| **Window** | `window-minimize`, `window-maximize`, `window-close` | Title bar controls (custom viewBox) |
| **Brmblegotchi — Actions** | `gotchi-food`, `gotchi-play`, `gotchi-clean` | Pet interaction buttons |
| **Brmblegotchi — Stats** | `gotchi-hunger`, `gotchi-happiness`, `gotchi-cleanliness` | Pet stat indicators |
| **Games** | `swords`, `game-deathroll`, `game-rps`, `rps-rock`, `rps-paper`, `rps-scissors` | `swords` = the "Challenge to a duel" menu parent and the actionable duel activity badge; `game-*` are per-game avatars/menu icons keyed by `gameType` (see `utils/games.ts`); `rps-*` are the RPS choice-button icons (object metaphors) |

Brmblegotchi icons are prefixed `gotchi-` and shared across all pet themes (`original`, `dino`, `cat`). If a pet theme needs unique icons, add them under a sub-header like `/* ── gotchi · dino ── */` in the icon map.

### Adding a New Icon

1. **Find the icon** on [Lucide Icons](https://lucide.dev/icons). Search by name or keyword, click the icon, and copy the SVG markup.
2. **Strip the outer `<svg>` wrapper.** Lucide gives you a full `<svg>` tag with attributes like `xmlns`, `width`, `height`, `viewBox`, `fill`, `stroke`, `stroke-width`, `stroke-linecap`, `stroke-linejoin`. Remove the outer `<svg>…</svg>` and keep only the inner elements (`<path>`, `<circle>`, `<line>`, `<polyline>`, `<rect>`, `<polygon>`). Also strip any `stroke`, `fill`, `stroke-width`, `stroke-linecap`, `stroke-linejoin` attributes from the inner elements — the `<Icon>` component applies these globally.
3. **Open `src/Brmble.Web/src/components/Icon/Icon.tsx`** and add an entry to the `iconPaths` map in the appropriate category group:
   ```tsx
   'my-icon': {
     paths: (
       <>
         <path d="..." />
         <circle cx="12" cy="12" r="3" />
       </>
     ),
   },
   ```
4. **Use it:** `<Icon name="my-icon" size={20} />`
5. **Update the icon table** in this guide (section 11 → "Available Icons (by category)") so the new icon appears in the correct category row.

#### Icon Conventions

| Rule | Detail |
|---|---|
| ViewBox | `0 0 24 24` (omit `viewBox` field — it's the default). Only set for non-standard icons (e.g. `check` uses `0 0 16 16`) |
| Style | Feather/Lucide conventions: stroke-based, `currentColor`, strokeWidth 2, round caps/joins |
| Fill icons | Set `fill: true` on the definition (e.g. `triangle-right`). Stroke attributes are omitted automatically |
| Hybrid stroke+fill | Some icons mix stroke outlines with filled sub-elements. Keep the definition as stroke-based (no `fill: true` at the top level) and add `fill="currentColor" stroke="none"` on the specific element that needs filling (e.g. `gotchi-play` has a stroked `<circle>` with a filled `<polygon>`, and `info-filled` has a filled `<circle>` dot). |
| Naming | Use Lucide names. Pair toggleable icons with `-off` suffix (`mic` / `mic-off`) |
| Grouping | Place related icons adjacent in the map with a comment header (`/* ── Mic ── */`) |
| Category banners | Major sections use a 3-line box comment. Format: `// ╔══…══╗` / `// ║  CATEGORY NAME  ║` / `// ╚══…══╝` with optional description lines between the name and bottom border. See existing banners in Icon.tsx (VOICE, MEDIA, CHAT, etc.) |
| No emoji | Never use emoji characters for icons in the UI. Always use `<Icon>` |

### When NOT to Use `<Icon>`

- **BrmbleLogo** — Complex animated multi-ring SVG. Use the dedicated `<BrmbleLogo>` component.
- **MumbleIcon / BrmbleIcon** — Large brand logos (50+ paths). Keep as local inline SVGs in their host component.
- **Complex illustrations** — Use `<img>` tag referencing a static asset in `src/assets/`.

---

## 12. Inline SVG Guidelines (Legacy)

> **Note:** New icons should use the `<Icon>` component (section 11). These rules apply to the remaining inline SVGs (brand logos, complex illustrations) that are too large or unique for the icon map.

### When to Use Inline SVG (Instead of `<Icon>`)

- **Logo** (35 paths, animated): Dedicated React component (`BrmbleLogo`)
- **Complex illustrations**: Use `<img>` tag referencing static asset
- **Brand icons** (MumbleIcon, BrmbleIcon): Multi-path logos kept local to their host component

### Rules

1. **Always use `currentColor`** for fill/stroke on theme-aware SVGs. Never hardcode colors.
2. **Use `aria-label`** on decorative/branded SVGs. Use `aria-hidden="true"` on purely decorative icons adjacent to text labels.
3. **Component-specific dimensions** (icon sizes, avatar sizes, button sizes) that don't map to spacing tokens should use local CSS custom properties for documentation and reuse:
   ```css
   .my-component {
     --icon-size: 28px;
     width: var(--icon-size);
     height: var(--icon-size);
   }
   ```
4. **`overflow: visible`** must be set on SVGs with hover/animation effects that translate elements outside the viewBox.

---

## 13. Notification Pattern

### Base Component

All notifications use the shared `<Notification>` base component (`src/Brmble.Web/src/components/Notification/`). Never create standalone notification/toast components with their own positioning/animation/styling — always wrap with `<Notification>`.

Brmble does **not** have a separate toast system. Do not add `Toast` components, bottom-right toasts, or bottom-center toasts. Use top-right notifications and `useNotificationQueue`.

### Status Types

The `status` prop drives icon, color, ARIA role, and auto-dismiss behavior:

| Status | Icon | Color tokens | ARIA role | Auto-dismiss |
|---|---|---|---|---|
| `info` | `info` | `--accent-info-*` | `role="status"` | 5s |
| `success` | `check-circle` | `--accent-success-*` | `role="status"` | 5s |
| `warning` | `alert-triangle` | `--accent-warning-*` | `role="status"` | No (persist) |
| `error` | `alert-circle` | `--accent-danger-*` | `role="alert"` | No (persist) |

### Decision Checklist (answer all before building a notification)

1. **What status applies?** `info` = supplemental, `success` = action confirmed, `warning` = needs attention, `error` = something failed
2. **What position?** `top-right`. Brmble no longer supports toast positions.
3. **Should it auto-dismiss?** Default from status, but can override with `duration` prop
4. **Does it need a dismiss button?** Persistent notifications: yes. Blocking with no fallback: no dismiss.
5. **What actions does it need?** Max 1 primary action. Action must be reachable elsewhere in UI since notifications can be missed.
6. **What title + detail?** Title = what happened (short, one line). Detail = context or next step (optional).
7. **What lifecycle model?** Choose one: stable singleton, replacement, or historical/multi-entry. This determines the ID and cleanup strategy.
8. **Should users be able to disable it?** Repeatable informational top-right notifications should usually respect Notifications -> `Disable optional notifications` and a category toggle. Critical warnings, errors, recovery, updates, and one-time confirmations usually stay ungated.

### Props

```tsx
interface NotificationProps {
  status: 'info' | 'success' | 'warning' | 'error';
  position: 'top-right';
  title: React.ReactNode;         // Bold headline — what happened. Keep to one line.
  detail?: React.ReactNode;       // Secondary text — context, next step, or explanation.
  actions?: React.ReactNode;      // Action buttons rendered below the message.
  visible: boolean;
  duration?: number | null;       // null = never. Defaults: info/success = 5000, warning/error = null
  onDismiss?: () => void;         // When provided, close button (×) renders
  onExited?: () => void;          // After exit animation completes
  pauseOnHover?: boolean;         // Default: true. Pauses auto-dismiss on hover (WCAG 2.2.1)
  className?: string;             // For consumer-specific styling
}
```

### Content Structure

Every notification uses a **title + detail** pattern:

- **Title** = what happened. Short, scannable, fits one line. Bold weight.
- **Detail** = context or next step. Smaller, secondary color. Optional — omit if the title says it all.
- **Multi-line detail** = two or more bare `<div>`s inside a fragment. No wrapper class and no `<br/>`: they sit inside `.notification__detail` and inherit its size, color and line height.

The status icon aligns vertically with the title line.

| When writing… | Do | Don't |
|---|---|---|
| Title | `Certificate missing` | `Profile "X" has no certificate file` |
| Title | `Update available` | `Update available: v1.2.3` |
| Detail | `Profile "X" has no certificate.` | (cram everything into one line) |
| Detail | `Press Update to install v1.2.3.` | (repeat info from title) |

### Behavioral Rules

- **Auto-dismiss:** `info`/`success` auto-dismiss at 5s; `warning`/`error` persist. Timer pauses on hover.
- **Errors and actionable notifications must never auto-dismiss.**
- **Max 3** visible top-right notifications. Excess queued. Notifications are deduplicated by `id`; matching status/message alone does not deduplicate them.
- **Action buttons:** Max 1 primary per notification. Every labeled button must perform a distinct action (e.g. "Update", "Import", "Settings"). Close button is separate from action buttons.
- **Dismissal is `×` only.** Never add a text button ("Dismiss", "Later", "Close") that duplicates the `×` close button. The `×` is the universal dismiss affordance — text buttons are reserved for meaningful actions. This keeps the UI clean and avoids redundancy.
- Top-right notifications render inside a `.notification-stack` container in `App.tsx`.

### Optional Notification Settings

Before adding a repeatable top-right notification, decide whether it belongs behind the Notifications settings tab. Optional notifications are user-controllable pop-up notices that can repeat during normal use and are not required for account recovery, safety, or error handling.

Use optional notification settings for repeatable informational events such as screen share invitations, screen share status updates, idle reminders, or channel move notices. Do not gate critical warnings, errors, update prompts, certificate recovery, kicked/banned notices, service outage warnings, or one-time confirmations unless there is a specific product decision to make them optional.

Optional notifications must check the effective setting before registering with `useNotificationQueue`; disabled notifications should not leave stale entries visible or queued.

### Queue & Priority (`useNotificationQueue`)

Top-right notifications are managed by the `useNotificationQueue` hook (`src/Brmble.Web/src/hooks/useNotificationQueue.ts`). This keeps the stack readable by limiting visible notifications and ensuring critical ones are always shown.

**Priority order** (highest first):

| Priority | Status | Numeric |
|---|---|---|
| Highest | `error` | 3 |
| | `warning` | 2 |
| | `info` | 1 |
| Lowest | `success` | 0 |

**Rules:**
- Max **3** notifications visible simultaneously. Excess entries are queued.
- Within the same priority, **arrival order** wins (first registered shows first).
- When a higher-priority notification registers, it **preempts** the lowest-priority visible one.
- When a notification is dismissed or exits, the next queued entry **re-appears** automatically.
- `register(id, status)` — call when notification data exists (e.g. broken profile detected, update available, server imported).
- `unregister(id)` — call from `onExited` (after exit animation), not from `onDismiss`. This ensures the exit animation completes before the slot is freed.
- `onExited` only fires if the component survives the exit animation. A notification behind a render gate — `{data && q.isVisible(id) && <Notification visible={true} … />}` — unmounts the moment `data` clears, before the exit timer is ever scheduled, so its `onExited` is unreachable. Such a notification must unregister from the same effect that registers it (`if (show) register(id, status); else unregister(id)`), or it leaks its queue slot.
- `isVisible(id)` — pass as the `visible` prop to `<Notification>`.

### Queue Lifecycle Checklist

Before adding a top-right notification, decide and document the lifecycle model:

- **Stable singleton:** One logical notification exists at a time. Use a stable ID (`update`, `copy`, `idle-auto-leave`) and unregister that same ID when it is no longer relevant.
- **Replacement:** Repeated events should overwrite the previous notification. Use generated IDs only if you unregister the previous ID before registering the next one. Example: repeated channel-move notifications should replace the last move notification, not accumulate forever.
- **Historical/multi-entry:** Repeated events should remain separate because each entry matters. Use generated IDs, but prove every generated ID is eventually unregistered. Example: imported server notifications may show one notification per imported server.

Generated IDs require extra care:

- Matching title/detail/status does **not** deduplicate notifications; only the `id` matters.
- If a notification clears React state in `onDismiss`, do not assume `onExited` will run afterward. Either keep the component mounted with `visible={false}` until exit, or explicitly unregister the queue ID in the same dismissal path.
- For replacement notifications, unregister the previous ID before setting/registering the next generated ID.
- Add a repeated-event test for any generated-ID top-right notification. The test must emit at least **4** events, or otherwise prove stale entries cannot fill the max-3 queue and block future notifications.

**Integration pattern in App.tsx:**
```tsx
const q = useNotificationQueue();

// Register when data arrives
useEffect(() => {
  if (hasBrokenCert) q.register('broken-cert', 'warning');
  else q.unregister('broken-cert');
}, [hasBrokenCert]);

// Render
<Notification
  visible={q.isVisible('broken-cert')}
  onExited={() => q.unregister('broken-cert')}
  ...
/>
```

### Accessibility

- **ARIA:** `info`/`success`/`warning` use `role="status"` (`aria-live="polite"`); `error` uses `role="alert"` (`aria-live="assertive"`)
- **Icons:** Status icon always rendered — never rely on color alone (WCAG 1.4.1)
- **Keyboard:** Close button is keyboard accessible. `Esc` dismisses focused notification.
- **Motion:** `prefers-reduced-motion: reduce` disables slide animation, keeps opacity fade only.

### When NOT to Use Notification

- **Blocking decisions** requiring immediate response → use `confirm()` modal
- **Form validation errors** → use inline error text near the field (`.profiles-form-error` pattern)
- **Passive status indicators** → use inline badges/dots, not notifications

### Token Reference

All four semantic accent families must be defined in every theme:

| Family | Variants |
|---|---|
| `--accent-info-*` | base, `-text`, `-subtle`, `-border`, `-bg` |
| `--accent-success-*` | base, `-text`, `-subtle`, `-border`, `-bg`, `-glow` |
| `--accent-warning-*` | base, `-text`, `-subtle`, `-border`, `-bg` |
| `--accent-danger-*` | base, `-text`, `-subtle`, `-border`, `-bg`, `-strong` |

See `src/Brmble.Web/src/themes/_template.css` for guidance values per token.

### Example: Adding a New Notification

```tsx
// A "server unreachable" error notification
<Notification
  status="error"
  position="top-right"
  visible={visible}
  onDismiss={handleDismiss}
  title="Server unreachable"
  detail="Could not reach the server. Check your connection."
  actions={
    <button className="btn btn-sm btn-primary" onClick={handleRetry}>Retry</button>
  }
/>
```

### Existing Notifications

| Component | Status | Position | Auto-dismiss | Title | Detail |
|---|---|---|---|---|---|
| `UpdateNotification` | `info` | `top-right` | No | `Update available` | `Press Update to install v{version}.` |
| `BrokenCertNotification` | `warning` | `top-right` | No | `Certificate missing` | Profile name, switched-to info, recovery instructions |
| `game-command-error` (App) | `error` | `top-right` | No | `Ready check failed` / `Rematch response failed` / `Rematch request failed` | Server `reason` for the rejected duel command |
