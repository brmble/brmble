# Message Deletion Actor Routing Design

## Goal

Restore message deletion for Brmble users while preserving the server-side policy: non-admins may delete only their own channel or DM messages within 24 hours, and admins may delete any channel or DM message within 24 hours.

## Root Cause

The Matrix redaction actor was changed to the authenticated requester for every room. That allows a user to redact their own event, but it prevents a Brmble administrator from deleting another user's channel message because the requester does not have sufficient Matrix power. Direct-message rooms also reject participant redactions under their current Matrix power-level defaults, so both own and other-user DM deletions fail.

## Design

1. Keep `MessageDeletionService` as the source of truth for Brmble authorization and the 24-hour deletion window.
2. Identify whether the requested room is a registered channel or a registered DM room.
3. For channel messages, redact through the Brmble bot, preserving the pre-requester behavior that permits server administrators to moderate other users' messages.
4. For DM messages, redact as the authenticated requester. Update DM room creation to define participant redaction permission explicitly so a joined participant can redact through Matrix. Brmble authorization still prevents non-admins from deleting another participant's message.
5. Preserve the existing optional actor parameter on `IMatrixAppService.RedactRoomEvent`; callers unrelated to message deletion continue to use the bot default.

## Error Handling

Authorization failures remain `403 not_authorized`, expired messages remain `410 expired`, and Matrix transport or authorization failures continue to be surfaced by the existing endpoint mapping. The service must not fall back from a DM requester to the bot, because the bot is not a participant in existing two-person DMs.

## Testing

Add policy/service coverage proving actor selection for registered channels and DMs. Extend integration coverage to verify:

- an ordinary user can delete their own recent channel message;
- an administrator can delete another user's recent channel message through the bot actor;
- an ordinary user can delete their own recent DM message through their own Matrix identity;
- an administrator can delete another user's recent DM message through their own Matrix identity;
- an ordinary user cannot delete another user's recent message;
- the 24-hour limit and existing invalid/already-deleted behavior remain unchanged.

Add Matrix app-service coverage proving the channel path retains the bot default and the DM path includes the requester actor. Keep the test changes scoped to message deletion and DM room power-level construction.

## Scope

This change does not alter message display, frontend eligibility, Matrix user identity validation, room membership, or unrelated bot-owned redactions.
