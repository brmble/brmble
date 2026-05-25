# Server Test Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `Brmble.Server.Tests` fast for local and GitHub runs by removing accidental Mumble Ice and LiveKit network waits from the default test suite.

**Architecture:** Keep endpoint tests hermetic by removing external hosted services from `BrmbleServerFactory`. Add narrow injectable boundaries around Mumble Ice communicator creation and LiveKit room SDK calls so unavailable-service behavior can be tested with immediate deterministic failures instead of TCP/gRPC timeouts.

**Tech Stack:** C#/.NET 10, ASP.NET Core `WebApplicationFactory`, MSTest, Moq, Microsoft.Extensions.DependencyInjection.

---

## File Structure

- Modify: `tests/Brmble.Server.Tests/Integration/BrmbleServerFactory.cs`
  - Owns integration-test service replacement. It should remove `MumbleIceService` from `IHostedService` registrations before the test host starts.
- Create: `tests/Brmble.Server.Tests/Integration/BrmbleServerFactoryTests.cs`
  - Verifies the test factory does not expose/start `MumbleIceService` as a hosted service.
- Create: `src/Brmble.Server/Mumble/IMumbleIceCommunicatorFactory.cs`
  - Narrow abstraction for creating the Ice communicator used by `MumbleIceService`.
- Create: `src/Brmble.Server/Mumble/MumbleIceCommunicatorFactory.cs`
  - Production communicator factory preserving the current Ice property setup.
- Modify: `src/Brmble.Server/Mumble/MumbleExtensions.cs`
  - Registers the new Mumble communicator factory.
- Modify: `src/Brmble.Server/Mumble/MumbleIceService.cs`
  - Uses `IMumbleIceCommunicatorFactory` instead of constructing `Ice.Communicator` directly.
- Modify: `tests/Brmble.Server.Tests/Mumble/MumbleIceServiceTests.cs`
  - Injects an immediate failing communicator factory for unavailable-Ice tests.
- Create: `src/Brmble.Server/LiveKit/ILiveKitRoomClient.cs`
  - Narrow abstraction over LiveKit room SDK calls used by `LiveKitService`.
- Create: `src/Brmble.Server/LiveKit/LiveKitRoomClient.cs`
  - Production LiveKit SDK adapter.
- Modify: `src/Brmble.Server/LiveKit/LiveKitExtensions.cs`
  - Registers the new LiveKit room client.
- Modify: `src/Brmble.Server/LiveKit/LiveKitService.cs`
  - Uses `ILiveKitRoomClient` for participant removal and participant listing.
- Modify: `tests/Brmble.Server.Tests/LiveKit/LiveKitServiceTests.cs`
  - Supplies a mock `ILiveKitRoomClient` to `LiveKitService` construction.
- Modify: `tests/Brmble.Server.Tests/LiveKit/LiveKitServiceRemoveParticipantTests.cs`
  - Replaces the real localhost LiveKit call with immediate mocked success/failure cases.

---

### Task 1: Remove Mumble Ice Hosted Service From Test Factory

**Files:**
- Create: `tests/Brmble.Server.Tests/Integration/BrmbleServerFactoryTests.cs`
- Modify: `tests/Brmble.Server.Tests/Integration/BrmbleServerFactory.cs`

- [ ] **Step 1: Write the failing test**

Create `tests/Brmble.Server.Tests/Integration/BrmbleServerFactoryTests.cs`:

```csharp
using Brmble.Server.Mumble;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Integration;

[TestClass]
public class BrmbleServerFactoryTests
{
    [TestMethod]
    public void Services_DoesNotRegisterMumbleIceServiceAsHostedService()
    {
        using var factory = new BrmbleServerFactory();
        using var client = factory.CreateClient();

        var hostedServices = factory.Services.GetServices<IHostedService>();

        Assert.IsFalse(hostedServices.Any(service => service.GetType() == typeof(MumbleIceService)));
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter BrmbleServerFactoryTests --no-restore
```

Expected: FAIL because `MumbleIceService` is still registered as an `IHostedService`. The test may also take about 4 seconds before failing, which confirms it is starting the slow path.

- [ ] **Step 3: Remove only the Mumble Ice hosted service in the test factory**

Modify `tests/Brmble.Server.Tests/Integration/BrmbleServerFactory.cs`.

