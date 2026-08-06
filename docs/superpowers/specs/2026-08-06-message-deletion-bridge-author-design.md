# Message Deletion for Mumble-Relayed Messages

## Goal

Allow a user to delete their own recent messages even when the message was relayed from Mumble by the Brmble Matrix bot. Preserve the existing authorization rules: authors may delete their own messages within 24 hours, administrators may delete any recent message, and other non-administrators may not delete someone else’s message.

## Root cause

Direct Matrix messages are authored by the user’s Matrix ID. Mumble-relayed messages are authored by the Brmble bot and currently put the Mumble display name only in the visible body prefix. The client and server therefore cannot safely determine the actual author. Admins can delete these messages through the moderation path, but non-admin authors cannot.

## Chosen design

When the authenticated server-side Mumble relay sends a message, it adds a dedicated event-content field containing the authenticated Matrix user ID. The visible body remains unchanged. The field is not accepted from the browser as an authorization claim; it is written only by the server relay using the authenticated sender mapping.

The server parses this field as the effective author and evaluates deletion against it. For direct Matrix messages, or older relayed messages without the field, the Matrix event sender remains the author. The browser uses the same effective-author field when deciding whether to show the Delete action. Admin capability remains a server-issued hint for UI visibility, with the server remaining authoritative.

## Data flow

1. The Mumble event handler receives an authenticated sender and calls the Matrix relay.
2. The relay writes `com.brmble.author_matrix_user_id` alongside the normal message content.
3. The Matrix client reads the field into `ChatMessage.senderMatrixUserId` for bridged messages.
4. The deletion endpoint parses the field and passes the effective author to the existing 24-hour policy.
5. Direct messages and legacy bridged events continue to use the Matrix event sender.

The metadata is an ownership hint only when produced by the trusted server relay. It is never accepted as a request-body override and cannot grant moderation rights.

## Testing

- Matrix deletion policy: a recent bridged message is allowed for its effective author and forbidden for another non-admin.
- Server integration: the relay writes the authenticated author metadata; the deletion endpoint permits that author and rejects another non-admin.
- Web transformation/eligibility: the metadata is exposed as the message sender identity and the Delete action appears for the author.
- Existing direct-message, administrator, expiry, redaction, and non-author tests remain passing.

## Scope

Keep the 24-hour window, redaction behavior, room authorization, and admin permission checks unchanged. Do not infer ownership from display names or visible body prefixes. No migration is required; old events use their actual Matrix sender.
