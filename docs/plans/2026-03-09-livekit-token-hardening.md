# LiveKit Token Flow Hardening — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the LiveKit token request flow resilient with retry logic, structured error propagation, and diagnostic logging.

**Architecture:** Replace the null-return pattern in `SendViaBcTls`/`PostViaBcTls` with a `TlsResult` record that carries HTTP status codes and error messages. Add retry with exponential backoff in the `livekit.requestToken` bridge handler. Propagate specific errors to the frontend.

**Tech Stack:** C# (.NET), TypeScript/React, MSTest

---

### Task 1: Add `TlsResult` record and update `SendViaBcTls`

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs:875-948`

**Step 1: Add the `TlsResult` record**

Add this record type inside `MumbleAdapter` class, just above the `SendViaBcTls` method (before line 871):

```csharp
private record TlsResult(bool Success, string? Body, int StatusCode, string? Error);
```

**Step 2: Update `SendViaBcTls` signature and return type**

Change `SendViaBcTls` from returning `string?` to `TlsResult`. The key changes:
- Parse HTTP status code as an integer from the status line
- Return `TlsResult(true, body, statusCode, null)` on success
- Return `TlsResult(false, null, statusCode, statusLine)` on non-200
- Return `TlsResult(false, null, 0, "No response")` when response is empty
- Wrap the entire method body in try/catch to capture connection and TLS exceptions as `TlsResult(false, null, 0, ex.Message)`

Updated method:

```csharp
private static async Task<TlsResult> SendViaBcTls(X509Certificate2 cert, Uri uri, string httpRequest)
{
    try
    {
        using var tcp = new TcpClient();
        await tcp.ConnectAsync(uri.Host, uri.Port);

        var sniName = uri.HostNameType == UriHostNameType.Dns ? uri.Host : null;
        var tlsClient = new BrmbleTlsClient(cert, sniName);
        var tlsProtocol = new TlsClientProtocol(tcp.GetStream());
        tlsProtocol.Connect(tlsClient);

        try
        {
            var stream = tlsProtocol.Stream;
            var requestBytes = System.Text.Encoding.UTF8.GetBytes(httpRequest);
            await stream.WriteAsync(requestBytes, 0, requestBytes.Length);
            await stream.FlushAsync();

            using var ms = new MemoryStream();
            var buf = new byte[4096];
            int read;
            try
            {
                while ((read = await stream.ReadAsync(buf, 0, buf.Length)) > 0)
                    ms.Write(buf, 0, read);
            }
            catch (Org.BouncyCastle.Tls.TlsNoCloseNotifyException) { }

            var response = System.Text.Encoding.UTF8.GetString(ms.ToArray());
            var statusEnd = response.IndexOf('\n');
            if (statusEnd < 0) return new TlsResult(false, null, 0, "No response from server");

            var statusLine = response[..statusEnd].Trim();

            // Parse status code from "HTTP/1.1 200 OK"
            var statusCode = 0;
            var parts = statusLine.Split(' ');
            if (parts.Length >= 2)
                int.TryParse(parts[1], out statusCode);

            if (statusCode < 200 || statusCode >= 300)
            {
                return new TlsResult(false, null, statusCode, $"Server returned {statusCode}");
            }

            var bodyStart = response.IndexOf("\r\n\r\n", StringComparison.Ordinal);
            if (bodyStart < 0) bodyStart = response.IndexOf("\n\n", StringComparison.Ordinal);
            if (bodyStart < 0) return new TlsResult(true, null, statusCode, null);

            var separatorLength = response[bodyStart] == '\r' ? 4 : 2;
            var body = response[(bodyStart + separatorLength)..].Trim();

            var headersSection = response[..bodyStart];
            if (headersSection.Contains("Transfer-Encoding: chunked", StringComparison.OrdinalIgnoreCase))
            {
                var sb = new System.Text.StringBuilder();
                var remaining = body;
                while (remaining.Length > 0)
                {
                    var lineEnd = remaining.IndexOf("\r\n", StringComparison.Ordinal);
                    if (lineEnd < 0) break;
                    var chunkSizeHex = remaining[..lineEnd].Trim();
                    if (!int.TryParse(chunkSizeHex, System.Globalization.NumberStyles.HexNumber, null, out var chunkSize) || chunkSize == 0)
                        break;
                    var chunkStart = lineEnd + 2;
                    if (chunkStart + chunkSize > remaining.Length) break;
                    sb.Append(remaining.AsSpan(chunkStart, chunkSize));
                    remaining = remaining[(chunkStart + chunkSize)..];
                    if (remaining.StartsWith("\r\n"))
                        remaining = remaining[2..];
                }
                body = sb.ToString().Trim();
            }

            return new TlsResult(true, string.IsNullOrWhiteSpace(body) ? null : body, statusCode, null);
        }
        finally
        {
            tlsProtocol.Close();
        }
    }
    catch (Exception ex)
    {
        return new TlsResult(false, null, 0, ex.Message);
    }
}
```

**Step 3: Build to verify compilation**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: Build errors in `PostViaBcTls` and `GetViaBcTls` (they still expect `string?`) — that's expected, we fix those in Task 2.

---

### Task 2: Update `PostViaBcTls` and `GetViaBcTls` to use `TlsResult`

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs:950-980`