Add this using near the other `Microsoft.Extensions.*` usings:

```csharp
using Microsoft.Extensions.Hosting;
```

Inside `builder.ConfigureServices(services => { ... })`, immediately after the database replacement block and before the Matrix mock block, add:

```csharp
            var mumbleIceHostedService = services.FirstOrDefault(d =>
                d.ServiceType == typeof(IHostedService) &&
                d.ImplementationType == typeof(MumbleIceService));
            if (mumbleIceHostedService != null) services.Remove(mumbleIceHostedService);
```

The surrounding section should look like this:

```csharp
            // Replace the lazily-registered Database factory with a concrete in-memory instance.
            var descriptor = services.FirstOrDefault(d => d.ServiceType == typeof(Database));
            if (descriptor != null) services.Remove(descriptor);
            var db = new Database(_cs);
            db.Initialize();
            services.AddSingleton(db);

            var mumbleIceHostedService = services.FirstOrDefault(d =>
                d.ServiceType == typeof(IHostedService) &&
                d.ImplementationType == typeof(MumbleIceService));
            if (mumbleIceHostedService != null) services.Remove(mumbleIceHostedService);

            // Stub IMatrixAppService so no real HTTP calls are made
            var existing = services.FirstOrDefault(d => d.ServiceType == typeof(IMatrixAppService));
```

- [ ] **Step 4: Run targeted test to verify it passes quickly**

Run:

```powershell
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter BrmbleServerFactoryTests --no-restore
```

Expected: PASS, and the test should no longer spend about 4 seconds in `MumbleIceService.StartAsync`.

- [ ] **Step 5: Run one representative endpoint group**

Run:

```powershell
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter LiveKitEndpointsTests --no-restore
```

Expected: PASS. Individual endpoint tests should not each report about 4 seconds anymore.

- [ ] **Step 6: Commit**

```powershell
git add tests/Brmble.Server.Tests/Integration/BrmbleServerFactory.cs tests/Brmble.Server.Tests/Integration/BrmbleServerFactoryTests.cs
git commit -m "test: remove mumble ice startup from server factory"
```

---

### Task 2: Make Mumble Ice Startup Failure Tests Deterministic

**Files:**
- Create: `src/Brmble.Server/Mumble/IMumbleIceCommunicatorFactory.cs`
- Create: `src/Brmble.Server/Mumble/MumbleIceCommunicatorFactory.cs`
- Modify: `src/Brmble.Server/Mumble/MumbleExtensions.cs`
- Modify: `src/Brmble.Server/Mumble/MumbleIceService.cs`
- Modify: `tests/Brmble.Server.Tests/Mumble/MumbleIceServiceTests.cs`

- [ ] **Step 1: Write failing Mumble Ice tests using the planned seam**

Modify `tests/Brmble.Server.Tests/Mumble/MumbleIceServiceTests.cs`.

Change the `CreateService` helper signature and body to accept an optional communicator factory:

```csharp
    private static MumbleIceService CreateService(
        string host = "localhost",
        int port = 9999,
        IMumbleIceCommunicatorFactory? communicatorFactory = null)
    {
        var participantRemover = new Mock<ILiveKitParticipantRemover>().Object;
        var revocationScheduler = new LiveKitParticipantRevocationScheduler(
            participantRemover,
            NullLogger<LiveKitParticipantRevocationScheduler>.Instance,
            []);

        var callback = new MumbleServerCallback(
            Enumerable.Empty<IMumbleEventHandler>(),
            new Mock<ISessionMappingService>().Object,
            new Mock<IBrmbleEventBus>().Object,
            new Mock<IChannelMembershipService>().Object,
            new ScreenShareTracker(),
            revocationScheduler,
            new LiveKitParticipantTracker(),
            NullLogger<MumbleServerCallback>.Instance);

        var iceSettings = Options.Create(new IceSettings { Host = host, Port = port, Secret = "test-secret" });

        var db = new Database("Data Source=:memory:");
        db.Initialize();
        var channelRepo = new ChannelRepository(db);
        var appService = new Mock<IMatrixAppService>().Object;
        var sessions = new Mock<IActiveBrmbleSessions>().Object;
        var matrixService = new MatrixService(channelRepo, appService, sessions, NullLogger<MatrixService>.Instance);

        var registrationService = new MumbleRegistrationService(NullLogger<MumbleRegistrationService>.Instance);
        var aclIceClient = new MumbleAclIceClient();

        communicatorFactory ??= CreateFailingCommunicatorFactory();

        return new MumbleIceService(
            callback,
            registrationService,
            aclIceClient,
            matrixService,
            iceSettings,
            communicatorFactory,
            NullLogger<MumbleIceService>.Instance);
    }
```

