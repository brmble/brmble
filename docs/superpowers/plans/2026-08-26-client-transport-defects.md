# Client Transport Defects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `NativeBridge` from silently losing UI flush triggers, and stop `DecodeChunkedBody` from truncating any HTTP chunked response containing non-ASCII bytes.

**Architecture:** `NotifyUiThread()` gains a claim-then-post dirty flag so at most one `WM_USER` is outstanding, and honours `PostMessage`'s return value by releasing the claim on failure so the next of the 129 client-wide call sites (101 of them in `MumbleAdapter.cs`) retries. `ParseHttpResponse` moves from `string` to `byte[]` so chunk sizes are applied in byte space, as RFC 7230 requires.

**Tech Stack:** C# / .NET 10 (`net10.0-windows`), MSTest 3.7.3, Win32 P/Invoke, WebView2.

**Spec:** `docs/superpowers/specs/2026-08-26-client-transport-defects-design.md`

## Global Constraints

- Never commit to `main`. All work lands on branch `fix/client-transport-defects`.
- Test project is MSTest: `[TestClass]`, `[TestMethod]`, `[DataTestMethod]`, `Assert.AreEqual(expected, actual)`. No xUnit, no FluentAssertions.
- `NativeBridge` stays `sealed`; its public constructor signature does not change.
- Do **not** add a bound or a drop policy to `_pendingMessages`. Do **not** modify the batching logic in `ProcessUiMessage`. Do **not** modify any of the 101 `NotifyUiThread()` call sites in `MumbleAdapter.cs`, nor the other 28 elsewhere in the client (129 total across 10 files).
- Every task ends in a commit. Commit message prefixes: `fix:`, `test:`, `refactor:`.

---

## File Structure

**Modified**
- `src/Brmble.Client/Bridge/NativeBridge.cs` — notify coalescing, post-failure handling, `_postMessage` test seam, nullable `_webView` guard.
- `src/Brmble.Client/Services/Voice/MumbleAdapter.cs` — `ParseHttpResponse` / `DecodeChunkedBody` byte-space rewrite plus its two call sites.
- `tests/Brmble.Client.Tests/Services/MumbleAdapterParseTests.cs` — extend `NativeBridgeTestHarness` (seed `_postMessage`, record posts).
- `tests/Brmble.Client.Tests/Services/GameServiceTests.cs` — update the ASCII chunked test to the new signature, add the multibyte test.

**Created**
- `tests/Brmble.Client.Tests/Bridge/NativeBridgeNotifyTests.cs` — coalescing and post-failure tests.

---

### Task 1: Notify-side coalescing

**Files:**
- Modify: `src/Brmble.Client/Bridge/NativeBridge.cs:25,33,36,88-110,126-129`
- Modify: `tests/Brmble.Client.Tests/Services/MumbleAdapterParseTests.cs:24-62`
- Create: `tests/Brmble.Client.Tests/Bridge/NativeBridgeNotifyTests.cs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `NativeBridge` private field `Func<IntPtr, uint, IntPtr, IntPtr, bool> _postMessage`; `NativeBridge` private field `int _notifyPending`; harness method `NativeBridgeTestHarness.RecordPosts(NativeBridge bridge, Func<bool>? result = null)` returning `List<(IntPtr Hwnd, uint Msg)>`. Task 2 uses the `result` parameter.

**Critical background for the implementer.** `NativeBridgeTestHarness.Create()` builds a `NativeBridge` with `RuntimeHelpers.GetUninitializedObject`, which **skips all field initialisers**. So a new `_postMessage` field initialised inline will be `null` on every harness-built bridge, and the many existing tests that reach `_bridge?.NotifyUiThread()` through `MumbleAdapter` would start throwing `NullReferenceException`. `Create()` must seed `_postMessage`. For the same reason `_webView` is `null` on harness bridges, which is why `DrainMessages` reads the queue directly instead of calling `ProcessUiMessage`; to test the drain path we make `_webView` nullable and guard it.

- [ ] **Step 1: Seed `_postMessage` in the shared harness and add post recording**

In `tests/Brmble.Client.Tests/Services/MumbleAdapterParseTests.cs`, inside `NativeBridgeTestHarness`, add the seed line to `Create()` and add the two new methods:

```csharp
    public static NativeBridge Create()
    {
        var bridge = (NativeBridge)RuntimeHelpers.GetUninitializedObject(typeof(NativeBridge));
        SetField(bridge, "_handlers", new Dictionary<string, List<Func<JsonElement, Task>>>());
        SetField(bridge, "_pendingMessages", new ConcurrentQueue<string>());
        // GetUninitializedObject skips field initialisers, so _postMessage would be null
        // and every NotifyUiThread() call through MumbleAdapter would throw.
        SetField(bridge, "_postMessage", new Func<IntPtr, uint, IntPtr, IntPtr, bool>((_, _, _, _) => true));
        return bridge;
    }

    /// <summary>
    /// Replaces the bridge's post delegate with a recorder. The returned list
    /// accumulates one entry per PostMessage call. <paramref name="result"/>
    /// controls what the fake PostMessage returns; null means always succeed.
    /// </summary>
    public static List<(IntPtr Hwnd, uint Msg)> RecordPosts(NativeBridge bridge, Func<bool>? result = null)
    {
        var posts = new List<(IntPtr Hwnd, uint Msg)>();
        SetField(bridge, "_postMessage", new Func<IntPtr, uint, IntPtr, IntPtr, bool>((hwnd, msg, _, _) =>
        {
            posts.Add((hwnd, msg));
            return result?.Invoke() ?? true;
        }));
        return posts;
    }

    public static void Enqueue(NativeBridge bridge, string json)
        => ((ConcurrentQueue<string>)GetField(bridge, "_pendingMessages")).Enqueue(json);
