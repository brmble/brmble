# Chat Persistence — Matrix Plumbing + Ice Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fill in all server-side TODO stubs to wire OG Mumble client messages through ZeroC Ice into Matrix via the appservice API.

**Architecture:** `MumbleIceService` connects to Mumble via ZeroC Ice and registers `MumbleServerCallback`. Ice events dispatch to `IMumbleEventHandler` implementations, specifically `MatrixEventHandler`, which calls `MatrixService` for dedup + relay. `MatrixService` calls `MatrixAppService` which performs HTTP PUTs to Continuwuity.

**Tech Stack:** .NET 10 / ASP.NET Core, Dapper + SQLite, ZeroC Ice 3.7 (`zeroc.ice` NuGet), MSTest + Moq, IHttpClientFactory.

---

## Reference

- **Design doc:** `docs/plans/2026-02-20-chat-persistence-matrix-ice-design.md`
- **Spec:** `docs/chat-persistance-spec.md` §3–6
- **Test command:** `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj`
- **Branch:** create `feature/chat-persistence-matrix-ice` from `main`

---

## Task 1: ChannelRepository — data layer

**Files:**
- Modify: `src/Brmble.Server/Matrix/ChannelRepository.cs`
- Modify: `tests/Brmble.Server.Tests/Matrix/ChannelRepositoryTests.cs`

### Step 1: Write the failing tests

Replace the TODO comment block in `ChannelRepositoryTests.cs` with these tests (keep existing `Setup`/`Cleanup`/constructor test):

```csharp
[TestMethod]
public void GetRoomId_ExistingMapping_ReturnsRoomId()
{
    var repo = new ChannelRepository(_db!);
    repo.Insert(42, "!room:server");

    var result = repo.GetRoomId(42);

    Assert.AreEqual("!room:server", result);
}

[TestMethod]
public void GetRoomId_UnknownChannel_ReturnsNull()
{
    var repo = new ChannelRepository(_db!);

    var result = repo.GetRoomId(99);

    Assert.IsNull(result);
}

[TestMethod]
public void Insert_NewMapping_PersistsToDatabase()
{
    var repo = new ChannelRepository(_db!);
    repo.Insert(1, "!abc:server");

    var result = repo.GetRoomId(1);

    Assert.AreEqual("!abc:server", result);
}

[TestMethod]
public void Insert_DuplicateChannelId_DoesNotThrow()
{
    var repo = new ChannelRepository(_db!);
    repo.Insert(1, "!abc:server");
    repo.Insert(1, "!xyz:server"); // INSERT OR IGNORE — no throw
}

[TestMethod]
public void Delete_ExistingMapping_RemovesRecord()
{
    var repo = new ChannelRepository(_db!);
    repo.Insert(5, "!room:server");

    repo.Delete(5);

    Assert.IsNull(repo.GetRoomId(5));
}

[TestMethod]
public void Delete_NonExistentMapping_DoesNotThrow()
{
    var repo = new ChannelRepository(_db!);
    repo.Delete(999);
}
```

### Step 2: Run tests to verify they fail

```bash
dotnet test tests/Brmble.Server.Tests/ --filter "ChannelRepositoryTests"
```

Expected: `FAIL` — methods not implemented.

### Step 3: Implement ChannelRepository

Replace the three TODO comments in `src/Brmble.Server/Matrix/ChannelRepository.cs`:

```csharp
using Brmble.Server.Data;
using Dapper;

namespace Brmble.Server.Matrix;

public record ChannelRoomMapping(int MumbleChannelId, string MatrixRoomId);

public class ChannelRepository
{
    private readonly Database _db;

    public ChannelRepository(Database db)
    {
        _db = db;
    }

    public string? GetRoomId(int mumbleChannelId)
    {
        using var conn = _db.CreateConnection();
        return conn.QuerySingleOrDefault<string>(
            "SELECT matrix_room_id FROM channel_room_map WHERE mumble_channel_id = @id",
            new { id = mumbleChannelId });
    }

    public void Insert(int mumbleChannelId, string matrixRoomId)
    {
        using var conn = _db.CreateConnection();
        conn.Execute(
            "INSERT OR IGNORE INTO channel_room_map (mumble_channel_id, matrix_room_id) VALUES (@channelId, @roomId)",
            new { channelId = mumbleChannelId, roomId = matrixRoomId });
    }

    public void Delete(int mumbleChannelId)
    {
        using var conn = _db.CreateConnection();
        conn.Execute(
            "DELETE FROM channel_room_map WHERE mumble_channel_id = @id",
            new { id = mumbleChannelId });
    }
}
```

### Step 4: Run tests to verify they pass

```bash
dotnet test tests/Brmble.Server.Tests/ --filter "ChannelRepositoryTests"
```

Expected: all 7 tests pass.

### Step 5: Commit

```bash
git add src/Brmble.Server/Matrix/ChannelRepository.cs \
        tests/Brmble.Server.Tests/Matrix/ChannelRepositoryTests.cs
git commit -m "feat: implement ChannelRepository data methods"
```

---

## Task 2: MatrixAppService — HTTP layer

**Files:**
- Modify: `src/Brmble.Server/Matrix/MatrixAppService.cs`
- Modify: `src/Brmble.Server/Matrix/MatrixExtensions.cs`
- Create: `tests/Brmble.Server.Tests/Matrix/MatrixAppServiceTests.cs`

### Step 1: Extract IMatrixAppService interface

`MatrixService` needs to mock the app service in unit tests. Add an interface to `MatrixAppService.cs` above the class:

```csharp
public interface IMatrixAppService
{
    Task SendMessage(string roomId, string displayName, string text);
    Task<string> CreateRoom(string name);
    Task SetRoomName(string roomId, string name);
}
```

Update `MatrixExtensions.cs` to register by interface:

```csharp
using Brmble.Server.Mumble;

namespace Brmble.Server.Matrix;

public static class MatrixExtensions
{
    public static IServiceCollection AddMatrix(this IServiceCollection services)
    {
        services.AddHttpClient();
        services.AddSingleton<ChannelRepository>();
        services.AddSingleton<IMatrixAppService, MatrixAppService>();
        services.AddSingleton<MatrixService>();
        services.AddSingleton<IMumbleEventHandler, MatrixEventHandler>();
        return services;
    }
}
```

### Step 2: Write failing tests

Create `tests/Brmble.Server.Tests/Matrix/MatrixAppServiceTests.cs`:

```csharp
using System.Net;
using System.Text.Json;
using Brmble.Server.Matrix;
using Microsoft.Extensions.Configuration;
using Moq;
using Moq.Protected;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Matrix;

[TestClass]
public class MatrixAppServiceTests
{
    private Mock<HttpMessageHandler> _mockHandler = null!;
    private MatrixAppService _svc = null!;
    private List<HttpRequestMessage> _capturedRequests = null!;

    [TestInitialize]
    public void Setup()
    {
        _capturedRequests = [];
        _mockHandler = new Mock<HttpMessageHandler>(MockBehavior.Strict);

        var factory = new Mock<IHttpClientFactory>();
        factory.Setup(f => f.CreateClient(It.IsAny<string>()))
            .Returns(new HttpClient(_mockHandler.Object));

        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Matrix:HomeserverUrl"] = "http://localhost:8008",
                ["Matrix:AppServiceToken"] = "test-token"
            })
            .Build();

        _svc = new MatrixAppService(factory.Object, config);
    }

    private void SetupHttpResponse(HttpStatusCode status, string body = "{}")
    {
        _mockHandler.Protected()
            .Setup<Task<HttpResponseMessage>>("SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>())
            .Callback<HttpRequestMessage, CancellationToken>((req, _) => _capturedRequests.Add(req))
            .ReturnsAsync(new HttpResponseMessage(status)
            {
                Content = new StringContent(body)
            });
    }

    [TestMethod]
    public async Task SendMessage_SendsPutWithCorrectPath()
    {
        SetupHttpResponse(HttpStatusCode.OK);

        await _svc.SendMessage("!room:server", "Alice", "hello");

        var req = _capturedRequests.Single();
        Assert.AreEqual(HttpMethod.Put, req.Method);
        StringAssert.Contains(req.RequestUri!.AbsolutePath,
            "/_matrix/client/v3/rooms/!room:server/send/m.room.message/");
    }

    [TestMethod]
    public async Task SendMessage_SendsBearerToken()
    {
        SetupHttpResponse(HttpStatusCode.OK);

        await _svc.SendMessage("!room:server", "Alice", "hello");

        var req = _capturedRequests.Single();
        Assert.AreEqual("test-token", req.Headers.Authorization!.Parameter);
        Assert.AreEqual("Bearer", req.Headers.Authorization!.Scheme);
    }

    [TestMethod]
    public async Task SendMessage_BodyContainsDisplayNameAndText()
    {
        SetupHttpResponse(HttpStatusCode.OK);

        await _svc.SendMessage("!room:server", "Alice", "hello world");

        var req = _capturedRequests.Single();
        var body = await req.Content!.ReadAsStringAsync();
        StringAssert.Contains(body, "[Alice]");
        StringAssert.Contains(body, "hello world");
    }

    [TestMethod]
    public async Task CreateRoom_ReturnsRoomId()
    {
        SetupHttpResponse(HttpStatusCode.OK,
            JsonSerializer.Serialize(new { room_id = "!newroom:server" }));

        var roomId = await _svc.CreateRoom("General");

        Assert.AreEqual("!newroom:server", roomId);
    }

    [TestMethod]
    public async Task CreateRoom_SendsPostToCreateRoomEndpoint()
    {
        SetupHttpResponse(HttpStatusCode.OK,
            JsonSerializer.Serialize(new { room_id = "!newroom:server" }));

        await _svc.CreateRoom("General");

        var req = _capturedRequests.Single();
        Assert.AreEqual(HttpMethod.Post, req.Method);
        StringAssert.Contains(req.RequestUri!.AbsolutePath, "/_matrix/client/v3/createRoom");
    }

    [TestMethod]
    public async Task SetRoomName_SendsPutToRoomNameStateEndpoint()
    {
        SetupHttpResponse(HttpStatusCode.OK);

        await _svc.SetRoomName("!room:server", "New Name");

        var req = _capturedRequests.Single();
        Assert.AreEqual(HttpMethod.Put, req.Method);
        StringAssert.Contains(req.RequestUri!.AbsolutePath, "m.room.name");
    }
}
```

### Step 3: Run tests to verify they fail

```bash
dotnet test tests/Brmble.Server.Tests/ --filter "MatrixAppServiceTests"
```

Expected: compile error — `MatrixAppService` constructor doesn't accept `IConfiguration` yet.

### Step 4: Implement MatrixAppService

Replace the entire content of `src/Brmble.Server/Matrix/MatrixAppService.cs`:

```csharp
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;

namespace Brmble.Server.Matrix;

public interface IMatrixAppService
{
    Task SendMessage(string roomId, string displayName, string text);
    Task<string> CreateRoom(string name);
    Task SetRoomName(string roomId, string name);
}

public class MatrixAppService : IMatrixAppService
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly string _homeserverUrl;
    private readonly string _appServiceToken;

    public MatrixAppService(IHttpClientFactory httpClientFactory, IConfiguration configuration)
    {
        _httpClientFactory = httpClientFactory;
        _homeserverUrl = configuration["Matrix:HomeserverUrl"]
            ?? throw new InvalidOperationException("Matrix:HomeserverUrl not configured");
        _appServiceToken = configuration["Matrix:AppServiceToken"]
            ?? throw new InvalidOperationException("Matrix:AppServiceToken not configured");
    }

    public async Task SendMessage(string roomId, string displayName, string text)
    {
        var txnId = Guid.NewGuid().ToString("N");
        var url = $"{_homeserverUrl}/_matrix/client/v3/rooms/{Uri.EscapeDataString(roomId)}/send/m.room.message/{txnId}";
        var body = JsonSerializer.Serialize(new
        {
            msgtype = "m.text",
            body = $"[{displayName}]: {text}"
        });
        await SendRequest(HttpMethod.Put, url, body);
    }

    public async Task<string> CreateRoom(string name)
    {
        var url = $"{_homeserverUrl}/_matrix/client/v3/createRoom";
        var body = JsonSerializer.Serialize(new
        {
            name,
            preset = "private_chat"
        });
        var response = await SendRequest(HttpMethod.Post, url, body);
        var json = JsonSerializer.Deserialize<JsonElement>(response);
        return json.GetProperty("room_id").GetString()
            ?? throw new InvalidOperationException("Matrix did not return a room_id");
    }

    public async Task SetRoomName(string roomId, string name)
    {
        var url = $"{_homeserverUrl}/_matrix/client/v3/rooms/{Uri.EscapeDataString(roomId)}/state/m.room.name";
        var body = JsonSerializer.Serialize(new { name });
        await SendRequest(HttpMethod.Put, url, body);
    }

    private async Task<string> SendRequest(HttpMethod method, string url, string jsonBody)
    {
        var client = _httpClientFactory.CreateClient();
        var request = new HttpRequestMessage(method, url)
        {
            Content = new StringContent(jsonBody, Encoding.UTF8, "application/json")
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _appServiceToken);
        var response = await client.SendAsync(request);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadAsStringAsync();
    }
}
```

