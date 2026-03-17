# Mumble Name Authority Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Mumble's certificate-based registration the single source of truth for usernames in Brmble.

**Architecture:** New `IMumbleRegistrationService` wraps ICE proxy registration methods. `AuthService.Authenticate()` checks Mumble registration before creating/returning Brmble accounts. Frontend disables the username field after successful registration.

**Tech Stack:** C# / ASP.NET Core / ZeroC Ice / React + TypeScript

**Spec:** `docs/superpowers/specs/2026-03-15-mumble-name-authority-design.md`

---

## File Structure

### New Files
- `src/Brmble.Server/Mumble/IMumbleRegistrationService.cs` — Interface for Mumble registration operations
- `src/Brmble.Server/Mumble/MumbleRegistrationService.cs` — Implementation wrapping ICE server proxy
- `tests/Brmble.Server.Tests/Mumble/MumbleRegistrationServiceTests.cs` — Unit tests for registration service
- `tests/Brmble.Server.Tests/Auth/AuthServiceRegistrationTests.cs` — Tests for the registration flow in AuthService

### Modified Files
- `src/Brmble.Server/Mumble/MumbleIceService.cs` — Share server proxy with registration service
- `src/Brmble.Server/Mumble/MumbleExtensions.cs` — Register new service in DI
- `src/Brmble.Server/Auth/AuthService.cs` — Add registration check to Authenticate(), add `IsRegistered` to AuthResult
- `src/Brmble.Server/Auth/AuthEndpoints.cs` — Handle name conflict errors, return registered name and status
- `src/Brmble.Client/Services/Voice/MumbleAdapter.cs` — Forward auth errors (name_taken, registration_error) via bridge messages
- `src/Brmble.Web/src/hooks/useServerlist.ts` — Add `registered` flag to ServerEntry
- `src/Brmble.Web/src/components/ServerList/ServerList.tsx` — Disable username field when registered
- `src/Brmble.Web/src/components/ConnectModal/ConnectModal.tsx` — Disable username field when registered
- `src/Brmble.Web/src/App.tsx` — Handle `voice.authError` bridge message, pass registered state
- `tests/Brmble.Server.Tests/Auth/AuthServiceTests.cs` — Update constructor calls for new dependencies

---

## Chunk 1: IMumbleRegistrationService

### Task 1: Create IMumbleRegistrationService interface

**Files:**
- Create: `src/Brmble.Server/Mumble/IMumbleRegistrationService.cs`

- [ ] **Step 1: Create the interface file**

```csharp
// src/Brmble.Server/Mumble/IMumbleRegistrationService.cs
namespace Brmble.Server.Mumble;

/// <summary>
/// Wraps Mumble ICE server proxy registration methods.
/// Mumble is the single source of truth for usernames.
/// </summary>
public interface IMumbleRegistrationService
{
    /// <summary>
    /// Check if the connected user (by Mumble session ID) is registered.
    /// Returns (true, userId) if registered, (false, -1) if not.
    /// </summary>
    Task<(bool IsRegistered, int UserId)> GetRegistrationStatusAsync(int sessionId);

    /// <summary>
    /// Get the registered name for a Mumble user ID.
    /// Returns null if not registered or registration has no name.
    /// </summary>
    Task<string?> GetRegisteredNameAsync(int userId);

    /// <summary>
    /// Register a username bound to a certificate hash in Mumble.
    /// Returns the new Mumble user ID on success.
    /// Throws MumbleNameConflictException if the name is already taken.
    /// Throws MumbleRegistrationException for other ICE failures.
    /// </summary>
    Task<int> RegisterUserAsync(string name, string certHash);
}

/// <summary>Thrown when a requested username is already registered in Mumble.</summary>
public class MumbleNameConflictException : Exception
{
    public string RequestedName { get; }
    public MumbleNameConflictException(string name)
        : base($"Username '{name}' is already registered in Mumble.")
    {
        RequestedName = name;
    }
}

/// <summary>Thrown when Mumble ICE is unavailable or returns an unexpected error.</summary>
public class MumbleRegistrationException : Exception
{
    public MumbleRegistrationException(string message, Exception? inner = null)
        : base(message, inner) { }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/Brmble.Server/Mumble/IMumbleRegistrationService.cs
git commit -m "feat: add IMumbleRegistrationService interface"
```

