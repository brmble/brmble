# Design: ACL Editor Usability Pass

## Goal

Make the channel ACL editor understandable to non-expert admins by replacing the current raw-row mental model with a clear split:

- left side for shared access paths and groups
- right side for individual user access

The primary usability problems to solve are:

- the current selector field does not communicate whether it expects a token, group, numeric user id, or name
- the current rule list exposes low-level ACL structure before the user understands what they are editing
- password protection is separated conceptually from the rest of channel access, even though it is implemented through ACL token rules

## Approved Direction

The approved UI direction is a two-pane ACL editor:

- Left pane title: `What groups can join this channel`
- Right pane title: `Which users can join this channel`

This wording is intentional. It explains the data model before the admin interacts with it.

## Left Pane

The left pane is the readable overview of shared access paths.

It should show cards or strongly separated list items for:

- channel password access
- token-based access
- named group access
- other shared join paths that are not specific to a single person

Each item should be visually labeled by type so the admin can distinguish:

- `Password`
- `Token`
- `Group`

Each item should summarize the key effective permissions in plain language, such as:

- `Allow enter`
- `Allow traverse`
- `Allow speak`
- `Allow text`

### Password placement

Password access should live in the left pane as one of the shared access paths, not as a disconnected hidden setting elsewhere.

The password card should:

- remain visible in the same access model as other join rules
- allow setting, updating, or removing the password
- explain that Brmble manages a native Mumble token-backed password rule underneath
- avoid implying that other token rules are changed when editing the password

This keeps the mental model simple: all shared ways to enter the channel are visible in one place.

## Right Pane

The right pane is for individual people only.

It should support:

- searching users by visible username
- showing whether a user is already covered by a left-side group or password path
- adding direct user access without typing raw numeric ids
- reviewing and editing direct user exceptions

This pane must not force the admin to understand raw Mumble user ids.

## Interaction Model

The editor should behave like this:

1. Admin opens channel permissions.
2. Left pane immediately shows shared access paths for the channel.
3. Right pane shows user search and direct user access tools.
4. If the admin selects or focuses a left-side item, the right pane may show related context, but it remains a user-oriented panel.
5. Advanced ACL details can exist behind a secondary disclosure later, but the default screen remains human-readable.

## Language and Framing

The editor should prefer human wording over raw ACL terminology on the primary surface.

Use:

- `What groups can join this channel`
- `Which users can join this channel`
- `Channel password`
- `Direct user access`

Avoid leading with:

- `Selector`
- raw `userId`
- unlabeled mixed rule rows

Low-level ACL details can still exist internally and in advanced UI, but they should not define the first experience.

## Technical Implications

This usability pass changes presentation first, not the underlying canonical ACL model.

The implementation should continue to preserve:

- Mumble as the source of truth
- native ACL/token behavior
- existing snapshot and save flow
- password-token management semantics already used by Brmble

The UI layer should introduce a clearer local view model that distinguishes:

- shared access entries
- direct user entries
- managed password entry

without breaking the existing server-side ACL DTOs.

## Non-Goals

This pass does not require:

- replacing Mumble ACL semantics
- adding Brmble-only authorization rules
- removing advanced ACL editing forever
- inventing a second password system outside ACL-backed token behavior

## Success Criteria

The redesign is successful if:

- admins no longer need to guess what the selector field expects
- password protection is visible as part of channel access
- groups and users are clearly separated visually and conceptually
- direct user access can be granted without typing raw ids
- the default editor communicates channel access structure at a glance

## Implementation Notes

Recommended first implementation slice:

1. Replace the current mixed local rules list with the two-pane layout.
2. Add a dedicated left-side password card wired to the existing password-token mechanism.
3. Introduce a user-facing view model for left-side group/token/password entries and right-side direct user entries.
4. Keep advanced/raw ACL editing out of the first pass unless required as a fallback.