**Step 1: Update `PostViaBcTls`**

Change return type from `object?` to `TlsResult`. Pass through the `TlsResult` on failure, parse JSON body on success:

```csharp
private static async Task<TlsResult> PostViaBcTls(X509Certificate2 cert, Uri uri, string jsonBody)
{
    var hostHeader = uri.IsDefaultPort ? uri.Host : $"{uri.Host}:{uri.Port}";
    var contentLength = System.Text.Encoding.UTF8.GetByteCount(jsonBody);
    var httpRequest = $"POST {uri.PathAndQuery} HTTP/1.1\r\nHost: {hostHeader}\r\nContent-Type: application/json\r\nContent-Length: {contentLength}\r\nConnection: close\r\n\r\n{jsonBody}";

    return await SendViaBcTls(cert, uri, httpRequest);
}
```

**Step 2: Update `GetViaBcTls`**

Change return type from `string?` to `TlsResult`:

```csharp
private static async Task<TlsResult> GetViaBcTls(X509Certificate2 cert, Uri uri)
{
    var hostHeader = uri.IsDefaultPort ? uri.Host : $"{uri.Host}:{uri.Port}";
    var httpRequest = $"GET {uri.PathAndQuery} HTTP/1.1\r\nHost: {hostHeader}\r\nConnection: close\r\n\r\n";
    return await SendViaBcTls(cert, uri, httpRequest);
}
```

**Step 3: Build to verify compilation**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: Build errors in the LiveKit bridge handlers (they use the old return types) — fixed in Task 3.

---