### Task 2: Implement MumbleRegistrationService

**Files:**
- Create: `src/Brmble.Server/Mumble/MumbleRegistrationService.cs`
- Modify: `src/Brmble.Server/Mumble/MumbleIceService.cs` — share proxy
- Modify: `src/Brmble.Server/Mumble/MumbleExtensions.cs` — register in DI

- [ ] **Step 1: Create the implementation**

```csharp
// src/Brmble.Server/Mumble/MumbleRegistrationService.cs
using Microsoft.Extensions.Logging;

namespace Brmble.Server.Mumble;

public class MumbleRegistrationService : IMumbleRegistrationService
{
    private readonly ILogger<MumbleRegistrationService> _logger;
    private volatile MumbleServer.ServerPrx? _serverProxy;

    public MumbleRegistrationService(ILogger<MumbleRegistrationService> logger)
    {
        _logger = logger;
    }

    internal void SetServerProxy(MumbleServer.ServerPrx proxy) => _serverProxy = proxy;

    private MumbleServer.ServerPrx GetProxy()
    {
        return _serverProxy ?? throw new MumbleRegistrationException(
            "Mumble ICE server proxy is not available. Cannot perform registration operations.");
    }

    public async Task<(bool IsRegistered, int UserId)> GetRegistrationStatusAsync(int sessionId)
    {
        var proxy = GetProxy();
        try
        {
            var state = await proxy.getStateAsync(sessionId);
            var isRegistered = state.userid >= 0;
            _logger.LogDebug(
                "Registration status for session {SessionId}: registered={IsRegistered}, userid={UserId}",
                sessionId, isRegistered, state.userid);
            return (isRegistered, state.userid);
        }
        catch (MumbleServer.InvalidSessionException)
        {
            throw new MumbleRegistrationException($"Mumble session {sessionId} not found.");
        }
        catch (Exception ex) when (ex is not MumbleRegistrationException)
        {
            throw new MumbleRegistrationException($"ICE error checking session {sessionId}.", ex);
        }
    }

    public async Task<string?> GetRegisteredNameAsync(int userId)
    {
        var proxy = GetProxy();
        try
        {
            var info = await proxy.getRegistrationAsync(userId);
            info.TryGetValue(MumbleServer.UserInfo.UserName, out var name);
            return name;
        }
        catch (MumbleServer.InvalidUserException)
        {
            return null;
        }
        catch (Exception ex) when (ex is not MumbleRegistrationException)
        {
            throw new MumbleRegistrationException($"ICE error getting registration for user {userId}.", ex);
        }
    }

    public async Task<int> RegisterUserAsync(string name, string certHash)
    {
        var proxy = GetProxy();
        var info = new Dictionary<MumbleServer.UserInfo, string>
        {
            { MumbleServer.UserInfo.UserName, name },
            { MumbleServer.UserInfo.UserHash, certHash }
        };

        try
        {
            var newUserId = await proxy.registerUserAsync(info);
            _logger.LogInformation(
                "Registered user '{Name}' in Mumble with userId={UserId}, certHash={CertHash}",
                name, newUserId, certHash);
            return newUserId;
        }
        catch (MumbleServer.InvalidUserException)
        {
            throw new MumbleNameConflictException(name);
        }
        catch (Exception ex) when (ex is not MumbleNameConflictException)
        {
            throw new MumbleRegistrationException($"ICE error registering user '{name}'.", ex);
        }
    }
}
```

- [ ] **Step 2: Update MumbleIceService to share proxy with registration service**

In `src/Brmble.Server/Mumble/MumbleIceService.cs`, add `MumbleRegistrationService` as a constructor dependency and call `SetServerProxy` on it alongside the existing `_callback.SetServerProxy(serverProxy)` call.

```csharp
// Add to constructor parameters:
private readonly MumbleRegistrationService _registrationService;

// In constructor:
_registrationService = registrationService;

// After the existing _callback.SetServerProxy(serverProxy) call:
_registrationService.SetServerProxy(serverProxy);
```

