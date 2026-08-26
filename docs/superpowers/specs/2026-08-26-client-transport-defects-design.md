# Client Transport Defects — Design

Fixes the two client transport defects deferred in
`docs/superpowers/reviews/2026-07-28-duel-orchestration-queue-review.md`
("Deferred — not Project 1 work", items 1 and 3). Both are still present on
`main` as of `dd505be4`; every line reference below was verified against that
commit.

Item 2 of that section (`/games/action` ownership check) is server work and is
out of scope here.

## Defect 1 — NativeBridge loses flush triggers

`src/Brmble.Client/Bridge/NativeBridge.cs`

`NotifyUiThread()` (line 128) posts one `WM_USER` per event and discards
`PostMessage`'s return value, though the P/Invoke is declared returning `bool`
at line 25. `MumbleAdapter.cs` calls it from 101 sites, about one per forwarded event. A thread's posted-message queue is capped at 10,000 by
default; past that `PostMessage` returns FALSE and is silently ignored. The
flush trigger is then lost while `_pendingMessages` (line 36, unbounded) keeps
growing.

The bug is the lost wakeup. The queue growth is its symptom.

`ProcessUiMessage()` (lines 88-110) is *not* part of the problem: it already
drains the whole queue into a single `PostWebMessageAsJson` call, wrapping
multiple messages in a JSON array. The missing coalescing is on the notify
side. The batching is left alone.

### Design

Two new fields:

```csharp
private int _notifyPending;
private Func<IntPtr, uint, IntPtr, IntPtr, bool> _postMessage = PostMessage;
```

`NotifyUiThread()` claims, then posts:

- `Interlocked.CompareExchange(ref _notifyPending, 1, 0) != 0` — a post is
  already outstanding, so return without posting.
- Otherwise invoke `_postMessage`. If it returns false, reset `_notifyPending`
  to 0 and log `Marshal.GetLastWin32Error()`.

Resetting on failure is what makes the path self-healing. Nothing retries on a
timer and nothing blocks; the next `NotifyUiThread()` call — of which there are
many — reclaims and reposts. A failure that happens to be the last event before
a quiet period leaves messages queued until the next event, which is
acceptable: those messages had no consumer waiting anyway.

`ProcessUiMessage()` resets `_notifyPending` **before** draining. Order is
load-bearing. Draining first would leave a window in which a `Send` enqueues a
payload, calls `NotifyUiThread()`, observes the flag still set, skips its post,
and leaves the payload queued with no pending wakeup until an unrelated later
event. Resetting first means anything enqueued after the drain triggers a fresh
post, and anything enqueued during the drain is drained regardless — at worst
producing one redundant `WM_USER` that finds an empty queue.

### Deliberately not done

**No bound on `_pendingMessages`, and no drop policy.** With notify-side
coalescing the 10,000 cliff is unreachable rather than merely bounded, which
removes the mechanism that made unbounded growth dangerous. A bound would
require a drop policy, and no safe uniform one exists: duel queue snapshots are
replaceable (revision-gated with exponential-backoff recovery in
`src/Brmble.Web/src/components/Games/useDuelQueueState.ts`, lines 114 and
137-145) and spectator snapshots likewise, but terminal and lifecycle events
are not. `src/Brmble.Server/Games/Spectators/SpectatorService.cs` lines 138-144
document exactly that failure: lose a terminal event and "spectators of the
live match are stuck on a board that never ends." A drop-oldest or drop-newest
policy can therefore strand the UI. Classifying every `Send` site to protect a
critical subset would leave the bound unenforceable against that subset anyway.

Unbounded growth now requires a permanently wedged UI thread, at which point
the application is already unusable and memory is not the presenting problem.

**No strict one-outstanding-post invariant.** `Flush()` delegates to
`ProcessUiMessage()`, so a UI-thread `Flush()` racing an outstanding post
resets the flag and permits a second post. The real invariant is "at most a
small handful outstanding" — four orders of magnitude below the cliff.
Splitting `Flush` from `ProcessUiMessage` to buy strictness is not worth the
additional code path.

