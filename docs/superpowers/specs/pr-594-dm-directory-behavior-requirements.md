# PR #594: Direct Message Directory — Required Behavior

## Purpose of this report

This document describes the intended user experience and behavioral requirements for [Brmble PR #594](https://github.com/brmble/brmble/pull/594).

The pull request is intended to expand the Direct Message sidebar so that users can discover people before a conversation exists. The current change is close to that goal, but it does not consistently distinguish between a person's registered Brmble identity and the client through which that person is currently connected.

This report defines what the feature must do. It intentionally does not prescribe an implementation.

## Core product rule

Two separate facts determine Direct Message behavior:

1. **Account identity determines persistent visibility.** A registered Brmble user has a persistent Matrix identity and should remain discoverable in the **Messages** section, even while offline and even when no previous DM conversation exists.
2. **The currently connected client determines the live delivery route.** A user connected through the Brmble client can receive a Matrix DM. A user connected through a standard Mumble client must receive an original Mumble private message, even if that person also owns a registered Brmble account.

The presence of a Matrix identity alone must not be treated as proof that the user's current client can receive Matrix messages.

## Goals

The completed feature must:

- Make every registered Brmble user discoverable in the persistent **Messages** directory.
- Make every eligible user currently connected through a standard Mumble client discoverable under **Mumble users**.
- Select the delivery transport according to the recipient's currently connected client.
- Preserve the existing behavior of Matrix DMs, including persistent rooms and history.
- Preserve the existing behavior of Mumble private messages, including session-based delivery and ephemeral history.
- Allow a registered Brmble user to appear in both sections when both entries represent valid but different messaging routes.
- Prevent an online Brmble-client user from being unnecessarily duplicated under **Mumble users**.
- Ensure that selecting a directory entry and sending the first message works even when no conversation with that entry existed previously.
- Keep the two types of contacts visually and behaviorally understandable to the sender.

## Non-goals

This work is not intended to:

- Merge Matrix and Mumble messages into one shared conversation.
- Synchronize Mumble private-message history into Matrix.
- Make Mumble private messages persistent across a local disconnect.
- Change how Matrix rooms are created for first-time Brmble DMs.
- Change the underlying Matrix or Mumble messaging protocols.
- Assume that owning a Brmble account means the person is currently using the Brmble client.
- Deduplicate two entries when doing so would hide a valid messaging route.

## Terminology

### Registered Brmble user

A person who has a persistent Brmble/Matrix identity. This identity exists independently of whether the person is online and independently of which client they are currently using.

### Brmble-client connection

An active connection made through the Brmble client. This connection supports the Brmble Matrix DM experience.

### Standard Mumble connection

An active connection made through a non-Brmble Mumble client. This connection supports the original session-based Mumble private-message experience.

A person using a standard Mumble client may still be a registered Brmble user. Registration and active-client capability are separate concepts.

### Persistent Message entry

An entry under **Messages** representing a registered Brmble/Matrix identity. Messages sent through this entry use Matrix and belong to the persistent DM conversation.

### Mumble user entry

An entry under **Mumble users** representing a currently reachable Mumble session. Messages sent through this entry use the original Mumble private-message route and remain ephemeral.

## Authoritative behavior matrix

| Recipient state | Show under Messages | Show under Mumble users | Transport from Messages | Transport from Mumble users |
| --- | --- | --- | --- | --- |
| Registered Brmble user, offline | Yes | No | Matrix | Not applicable |
| Registered Brmble user, online through Brmble client | Yes | No | Matrix | Not applicable |
| Registered Brmble user, online through standard Mumble client | Yes | Yes | Matrix | Mumble private message |
| Unregistered user, online through standard Mumble client | No | Yes | Not applicable | Mumble private message |
| Unregistered Mumble user, offline and with no active ephemeral conversation | No | No | Not applicable | Not applicable |
| Current local user | No | No | Not applicable | Not applicable |

## Why a registered user may correctly appear twice

When a registered Brmble user is online through a standard Mumble client, two entries are intentional:

- The **Messages** entry represents the person's persistent Brmble identity. Selecting it opens or creates the Matrix DM conversation.
- The **Mumble users** entry represents the person's currently connected Mumble session. Selecting it starts or opens the ephemeral Mumble private-message conversation.

These are not accidental duplicates. They are two different communication routes with different delivery characteristics and different history behavior.

The UI should preserve that distinction instead of silently deciding that the persistent identity replaces the currently reachable Mumble session.

## Client capability must control live routing

The product must decide how to contact an online user based on the client the recipient is currently using:

- If the recipient is connected through the Brmble client, the Brmble/Matrix route is available.
- If the recipient is connected through a standard Mumble client, the original Mumble private-message route is the live route.

A standard Mumble connection must continue to behave like a standard Mumble connection even when the username can be associated with a registered Brmble account or Matrix identity.

This is important because a Matrix identity may be known for identification purposes while the recipient's current client is unable to display or receive the Matrix conversation in real time.

## Expected behavior by section

### Messages

The **Messages** section must contain:

- Existing Matrix DM conversations.
- Registered Brmble users with whom no DM room exists yet.
- Registered Brmble users who are offline.
- Registered Brmble users who are currently online through either client type.

Selecting a registered Brmble user must open the person's persistent Matrix conversation. If this is the first message, the Matrix DM room should continue to be created only when the message is sent.

Existing previews, unread state, avatars, names, history, and room behavior should remain intact.

### Mumble users

The **Mumble users** section must contain eligible users who are currently connected through a standard Mumble client, including:

- Users without a Brmble registration.
- Registered Brmble users who happen to be using a standard Mumble client for the current connection.

It must not contain:

- The current local user.
- A remote user whose active connection is through the Brmble client.
- An automatically discovered offline user who has no remaining ephemeral conversation state under the existing Mumble DM behavior.

The Mumble entry must retain the established visual and behavioral cues that it is ephemeral.

## Selecting and messaging a first-time Mumble directory contact

The central new interaction is messaging someone listed under **Mumble users** before any previous private conversation exists.

The complete user flow must be:

1. An eligible standard-Mumble user becomes visible under **Mumble users** while online.
2. The sender selects that entry.
3. The DM view clearly identifies the conversation as a Mumble direct message.
4. The composer is enabled while the recipient has an active session.
5. Sending the first message uses the recipient's current Mumble session.
6. The sent message appears in the ephemeral conversation immediately.
7. No Matrix room request is made for this interaction.
8. The recipient receives the message through the standard Mumble private-message mechanism.

Displaying the contact without making this flow work is not sufficient. Contact discovery and message delivery are one feature from the user's perspective.

## Selecting the persistent entry for a registered standard-Mumble user

If a registered user is currently connected through standard Mumble, the sender may still deliberately select that person's entry under **Messages**.

That selection must continue to represent the persistent Matrix identity and must use Matrix. It must not silently switch to Mumble merely because the person is currently online through standard Mumble.

The sender chooses the route by choosing the section and entry:

- **Messages entry:** persistent Matrix conversation.
- **Mumble users entry:** live, ephemeral Mumble conversation.

## Presence and lifecycle expectations

### When a standard-Mumble user connects

- The user should appear under **Mumble users** once the connection is known and is eligible for private messaging.
- If the person is also registered with Brmble, the existing **Messages** entry remains present.

### When a standard-Mumble user disconnects

- The disconnected session must no longer be treated as a valid send target.
- The composer must not send to a stale session.
- Any handling of an already-open ephemeral conversation should preserve the established Mumble DM lifecycle and offline behavior.
- A directory-only Mumble entry with no retained conversation should no longer appear as an online user.

### When a user reconnects through standard Mumble

- The Mumble entry must use the new active session.
- Messages must not be sent to the previous session.
- Existing ephemeral state may resume only to the extent supported by the current product behavior.

### When a user changes from standard Mumble to the Brmble client

- The persistent **Messages** entry remains.
- The user should no longer be offered as an active standard-Mumble entry once the old Mumble-client session is gone.
- New communication through the Brmble-client presence should use Matrix.

### When a user changes from the Brmble client to standard Mumble

- The persistent **Messages** entry remains.
- A separate **Mumble users** entry should appear for the active standard-Mumble session.
- The Mumble entry must use the ephemeral Mumble route.

### When the local user disconnects

- Ephemeral Mumble conversation state should continue to follow the existing disconnect behavior and must not be presented as persistent history.
- Persistent Matrix DM identity and room behavior should remain consistent with the existing product lifecycle.

## Display-name and identity expectations

- A persistent entry must be identified by the registered Brmble/Matrix identity.
- A Mumble entry must represent the active Mumble user and session.
- A current online display name may be shown where appropriate, but it must not change which transport the entry represents.
- Two visible entries with the same display name are acceptable when one is the persistent Matrix route and the other is the active Mumble route.
- The Mumble entry must remain visually distinguishable so the sender understands that its history and delivery behavior differ from the persistent entry.

## Unread and conversation-state expectations

- Existing Matrix unread tracking must remain unchanged.
- Existing Mumble unread tracking must remain unchanged.
- Reading one route must not incorrectly clear unread state belonging to the other route.
- A Matrix conversation and a Mumble conversation for the same person are separate conversations.
- A message preview from one route must not appear on the other route's entry.
- Closing or losing an ephemeral Mumble conversation must not remove the person's persistent Brmble entry.

## Search expectations

- Search should match users in both sections.
- A registered standard-Mumble user may produce two matching results because two valid routes exist.
- Search results must retain the section and transport distinction.
- Empty-state copy should refer to users where the directory is being searched, not only to existing conversations.

## Failure conditions the PR must avoid

The completed PR must not allow any of the following:

- A certificate hash or other Mumble contact identifier being submitted as a Matrix user ID.
- A first-time Mumble directory contact appearing selectable while messages are routed through Matrix.
- A registered standard-Mumble user being removed from **Mumble users** merely because a Matrix identity is known.
- A standard-Mumble session being treated as Brmble-capable based only on account registration or username mapping.
- A message being sent to a stale Mumble session after disconnect or reconnect.
- A standard-Mumble user being duplicated under **Mumble users** and also routed through Mumble from the **Messages** entry.
- A Brmble-client user being unnecessarily duplicated as a standard-Mumble contact.
- Matrix and Mumble histories being combined or confused.

## Required acceptance scenarios

The change should not be considered complete until all of the following behaviors have been verified.

### Scenario 1: Offline registered user with no existing conversation

- The user appears under **Messages**.
- The user does not appear under **Mumble users**.
- Selecting the entry opens an empty persistent DM view.
- Sending the first message follows the Matrix room-creation flow.

### Scenario 2: Online Brmble-client user

- The user appears under **Messages**.
- The user does not appear under **Mumble users**.
- Sending from the entry uses Matrix.

### Scenario 3: Online unregistered standard-Mumble user

- The user appears under **Mumble users**.
- The user does not appear under **Messages**.
- Selecting the user and sending the first message uses the active Mumble session.
- No Matrix operation is attempted.

### Scenario 4: Registered user online through standard Mumble

- The user appears under **Messages** as a persistent identity.
- The user also appears under **Mumble users** as an active Mumble session.
- Sending from **Messages** uses Matrix.
- Sending from **Mumble users** uses the Mumble private-message route.
- The two conversations retain separate histories and unread state.

### Scenario 5: First-time Mumble directory message

- The contact has no previous Mumble conversation state.
- Selecting the automatically listed contact enables the correct Mumble conversation.
- The first send succeeds through Mumble.
- The sent message appears in the ephemeral history.
- The operation does not attempt to create a Matrix room.

### Scenario 6: Mumble recipient reconnects with a new session

- The contact reflects the new active session.
- A subsequent message reaches the new session.
- No message is sent to the stale session.

### Scenario 7: Recipient changes client type

- Moving from standard Mumble to Brmble removes the active Mumble route when the old session ends while retaining the persistent entry.
- Moving from Brmble to standard Mumble adds the active Mumble route while retaining the persistent entry.
- Each entry continues to use the transport it represents.

### Scenario 8: Local disconnect

- Ephemeral Mumble history follows the existing clearing behavior.
- The application does not present ephemeral Mumble history as persistent.
- Persistent Matrix identity and room data continue to follow existing behavior.

## Definition of done

PR #594 is ready when:

- The sidebar represents persistent identities and active Mumble sessions as separate concepts.
- Active-client capability, rather than the mere presence of a Matrix identity, determines whether an online user belongs under **Mumble users**.
- A registered user connected through standard Mumble can intentionally be contacted through either route by selecting the corresponding entry.
- Every newly listed Mumble contact is fully usable on first selection and first send.
- Existing Matrix and Mumble behavior remains intact outside the directory expansion.
- The acceptance scenarios above are covered by behavioral verification, including transport assertions rather than only checking that contacts appear.