- [ ] **Step 3: Register in DI**

In `src/Brmble.Server/Mumble/MumbleExtensions.cs`, add:

```csharp
services.AddSingleton<MumbleRegistrationService>();
services.AddSingleton<IMumbleRegistrationService>(sp => sp.GetRequiredService<MumbleRegistrationService>());
```

- [ ] **Step 4: Build and verify compilation**

Run: `dotnet build src/Brmble.Server/Brmble.Server.csproj`
Expected: Build succeeded.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Server/Mumble/MumbleRegistrationService.cs src/Brmble.Server/Mumble/MumbleIceService.cs src/Brmble.Server/Mumble/MumbleExtensions.cs
git commit -m "feat: implement MumbleRegistrationService wrapping ICE proxy"
```

### Task 3: Write tests for MumbleRegistrationService

**Files:**
- Create: `tests/Brmble.Server.Tests/Mumble/MumbleRegistrationServiceTests.cs`

- [ ] **Step 1: Write tests**

```csharp
// tests/Brmble.Server.Tests/Mumble/MumbleRegistrationServiceTests.cs
using Brmble.Server.Mumble;
using Microsoft.Extensions.Logging;
using Moq;

namespace Brmble.Server.Tests.Mumble;

[TestClass]
public class MumbleRegistrationServiceTests
{
    private MumbleRegistrationService _service = null!;

    [TestInitialize]
    public void Setup()
    {
        var logger = new Mock<ILogger<MumbleRegistrationService>>();
        _service = new MumbleRegistrationService(logger.Object);
    }

    [TestMethod]
    public async Task GetRegistrationStatusAsync_ThrowsWhenProxyNotSet()
    {
        // No proxy set — should throw MumbleRegistrationException
        await Assert.ThrowsExceptionAsync<MumbleRegistrationException>(
            () => _service.GetRegistrationStatusAsync(1));
    }

    [TestMethod]
    public async Task RegisterUserAsync_ThrowsWhenProxyNotSet()
    {
        await Assert.ThrowsExceptionAsync<MumbleRegistrationException>(
            () => _service.RegisterUserAsync("testuser", "abc123"));
    }

    [TestMethod]
    public async Task GetRegisteredNameAsync_ThrowsWhenProxyNotSet()
    {
        await Assert.ThrowsExceptionAsync<MumbleRegistrationException>(
            () => _service.GetRegisteredNameAsync(1));
    }