```

- [ ] **Step 2: Write the failing coalescing tests**

Create `tests/Brmble.Client.Tests/Bridge/NativeBridgeNotifyTests.cs`:

```csharp
using Brmble.Client.Bridge;
using Brmble.Client.Tests.Services;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Bridge;

[TestClass]
public class NativeBridgeNotifyTests
{
    [TestMethod]
    public void Notify_CalledRepeatedlyWithoutProcessing_PostsOnce()
    {
        var bridge = NativeBridgeTestHarness.Create();
        var posts = NativeBridgeTestHarness.RecordPosts(bridge);

        bridge.NotifyUiThread();
        bridge.NotifyUiThread();
        bridge.NotifyUiThread();

        Assert.AreEqual(1, posts.Count);
    }

    [TestMethod]
    public void Notify_AfterProcessUiMessage_PostsAgain()
    {
        var bridge = NativeBridgeTestHarness.Create();
        var posts = NativeBridgeTestHarness.RecordPosts(bridge);

        bridge.NotifyUiThread();
        bridge.NotifyUiThread();
        bridge.ProcessUiMessage();
        bridge.NotifyUiThread();

        Assert.AreEqual(2, posts.Count);
    }

    [TestMethod]
    public void Notify_WhileCoalesced_LosesNoMessages()
    {
        var bridge = NativeBridgeTestHarness.Create();
        NativeBridgeTestHarness.RecordPosts(bridge);

        for (var i = 0; i < 50; i++)
        {
            NativeBridgeTestHarness.Enqueue(bridge, $"{{\"type\":\"t\",\"data\":{i}}}");
            bridge.NotifyUiThread();
        }

        var drained = NativeBridgeTestHarness.DrainMessages(bridge);
        Assert.AreEqual(50, drained.Count);
    }
}
```

- [ ] **Step 3: Run the tests and verify they fail for the right reason**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter NativeBridgeNotifyTests`

Expected: all four tests (three new, plus every existing harness-using test) FAIL at runtime with `NullReferenceException` thrown from `NativeBridgeTestHarness.SetField` — `GetField(...)!` returns null because `NativeBridge` has no `_postMessage` field yet. This confirms the seam is genuinely absent. Do not proceed until you have seen it.

- [ ] **Step 4: Add the `_postMessage` seam and the `_webView` guard — but not coalescing yet**

In `src/Brmble.Client/Bridge/NativeBridge.cs`:

Change the `_webView` field to nullable and add `_postMessage` alongside the existing fields:

```csharp
    private readonly CoreWebView2? _webView;
    private readonly Dictionary<string, List<Func<JsonElement, Task>>> _handlers = new();
    private IntPtr _hwnd;
    private readonly ConcurrentQueue<string> _pendingMessages = new();
    private Func<IntPtr, uint, IntPtr, IntPtr, bool> _postMessage = PostMessage;
```

In the constructor, subscribe through the parameter rather than the field so nullability analysis stays quiet:

```csharp
    public NativeBridge(CoreWebView2 webView, IntPtr hwnd)
    {
        _webView = webView;
        _hwnd = hwnd;
        webView.WebMessageReceived += OnWebMessageReceived;
    }
```

