# Collaborative Paint Verification

## Automated gate

Run the complete suites for the migrated temporary-paint lifecycle:

- `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj`
- `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj`
- from `src/Brmble.Web`:
  - `npm test`
  - `npm run type-check`
  - `npm run build`
  - `npm run lint`

## Core lifecycle checks

The automated coverage should prove these behaviors:

- create → join → snapshot/source → stroke → undo → clear → end works through the public endpoints;
- a user who enters the host's voice channel after session start can discover the active session, explicitly join, and then receive the current source and committed canvas state;
- a user outside the session channel cannot retrieve temporary source bytes or participant-only snapshot data;
- ending one session makes its source unavailable and cleanup removes only that session's temporary directory while leaving another session's bytes untouched;
- restart recovery deletes orphan temporary source data when the previous in-memory session owner is gone.

## Manual multi-client check

Use three client states: Host, Alice, and Bob.

1. Put Host and Alice in the same voice channel. Keep Bob outside that channel.
2. Host starts Paint from the header and supplies a valid source image.
3. Confirm channel chat shows the active paint invitation state. No extra Matrix paint room lifecycle should be required for participation.
4. Alice sees **Join paint** but is not automatically added.
5. Alice clicks **Join paint** and then opens Paint.
6. Host draws at least one committed stroke.
7. Move Bob into the same voice channel after the session is already active.
8. Confirm Bob can discover the existing invitation, sees **Join paint**, joins explicitly, and receives both the source and the already committed stroke state.
9. Move Alice out of the voice channel.
10. Confirm her editor closes or loses access, and that source/snapshot/mutation requests are rejected while she is outside the channel.
11. Move Alice back into the voice channel.
12. Confirm the card offers **Join paint** again and the editor does not reopen until she explicitly rejoins.

## Save and ambiguous-end checks

These checks remain required and must stay exact:

1. Host uses **Save to chat**.
2. Confirm exactly one finished `m.image` is posted to the normal channel chat.
3. Confirm the saved image stays viewable after temporary cleanup removes the session source directory.
4. Force an upload failure and confirm the editor stays open, the session stays active, and retry reuses the exact same composed PNG file object and bytes instead of recomposing a new upload payload.
5. Force a timed-out normal-chat post and confirm retry reuses the same message content metadata and the same Matrix transaction identity instead of posting a distinct save attempt.
6. Force the ambiguous-end follow-up path: after the image post is already confirmed, make the first end attempt fail ambiguously and verify the client treats a terminal snapshot status as success without uploading or posting the normal-chat image again.

The recovery behavior above is still specified in [Paint-follow-up-ambiguous-end-recovery.md](Paint-follow-up-ambiguous-end-recovery.md).

## Cleanup and operator checks

1. End a session and confirm cleanup removes that session's temporary directory.
2. Start a second session and confirm cleanup of the first does not alter the second session's source bytes.
3. Simulate an ungraceful server interruption with an active temporary source still on disk, restart against the same data volume, and confirm the startup sweep removes the orphan directory.
4. Force temporary delete failures with `IOException` and `UnauthorizedAccessException`.
5. Confirm retries move cleanup rows from `pending` to `failed`, preserve only the session ID and error type, and eventually move to `terminal` without claiming deletion succeeded.
6. Inspect terminal failures with:

   `SELECT session_id, attempts, last_error, updated_at FROM paint_temporary_cleanup WHERE status = 'terminal' ORDER BY updated_at DESC;`

7. After fixing the underlying filesystem or permission issue for one reviewed session, requeue only that row with:

   `UPDATE paint_temporary_cleanup SET status = 'failed', attempts = 0, updated_at = CURRENT_TIMESTAMP, next_attempt_at = CURRENT_TIMESTAMP WHERE session_id = '<reviewed-session-guid>' AND status = 'terminal';`

8. Confirm the next cleanup sweep retries only that session and either succeeds or returns it through the normal failed → terminal retry path.

## Static audit checks

Run and review the Task 9 searches:

- removed Matrix-paint helper references must return zero current production/test matches;
- current paint runtime and wire models must have zero `matrixRoomId`, `mxcUrl`, `participantUserIds`, `sourceEventId`, and `sourcePreview` matches outside the explicit legacy parser allowlist;
- every allowlisted legacy parser match must be reviewed and confirmed to normalize away before current authorization or invitation behavior;
- `paint_room_cleanup` matches must remain legacy schema/history references only, not active cleanup processing.

## Notes

- Manual checks requiring live multi-client or operational failure injection are not covered by this workspace alone.
- The checked-in integration tests now use the real HTTP endpoints, real SQLite cleanup repository, and a temporary filesystem-backed source store.