    [TestMethod]
    public void MumbleNameConflictException_ContainsRequestedName()
    {
        var ex = new MumbleNameConflictException("arie");
        Assert.AreEqual("arie", ex.RequestedName);
        Assert.IsTrue(ex.Message.Contains("arie"));
    }
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~MumbleRegistrationServiceTests" -v n`
Expected: 4 tests passed.

- [ ] **Step 3: Commit**

```bash
git add tests/Brmble.Server.Tests/Mumble/MumbleRegistrationServiceTests.cs
git commit -m "test: add MumbleRegistrationService unit tests"
```

---

## Chunk 2: AuthService Registration Flow

### Task 4: Add username validation helper

**Files:**
- Modify: `src/Brmble.Server/Auth/AuthService.cs`

- [ ] **Step 1: Write failing test for validation**

Add to `tests/Brmble.Server.Tests/Auth/AuthServiceRegistrationTests.cs`:

```csharp
// tests/Brmble.Server.Tests/Auth/AuthServiceRegistrationTests.cs
using Brmble.Server.Auth;

namespace Brmble.Server.Tests.Auth;

[TestClass]
public class AuthServiceRegistrationTests
{
    [TestMethod]
    [DataRow(null)]
    [DataRow("")]
    [DataRow("   ")]
    public void ValidateMumbleUsername_RejectsEmptyNames(string? name)
    {
        var (valid, error) = AuthService.ValidateMumbleUsername(name);
        Assert.IsFalse(valid);
        Assert.IsNotNull(error);
    }

    [TestMethod]
    public void ValidateMumbleUsername_RejectsNamesTooLong()
    {
        var longName = new string('a', 129);
        var (valid, error) = AuthService.ValidateMumbleUsername(longName);
        Assert.IsFalse(valid);
        Assert.IsNotNull(error);
    }

    [TestMethod]
    [DataRow("arie")]
    [DataRow("Player_1")]
    [DataRow("a")]
    public void ValidateMumbleUsername_AcceptsValidNames(string name)
    {
        var (valid, error) = AuthService.ValidateMumbleUsername(name);
        Assert.IsTrue(valid);
        Assert.IsNull(error);
    }

    [TestMethod]
    [DataRow("user/name")]
    [DataRow("user#name")]
    [DataRow("user\x01name")]
    public void ValidateMumbleUsername_RejectsInvalidCharacters(string name)
    {
        var (valid, error) = AuthService.ValidateMumbleUsername(name);
        Assert.IsFalse(valid);
        Assert.IsNotNull(error);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~AuthServiceRegistrationTests" -v n`
Expected: FAIL — `ValidateMumbleUsername` does not exist yet.

- [ ] **Step 3: Implement ValidateMumbleUsername**

Add static method to `src/Brmble.Server/Auth/AuthService.cs`:

```csharp
private static readonly System.Text.RegularExpressions.Regex InvalidCharsRegex =
    new(@"[\x00-\x1F/#]", System.Text.RegularExpressions.RegexOptions.Compiled);

public static (bool IsValid, string? Error) ValidateMumbleUsername(string? name)
{
    if (string.IsNullOrWhiteSpace(name))
        return (false, "Username cannot be empty.");

    if (name.Length > 128)
        return (false, "Username must be 128 characters or fewer.");

    if (InvalidCharsRegex.IsMatch(name))
        return (false, "Username contains invalid characters.");

    return (true, null);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~AuthServiceRegistrationTests" -v n`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Server/Auth/AuthService.cs tests/Brmble.Server.Tests/Auth/AuthServiceRegistrationTests.cs
git commit -m "feat: add username validation for Mumble registration"
```

### Task 5: Integrate registration check into AuthService.Authenticate()

**Files:**
- Modify: `src/Brmble.Server/Auth/AuthService.cs` — add `IMumbleRegistrationService` dependency, modify `Authenticate()`
- Modify: `src/Brmble.Server/Auth/AuthEndpoints.cs` — handle `MumbleNameConflictException`

- [ ] **Step 1: Add IMumbleRegistrationService to AuthService constructor and IsRegistered to AuthResult**

In `src/Brmble.Server/Auth/AuthService.cs`, add the dependency:

```csharp
private readonly IMumbleRegistrationService _mumbleRegistration;
private readonly ISessionMappingService _sessionMapping;

// In constructor, add parameters:
IMumbleRegistrationService mumbleRegistration,
ISessionMappingService sessionMapping
```

Update `AuthResult` to include registration status:

```csharp
public record AuthResult(long UserId, string MatrixUserId, string MatrixAccessToken, string DisplayName, bool IsRegistered, string Localpart);
```

- [ ] **Step 1b: Update existing AuthServiceTests for new constructor parameters**

In `tests/Brmble.Server.Tests/Auth/AuthServiceTests.cs`, update the `AuthService` constructor calls in `[TestInitialize]` to include mocked `IMumbleRegistrationService` and `ISessionMappingService`:

```csharp
private Mock<IMumbleRegistrationService> _mockMumbleRegistration = null!;
private Mock<ISessionMappingService> _mockSessionMapping = null!;

// In TestInitialize:
_mockMumbleRegistration = new Mock<IMumbleRegistrationService>();
_mockSessionMapping = new Mock<ISessionMappingService>();

// Pass to AuthService constructor:
new AuthService(...existing params..., _mockMumbleRegistration.Object, _mockSessionMapping.Object);
```

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~AuthServiceTests" -v n`
Expected: All existing tests still pass.

- [ ] **Step 2: Add registration resolution method to AuthService**

Add a new method that resolves the authoritative username from Mumble:

```csharp
/// <summary>
/// Resolves the authoritative username from Mumble's registration system.
/// Returns the name to use for the Brmble account.
/// Throws MumbleNameConflictException if the requested name is taken.
/// Throws MumbleRegistrationException if ICE is unavailable.
/// </summary>
public async Task<string> ResolveMumbleNameAsync(string mumbleName, string certHash)
{
    // Look up Mumble session for this user
    if (!_sessionMapping.TryGetSessionId(mumbleName, out var sessionId))
    {
        _logger.LogWarning("No Mumble session found for name '{Name}' during registration", mumbleName);
        throw new MumbleRegistrationException($"No active Mumble session found for '{mumbleName}'.");
    }

    // Check if user is already registered in Mumble
    var (isRegistered, mumbleUserId) = await _mumbleRegistration.GetRegistrationStatusAsync(sessionId);

    if (isRegistered)
    {
        // Use the Mumble-registered name (authoritative), ignore what client sent
        var registeredName = await _mumbleRegistration.GetRegisteredNameAsync(mumbleUserId);
        if (!string.IsNullOrEmpty(registeredName))
        {
            _logger.LogInformation(
                "User already registered in Mumble as '{RegisteredName}', ignoring requested name '{RequestedName}'",
                registeredName, mumbleName);
            return registeredName;
        }
    }

    // Not registered — validate and register the requested name
    var (valid, error) = ValidateMumbleUsername(mumbleName);
    if (!valid)
        throw new MumbleRegistrationException(error!);

    // This will throw MumbleNameConflictException if name is taken (handles TOCTOU)
    await _mumbleRegistration.RegisterUserAsync(mumbleName, certHash);
    _logger.LogInformation("Registered '{Name}' in Mumble for cert {CertHash}", mumbleName, certHash);
    return mumbleName;
}
```

- [ ] **Step 3: Modify Authenticate() to use ResolveMumbleNameAsync**

In the existing `Authenticate()` method, change the section where a new user is created. Before calling `_userRepo.Insert(certHash, mumbleUsername)`, resolve the name:

```csharp
// Before creating a new user, resolve the name from Mumble
string? resolvedName = mumbleUsername;
if (!string.IsNullOrEmpty(mumbleUsername))
{
    resolvedName = await ResolveMumbleNameAsync(mumbleUsername, certHash);
}

// Use resolvedName instead of mumbleUsername for Insert
var user = await _userRepo.Insert(certHash, resolvedName);
```

For **existing users** (already have a Brmble account), add reconciliation after the lookup:

```csharp
// Existing user — reconcile name with Mumble registration
if (!string.IsNullOrEmpty(mumbleUsername) && _sessionMapping.TryGetSessionId(mumbleUsername, out var existingSid))
{
    var (isReg, muId) = await _mumbleRegistration.GetRegistrationStatusAsync(existingSid);
    if (isReg)
    {
        var regName = await _mumbleRegistration.GetRegisteredNameAsync(muId);
        if (!string.IsNullOrEmpty(regName) && regName != user.DisplayName)
        {
            await _userRepo.UpdateDisplayName(user.Id, regName);
            _logger.LogInformation("Reconciled display name to Mumble registration: '{Name}'", regName);
        }
    }
    else if (user.DisplayName != $"user_{user.Id}")
    {
        // Not registered yet — auto-register their existing Brmble name
        try
        {
            await _mumbleRegistration.RegisterUserAsync(user.DisplayName, certHash);
            _logger.LogInformation("Auto-registered existing user '{Name}' in Mumble", user.DisplayName);
        }
        catch (MumbleNameConflictException)
        {
            // Name was taken by someone else — fallback
            var fallback = $"user_{user.Id}";
            await _userRepo.UpdateDisplayName(user.Id, fallback);
            _logger.LogWarning(
                "Existing name '{Name}' conflicted in Mumble, reset to '{Fallback}'",
                user.DisplayName, fallback);
        }
    }
}
```

- [ ] **Step 4: Update AuthEndpoints to handle MumbleNameConflictException**

In `src/Brmble.Server/Auth/AuthEndpoints.cs`, wrap the `authService.Authenticate()` call to catch name conflicts:

```csharp
AuthResult result;
try
{
    result = await authService.Authenticate(certHash, mumbleUsername);
}
catch (MumbleNameConflictException ex)
{
    logger.LogWarning("Name conflict during auth: {Message}", ex.Message);
    return Results.Conflict(new { error = "name_taken", message = ex.Message, name = ex.RequestedName });
}
catch (MumbleRegistrationException ex)
{
    logger.LogError(ex, "Mumble registration error during auth");
    return Results.StatusCode(503);
}
catch (Exception ex)
{
    // existing catch block
}
```

- [ ] **Step 5: Build and verify compilation**

Run: `dotnet build`
Expected: Build succeeded.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Server/Auth/AuthService.cs src/Brmble.Server/Auth/AuthEndpoints.cs
git commit -m "feat: integrate Mumble registration check into auth flow"
```

### Task 6: Add auth flow registration tests

**Files:**
- Modify: `tests/Brmble.Server.Tests/Auth/AuthServiceRegistrationTests.cs`

- [ ] **Step 1: Add integration-style tests for the registration flow**

Add these tests to `AuthServiceRegistrationTests.cs`. These test `ResolveMumbleNameAsync` behavior with mocked dependencies:

```csharp
// Add fields and setup to the test class:
private Mock<IMumbleRegistrationService> _mockReg = null!;
private Mock<ISessionMappingService> _mockSession = null!;
private AuthService _authService = null!;

// In a [TestInitialize] method, set up mocks and construct AuthService
// with all required dependencies (follow existing AuthServiceTests pattern).

[TestMethod]
public async Task ResolveMumbleNameAsync_ReturnsRegisteredName_WhenAlreadyRegistered()
{
    int sessionId = 42;
    _mockSession.Setup(s => s.TryGetSessionId("bob", out sessionId)).Returns(true);
    _mockReg.Setup(r => r.GetRegistrationStatusAsync(42))
        .ReturnsAsync((true, 1));
    _mockReg.Setup(r => r.GetRegisteredNameAsync(1))
        .ReturnsAsync("arie");

    var result = await _authService.ResolveMumbleNameAsync("bob", "cert123");
    Assert.AreEqual("arie", result); // Registered name overrides requested name
}

[TestMethod]
public async Task ResolveMumbleNameAsync_RegistersNewName_WhenNotRegistered()
{
    int sessionId = 42;
    _mockSession.Setup(s => s.TryGetSessionId("newuser", out sessionId)).Returns(true);
    _mockReg.Setup(r => r.GetRegistrationStatusAsync(42))
        .ReturnsAsync((false, -1));
    _mockReg.Setup(r => r.RegisterUserAsync("newuser", "cert456"))
        .ReturnsAsync(5);

    var result = await _authService.ResolveMumbleNameAsync("newuser", "cert456");
    Assert.AreEqual("newuser", result);
    _mockReg.Verify(r => r.RegisterUserAsync("newuser", "cert456"), Times.Once);
}

[TestMethod]
public async Task ResolveMumbleNameAsync_ThrowsNameConflict_WhenNameTaken()
{
    int sessionId = 42;
    _mockSession.Setup(s => s.TryGetSessionId("taken", out sessionId)).Returns(true);
    _mockReg.Setup(r => r.GetRegistrationStatusAsync(42))
        .ReturnsAsync((false, -1));
    _mockReg.Setup(r => r.RegisterUserAsync("taken", "cert789"))
        .ThrowsAsync(new MumbleNameConflictException("taken"));

    await Assert.ThrowsExceptionAsync<MumbleNameConflictException>(
        () => _authService.ResolveMumbleNameAsync("taken", "cert789"));
}

[TestMethod]
public async Task ResolveMumbleNameAsync_ThrowsWhenNoSession()
{
    int sessionId;
    _mockSession.Setup(s => s.TryGetSessionId("ghost", out sessionId)).Returns(false);

    await Assert.ThrowsExceptionAsync<MumbleRegistrationException>(
        () => _authService.ResolveMumbleNameAsync("ghost", "cert000"));
}
```

Follow the existing mock patterns in `AuthServiceTests.cs` (Moq + MSTest). The `ResolveMumbleNameAsync` method is public on `AuthService` and can be tested directly.

- [ ] **Step 2: Run tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~AuthServiceRegistrationTests" -v n`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/Brmble.Server.Tests/Auth/AuthServiceRegistrationTests.cs
git commit -m "test: add auth flow registration tests"
```

---

## Chunk 3: Frontend — Disable Username After Registration

### Task 7: Add registered state to auth response and ServerEntry

**Files:**
- Modify: `src/Brmble.Server/Auth/AuthEndpoints.cs` — include `registered: true` in response
- Modify: `src/Brmble.Web/src/hooks/useServerlist.ts` — add `registered` to `ServerEntry`
- Modify: `src/Brmble.Web/src/App.tsx` — read `registered` from auth response, save to server entry

- [ ] **Step 1: Add `registered` field to auth response**

In `src/Brmble.Server/Auth/AuthEndpoints.cs`, add to the OK response object:

```csharp
return Results.Ok(new
{
    matrix = new { ... },  // existing
    userMappings,          // existing
    sessionMappings = ..., // existing
    livekit = (object?)null,
    registered = result.IsRegistered,       // NEW: from AuthResult
    registeredName = result.DisplayName     // NEW: the authoritative name from Mumble
});
```

- [ ] **Step 2: Add `registered` flag to ServerEntry**

In `src/Brmble.Web/src/hooks/useServerlist.ts`, update the `ServerEntry` interface:

```typescript
export interface ServerEntry {
  id: string;
  label: string;
  host: string;
  port: number;
  username: string;
  registered?: boolean;  // NEW: true after successful Mumble registration
}
```

Note: The App.tsx bridge handler changes for `registered`/`registeredName` and error handling are covered in Task 10, which handles the full bridge message flow.

- [ ] **Step 3: Build frontend**

Run: `(cd src/Brmble.Web && npm run build)`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Server/Auth/AuthEndpoints.cs src/Brmble.Web/src/hooks/useServerlist.ts src/Brmble.Web/src/App.tsx
git commit -m "feat: add registered flag to auth response and server entries"
```

### Task 8: Disable username field in ServerList when registered

**Files:**
- Modify: `src/Brmble.Web/src/components/ServerList/ServerList.tsx`

- [ ] **Step 1: Disable username input when server is registered**

In `ServerList.tsx`, find the username input field in the server edit/display form. Add the `disabled` attribute based on the `registered` flag:

```tsx
<input
  type="text"
  id="username"
  value={editForm.username}
  onChange={(e) => setEditForm({ ...editForm, username: e.target.value })}
  placeholder="Username"
  disabled={server.registered === true}
/>
```

Add a visual hint when disabled (e.g. a small label or tooltip explaining the name is locked).

- [ ] **Step 2: Build frontend**

Run: `(cd src/Brmble.Web && npm run build)`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/ServerList/ServerList.tsx
git commit -m "feat: disable username field in ServerList when registered"
```

### Task 9: Disable username field in ConnectModal when registered

**Files:**
- Modify: `src/Brmble.Web/src/components/ConnectModal/ConnectModal.tsx`

- [ ] **Step 1: Add `registeredUsername` prop to ConnectModal**

```tsx
interface ConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnect: (serverData: { host: string; port: number; username: string; password: string }) => void;
  registeredUsername?: string;  // NEW: if set, username is locked
}
```

When `registeredUsername` is provided, pre-fill the username field and disable it:

```tsx
<input
  type="text"
  id="username"
  value={registeredUsername || username}
  onChange={(e) => !registeredUsername && setUsername(e.target.value)}
  placeholder="Your display name"
  disabled={!!registeredUsername}