In `ProcessUiMessage`, guard the WebView2 send. Tests construct bridges without a WebView2, so the drain must be observable without one:

```csharp
        if (batch.Count == 0)
            return;

        if (_webView is null)
            return;

        if (batch.Count == 1)
```

In `NotifyUiThread`, route through the delegate:

```csharp
    public void NotifyUiThread()
    {
        _postMessage(_hwnd, WM_USER, IntPtr.Zero, IntPtr.Zero);
    }
```

- [ ] **Step 5: Run the tests and confirm the defect is real**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter NativeBridgeNotifyTests`

Expected: `Notify_CalledRepeatedlyWithoutProcessing_PostsOnce` FAILS with `Assert.AreEqual failed. Expected:<1>. Actual:<3>`, and `Notify_AfterProcessUiMessage_PostsAgain` FAILS with `Expected:<2>. Actual:<3>`. `Notify_WhileCoalesced_LosesNoMessages` passes. This is the bug: one post per event.

- [ ] **Step 6: Implement coalescing**

In `src/Brmble.Client/Bridge/NativeBridge.cs`, add the flag field next to `_postMessage`:

```csharp
    private int _notifyPending;
```

Replace `NotifyUiThread`:

```csharp
    /// <summary>
    /// Posts a WM_USER message to trigger ProcessUiMessage on the UI thread.
    /// Safe to call from any thread.
    /// </summary>
    /// <remarks>
    /// Coalescing: the claim below means at most one WM_USER is outstanding at a
    /// time, no matter how many events fire. Without it every forwarded event
    /// posted its own message, and a stalled UI thread could push past the 10,000
    /// per-thread posted-message cap, past which PostMessage fails and the flush
    /// trigger is lost entirely. ProcessUiMessage always drains the whole queue,
    /// so one pending post is sufficient to deliver any number of payloads.
    /// </remarks>
    public void NotifyUiThread()
    {
        // A post is already outstanding; it will drain whatever we just enqueued.
        if (Interlocked.CompareExchange(ref _notifyPending, 1, 0) != 0)
            return;

        _postMessage(_hwnd, WM_USER, IntPtr.Zero, IntPtr.Zero);
    }
```

In `ProcessUiMessage`, release the claim **before** draining. Insert as the first statement of the method, above `var batch = new List<string>();`:

```csharp
        // Released before the drain, not after. Releasing afterwards leaves a window
        // where a Send enqueues a payload, sees the claim still held, skips its post,
        // and leaves that payload queued with nothing scheduled to flush it. Releasing
        // first means anything enqueued after the drain triggers a fresh post, and
        // anything enqueued during the drain is drained anyway — at worst costing one
        // redundant WM_USER that finds an empty queue.
        Interlocked.Exchange(ref _notifyPending, 0);
```

- [ ] **Step 7: Run the tests and verify they pass**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter NativeBridgeNotifyTests`
Expected: all three PASS.