### Task 3: Update LiveKit bridge handlers to use `TlsResult` + add retry

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs:1466-1586`

**Step 1: Update `livekit.requestToken` handler with retry logic**

Replace the handler at line 1466 with retry and structured error propagation:

```csharp
bridge.RegisterHandler("livekit.requestToken", async data =>
{
    var roomName = data.TryGetProperty("roomName", out var rn) ? rn.GetString() : null;
    if (string.IsNullOrWhiteSpace(roomName) || _apiUrl is null)
    {
        _bridge?.Send("livekit.tokenError", new { error = "Not connected or missing roomName" });
        _bridge?.NotifyUiThread();
        return;
    }

    using var cert = _certService?.GetExportableCertificate();
    if (cert is null)
    {
        _bridge?.Send("livekit.tokenError", new { error = "No client certificate" });
        _bridge?.NotifyUiThread();
        return;
    }

    var baseUri = new Uri(_apiUrl, UriKind.Absolute);
    var tokenUri = new Uri(baseUri, "livekit/token");
    var jsonBody = System.Text.Json.JsonSerializer.Serialize(new { roomName });

    var delays = new[] { 500, 1000, 2000 };
    TlsResult? lastResult = null;

    for (var attempt = 0; attempt <= delays.Length; attempt++)
    {
        try
        {
            lastResult = await PostViaBcTls(cert, tokenUri, jsonBody);

            if (lastResult.Success && lastResult.Body is not null)
            {
                // Parse JSON body into dictionary for bridge
                using var doc = System.Text.Json.JsonDocument.Parse(lastResult.Body);
                var dict = new Dictionary<string, object?>();
                foreach (var prop in doc.RootElement.EnumerateObject())
                {
                    dict[prop.Name] = prop.Value.ValueKind switch
                    {
                        System.Text.Json.JsonValueKind.String => prop.Value.GetString(),
                        System.Text.Json.JsonValueKind.Number => prop.Value.GetDouble(),
                        System.Text.Json.JsonValueKind.True => true,
                        System.Text.Json.JsonValueKind.False => false,
                        _ => prop.Value.GetRawText()
                    };
                }
                _bridge?.Send("livekit.token", dict);
                _bridge?.NotifyUiThread();
                return;
            }

            // Don't retry on 4xx — these are client errors that won't self-resolve
            if (lastResult.StatusCode >= 400 && lastResult.StatusCode < 500)
                break;
        }
        catch (Exception ex)
        {
            lastResult = new TlsResult(false, null, 0, ex.Message);
        }

        // Retry after delay if we have attempts remaining
        if (attempt < delays.Length)
        {
            LogToFile($"[LiveKit] Token request attempt {attempt + 1} failed: {lastResult?.Error ?? "unknown"}, retrying in {delays[attempt]}ms");
            await Task.Delay(delays[attempt]);
        }
    }

    var errorMsg = lastResult?.Error ?? "Token request failed";
    LogToFile($"[LiveKit] Token request failed after all attempts: {errorMsg}");
    _bridge?.Send("livekit.tokenError", new { error = errorMsg });
    _bridge?.NotifyUiThread();
});
```

**Step 2: Update `livekit.shareStarted` handler**

Replace the handler at line 1506:

```csharp
bridge.RegisterHandler("livekit.shareStarted", async data =>
{
    var roomName = data.TryGetProperty("roomName", out var rn) ? rn.GetString() : null;
    if (string.IsNullOrWhiteSpace(roomName) || _apiUrl is null) return;

    using var cert = _certService?.GetExportableCertificate();
    if (cert is null) return;

    try
    {
        var baseUri = new Uri(_apiUrl, UriKind.Absolute);
        var uri = new Uri(baseUri, "livekit/share-started");
        var result = await PostViaBcTls(cert, uri, System.Text.Json.JsonSerializer.Serialize(new { roomName }));
        if (!result.Success)
            LogToFile($"[LiveKit] share-started notification failed: {result.Error}");
    }
    catch (Exception ex)
    {
        LogToFile($"[LiveKit] Failed to notify share-started: {ex.Message}");
    }
});
```

**Step 3: Update `livekit.shareStopped` handler**

Replace the handler at line 1526:

```csharp
bridge.RegisterHandler("livekit.shareStopped", async data =>
{
    var roomName = data.TryGetProperty("roomName", out var rn) ? rn.GetString() : null;
    if (string.IsNullOrWhiteSpace(roomName) || _apiUrl is null) return;

    using var cert = _certService?.GetExportableCertificate();
    if (cert is null) return;

    try
    {
        var baseUri = new Uri(_apiUrl, UriKind.Absolute);
        var uri = new Uri(baseUri, "livekit/share-stopped");
        var result = await PostViaBcTls(cert, uri, System.Text.Json.JsonSerializer.Serialize(new { roomName }));
        if (!result.Success)
            LogToFile($"[LiveKit] share-stopped notification failed: {result.Error}");
    }
    catch (Exception ex)
    {
        LogToFile($"[LiveKit] Failed to notify share-stopped: {ex.Message}");
    }
});
```

**Step 4: Update `livekit.checkActiveShare` handler**

Replace the handler at line 1546:

```csharp
bridge.RegisterHandler("livekit.checkActiveShare", async data =>
{
    var roomName = data.TryGetProperty("roomName", out var rn) ? rn.GetString() : null;
    if (string.IsNullOrWhiteSpace(roomName) || _apiUrl is null)
    {
        _bridge?.Send("livekit.activeShareResult", new { roomName, active = false });
        _bridge?.NotifyUiThread();
        return;
    }

    using var cert = _certService?.GetExportableCertificate();
    if (cert is null)
    {
        _bridge?.Send("livekit.activeShareResult", new { roomName, active = false });
        _bridge?.NotifyUiThread();
        return;
    }

    try
    {
        var baseUri = new Uri(_apiUrl, UriKind.Absolute);
        var uri = new Uri(baseUri, $"livekit/active-share?roomName={Uri.EscapeDataString(roomName)}");
        var result = await GetViaBcTls(cert, uri);
        if (result.Success && result.Body is not null)
        {
            using var doc = System.Text.Json.JsonDocument.Parse(result.Body);
            var userName = doc.RootElement.TryGetProperty("userName", out var un) ? un.GetString() : null;
            _bridge?.Send("livekit.activeShareResult", new { roomName, active = true, userName });
        }
        else
        {
            _bridge?.Send("livekit.activeShareResult", new { roomName, active = false });
        }
        _bridge?.NotifyUiThread();
    }
    catch
    {
        _bridge?.Send("livekit.activeShareResult", new { roomName, active = false });
        _bridge?.NotifyUiThread();
    }
});
```

**Step 5: Add `LogToFile` helper method**

Add this private method near the other helper methods in the class:

```csharp
private static void LogToFile(string message)
{
    try
    {
        System.IO.File.AppendAllText(
            System.IO.Path.Combine(System.IO.Path.GetTempPath(), "brmble-livekit.log"),
            $"[{DateTime.Now:HH:mm:ss.fff}] {message}\n");
    }
    catch { /* logging should never throw */ }
}
```

**Step 6: Build and run tests**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: Build succeeds with no errors.

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj`
Expected: All existing tests pass (parse tests don't touch TLS methods).

**Step 7: Commit**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs
git commit -m "feat: add structured TlsResult and retry logic for LiveKit token requests"
```

---

### Task 4: Increase frontend token timeout

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useScreenShare.ts:46,113`

**Step 1: Update both timeout values from 15000 to 20000**

In `startSharing` (line 46):
```typescript
}, 20000);
```

In `connectAsViewer` (line 113):
```typescript
}, 20000);
```

**Step 2: Build frontend**

Run: `(cd src/Brmble.Web && npm run build)`
Expected: Build succeeds.

**Step 3: Commit**

```bash
git add src/Brmble.Web/src/hooks/useScreenShare.ts
git commit -m "feat: increase LiveKit token timeout to 20s to accommodate retry"
```

---

### Task 5: Add server-side logging for JSON parse failures

**Files:**
- Modify: `src/Brmble.Server/LiveKit/LiveKitEndpoints.cs:28,68,105`

**Step 1: Write failing test for invalid JSON body**

Add to `tests/Brmble.Server.Tests/Integration/LiveKitTokenTests.cs`:

```csharp
[TestMethod]
public async Task PostLiveKitToken_InvalidJson_ReturnsBadRequest()
{
    var body = new StringContent("not json at all", Encoding.UTF8, "application/json");
    var response = await _client.PostAsync("/livekit/token", body);
    Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
}
```

**Step 2: Run test to verify it passes (current behavior already returns 400)**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "LiveKitTokenTests"`
Expected: PASS — invalid JSON falls through to the `roomName` null check which returns 400.

**Step 3: Add logger parameter and logging to the catch blocks**

In `/livekit/token` endpoint (line 28), change:
```csharp
catch { /* invalid JSON */ }
```
to:
```csharp
catch (Exception ex) { logger.LogWarning(ex, "Failed to parse LiveKit token request body"); }
```

In `/livekit/share-started` endpoint (line 68), add logger parameter and change:
```csharp
catch { }
```
to:
```csharp
catch (Exception ex) { logger.LogWarning(ex, "Failed to parse share-started request body"); }
```

Note: The `share-started` and `share-stopped` endpoints don't have a logger parameter. Add `ILogger<LiveKitService> logger` to the endpoint lambda parameter lists for `share-started` (line 52) and `share-stopped` (line 90).

In `/livekit/share-stopped` endpoint (line 105), change:
```csharp
catch { }
```
to:
```csharp
catch (Exception ex) { logger.LogWarning(ex, "Failed to parse share-stopped request body"); }
```

**Step 4: Build and run all server tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add src/Brmble.Server/LiveKit/LiveKitEndpoints.cs tests/Brmble.Server.Tests/Integration/LiveKitTokenTests.cs
git commit -m "feat: add logging for JSON parse failures in LiveKit endpoints"
```

---

### Task 6: Final build and full test run

**Step 1: Build everything**

Run: `dotnet build`
Expected: Build succeeds.

**Step 2: Run all tests**

Run: `dotnet test`
Expected: All tests pass.

**Step 3: Build frontend**

Run: `(cd src/Brmble.Web && npm run build)`
Expected: Build succeeds.