Add this helper below `CreateService`:

```csharp
    private static IMumbleIceCommunicatorFactory CreateFailingCommunicatorFactory()
    {
        var communicatorFactory = new Mock<IMumbleIceCommunicatorFactory>();
        communicatorFactory.Setup(f => f.Create())
            .Throws(new InvalidOperationException("Ice unavailable in test"));
        return communicatorFactory.Object;
    }
```

Rename the first test to make the deterministic failure explicit:

```csharp
    [TestMethod]
    public async Task StartAsync_IceStartupThrows_CompletesWithoutThrowing()
    {
        var svc = CreateService();
        await svc.StartAsync(CancellationToken.None);
    }
```

Keep `StopAsync_CompletesWithoutThrowing` unchanged except that it now uses the updated helper. Keep `StartThenStop_CompletesWithoutThrowing` unchanged except that startup now fails immediately through the fake factory.

- [ ] **Step 2: Run test to verify it fails at compile time**

Run:

```powershell
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter MumbleIceServiceTests --no-restore
```

Expected: FAIL to compile because `IMumbleIceCommunicatorFactory` does not exist and `MumbleIceService` does not accept the factory parameter yet.

- [ ] **Step 3: Add the communicator factory interface**

Create `src/Brmble.Server/Mumble/IMumbleIceCommunicatorFactory.cs`:

```csharp
namespace Brmble.Server.Mumble;

public interface IMumbleIceCommunicatorFactory
{
    Ice.Communicator Create();
}
```

- [ ] **Step 4: Add the production communicator factory**

Create `src/Brmble.Server/Mumble/MumbleIceCommunicatorFactory.cs`:

```csharp
namespace Brmble.Server.Mumble;

public sealed class MumbleIceCommunicatorFactory : IMumbleIceCommunicatorFactory
{
    public Ice.Communicator Create()
    {
        var properties = new Ice.Properties();
        properties.setProperty("Ice.Default.EncodingVersion", "1.0");
        properties.setProperty("Ice.MessageSizeMax", "65536");

        var initData = new Ice.InitializationData { properties = properties };
        return new Ice.Communicator(initData);
    }
}
```

- [ ] **Step 5: Register the communicator factory**

Modify `src/Brmble.Server/Mumble/MumbleExtensions.cs`.

Add this line before `services.AddHostedService<MumbleIceService>();`:

```csharp
        services.AddSingleton<IMumbleIceCommunicatorFactory, MumbleIceCommunicatorFactory>();
```

The bottom of `AddMumble` should look like this:

```csharp
        services.AddSingleton<IAclEventDispatcher, AclEventDispatcher>();
        services.AddSingleton<IAclSyncCoordinator, AclSyncCoordinator>();
        services.AddSingleton<AclValidationService>();
        services.AddSingleton<MumbleServerCallback>();
        services.AddSingleton<IMumbleIceCommunicatorFactory, MumbleIceCommunicatorFactory>();
        services.AddHostedService<MumbleIceService>();
        return services;
```

- [ ] **Step 6: Inject and use the communicator factory in MumbleIceService**

Modify `src/Brmble.Server/Mumble/MumbleIceService.cs`.

Add a field:

```csharp
    private readonly IMumbleIceCommunicatorFactory _communicatorFactory;
```

Change the constructor signature to include the factory before the logger:

```csharp
    public MumbleIceService(
        MumbleServerCallback callback,
        MumbleRegistrationService registrationService,
        MumbleAclIceClient aclIceClient,
        MatrixService matrixService,
        IOptions<IceSettings> settings,
        IMumbleIceCommunicatorFactory communicatorFactory,
        ILogger<MumbleIceService> logger)
```

Assign it in the constructor:

```csharp
        _communicatorFactory = communicatorFactory;
```

Replace the communicator construction block in `StartAsync`:

```csharp
            var properties = new Ice.Properties();
            properties.setProperty("Ice.Default.EncodingVersion", "1.0");
            properties.setProperty("Ice.MessageSizeMax", "65536"); // 64 MB — match Mumble server default

            var initData = new Ice.InitializationData { properties = properties };
            _communicator = new Ice.Communicator(initData);
```

with:

```csharp
            _communicator = _communicatorFactory.Create();
```

- [ ] **Step 7: Run targeted Mumble Ice tests**

Run:

```powershell
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter MumbleIceServiceTests --no-restore
```

Expected: PASS, and the two startup tests should no longer take about 8 seconds each.

- [ ] **Step 8: Run representative Mumble tests**

Run:

```powershell
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "MumbleIceServiceTests|MumbleAclServiceTests|MumbleRegistrationServiceTests" --no-restore
```

Expected: PASS.

- [ ] **Step 9: Commit**

```powershell
git add src/Brmble.Server/Mumble/IMumbleIceCommunicatorFactory.cs src/Brmble.Server/Mumble/MumbleIceCommunicatorFactory.cs src/Brmble.Server/Mumble/MumbleExtensions.cs src/Brmble.Server/Mumble/MumbleIceService.cs tests/Brmble.Server.Tests/Mumble/MumbleIceServiceTests.cs
git commit -m "test: make mumble ice startup tests deterministic"
```

---

### Task 3: Replace Real LiveKit Room Network Calls In Unit Tests

**Files:**
- Create: `src/Brmble.Server/LiveKit/ILiveKitRoomClient.cs`
- Create: `src/Brmble.Server/LiveKit/LiveKitRoomClient.cs`
- Modify: `src/Brmble.Server/LiveKit/LiveKitExtensions.cs`
- Modify: `src/Brmble.Server/LiveKit/LiveKitService.cs`
- Modify: `tests/Brmble.Server.Tests/LiveKit/LiveKitServiceTests.cs`
- Modify: `tests/Brmble.Server.Tests/LiveKit/LiveKitServiceRemoveParticipantTests.cs`

- [ ] **Step 1: Write failing LiveKit room-client tests**

Replace the contents of `tests/Brmble.Server.Tests/LiveKit/LiveKitServiceRemoveParticipantTests.cs` with:

```csharp
using Brmble.Server.Auth;
using Brmble.Server.Data;
using Brmble.Server.LiveKit;
using Brmble.Server.Matrix;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Moq;

namespace Brmble.Server.Tests.LiveKit;

[TestClass]
public class LiveKitServiceRemoveParticipantTests
{
    [TestMethod]
    public async Task RemoveParticipant_ReturnsFalseAndDoesNotThrow_WhenRoomClientThrows()
    {
        var roomClient = new Mock<ILiveKitRoomClient>();
        roomClient.Setup(c => c.RemoveParticipant("nonexistent-room", "nonexistent-user"))
            .ThrowsAsync(new InvalidOperationException("LiveKit unavailable in test"));
        var service = CreateService(roomClient.Object);

        var removed = await service.RemoveParticipant("nonexistent-room", "nonexistent-user");

        Assert.IsFalse(removed);
    }

    [TestMethod]
    public async Task RemoveParticipant_ReturnsTrue_WhenRoomClientSucceeds()
    {
        var roomClient = new Mock<ILiveKitRoomClient>();
        roomClient.Setup(c => c.RemoveParticipant("channel-1", "@alice:test"))
            .Returns(Task.CompletedTask);
        var service = CreateService(roomClient.Object);

        var removed = await service.RemoveParticipant("channel-1", "@alice:test");

        Assert.IsTrue(removed);
        roomClient.Verify(c => c.RemoveParticipant("channel-1", "@alice:test"), Times.Once);
    }

    private static LiveKitService CreateService(ILiveKitRoomClient roomClient)
    {
        var settings = Options.Create(new LiveKitSettings
        {
            ApiKey = "test",
            ApiSecret = "secret-must-be-long-enough-for-hmac",
            ServerUrl = "http://localhost:7880"
        });
        var matrixSettings = Options.Create(new MatrixSettings { ServerDomain = "test.local" });
        var userRepo = new Mock<UserRepository>(
            new Mock<Database>("Data Source=:memory:").Object,
            matrixSettings);

        return new LiveKitService(
            settings,
            userRepo.Object,
            roomClient,
            NullLogger<LiveKitService>.Instance);
    }
}
```