### Step 5: Update MatrixService constructor to use IMatrixAppService

In `src/Brmble.Server/Matrix/MatrixService.cs`, change the field type:

```csharp
using Brmble.Server.Auth;

namespace Brmble.Server.Matrix;

public class MatrixService
{
    private readonly ChannelRepository _channelRepository;
    private readonly IMatrixAppService _appService;
    private readonly IActiveBrmbleSessions _activeSessions;

    public MatrixService(
        ChannelRepository channelRepository,
        IMatrixAppService appService,
        IActiveBrmbleSessions activeSessions)
    {
        _channelRepository = channelRepository;
        _appService = appService;
        _activeSessions = activeSessions;
    }
}
```

Also update `MatrixServiceTests.cs` — change its constructor test to use `Mock<IMatrixAppService>`:

```csharp
[TestMethod]
public void Constructor_WithValidDependencies_DoesNotThrow()
{
    var db = new Database("Data Source=:memory:");
    var channelRepo = new ChannelRepository(db);
    var appService = new Mock<IMatrixAppService>().Object;
    var sessions = new Mock<IActiveBrmbleSessions>().Object;
    var svc = new MatrixService(channelRepo, appService, sessions);
    Assert.IsNotNull(svc);
}
```

### Step 6: Run all tests to verify they pass

```bash
dotnet test tests/Brmble.Server.Tests/
```

Expected: all existing + new MatrixAppService tests pass.

### Step 7: Commit

```bash
git add src/Brmble.Server/Matrix/MatrixAppService.cs \
        src/Brmble.Server/Matrix/MatrixExtensions.cs \
        src/Brmble.Server/Matrix/MatrixService.cs \
        tests/Brmble.Server.Tests/Matrix/MatrixAppServiceTests.cs \
        tests/Brmble.Server.Tests/Matrix/MatrixServiceTests.cs
git commit -m "feat: implement MatrixAppService HTTP methods, extract IMatrixAppService"
```

---

## Task 3: MatrixService.RelayMessage

**Files:**
- Modify: `src/Brmble.Server/Matrix/MatrixService.cs`
- Modify: `tests/Brmble.Server.Tests/Matrix/MatrixServiceTests.cs`

### Step 1: Write failing tests

Replace the TODO comment block in `MatrixServiceTests.cs` (keep constructor test):

```csharp
using Brmble.Server.Auth;
using Brmble.Server.Data;
using Brmble.Server.Matrix;
using Brmble.Server.Mumble;
using Microsoft.Data.Sqlite;
using Moq;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Matrix;

[TestClass]
public class MatrixServiceTests
{
    private SqliteConnection? _keepAlive;
    private ChannelRepository _channelRepo = null!;
    private Mock<IMatrixAppService> _appService = null!;
    private Mock<IActiveBrmbleSessions> _sessions = null!;
    private MatrixService _svc = null!;

    [TestInitialize]
    public void Setup()
    {
        var dbName = "testdb_" + Guid.NewGuid().ToString("N");
        var cs = $"Data Source={dbName};Mode=Memory;Cache=Shared";
        _keepAlive = new SqliteConnection(cs);
        _keepAlive.Open();
        var db = new Database(cs);
        db.Initialize();
        _channelRepo = new ChannelRepository(db);

        _appService = new Mock<IMatrixAppService>();
        _sessions = new Mock<IActiveBrmbleSessions>();
        _svc = new MatrixService(_channelRepo, _appService.Object, _sessions.Object);
    }

    [TestCleanup]
    public void Cleanup() => _keepAlive?.Dispose();

    [TestMethod]
    public async Task RelayMessage_BrmbleClient_SkipsRelay()
    {
        _sessions.Setup(s => s.IsBrmbleClient("brmble-hash")).Returns(true);

        await _svc.RelayMessage(new MumbleUser("Alice", "brmble-hash", 1), "hello", 42);

        _appService.Verify(
            a => a.SendMessage(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>()),
            Times.Never);
    }

    [TestMethod]
    public async Task RelayMessage_UnmappedChannel_SkipsRelay()
    {
        _sessions.Setup(s => s.IsBrmbleClient(It.IsAny<string>())).Returns(false);
        // channel 99 not in DB

        await _svc.RelayMessage(new MumbleUser("Alice", "abc", 1), "hello", 99);

        _appService.Verify(
            a => a.SendMessage(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>()),
            Times.Never);
    }

    [TestMethod]
    public async Task RelayMessage_MappedChannel_PostsMessage()
    {
        _sessions.Setup(s => s.IsBrmbleClient("og-hash")).Returns(false);
        _channelRepo.Insert(42, "!room:server");

        await _svc.RelayMessage(new MumbleUser("Bob", "og-hash", 2), "hello", 42);

        _appService.Verify(a => a.SendMessage("!room:server", "Bob", "hello"), Times.Once);
    }

    [TestMethod]
    public async Task RelayMessage_HtmlInText_StripsTagsBeforePosting()
    {
        _sessions.Setup(s => s.IsBrmbleClient("og-hash")).Returns(false);
        _channelRepo.Insert(1, "!room:server");

        await _svc.RelayMessage(
            new MumbleUser("Bob", "og-hash", 1),
            "<b>bold</b> and <i>italic</i>",
            1);

        _appService.Verify(
            a => a.SendMessage("!room:server", "Bob", "bold and italic"),
            Times.Once);
    }

    [TestMethod]
    public async Task RelayMessage_HtmlEntitiesInText_DecodesEntities()
    {
        _sessions.Setup(s => s.IsBrmbleClient("og-hash")).Returns(false);
        _channelRepo.Insert(1, "!room:server");

        await _svc.RelayMessage(
            new MumbleUser("Bob", "og-hash", 1),
            "hello &amp; world",
            1);

        _appService.Verify(
            a => a.SendMessage("!room:server", "Bob", "hello & world"),
            Times.Once);
    }
}
```