- [ ] **Step 8: Run the whole client suite to confirm nothing regressed**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj`
Expected: all PASS. If anything fails with `NullReferenceException` inside `NotifyUiThread`, `Create()` is not seeding `_postMessage` — revisit Step 1.

- [ ] **Step 9: Commit**

```bash
git add src/Brmble.Client/Bridge/NativeBridge.cs tests/Brmble.Client.Tests/Bridge/NativeBridgeNotifyTests.cs tests/Brmble.Client.Tests/Services/MumbleAdapterParseTests.cs
git commit -m "fix(client): coalesce NativeBridge UI notifications behind a single pending post"
```

---

### Task 2: Honour the PostMessage failure result

**Files:**
- Modify: `src/Brmble.Client/Bridge/NativeBridge.cs` (`NotifyUiThread`)
- Modify: `tests/Brmble.Client.Tests/Bridge/NativeBridgeNotifyTests.cs`

**Interfaces:**
- Consumes: `NativeBridgeTestHarness.RecordPosts(bridge, result)` and `NativeBridge._notifyPending` from Task 1.
- Produces: nothing consumed by later tasks.

**Background.** `PostMessage` is declared returning `bool` at `NativeBridge.cs:25` and the result is discarded. After Task 1 a discarded failure is strictly worse than before: the claim stays held forever and the bridge never flushes again. Releasing the claim on failure makes the path self-healing — the next of the 129 `NotifyUiThread()` calls across the client (101 in `MumbleAdapter.cs`, the rest across 9 other files) reclaims and reposts. Nothing retries on a timer and nothing blocks.

- [ ] **Step 1: Write the failing self-healing test**

Append to `NativeBridgeNotifyTests`:

```csharp
    [TestMethod]
    public void Notify_WhenPostFails_NextNotifyPostsAgain()
    {
        var bridge = NativeBridgeTestHarness.Create();
        var succeed = false;
        var posts = NativeBridgeTestHarness.RecordPosts(bridge, () => succeed);

        // First post fails: the claim must be released rather than held forever.
        bridge.NotifyUiThread();
        Assert.AreEqual(1, posts.Count);

        // A later event must be able to retry.
        succeed = true;
        bridge.NotifyUiThread();
        Assert.AreEqual(2, posts.Count);

        // And once a post succeeds, coalescing resumes.
        bridge.NotifyUiThread();
        Assert.AreEqual(2, posts.Count);
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter Notify_WhenPostFails_NextNotifyPostsAgain`
Expected: FAIL at the second assertion with `Assert.AreEqual failed. Expected:<2>. Actual:<1>` — the failed post held the claim and the bridge is now permanently wedged.

- [ ] **Step 3: Release the claim on failure and report it once**

In `src/Brmble.Client/Bridge/NativeBridge.cs`, add a field next to `_notifyPending`:

```csharp
    private int _postFailureReported;
```

Replace `NotifyUiThread` in full:

```csharp
    /// <summary>
    /// Posts a WM_USER message to trigger ProcessUiMessage on the UI thread.
    /// Safe to call from any thread.
    /// </summary>
    /// <remarks>
    /// Coalescing: the claim below means at most one WM_USER is outstanding at a
    /// time, no matter how many events fire. Without it every forwarded event
    /// posted its own message, and a stalled UI thread could push past the 10,000
    /// per-thread posted-message cap, past which PostMessage fails and the flush
    /// trigger is lost entirely. ProcessUiMessage always drains the whole queue,
    /// so one pending post is sufficient to deliver any number of payloads.
    /// </remarks>
    public void NotifyUiThread()
    {
        // A post is already outstanding; it will drain whatever we just enqueued.
        if (Interlocked.CompareExchange(ref _notifyPending, 1, 0) != 0)
            return;

        if (_postMessage(_hwnd, WM_USER, IntPtr.Zero, IntPtr.Zero))
        {
            Interlocked.Exchange(ref _postFailureReported, 0);
            return;
        }

        // The post failed, so nothing will drain the queue. Release the claim so the
        // next event reposts — this is the only retry, and it is enough because
        // NotifyUiThread is called on essentially every forwarded event.
        Interlocked.Exchange(ref _notifyPending, 0);

        // Reported once per failure episode. A wedged message queue fails for every
        // subsequent event too, and one line per event would bury the log.
        if (Interlocked.Exchange(ref _postFailureReported, 1) == 0)
        {
            Console.WriteLine(
                $"[NativeBridge] PostMessage(WM_USER) failed, win32={Marshal.GetLastWin32Error()}; " +
                "UI flush deferred to the next event.");
        }
    }
```

`Console.WriteLine` rather than `LogBridge` is deliberate: `LogBridge` is `[Conditional("DEBUG")]` and would be compiled out of Release, leaving exactly the silent failure this task exists to remove. `DevLog` tees `Console` to `brmble-debug.log` in all configurations.

- [ ] **Step 4: Run the test to verify it passes**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter NativeBridgeNotifyTests`
Expected: all four PASS.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Client/Bridge/NativeBridge.cs tests/Brmble.Client.Tests/Bridge/NativeBridgeNotifyTests.cs
git commit -m "fix(client): release the notify claim when PostMessage fails instead of wedging the bridge"
```

---

### Task 3: Decode HTTP chunks in byte space

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs:1284,1338,1352-1408`
- Modify: `tests/Brmble.Client.Tests/Services/GameServiceTests.cs:113-134`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `internal static ChannelRequestBridgeHandler.TlsCallResult MumbleAdapter.ParseHttpResponse(byte[] response)` — replaces the `string` overload; no overload is kept.

**Background.** `ParseHttpResponse` currently takes an already-UTF-8-decoded `string`, but HTTP chunk sizes are byte counts (RFC 7230) while `body.AsSpan(offset, size)` at line 1402 indexes UTF-16 chars. One non-ASCII byte and the chunk over-reads into the following CRLF and size line, the CRLF check at line 1404 fails, the loop breaks, and the body is silently truncated. Duel and game error messages carry usernames, so this is reachable.

The existing `Command_ChunkedServerErrorThroughAdapter_PreservesStructuredReason` uses pure-ASCII chunks and therefore passes against the broken code. Do not treat it as coverage.

- [ ] **Step 1: Write the failing multibyte test against the current signature**

In `tests/Brmble.Client.Tests/Services/GameServiceTests.cs`, add `using System.Text;` to the usings, and add this test immediately after `Command_ChunkedServerErrorThroughAdapter_PreservesStructuredReason`. Note it calls the **current** `string` overload — that is intentional, so the red proves the bug rather than a compile error:

```csharp
    [TestMethod]
    public async Task Command_ChunkedMultibyteServerError_PreservesStructuredReason()
    {
        // Chunk sizes are byte counts. These chunks are longer in bytes than in
        // chars, which is what desynchronises a char-indexed decoder.
        const string firstChunk = "{\"error\":\"Not Zoë's ";
        const string secondChunk = "offer 日本\",\"reason\":\"notParticipant\"}";
        var rawResponse = "HTTP/1.1 400 Bad Request\r\nTransfer-Encoding: chunked\r\nContent-Type: application/json\r\n\r\n"
            + $"{Encoding.UTF8.GetByteCount(firstChunk):X};source=Kestrel\r\n{firstChunk}\r\n"
            + $"{Encoding.UTF8.GetByteCount(secondChunk):X}\r\n{secondChunk}\r\n"
            + "0\r\nRequest-Id: abc\r\n\r\n";
        using var cert = CreateCertificate();
        var bridge = NativeBridgeTestHarness.Create();
        var service = CreateService(bridge, cert, (_, _) => MumbleAdapter.ParseHttpResponse(rawResponse));
        service.RegisterHandlers(bridge);

        await NativeBridgeTestHarness.InvokeAsync(bridge, "game.cancelOffer",
            JsonSerializer.SerializeToElement(new { offerId = 9 }));

        var error = NativeBridgeTestHarness.DrainMessages(bridge).Single(x => x.Type == "game.error");
        using var document = JsonDocument.Parse(error.DataJson);
        Assert.AreEqual("Not Zoë's offer 日本", document.RootElement.GetProperty("error").GetString());
        Assert.AreEqual("notParticipant", document.RootElement.GetProperty("reason").GetString());
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter Command_ChunkedMultibyteServerError_PreservesStructuredReason`

Expected: FAIL. The body is truncated, so the assertion on `error` does not match (or the `game.error` payload lacks `reason` / the JSON parse throws). Record the actual failure text — it is the evidence the bug is real. Do not proceed until you have seen it.

- [ ] **Step 3: Rewrite `ParseHttpResponse` and `DecodeChunkedBody` in byte space**

In `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`, replace both methods (lines 1352-1408) with:

```csharp
    internal static ChannelRequestBridgeHandler.TlsCallResult ParseHttpResponse(byte[] response)
    {
        var statusEnd = Array.IndexOf(response, (byte)'\n');
        if (statusEnd < 0)
            return new(false, null, 0, "No response from server");

        var statusLine = System.Text.Encoding.UTF8.GetString(response, 0, statusEnd).Trim();
        var parts = statusLine.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length < 2 || !int.TryParse(parts[1], out var statusCode))
            return new(false, null, 0, $"Unparseable status line: {statusLine}");

        var separatorLength = 4;
        var bodyStart = response.AsSpan().IndexOf("\r\n\r\n"u8);
        if (bodyStart < 0)
        {
            separatorLength = 2;
            bodyStart = response.AsSpan().IndexOf("\n\n"u8);
        }

        string? body = null;
        if (bodyStart >= 0)
        {
            var headers = System.Text.Encoding.UTF8.GetString(response, 0, bodyStart);
            var bodyBytes = response.AsSpan(bodyStart + separatorLength);
            if (headers.Contains("Transfer-Encoding: chunked", StringComparison.OrdinalIgnoreCase))
                body = DecodeChunkedBody(bodyBytes);
            else
                body = System.Text.Encoding.UTF8.GetString(bodyBytes).Trim();
        }

        if (string.IsNullOrWhiteSpace(body)) body = null;
        var success = statusCode is >= 200 and < 300;
        var error = success ? null : body is null
            ? $"Server returned {statusCode}"
            : $"Server returned {statusCode}: {body}";
        return new(success, body, statusCode, error);
    }

    /// <summary>
    /// Decodes an HTTP chunked transfer body.
    /// </summary>
    /// <remarks>
    /// Operates on raw bytes because RFC 7230 chunk sizes are BYTE counts. An earlier
    /// version indexed the UTF-8-decoded string, so any non-ASCII byte made the chunk
    /// over-read into the following CRLF and size line, breaking the loop and silently
    /// truncating the body. UTF-8 decoding happens once, over the assembled result.
    /// </remarks>
    private static string DecodeChunkedBody(ReadOnlySpan<byte> body)
    {
        using var result = new MemoryStream();
        var offset = 0;
        while (offset < body.Length)
        {
            var remaining = body[offset..];
            var lineEnd = remaining.IndexOf("\r\n"u8);
            if (lineEnd < 0) break;
            var sizeText = System.Text.Encoding.ASCII.GetString(remaining[..lineEnd]);
            var extension = sizeText.IndexOf(';');
            if (extension >= 0) sizeText = sizeText[..extension];
            if (!int.TryParse(sizeText.Trim(), System.Globalization.NumberStyles.HexNumber,
                    System.Globalization.CultureInfo.InvariantCulture, out var size))
                break;
            offset += lineEnd + 2;
            if (size == 0) break;
            if (size < 0 || offset + size > body.Length) break;
            result.Write(body.Slice(offset, size));
            offset += size;
            if (offset + 2 > body.Length || !body.Slice(offset, 2).SequenceEqual("\r\n"u8)) break;
            offset += 2;
        }
        return System.Text.Encoding.UTF8.GetString(result.ToArray()).Trim();
    }
```

Note `lineEnd` is now relative to `remaining`, not absolute — hence `offset += lineEnd + 2` rather than `offset = lineEnd + 2`.

- [ ] **Step 4: Update both production call sites**

`src/Brmble.Client/Services/Voice/MumbleAdapter.cs` line 1284:

```csharp
            var parsed = ParseHttpResponse(ms.ToArray());
```

and line 1338:

```csharp
                var parsed = ParseHttpResponse(ms.ToArray());
```

- [ ] **Step 5: Update both tests to the byte[] signature**

In `tests/Brmble.Client.Tests/Services/GameServiceTests.cs`, in **both** `Command_ChunkedServerErrorThroughAdapter_PreservesStructuredReason` and the new `Command_ChunkedMultibyteServerError_PreservesStructuredReason`, change:

```csharp
        var service = CreateService(bridge, cert, (_, _) => MumbleAdapter.ParseHttpResponse(rawResponse));
```

to:

```csharp
        var service = CreateService(bridge, cert, (_, _) => MumbleAdapter.ParseHttpResponse(Encoding.UTF8.GetBytes(rawResponse)));
```

The ASCII test keeps its `firstChunk.Length` sizes — for ASCII, char count and byte count agree — and remains a regression guard for the simple path.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter GameServiceTests`
Expected: all PASS, including both chunked tests.

- [ ] **Step 7: Commit**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs tests/Brmble.Client.Tests/Services/GameServiceTests.cs
git commit -m "fix(client): decode HTTP chunk sizes as byte counts, not character counts"
```

---

### Task 4: Full-suite verification

**Files:** none modified unless a regression appears.

**Interfaces:**
- Consumes: everything from Tasks 1-3.
- Produces: nothing.

- [ ] **Step 1: Build the whole solution**

Run: `dotnet build`
Expected: success, no new warnings. A nullability warning on `_webView` means the constructor still touches the field instead of the parameter — revisit Task 1 Step 4.

- [ ] **Step 2: Run every test**

Run: `dotnet test`
Expected: all PASS.

- [ ] **Step 3: Commit any fixes**

Only if Steps 1-2 required changes:

```bash
git add -A
git commit -m "fix(client): address fallout from the transport defect fixes"
```

If nothing needed fixing, skip this step — do not create an empty commit.

---

## Notes for the reviewer

Things this plan deliberately does **not** do, per the spec:

- No bound and no drop policy on `_pendingMessages`. Coalescing makes the 10,000-message cliff unreachable, and no uniform drop policy is safe — losing a terminal event strands spectators on a board that never ends (`src/Brmble.Server/Games/Spectators/SpectatorService.cs:138-144`).
- No strict one-outstanding-post invariant. `Flush()` routes through `ProcessUiMessage()`, so a UI-thread `Flush()` racing an outstanding post can permit a second post. "At most a small handful" is four orders of magnitude below the cliff.
- No changes to `ProcessUiMessage`'s batching, which already coalesces correctly on the flush side.
- No changes to any of the 101 `NotifyUiThread()` call sites in `MumbleAdapter.cs`, nor to the other 28 across the client (129 total, 10 files).