/>
```

- [ ] **Step 2: Build frontend**

Run: `(cd src/Brmble.Web && npm run build)`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/ConnectModal/ConnectModal.tsx
git commit -m "feat: disable username field in ConnectModal when registered"
```

### Task 10: Forward auth errors through C# bridge and handle in frontend

**Important:** The frontend does NOT make HTTP requests to `/auth/token` directly. The auth flow goes through the C# bridge: `voice.connect` → `MumbleAdapter.Connect()` → `FetchCredentialsViaBcTls()` → `server.credentials` bridge message. Errors must be forwarded from MumbleAdapter through a bridge message.

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs` — parse 409/503 from auth endpoint, send `voice.authError` bridge message
- Modify: `src/Brmble.Web/src/App.tsx` — handle `voice.authError` bridge message

- [ ] **Step 1: Forward auth errors in MumbleAdapter**

In `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`, find the `FetchCredentialsViaBcTls()` method. Currently it returns `null` on non-200 responses and silently drops the error. Update it to parse 409 and 503 responses and send a bridge message:

```csharp
// In FetchCredentialsViaBcTls, after checking response status:
if (response.StatusCode == System.Net.HttpStatusCode.Conflict) // 409
{
    var errorBody = await response.Content.ReadAsStringAsync();
    var errorData = System.Text.Json.JsonDocument.Parse(errorBody);
    _bridge.SendToWeb("voice.authError", new
    {
        error = "name_taken",
        message = errorData.RootElement.GetProperty("message").GetString(),
        name = errorData.RootElement.GetProperty("name").GetString()
    });
    return null;
}