### Step 2: Run tests to verify they fail

```bash
dotnet test tests/Brmble.Server.Tests/ --filter "MatrixServiceTests"
```

Expected: `FAIL` — `RelayMessage` not implemented.

### Step 3: Implement RelayMessage

Add to `src/Brmble.Server/Matrix/MatrixService.cs`:

```csharp
using System.Text.RegularExpressions;
using System.Web;
using Brmble.Server.Auth;
using Brmble.Server.Mumble;

namespace Brmble.Server.Matrix;

public class MatrixService
{
    private readonly ChannelRepository _channelRepository;
    private readonly IMatrixAppService _appService;
    private readonly IActiveBrmbleSessions _activeSessions;

    public MatrixService(
        ChannelRepository channelRepository,
        IMatrixAppService appService,
        IActiveBrmbleSessions activeSessions)
    {
        _channelRepository = channelRepository;
        _appService = appService;
        _activeSessions = activeSessions;
    }

    public async Task RelayMessage(MumbleUser sender, string text, int channelId)
    {
        if (_activeSessions.IsBrmbleClient(sender.CertHash))
            return;

        var roomId = _channelRepository.GetRoomId(channelId);
        if (roomId is null)
            return;

        var plainText = StripHtml(text);
        await _appService.SendMessage(roomId, sender.Name, plainText);
    }

    private static string StripHtml(string html)
    {
        var stripped = Regex.Replace(html, "<.*?>", string.Empty, RegexOptions.Singleline);
        return HttpUtility.HtmlDecode(stripped).Trim();
    }
}
```

### Step 4: Run tests to verify they pass

```bash
dotnet test tests/Brmble.Server.Tests/ --filter "MatrixServiceTests"
```

Expected: all 6 tests pass.

### Step 5: Commit

```bash
git add src/Brmble.Server/Matrix/MatrixService.cs \
        tests/Brmble.Server.Tests/Matrix/MatrixServiceTests.cs
git commit -m "feat: implement MatrixService.RelayMessage with HTML stripping"
```

---

## Task 4: MatrixService.EnsureChannelRoom

**Files:**
- Modify: `src/Brmble.Server/Matrix/MatrixService.cs`
- Modify: `tests/Brmble.Server.Tests/Matrix/MatrixServiceTests.cs`

### Step 1: Write failing tests

Add to `MatrixServiceTests.cs`:

```csharp
[TestMethod]
public async Task EnsureChannelRoom_NewChannel_CreatesRoomAndStoresMapping()
{
    _appService.Setup(a => a.CreateRoom("General"))
        .ReturnsAsync("!newroom:server");

    await _svc.EnsureChannelRoom(new MumbleChannel(10, "General"));

    _appService.Verify(a => a.CreateRoom("General"), Times.Once);
    Assert.AreEqual("!newroom:server", _channelRepo.GetRoomId(10));
}

[TestMethod]
public async Task EnsureChannelRoom_ExistingChannel_DoesNotCreateRoom()
{
    _channelRepo.Insert(10, "!existing:server");

    await _svc.EnsureChannelRoom(new MumbleChannel(10, "General"));

    _appService.Verify(a => a.CreateRoom(It.IsAny<string>()), Times.Never);
}
```

### Step 2: Run tests to verify they fail

```bash
dotnet test tests/Brmble.Server.Tests/ --filter "EnsureChannelRoom"
```

Expected: `FAIL` — method not implemented.

### Step 3: Implement EnsureChannelRoom

Add to `MatrixService`:

```csharp
public async Task EnsureChannelRoom(MumbleChannel channel)
{
    if (_channelRepository.GetRoomId(channel.Id) is not null)
        return;

    var roomId = await _appService.CreateRoom(channel.Name);
    _channelRepository.Insert(channel.Id, roomId);
}
```

### Step 4: Run tests to verify they pass

```bash
dotnet test tests/Brmble.Server.Tests/ --filter "MatrixServiceTests"
```

Expected: all 8 tests pass.

### Step 5: Commit

```bash
git add src/Brmble.Server/Matrix/MatrixService.cs \
        tests/Brmble.Server.Tests/Matrix/MatrixServiceTests.cs
git commit -m "feat: implement MatrixService.EnsureChannelRoom"
```

---

## Task 5: MatrixEventHandler — wire all events

**Files:**
- Modify: `src/Brmble.Server/Matrix/MatrixEventHandler.cs`
- Create: `tests/Brmble.Server.Tests/Matrix/MatrixEventHandlerTests.cs`

### Step 1: Write failing tests

Create `tests/Brmble.Server.Tests/Matrix/MatrixEventHandlerTests.cs`:

```csharp
using Brmble.Server.Matrix;
using Brmble.Server.Mumble;
using Moq;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Matrix;

[TestClass]
public class MatrixEventHandlerTests
{
    private Mock<MatrixService> _matrixService = null!;
    private MatrixEventHandler _handler = null!;

    // MatrixService needs to be mockable — its relay methods will be tested via MatrixServiceTests.
    // Here we verify that the event handler wires the right method for each event.

    [TestMethod]
    public async Task OnUserTextMessage_CallsRelayMessage()
    {
        var appService = new Mock<IMatrixAppService>();
        appService.Setup(a => a.SendMessage(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>()))
            .Returns(Task.CompletedTask);

        // Use real MatrixService with in-memory DB so we can verify RelayMessage is called end-to-end.
        // (MatrixService is not an interface; test via observable side effect — SendMessage call.)
        var db = new Brmble.Server.Data.Database("Data Source=:memory:");
        db.Initialize();
        var channelRepo = new ChannelRepository(db);
        channelRepo.Insert(1, "!room:server");

        var sessions = new Mock<Brmble.Server.Auth.IActiveBrmbleSessions>();
        sessions.Setup(s => s.IsBrmbleClient("og")).Returns(false);

        var svc = new MatrixService(channelRepo, appService.Object, sessions.Object);
        _handler = new MatrixEventHandler(svc);

        await _handler.OnUserTextMessage(new MumbleUser("Bob", "og", 1), "hi", 1);

        appService.Verify(a => a.SendMessage("!room:server", "Bob", "hi"), Times.Once);
    }

    [TestMethod]
    public async Task OnChannelCreated_CallsEnsureChannelRoom()
    {
        var appService = new Mock<IMatrixAppService>();
        appService.Setup(a => a.CreateRoom("Test")).ReturnsAsync("!newroom:server");

        var db = new Brmble.Server.Data.Database("Data Source=:memory:");
        db.Initialize();
        var channelRepo = new ChannelRepository(db);
        var sessions = new Mock<Brmble.Server.Auth.IActiveBrmbleSessions>();
        var svc = new MatrixService(channelRepo, appService.Object, sessions.Object);
        _handler = new MatrixEventHandler(svc);

        await _handler.OnChannelCreated(new MumbleChannel(99, "Test"));

        appService.Verify(a => a.CreateRoom("Test"), Times.Once);
    }

    [TestMethod]
    public async Task OnChannelRemoved_DeletesMapping()
    {
        var appService = new Mock<IMatrixAppService>();
        var db = new Brmble.Server.Data.Database("Data Source=:memory:");
        db.Initialize();
        var channelRepo = new ChannelRepository(db);
        channelRepo.Insert(5, "!room:server");
        var sessions = new Mock<Brmble.Server.Auth.IActiveBrmbleSessions>();
        var svc = new MatrixService(channelRepo, appService.Object, sessions.Object);
        _handler = new MatrixEventHandler(svc);

        await _handler.OnChannelRemoved(new MumbleChannel(5, "OldChannel"));

        Assert.IsNull(channelRepo.GetRoomId(5));
    }

    [TestMethod]
    public async Task OnChannelRenamed_CallsSetRoomName()
    {
        var appService = new Mock<IMatrixAppService>();
        appService.Setup(a => a.SetRoomName(It.IsAny<string>(), It.IsAny<string>()))
            .Returns(Task.CompletedTask);

        var db = new Brmble.Server.Data.Database("Data Source=:memory:");
        db.Initialize();
        var channelRepo = new ChannelRepository(db);
        channelRepo.Insert(3, "!room:server");
        var sessions = new Mock<Brmble.Server.Auth.IActiveBrmbleSessions>();
        var svc = new MatrixService(channelRepo, appService.Object, sessions.Object);
        _handler = new MatrixEventHandler(svc);

        await _handler.OnChannelRenamed(new MumbleChannel(3, "NewName"));

        appService.Verify(a => a.SetRoomName("!room:server", "NewName"), Times.Once);
    }

    [TestMethod]
    public async Task OnUserConnected_DoesNotThrow()
    {
        var svc = new MatrixService(
            new ChannelRepository(new Brmble.Server.Data.Database("Data Source=:memory:")),
            new Mock<IMatrixAppService>().Object,
            new Mock<Brmble.Server.Auth.IActiveBrmbleSessions>().Object);
        _handler = new MatrixEventHandler(svc);

        await _handler.OnUserConnected(new MumbleUser("Alice", "abc", 1));
    }

    [TestMethod]
    public async Task OnUserDisconnected_DoesNotThrow()
    {
        var svc = new MatrixService(
            new ChannelRepository(new Brmble.Server.Data.Database("Data Source=:memory:")),
            new Mock<IMatrixAppService>().Object,
            new Mock<Brmble.Server.Auth.IActiveBrmbleSessions>().Object);
        _handler = new MatrixEventHandler(svc);

        await _handler.OnUserDisconnected(new MumbleUser("Alice", "abc", 1));
    }
}
```

### Step 2: Run tests to verify they fail

```bash
dotnet test tests/Brmble.Server.Tests/ --filter "MatrixEventHandlerTests"
```

Expected: several `FAIL` — methods return `Task.CompletedTask` instead of delegating.

### Step 3: Implement MatrixEventHandler

Replace `src/Brmble.Server/Matrix/MatrixEventHandler.cs`:

```csharp
using Brmble.Server.Mumble;

namespace Brmble.Server.Matrix;

public class MatrixEventHandler : IMumbleEventHandler
{
    private readonly MatrixService _matrixService;

    public MatrixEventHandler(MatrixService matrixService)
    {
        _matrixService = matrixService;
    }

    public Task OnUserConnected(MumbleUser user) => Task.CompletedTask;

    public Task OnUserDisconnected(MumbleUser user) => Task.CompletedTask;

    public Task OnUserTextMessage(MumbleUser sender, string text, int channelId)
        => _matrixService.RelayMessage(sender, text, channelId);

    public Task OnChannelCreated(MumbleChannel channel)
        => _matrixService.EnsureChannelRoom(channel);

    public Task OnChannelRemoved(MumbleChannel channel)
    {
        _matrixService.DeleteChannelRoom(channel.Id);
        return Task.CompletedTask;
    }

    public Task OnChannelRenamed(MumbleChannel channel)
        => _matrixService.RenameChannelRoom(channel);
}
```

### Step 4: Add DeleteChannelRoom and RenameChannelRoom to MatrixService

Add to `MatrixService.cs`:

```csharp
public void DeleteChannelRoom(int channelId)
{
    _channelRepository.Delete(channelId);
}

public async Task RenameChannelRoom(MumbleChannel channel)
{
    var roomId = _channelRepository.GetRoomId(channel.Id);
    if (roomId is null)
        return;
    await _appService.SetRoomName(roomId, channel.Name);
}
```

### Step 5: Run all tests to verify they pass

```bash
dotnet test tests/Brmble.Server.Tests/
```

Expected: all tests pass.

### Step 6: Commit

```bash
git add src/Brmble.Server/Matrix/MatrixEventHandler.cs \
        src/Brmble.Server/Matrix/MatrixService.cs \
        tests/Brmble.Server.Tests/Matrix/MatrixEventHandlerTests.cs
git commit -m "feat: implement MatrixEventHandler, add channel room lifecycle to MatrixService"
```

---

## Task 6: MumbleServerCallback — dispatch methods

**Files:**
- Modify: `src/Brmble.Server/Mumble/MumbleServerCallback.cs`
- Create: `tests/Brmble.Server.Tests/Mumble/MumbleServerCallbackTests.cs`

Note: this task adds pure C# dispatch methods with no Ice dependency yet — these are testable today. Ice-specific wiring comes in Task 8.

### Step 1: Write failing tests

Create `tests/Brmble.Server.Tests/Mumble/MumbleServerCallbackTests.cs`:

```csharp
using Brmble.Server.Mumble;
using Moq;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Mumble;

[TestClass]
public class MumbleServerCallbackTests
{
    [TestMethod]
    public async Task DispatchTextMessage_CallsAllHandlers()
    {
        var h1 = new Mock<IMumbleEventHandler>();
        var h2 = new Mock<IMumbleEventHandler>();
        var callback = new MumbleServerCallback([h1.Object, h2.Object]);
        var user = new MumbleUser("Alice", "abc", 1);

        await callback.DispatchTextMessage(user, "hello", 42);

        h1.Verify(h => h.OnUserTextMessage(user, "hello", 42), Times.Once);
        h2.Verify(h => h.OnUserTextMessage(user, "hello", 42), Times.Once);
    }

    [TestMethod]
    public async Task DispatchUserConnected_CallsAllHandlers()
    {
        var h1 = new Mock<IMumbleEventHandler>();
        var callback = new MumbleServerCallback([h1.Object]);
        var user = new MumbleUser("Bob", "xyz", 2);

        await callback.DispatchUserConnected(user);

        h1.Verify(h => h.OnUserConnected(user), Times.Once);
    }

    [TestMethod]
    public async Task DispatchUserDisconnected_CallsAllHandlers()
    {
        var h1 = new Mock<IMumbleEventHandler>();
        var callback = new MumbleServerCallback([h1.Object]);
        var user = new MumbleUser("Bob", "xyz", 2);

        await callback.DispatchUserDisconnected(user);

        h1.Verify(h => h.OnUserDisconnected(user), Times.Once);
    }

    [TestMethod]
    public async Task DispatchChannelCreated_CallsAllHandlers()
    {
        var h1 = new Mock<IMumbleEventHandler>();
        var callback = new MumbleServerCallback([h1.Object]);
        var channel = new MumbleChannel(10, "General");

        await callback.DispatchChannelCreated(channel);

        h1.Verify(h => h.OnChannelCreated(channel), Times.Once);
    }

    [TestMethod]
    public async Task DispatchChannelRemoved_CallsAllHandlers()
    {
        var h1 = new Mock<IMumbleEventHandler>();
        var callback = new MumbleServerCallback([h1.Object]);
        var channel = new MumbleChannel(10, "General");

        await callback.DispatchChannelRemoved(channel);

        h1.Verify(h => h.OnChannelRemoved(channel), Times.Once);
    }

    [TestMethod]
    public async Task DispatchChannelRenamed_CallsAllHandlers()
    {
        var h1 = new Mock<IMumbleEventHandler>();
        var callback = new MumbleServerCallback([h1.Object]);
        var channel = new MumbleChannel(10, "Renamed");

        await callback.DispatchChannelRenamed(channel);

        h1.Verify(h => h.OnChannelRenamed(channel), Times.Once);
    }

    [TestMethod]
    public async Task DispatchTextMessage_NoHandlers_DoesNotThrow()
    {
        var callback = new MumbleServerCallback([]);
        await callback.DispatchTextMessage(new MumbleUser("X", "x", 1), "hi", 1);
    }
}
```

### Step 2: Run tests to verify they fail

```bash
dotnet test tests/Brmble.Server.Tests/ --filter "MumbleServerCallbackTests"
```

Expected: `FAIL` — dispatch methods not implemented.

### Step 3: Implement MumbleServerCallback dispatch methods

Replace `src/Brmble.Server/Mumble/MumbleServerCallback.cs`:

```csharp
namespace Brmble.Server.Mumble;

public class MumbleServerCallback
{
    private readonly IEnumerable<IMumbleEventHandler> _handlers;

    public MumbleServerCallback(IEnumerable<IMumbleEventHandler> handlers)
    {
        _handlers = handlers;
    }

    public Task DispatchTextMessage(MumbleUser sender, string text, int channelId)
        => Task.WhenAll(_handlers.Select(h => h.OnUserTextMessage(sender, text, channelId)));

    public Task DispatchUserConnected(MumbleUser user)
        => Task.WhenAll(_handlers.Select(h => h.OnUserConnected(user)));

    public Task DispatchUserDisconnected(MumbleUser user)
        => Task.WhenAll(_handlers.Select(h => h.OnUserDisconnected(user)));

    public Task DispatchChannelCreated(MumbleChannel channel)
        => Task.WhenAll(_handlers.Select(h => h.OnChannelCreated(channel)));

    public Task DispatchChannelRemoved(MumbleChannel channel)
        => Task.WhenAll(_handlers.Select(h => h.OnChannelRemoved(channel)));

    public Task DispatchChannelRenamed(MumbleChannel channel)
        => Task.WhenAll(_handlers.Select(h => h.OnChannelRenamed(channel)));
}
```

### Step 4: Run all tests to verify they pass

```bash
dotnet test tests/Brmble.Server.Tests/
```

Expected: all tests pass.

### Step 5: Commit

```bash
git add src/Brmble.Server/Mumble/MumbleServerCallback.cs \
        tests/Brmble.Server.Tests/Mumble/MumbleServerCallbackTests.cs
git commit -m "feat: implement MumbleServerCallback dispatch methods"
```

---

## Task 7: Add ZeroC Ice + Slice stubs

