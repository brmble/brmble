# Trusted Author Metadata Design

## Goal

Prevent arbitrary Matrix users from asserting `com.brmble.author_matrix_user_id` as trusted authorship metadata.

## Design

The server will expose one exact trusted bot Matrix ID, derived from `MatrixSettings.ServerDomain` using the same `@brmble:<domain>` identity used by `MatrixAppService`. `MatrixMessageMetadata.Parse` will only retain the custom author field when the event's actual `sender` exactly matches that trusted bot ID. The deletion service will pass the configured ID into parsing, so forged metadata falls back to the event sender before authorization.

The web credential payload will include the same `botUserId`. `transformEventToChatMessage` will accept that trusted ID and apply custom author metadata only when the event sender exactly matches it. Existing bridge display-name parsing remains unchanged.

## Testing

Server policy tests will verify that bot-authored metadata is retained and non-bot forged metadata is ignored. Web transformer tests will verify the same positive and negative cases. Credential equality tests will include the bot ID so a configuration change refreshes the client state.

## Scope

No changes to Matrix message format, deletion permissions, moderation rules, or existing author metadata producers are required.
