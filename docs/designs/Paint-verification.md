# Collaborative Paint Verification

## Automated

- `dotnet test Brmble.slnx`
- `npm run test`
- `npm run build`

## Manual Two-Client Check

1. Host and selected participant are in the same voice channel.
2. Host starts paint from the header and selects only the participant.
3. Only selected Matrix accounts receive the private room invitation.
4. Host joins the private room, uploads the source, and attaches its event.
5. The snapshot includes the Matrix room and source event identifiers.
6. The selected participant joins the private room and then the canvas.
7. A non-selected user in the channel is rejected.
8. Both active clients draw and see committed strokes in the same order.
9. Reconnecting retrieves a fresh snapshot and restores committed strokes.
10. Undo removes only the caller's latest active stroke; only the host can clear.
11. Save to chat includes the source and committed strokes, never uncommitted previews.
12. Ending calls `DeletePaintRoomAsync`; unsupported deletion records the best-effort leave and retryable cleanup instead of claiming deletion succeeded.
13. Confirm version 1 limitations: temporary sessions, restart loss, no offline mode, fixed tools/colors/widths, no GIF/SVG, and Windows-only.

## Captured Notes

- Automated vertical coverage verifies create, source attach, join, stroke, undo, clear, end, committed-event application, revision-gap refresh, and saved image messaging.
- Manual two-client and Matrix cleanup checks require a configured Matrix environment and were not run in this workspace.

## Pre-Release Verification Addendum

- Active invitation cards show **Join paint** for eligible users, including users who joined the voice channel after the paint session started.
- Ended, expired, and unavailable invitation cards do not show a usable Join button and use the exact inactive wording from the pre-release plan.
- Save to chat posts the PNG to the chat connected to the voice channel before ending the paint session, using a stable Matrix transaction id and `org.brmble.paintSaveOperationId`.
- Upload and chat-post failures keep the paint editor open and keep the session active.
- Upload or chat-post retries reuse the same composed PNG bytes and metadata for the same save operation.
- A successful chat post followed by a failed session end is retryable without posting the image again.
- WebSocket stroke payloads use numeric `width` values `3`, `6`, and `12`.
- WebSocket paint tools and paint session statuses remain camel-case strings.
- Drawing appears locally during pointer movement without waiting for server acknowledgement.
- Preview sends are throttled to one send per `50` milliseconds.
- Pointer release sends one committed stroke containing all captured points in order.
- Pointer cancellation clears the local in-progress stroke without committing.
- The local user does not see a duplicate stroke after receiving their own committed-stroke echo, and the locally submitted stroke does not disappear before that echo arrives.