**Files:**
- Modify: `src/Brmble.Server/Brmble.Server.csproj`
- Create: `src/Brmble.Server/Mumble/Slice/MumbleServer.ice` (Slice source, for reference)
- Create: `src/Brmble.Server/Mumble/Slice/MumbleServer.cs` (pre-generated C# stubs)

### Step 1: Add ZeroC Ice NuGet package

```bash
dotnet add src/Brmble.Server/Brmble.Server.csproj package zeroc.ice --version 3.7.10
```

### Step 2: Obtain MumbleServer.ice

Download from the Mumble source repository. The Slice file defines the Mumble server RPC interface. Save to `src/Brmble.Server/Mumble/Slice/MumbleServer.ice`.

Source: https://github.com/mumble-voip/mumble/blob/master/src/murmur/MumbleServer.ice

### Step 3: Generate C# stubs

Run `slice2cs` (included in the zeroc.ice package tools) to generate C# from the Slice:

```bash
# Find slice2cs in the NuGet cache (path varies by OS):
# Windows: %USERPROFILE%\.nuget\packages\zeroc.ice\3.7.10\tools\slice2cs.exe
slice2cs --output-dir src/Brmble.Server/Mumble/Slice \
         src/Brmble.Server/Mumble/Slice/MumbleServer.ice
```

This generates `MumbleServer.cs` in the same directory. Commit this generated file to the repo so the build does not require `slice2cs` at build time.

### Step 4: Build to verify no errors

```bash
dotnet build src/Brmble.Server/Brmble.Server.csproj
```

Expected: builds successfully with the new Ice package and Slice stubs.

### Step 5: Run all tests to verify nothing broke

```bash
dotnet test tests/Brmble.Server.Tests/
```

Expected: all tests pass.

### Step 6: Commit

```bash
git add src/Brmble.Server/Brmble.Server.csproj \
        src/Brmble.Server/Mumble/Slice/
git commit -m "chore: add zeroc.ice NuGet package and MumbleServer Slice stubs"
```

---

## Task 8: MumbleServerCallback — Ice integration

**Files:**
- Modify: `src/Brmble.Server/Mumble/MumbleServerCallback.cs`

The `MumbleServerCallback` now extends `MumbleServer.ServerCallbackDisp_` (from the Slice stubs). Each Ice override method extracts the relevant data and delegates to the dispatch methods added in Task 6.

### Step 1: Update MumbleServerCallback to extend Ice base class

Replace `src/Brmble.Server/Mumble/MumbleServerCallback.cs`:

```csharp
namespace Brmble.Server.Mumble;

public class MumbleServerCallback : MumbleServer.ServerCallbackDisp_
{
    private readonly IEnumerable<IMumbleEventHandler> _handlers;

    public MumbleServerCallback(IEnumerable<IMumbleEventHandler> handlers)
    {
        _handlers = handlers;
    }

    // Ice overrides — called by ZeroC Ice runtime on Mumble server events.
    // Dispatch via Task.Run to avoid blocking the Ice callback thread.

    public override void userTextMessage(
        MumbleServer.User state,
        MumbleServer.TextMessage message,
        Ice.Current current)
    {
        var user = ToMumbleUser(state);
        var channelId = message.channels.FirstOrDefault();
        Task.Run(() => DispatchTextMessage(user, message.text, channelId));
    }

    public override void userConnected(MumbleServer.User state, Ice.Current current)
    {
        Task.Run(() => DispatchUserConnected(ToMumbleUser(state)));
    }

    public override void userDisconnected(MumbleServer.User state, Ice.Current current)
    {
        Task.Run(() => DispatchUserDisconnected(ToMumbleUser(state)));
    }

    public override void channelCreated(MumbleServer.Channel channel, Ice.Current current)
    {
        Task.Run(() => DispatchChannelCreated(ToMumbleChannel(channel)));
    }

    public override void channelRemoved(MumbleServer.Channel channel, Ice.Current current)
    {
        Task.Run(() => DispatchChannelRemoved(ToMumbleChannel(channel)));
    }

    public override void channelStateChanged(MumbleServer.Channel channel, Ice.Current current)
    {
        Task.Run(() => DispatchChannelRenamed(ToMumbleChannel(channel)));
    }

    // Dispatch methods (tested in Task 6)

    public Task DispatchTextMessage(MumbleUser sender, string text, int channelId)
        => Task.WhenAll(_handlers.Select(h => h.OnUserTextMessage(sender, text, channelId)));

    public Task DispatchUserConnected(MumbleUser user)
        => Task.WhenAll(_handlers.Select(h => h.OnUserConnected(user)));

    public Task DispatchUserDisconnected(MumbleUser user)
        => Task.WhenAll(_handlers.Select(h => h.OnUserDisconnected(user)));

    public Task DispatchChannelCreated(MumbleChannel channel)
        => Task.WhenAll(_handlers.Select(h => h.OnChannelCreated(channel)));

    public Task DispatchChannelRemoved(MumbleChannel channel)
        => Task.WhenAll(_handlers.Select(h => h.OnChannelRemoved(channel)));

    public Task DispatchChannelRenamed(MumbleChannel channel)
        => Task.WhenAll(_handlers.Select(h => h.OnChannelRenamed(channel)));

    // Unused Ice callbacks — empty implementations required by the base class

    public override void userStateChanged(MumbleServer.User state, Ice.Current current) { }
    public override void userKicked(MumbleServer.User kicked, MumbleServer.User kicker, string reason, Ice.Current current) { }
    public override void userBanned(MumbleServer.User banned, MumbleServer.User banner, string reason, Ice.Current current) { }

    // Mappers

    private static MumbleUser ToMumbleUser(MumbleServer.User state) =>
        new(state.name, state.hash, state.session);

    private static MumbleChannel ToMumbleChannel(MumbleServer.Channel channel) =>
        new(channel.id, channel.name);
}
```

Note: the exact members of `MumbleServer.User` and `MumbleServer.Channel` depend on the Slice definition. Adjust field names (`name`, `hash`, `session`, `id`) to match the generated stubs if they differ.

### Step 2: Build to verify it compiles

```bash
dotnet build src/Brmble.Server/Brmble.Server.csproj
```

### Step 3: Run all tests to verify they still pass

The `MumbleServerCallbackTests` from Task 6 still instantiate `MumbleServerCallback` directly and test the dispatch methods — these remain valid.

```bash
dotnet test tests/Brmble.Server.Tests/
```

Expected: all tests pass.

### Step 4: Commit

```bash
git add src/Brmble.Server/Mumble/MumbleServerCallback.cs
git commit -m "feat: extend MumbleServerCallback with ZeroC Ice callbacks"
```

---

## Task 9: MumbleIceService — Ice lifecycle

**Files:**
- Modify: `src/Brmble.Server/Mumble/MumbleIceService.cs`
- Modify: `src/Brmble.Server/Mumble/MumbleExtensions.cs`
- Modify: `tests/Brmble.Server.Tests/Mumble/MumbleIceServiceTests.cs`

### Step 1: Update MumbleIceService constructor to accept new dependencies

`MumbleIceService` needs `IConfiguration` for Ice host/port/secret and `MatrixService` for startup channel sync.

Update `MumbleExtensions.cs` — no registration changes needed since `IConfiguration` and `MatrixService` are already registered in DI:

```csharp
namespace Brmble.Server.Mumble;

public static class MumbleExtensions
{
    public static IServiceCollection AddMumble(this IServiceCollection services)
    {
        services.AddSingleton<MumbleServerCallback>();
        services.AddHostedService<MumbleIceService>();
        return services;
    }
}
```

(No changes needed — DI resolves `IConfiguration`, `MatrixService`, and `ILogger` automatically.)

### Step 2: Update existing MumbleIceService tests

The tests need config injected. Update `MumbleIceServiceTests.cs`:

```csharp
using Brmble.Server.Auth;
using Brmble.Server.Data;
using Brmble.Server.Matrix;
using Brmble.Server.Mumble;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Mumble;

[TestClass]
public class MumbleIceServiceTests
{
    private static MumbleIceService CreateService(string host = "localhost", int port = 9999)
    {
        var callback = new MumbleServerCallback(Enumerable.Empty<IMumbleEventHandler>());

        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Ice:Host"] = host,
                ["Ice:Port"] = port.ToString(),
                ["Ice:Secret"] = "test-secret",
                ["Ice:ConnectTimeoutMs"] = "200"
            })
            .Build();

        var db = new Database("Data Source=:memory:");
        db.Initialize();
        var channelRepo = new ChannelRepository(db);
        var appService = new Mock<IMatrixAppService>().Object;
        var sessions = new Mock<IActiveBrmbleSessions>().Object;
        var matrixService = new MatrixService(channelRepo, appService, sessions);

        return new MumbleIceService(
            callback,
            matrixService,
            config,
            NullLogger<MumbleIceService>.Instance);
    }

    [TestMethod]
    public async Task StartAsync_IceUnavailable_CompletesWithoutThrowing()
    {
        // Port 9999 on localhost — nothing listening, Ice connection will fail.
        // Per spec: if Ice fails at startup, log warning and continue.
        var svc = CreateService();
        await svc.StartAsync(CancellationToken.None);
    }

    [TestMethod]
    public async Task StopAsync_CompletesWithoutThrowing()
    {
        var svc = CreateService();
        await svc.StopAsync(CancellationToken.None);
    }

    [TestMethod]
    public async Task StartThenStop_CompletesWithoutThrowing()
    {
        var svc = CreateService();
        await svc.StartAsync(CancellationToken.None);
        await svc.StopAsync(CancellationToken.None);
    }
}
```

### Step 3: Run tests to verify they fail

```bash
dotnet test tests/Brmble.Server.Tests/ --filter "MumbleIceServiceTests"
```

Expected: compile error — `MumbleIceService` constructor doesn't accept the new parameters yet.

### Step 4: Implement MumbleIceService

Replace `src/Brmble.Server/Mumble/MumbleIceService.cs`:

```csharp
using Brmble.Server.Matrix;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace Brmble.Server.Mumble;

public class MumbleIceService : IHostedService
{
    private readonly MumbleServerCallback _callback;
    private readonly MatrixService _matrixService;
    private readonly string _host;
    private readonly int _port;
    private readonly string _secret;
    private readonly int _connectTimeoutMs;
    private readonly ILogger<MumbleIceService> _logger;
    private Ice.Communicator? _communicator;

    public MumbleIceService(
        MumbleServerCallback callback,
        MatrixService matrixService,
        IConfiguration configuration,
        ILogger<MumbleIceService> logger)
    {
        _callback = callback;
        _matrixService = matrixService;
        _host = configuration["Ice:Host"] ?? "mumble-server";
        _port = int.Parse(configuration["Ice:Port"] ?? "6502");
        _secret = configuration["Ice:Secret"] ?? string.Empty;
        _connectTimeoutMs = int.Parse(configuration["Ice:ConnectTimeoutMs"] ?? "3000");
        _logger = logger;
    }

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        try
        {
            var properties = Ice.Util.createProperties();
            properties.setProperty("Ice.Default.EncodingVersion", "1.0");
            properties.setProperty("Ice.Connection.ConnectTimeout", _connectTimeoutMs.ToString());

            var initData = new Ice.InitializationData { properties = properties };
            _communicator = Ice.Util.initialize(initData);

            var context = new Dictionary<string, string> { ["secret"] = _secret };
            var serverProxy = MumbleServer.ServerPrxHelper.checkedCast(
                _communicator.stringToProxy($"s/1 -e 1.0:tcp -h {_host} -p {_port}")
                    .ice_context(context));

            // Startup channel sync — ensure all existing channels have Matrix rooms
            var channels = serverProxy.getChannels(false);
            foreach (var (_, ch) in channels)
                await _matrixService.EnsureChannelRoom(new MumbleChannel(ch.id, ch.name));

            // Register callback adapter so Mumble can call back into us
            var adapter = _communicator.createObjectAdapterWithEndpoints(
                "MumbleCallback", "tcp -h 127.0.0.1");
            var callbackPrx = MumbleServer.ServerCallbackPrxHelper.uncheckedCast(
                adapter.addWithUUID(_callback));
            adapter.activate();
            serverProxy.addCallback(callbackPrx);

            _logger.LogInformation("Connected to Mumble server at {Host}:{Port}", _host, _port);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex,
                "Failed to connect to Mumble server at {Host}:{Port} — " +
                "OG client message persistence is unavailable; Brmble chat is unaffected",
                _host, _port);
        }
    }

    public Task StopAsync(CancellationToken cancellationToken)
    {
        try
        {
            _communicator?.destroy();
            _communicator = null;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Error shutting down Ice communicator");
        }
        return Task.CompletedTask;
    }
}
```

### Step 5: Run all tests to verify they pass

```bash
dotnet test tests/Brmble.Server.Tests/
```

Expected: all tests pass. `StartAsync_IceUnavailable_CompletesWithoutThrowing` passes because the catch block handles the Ice connection failure gracefully.

### Step 6: Run a full build to confirm no warnings

```bash
dotnet build
```

### Step 7: Commit

```bash
git add src/Brmble.Server/Mumble/MumbleIceService.cs \
        tests/Brmble.Server.Tests/Mumble/MumbleIceServiceTests.cs
git commit -m "feat: implement MumbleIceService — Ice lifecycle, startup channel sync, callback registration"
```

---

## Final Verification

```bash
dotnet test tests/Brmble.Server.Tests/
dotnet build
```

Both should complete cleanly. The full pipeline is now wired:

```
OG Mumble Client
  → Mumble Server (Ice event)
    → MumbleServerCallback (Ice override → dispatch method)
      → MatrixEventHandler (IMumbleEventHandler)
        → MatrixService (dedup check, room lookup)
          → MatrixAppService (HTTP PUT to Continuwuity)
```