- [ ] **Step 2: Run test to verify it fails at compile time**

Run:

```powershell
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter LiveKitServiceRemoveParticipantTests --no-restore
```

Expected: FAIL to compile because `ILiveKitRoomClient` does not exist and `LiveKitService` does not accept a room client yet.

- [ ] **Step 3: Add the LiveKit room client interface**

Create `src/Brmble.Server/LiveKit/ILiveKitRoomClient.cs`:

```csharp
namespace Brmble.Server.LiveKit;

public interface ILiveKitRoomClient
{
    Task RemoveParticipant(string roomName, string participantIdentity);

    Task<IReadOnlyList<string>> ListParticipantIdentities(string roomName);
}
```

- [ ] **Step 4: Add the production LiveKit SDK adapter**

Create `src/Brmble.Server/LiveKit/LiveKitRoomClient.cs`:

```csharp
using Livekit.Server.Sdk.Dotnet;
using Microsoft.Extensions.Options;

namespace Brmble.Server.LiveKit;

public sealed class LiveKitRoomClient : ILiveKitRoomClient
{
    private readonly LiveKitSettings _settings;

    public LiveKitRoomClient(IOptions<LiveKitSettings> settings)
    {
        _settings = settings.Value;
    }

    public async Task RemoveParticipant(string roomName, string participantIdentity)
    {
        var roomService = CreateRoomServiceClient();

        await roomService.RemoveParticipant(new RoomParticipantIdentity
        {
            Room = roomName,
            Identity = participantIdentity
        });
    }

    public async Task<IReadOnlyList<string>> ListParticipantIdentities(string roomName)
    {
        var roomService = CreateRoomServiceClient();
        var response = await roomService.ListParticipants(new ListParticipantsRequest
        {
            Room = roomName
        });

        return response.Participants.Select(p => p.Identity).ToList();
    }

    private RoomServiceClient CreateRoomServiceClient()
    {
        return new RoomServiceClient(
            _settings.ServerUrl,
            _settings.ApiKey,
            _settings.ApiSecret);
    }
}
```

- [ ] **Step 5: Register the room client**

Modify `src/Brmble.Server/LiveKit/LiveKitExtensions.cs`.

Add this line after options registration and before `services.AddSingleton<LiveKitService>();`:

```csharp
        services.AddSingleton<ILiveKitRoomClient, LiveKitRoomClient>();
```

The top of `AddLiveKit` should look like this:

```csharp
        services.AddOptions<LiveKitSettings>()
            .BindConfiguration("LiveKit");
        services.AddSingleton<ILiveKitRoomClient, LiveKitRoomClient>();
        services.AddSingleton<LiveKitService>();
```

- [ ] **Step 6: Inject and use the room client in LiveKitService**

Modify `src/Brmble.Server/LiveKit/LiveKitService.cs`.

Remove this using because SDK types will move to `LiveKitRoomClient`:

```csharp
using Livekit.Server.Sdk.Dotnet;
```

Add this field:

```csharp
    private readonly ILiveKitRoomClient _roomClient;
```

Change the constructor to:

```csharp
    public LiveKitService(
        IOptions<LiveKitSettings> settings,
        UserRepository userRepo,
        ILiveKitRoomClient roomClient,
        ILogger<LiveKitService> logger)
    {
        _settings = settings.Value;
        _userRepo = userRepo;
        _roomClient = roomClient;
        _logger = logger;
    }
```

Replace `RemoveParticipant` with:

```csharp
    public async Task<bool> RemoveParticipant(string roomName, string participantIdentity)
    {
        try
        {
            await _roomClient.RemoveParticipant(roomName, participantIdentity);

            _logger.LogInformation("Removed participant {Identity} from room {Room}", participantIdentity, roomName);
            return true;
        }
        catch (Exception ex)
        {
            // Idempotent: if room/participant doesn't exist, that's fine
            _logger.LogDebug(ex, "Could not remove participant {Identity} from room {Room} (may not exist)", participantIdentity, roomName);
            return false;
        }
    }
```

Replace `ListParticipantIdentities` with:

```csharp
    public async Task<IReadOnlyList<string>> ListParticipantIdentities(string roomName)
    {
        try
        {
            return await _roomClient.ListParticipantIdentities(roomName);
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Could not list participants in room {Room}", roomName);
            return Array.Empty<string>();
        }
    }
```

