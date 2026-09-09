# Paint Voice-Membership Guard Design

## Goal

Keep an active collaborative Paint editor open while the user browses other channel chats, server chat, or direct messages, and close it immediately when the user actually leaves, disconnects from, or moves away from the Paint session's voice channel.

## Root Cause

`App` currently uses `currentChannelId` for two Paint lifecycle decisions even though that state represents the selected channel conversation. The sidebar changes it on a single-click, while joining voice is a separate action. As a result, chat navigation is incorrectly treated as a voice-membership change.

The actual local voice channel is already represented by the self user's `channelId`, together with connection and leave-voice state. `PaintSessionView` must receive that actual membership state rather than the selected conversation.

## Design

Use the existing App state and keep the change local to Paint orchestration:

- Record the active Paint session's channel from the local user's actual voice channel when the editor opens or setup completes.
- Pass actual voice membership to `PaintSessionView`.
- Preserve an unknown state while voice membership is still loading so Paint is not closed prematurely.
- Represent confirmed absence from voice when the app disconnects or Leave Voice is active so the editor closes immediately.
- Change the App-level Paint close effect to compare the active Paint channel with actual voice membership, not `currentChannelId`.
- Keep chat, server-chat, and DM selection independent from Paint lifecycle.

The server remains authoritative for participation and mutation authorization. This client guard is responsible for promptly removing editor access from the UI.

## State Semantics

Paint membership has three meaningful states:

- `unknown`: the app is connected but has not yet received a self user/channel; do not close solely for this state.
- `present(channelId)`: compare the actual self voice channel with the active Paint channel and close on mismatch.
- `absent`: the app is disconnected or Leave Voice is confirmed; close an active editor.

Root channel ID `0` is treated as absence from a usable Paint voice channel.

## Testing

Add App-level regression coverage that opens Paint and proves:

- selecting a different channel chat keeps the editor open;
- switching to a DM keeps the editor open;
- selecting server chat keeps the editor open;
- an actual voice move closes the editor;
- Leave Voice or disconnect closes the editor;
- a temporarily unknown self voice channel does not close the editor.

Retain focused `PaintSessionView` coverage for mismatched actual voice membership. Tests must exercise the App wiring so a selected-chat ID cannot accidentally be passed as voice membership again.

## Out of Scope

- Changing server-side Paint authorization or participation rules.
- Reworking general channel/chat selection behavior.
- Refactoring Paint orchestration into a new hook.
