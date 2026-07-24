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