**No call-site changes in `MumbleAdapter.cs`.** Coalescing lives entirely
inside `NotifyUiThread()`, so all 101 call sites are untouched.

### Testability

`_postMessage` is a private delegate field rather than a direct static
P/Invoke. `NativeBridgeTestHarness` in
`tests/Brmble.Client.Tests/Services/MumbleAdapterParseTests.cs` already
constructs bridges via `RuntimeHelpers.GetUninitializedObject` and seeds
private fields by reflection, so tests substitute a fake poster — including one
that returns false — with no production API change. `NativeBridge` stays
sealed and its constructor signature is unchanged.

### Tests

New file `tests/Brmble.Client.Tests/Bridge/NativeBridgeNotifyTests.cs`:

1. Repeated `NotifyUiThread()` calls with no intervening `ProcessUiMessage()`
   produce exactly one post.
2. A `NotifyUiThread()` after `ProcessUiMessage()` posts again.
3. A post returning false leaves the next `NotifyUiThread()` able to post
   (self-healing).
4. Every payload enqueued while notifications were coalesced still arrives in
   the drain — coalescing must not cost messages.

## Defect 2 — DecodeChunkedBody counts characters, not bytes

`src/Brmble.Client/Services/Voice/MumbleAdapter.cs`, lines 1385-1408.

The socket buffer is UTF-8 decoded to a `string` before chunk parsing
(`ParseHttpResponse(string)` at line 1352, body extracted at line 1369), but
HTTP chunk sizes are byte counts per RFC 7230 while the code indexes UTF-16
chars: the bounds check at line 1401, `body.AsSpan(offset, size)` at line 1402
and `offset += size` at line 1403 are all in char units.

Any non-ASCII byte desynchronises the decoder. The chunk absorbs the following
CRLF and size line, the CRLF check at line 1404 fails, the loop breaks, and the
body is silently truncated. `JsonDocument.Parse` then throws and the whole
request fails. This is reachable in production: duel and game error messages
carry usernames.

### Design

`ParseHttpResponse` takes `byte[]` instead of `string`. Both call sites
(lines 1284 and 1338) already hold `ms.ToArray()` wrapped in
`Encoding.UTF8.GetString` and simply pass the array through.

- The status line terminator and the `\r\n\r\n` / `\n\n` header separator are
  located in byte space.
- The header block is UTF-8 decoded — it is ASCII — so the existing
  `Transfer-Encoding: chunked` check is unchanged.
- `DecodeChunkedBody` takes `ReadOnlySpan<byte>`. Each chunk size is parsed as
  hex from the ASCII size line, exactly *size bytes* of payload are copied, and
  UTF-8 decoding happens once over the fully assembled body.
- The chunk-size parse, `;` extension stripping, zero-chunk termination, bounds
  check, CRLF-terminator check and final `Trim()` all keep their current shape.
  Only the unit changes from chars to bytes.

The alternative of re-encoding the already-decoded string inside
`DecodeChunkedBody` was rejected: input that is not valid UTF-8 has already had
its bytes replaced with U+FFFD by the first decode, so the re-encode cannot
recover the original offsets.

### Tests

`Command_ChunkedServerErrorThroughAdapter_PreservesStructuredReason` in
`tests/Brmble.Client.Tests/Services/GameServiceTests.cs` (line 114) exercises
only pure-ASCII chunks and therefore currently cements the bug as "verified
correct". The review states it "should not be trusted as coverage of this
path." It is updated to encode its literal and otherwise left as an ASCII
regression guard.

A new sibling test carries a multibyte username, so each chunk's byte length
exceeds its char length. It must be observed failing against the current
implementation — truncated body, `JsonDocument.Parse` throwing — before the fix
lands.

## Verification

- `dotnet build`
- `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj`
- `dotnet test`

## Out of scope

- Arena Knockoff. Its plan needs a spec revision first: its client half is
  written against `ForegroundActivity` and `setRemotePlaybackPaused`, which do
  not exist.
- The one-live-match-per-channel assumption at
  `src/Brmble.Server/Games/Spectators/SpectatorService.cs` lines 24-35.
- The `/games/action` ownership check (item 2 of the deferred list).
- Any further minigame work.