if ((int)response.StatusCode == 503)
{
    _bridge.SendToWeb("voice.authError", new
    {
        error = "registration_unavailable",
        message = "Mumble registration service is temporarily unavailable. Please try again."
    });
    return null;
}
```

- [ ] **Step 2: Handle `voice.authError` in App.tsx**

In `src/Brmble.Web/src/App.tsx`, register a bridge listener for `voice.authError`:

```typescript
bridge.on('voice.authError', (data: { error: string; message: string; name?: string }) => {
  if (data.error === 'name_taken') {
    setConnectionError(`Username "${data.name}" is already taken. Please choose a different name.`);
  } else {
    setConnectionError(data.message || 'Authentication failed.');
  }
  // Connection should not proceed — MumbleAdapter already returned null
});
```

Display `connectionError` state near the ServerList / ConnectModal UI. Clear the error when the user modifies the username field.

- [ ] **Step 3: Also forward `registered` and `registeredName` through bridge**

In `MumbleAdapter.cs`, when the auth response is successful (200), parse the new `registered` and `registeredName` fields and include them in the `server.credentials` bridge message that's already sent to the frontend:

```csharp
// In the existing success path where server.credentials is sent:
// Add registered and registeredName to the payload
registered = credentialsData.registered,
registeredName = credentialsData.registeredName
```

In `App.tsx`, in the `server.credentials` handler, read these fields and update the server entry:

```typescript
if (data.registered && currentServer) {
  updateServer(currentServer.id, {
    ...currentServer,
    username: data.registeredName || currentServer.username,
    registered: true
  });
}
```

- [ ] **Step 4: Build both frontend and backend**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj && (cd src/Brmble.Web && npm run build)`
Expected: Both build successfully.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs src/Brmble.Web/src/App.tsx
git commit -m "feat: forward auth errors through bridge, handle name conflicts in UI"
```

---

## Chunk 4: ProfileSettingsTab & Final Integration

### Task 11: Make display name read-only in ProfileSettingsTab

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/ProfileSettingsTab.tsx`