- [ ] **Step 7: Update LiveKitServiceTests constructor setup**

Modify `tests/Brmble.Server.Tests/LiveKit/LiveKitServiceTests.cs`.

In `Setup`, replace the service construction:

```csharp
        _svc = new LiveKitService(settings, _mockUserRepo.Object,
            NullLogger<LiveKitService>.Instance);
```

with:

```csharp
        var roomClient = new Mock<ILiveKitRoomClient>();
        _svc = new LiveKitService(settings, _mockUserRepo.Object, roomClient.Object,
            NullLogger<LiveKitService>.Instance);
```

- [ ] **Step 8: Run targeted LiveKit service tests**

Run:

```powershell
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "LiveKitServiceTests|LiveKitServiceRemoveParticipantTests" --no-restore
```

Expected: PASS. `LiveKitServiceRemoveParticipantTests` should complete without a 4-second localhost wait.

- [ ] **Step 9: Run LiveKit endpoint tests**

Run:

```powershell
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter LiveKitEndpointsTests --no-restore
```

Expected: PASS.

- [ ] **Step 10: Commit**

```powershell
git add src/Brmble.Server/LiveKit/ILiveKitRoomClient.cs src/Brmble.Server/LiveKit/LiveKitRoomClient.cs src/Brmble.Server/LiveKit/LiveKitExtensions.cs src/Brmble.Server/LiveKit/LiveKitService.cs tests/Brmble.Server.Tests/LiveKit/LiveKitServiceTests.cs tests/Brmble.Server.Tests/LiveKit/LiveKitServiceRemoveParticipantTests.cs
git commit -m "test: isolate livekit room client in server tests"
```

---

### Task 4: Full Verification And Runtime Check

**Files:**
- No code changes expected.

- [ ] **Step 1: Run server tests with build**

Run:

```powershell
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --no-restore
```

Expected: PASS. Runtime should be far below the previous 5 minutes 45 seconds because repeated 4-second factory waits and direct external-service waits have been removed.

- [ ] **Step 2: Run server tests without build for clean timing**

Run:

```powershell
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --no-build --no-restore
```

Expected: PASS. Runtime should no longer be dominated by `WebApplicationFactory` startup waits.

- [ ] **Step 3: Inspect slow-test output for remaining accidental waits**

Run:

```powershell
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --no-build --no-restore --logger "console;verbosity=normal"
```

Expected: PASS. No normal test should report around 4 seconds solely because Mumble Ice or LiveKit localhost is unavailable. If isolated tests still take hundreds of milliseconds due to large payload creation, leave them alone unless they dominate the total runtime.

- [ ] **Step 4: Check worktree status**

Run:

```powershell
git status --short --branch
```

Expected: only unrelated pre-existing untracked files should remain. All files changed by this plan should be committed.

- [ ] **Step 5: Final summary**

Report:

- Before timing: `5 m 45 s` from the measured baseline.
- After timing from Step 2.
- Any remaining test that still takes about 1 second or more.
- Confirmation that no implementation pushed to remote unless the user explicitly requested it.

---

## Self-Review

Spec coverage:

- Hermetic default endpoint tests: Task 1 removes `MumbleIceService` from `BrmbleServerFactory`.
- Deterministic Mumble unavailable behavior: Task 2 injects `IMumbleIceCommunicatorFactory` and forces immediate startup failure in tests.
- Deterministic LiveKit unavailable behavior: Task 3 injects `ILiveKitRoomClient` and mocks immediate success/failure.
- Verification: Task 4 runs targeted and full server test commands and checks runtime output.

Placeholder scan:

- No placeholder sections remain.
- Each code-changing step includes concrete code and exact file paths.

Type consistency:

- `IMumbleIceCommunicatorFactory.Create()` returns `Ice.Communicator` and is consumed by `MumbleIceService`.
- `ILiveKitRoomClient.RemoveParticipant(...)` returns `Task`, allowing `LiveKitService.RemoveParticipant(...)` to preserve its existing `Task<bool>` public contract.
- `ILiveKitRoomClient.ListParticipantIdentities(...)` returns `Task<IReadOnlyList<string>>`, matching `LiveKitService.ListParticipantIdentities(...)`.
