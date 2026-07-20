# Design: Ephemeral Deathroll Spectator Feed

**Date:** 2026-07-20
**Status:** Approved
**Branch:** `feature/minigame-framework`

## Summary

Game chat messages (match start, each roll, final result) become **ephemeral,
live-only** feed lines broadcast to all members of the match's channel. Nothing
is written to Matrix; nothing survives reconnect or scrollback. This **removes**
the current persistent Matrix result message. A richer, persistent game-status
history will live elsewhere in the UI in a future iteration.

## Goals

- Same-channel members can spectate a Deathroll match live in chat: see when a
  match starts, watch every roll, and see who lost.
- Game messages never fill persistent chat — they are purged like other
  ephemeral system messages and are never sent to Matrix.
- Reuse existing primitives: the channel-broadcast publisher and the ephemeral
  system-message pattern already in the client chat store.

## Non-Goals (YAGNI)

- No backfill/replay for spectators who join mid-match or reconnect (pure live).
- No spectator UI beyond inline system-style chat lines.
- No structured per-roll payload composed on the client — the server composes
  the display text.
- No changes to the game modal, stats, or invite/outcome flows.

## Audience & Transport

- **Audience:** all members of the match's channel (`match.ChannelId`).
- **Transport:** the existing `IGameEventPublisher.PublishToChannelAsync(int channelId, object message)`,
  which is already wired to the channel broadcast bus. Participants continue to
  receive their existing targeted `game.started` / `game.stateUpdated` /
  `game.ended` events for the modal — those are unchanged.

## Event Shape

```
{ type: "game.feed", channelId, gameType, matchId, text }
```

The server composes `text` (reusing `GameSessionManager.NameOf`).

## Server Changes (`GameSessionManager` + wiring)

Three broadcast trigger points, all via `PublishToChannelAsync`, with emoji copy:

- **Match start** (when the match transitions to live):
  `"⚔️ {A} vs {B} — Deathroll started (ceiling {N})"`
- **Each roll** (at the point `game.stateUpdated` is published):
  `"🎲 {player} rolled {value} (1–{ceiling})"`
- **Match end** (replacing the current announcer call):
  - normal: `"💀 {loser} rolled 1 — {winner} wins!"`
  - forfeit/abandon: `"🏳️ {loser} forfeited — {winner} wins!"`

Remove the game-result Matrix persistence path:

- Stop calling `IGameAnnouncer.AnnounceResultAsync` for the persistent Matrix
  message. The `IGameAnnouncer` / `MatrixGameAnnouncer` abstraction is removed
  from the game result flow. Verify `MatrixService.SendChannelSystemMessageAsync`
  is not used elsewhere before removing it; if unused, remove it too, otherwise
  leave it in place.

## Client Changes

- `game.feed` is already forwarded generically by `MumbleAdapter`
  (`type.StartsWith("game.")`). Add a handler (App-level, where chat/channel
  context is available) that injects an ephemeral message into the target
  channel's chat store via `addMessage(text, 'system', …, systemType: 'game')`.
- Add `'game'` to `EPHEMERAL_TYPES` in `useChatStore` so `game` feed lines are
  rendered inline as system messages (existing `MessageBubble` `isSystem`
  styling) but purged from `localStorage` by `purgeEphemeralMessages` and never
  persisted.
- No new UI component and no new design tokens.

## Testing

- **Server:** `FakePublisher` already records channel broadcasts as
  `("channel", msg)`. Add tests asserting `game.feed` is broadcast to the channel
  on match start, on each roll, and on match end, with the expected text; and
  that the Matrix announcer is no longer invoked for results.
- **Client:** a unit test that a `game.feed` event adds a `systemType: 'game'`
  message to the correct channel, and that `purgeEphemeralMessages` removes it.
- **Docs:** update `docs/UI_GUIDE.md` to document the ephemeral game feed
  (system-style, live-only, never persisted).

## Copy / Emoji

Emoji-forward, fun tone (approved):
- Start: ⚔️
- Roll: 🎲
- Loss: 💀
- Forfeit/abandon: 🏳️