- [ ] **Step 1: Disable display name editing**

In `ProfileSettingsTab.tsx`, find the display name input/field. Make it read-only with a label explaining the name comes from Mumble registration:

```tsx
<input
  type="text"
  value={displayName}
  disabled
  title="Your display name is set by your Mumble registration and cannot be changed."
/>
<span className="settings-hint">Set by Mumble registration</span>
```

- [ ] **Step 2: Build frontend**

Run: `(cd src/Brmble.Web && npm run build)`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/SettingsModal/ProfileSettingsTab.tsx
git commit -m "feat: make display name read-only in profile settings"
```

### Task 12: Run full test suite

**Files:** None (verification only)

- [ ] **Step 1: Run all server tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj -v n`
Expected: All tests pass.

- [ ] **Step 2: Build full solution**

Run: `dotnet build`
Expected: Build succeeded.

- [ ] **Step 3: Build frontend**

Run: `(cd src/Brmble.Web && npm run build)`
Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 4: Manual smoke test**

1. Start the server and client in production mode
2. Connect to a Mumble server with a new username
3. Verify the username field becomes disabled after successful connection
4. Verify the name appears correctly in Mumble and Brmble
5. Disconnect and reconnect — verify the registered name is used automatically
6. Try connecting with a username that's already taken — verify error message appears

- [ ] **Step 5: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address issues found during integration testing"
```
