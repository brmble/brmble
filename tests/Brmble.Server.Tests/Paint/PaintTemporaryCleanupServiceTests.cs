using Brmble.Server.Data;
using Brmble.Server.Paint;
using Microsoft.Extensions.Logging;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Paint;

[TestClass]
public sealed class PaintTemporaryCleanupServiceTests
{
    [TestMethod]
    public async Task Sweep_LeavesDirectoryOwnedByOpenSession()
    {
        var fixture = CreateFixture();
        await fixture.Store.WriteAsync(fixture.SessionId, new byte[] { 1 }, CancellationToken.None);
        fixture.Lifetime.Retained.Add(fixture.SessionId);

        await fixture.Service.ProcessPendingAsync(CancellationToken.None);

        CollectionAssert.Contains((await fixture.Store.ListSessionIdsAsync(CancellationToken.None)).ToArray(), fixture.SessionId);
        Assert.AreEqual(0, fixture.Store.DeleteCalls);
    }

    [TestMethod]
    public async Task Sweep_DeletesDirectoryWhenNoInMemorySessionOwnsIt()
    {
        var fixture = CreateFixture();
        await fixture.Store.WriteAsync(fixture.SessionId, new byte[] { 1 }, CancellationToken.None);

        await fixture.Service.ProcessPendingAsync(CancellationToken.None);

        CollectionAssert.DoesNotContain((await fixture.Store.ListSessionIdsAsync(CancellationToken.None)).ToArray(), fixture.SessionId);
        Assert.AreEqual(0, (await fixture.Repository.GetDueAsync(CancellationToken.None)).Count);
    }

    [TestMethod]
    public async Task Sweep_DoesNotRunOverlappingDeletes()
    {
        var fixture = CreateFixture(new BlockingFakePaintTemporarySourceStore());
        await fixture.Store.WriteAsync(fixture.SessionId, new byte[] { 1 }, CancellationToken.None);
        var blockingStore = (BlockingFakePaintTemporarySourceStore)fixture.Store;

        var firstSweep = fixture.Service.ProcessPendingAsync(CancellationToken.None);
        await blockingStore.DeleteStarted.Task;

        await fixture.Service.ProcessPendingAsync(CancellationToken.None);

        Assert.AreEqual(1, blockingStore.DeleteStartCalls);
        blockingStore.AllowDelete.TrySetResult();
        await firstSweep;
    }

    [TestMethod]
    public async Task Sweep_RecordsRetryableFailureAndLogsSafeContext()
    {
        var fixture = CreateFixture();
        await fixture.Store.WriteAsync(fixture.SessionId, new byte[] { 1 }, CancellationToken.None);
        fixture.Store.DeleteExceptionFactory = _ => new IOException("disk unavailable secret");

        await fixture.Service.ProcessPendingAsync(CancellationToken.None);

        var due = await fixture.Repository.GetDueAsync(CancellationToken.None);
        Assert.AreEqual(0, due.Count);
        var stored = fixture.Repository.GetStored(fixture.SessionId);
        Assert.IsNotNull(stored);
        Assert.AreEqual("failed", stored.Status);
        Assert.AreEqual(1, stored.Attempts);
        Assert.AreEqual(nameof(IOException), stored.LastError);
        Assert.IsTrue(stored.NextAttemptAt > DateTimeOffset.UtcNow);

        var entry = fixture.Logger.Entries.Single();
        Assert.AreEqual(LogLevel.Warning, entry.Level);
        Assert.AreEqual(fixture.SessionId, entry.Properties["SessionId"]);
        Assert.AreEqual(1, entry.Properties["Attempt"]);
        Assert.AreEqual(nameof(IOException), entry.Properties["FailureType"]);
        Assert.IsFalse(entry.Message.Contains("secret", StringComparison.Ordinal));
        Assert.IsFalse(entry.Properties.Values.OfType<string>().Any(value => value.Contains("secret", StringComparison.Ordinal)));
    }

    [TestMethod]
    public async Task Sweep_MarksCleanupTerminalAtTheFifthAttempt()
    {
        var fixture = CreateFixture();
        await fixture.Store.WriteAsync(fixture.SessionId, new byte[] { 1 }, CancellationToken.None);
        await fixture.Repository.RecordPendingAsync(fixture.SessionId, CancellationToken.None);
        fixture.Repository.SetAttempts(fixture.SessionId, 4);
        fixture.Store.DeleteExceptionFactory = _ => new UnauthorizedAccessException("denied");

        await fixture.Service.ProcessPendingAsync(CancellationToken.None);

        Assert.AreEqual(0, (await fixture.Repository.GetDueAsync(CancellationToken.None)).Count);
        var terminal = await fixture.Repository.GetTerminalAsync(CancellationToken.None);
        Assert.AreEqual(1, terminal.Count);
        Assert.AreEqual(5, terminal[0].Attempts);
        Assert.AreEqual(nameof(UnauthorizedAccessException), terminal[0].LastError);
    }

    [TestMethod]
    public async Task Sweep_TreatsDirectoryNotFoundAsSuccessfulCleanupAndRemovesTheRecord()
    {
        var fixture = CreateFixture();
        await fixture.Repository.RecordPendingAsync(fixture.SessionId, CancellationToken.None);
        fixture.Store.DeleteExceptionFactory = _ => new DirectoryNotFoundException("gone");

        await fixture.Service.ProcessPendingAsync(CancellationToken.None);

        Assert.AreEqual(0, (await fixture.Repository.GetDueAsync(CancellationToken.None)).Count);
    }

    [TestMethod]
    public async Task Sweep_LogsRegistrationPersistenceFailureAndRetriesDiscoveryOnTheNextSweep()
    {
        var fixture = CreateFixture();
        await fixture.Store.WriteAsync(fixture.SessionId, new byte[] { 1 }, CancellationToken.None);
        fixture.Repository.ThrowOnRecordPending = true;

        await fixture.Service.ProcessPendingAsync(CancellationToken.None);

        Assert.AreEqual(0, fixture.Store.DeleteCalls);
        fixture.Repository.ThrowOnRecordPending = false;

        await fixture.Service.ProcessPendingAsync(CancellationToken.None);

        Assert.AreEqual(1, fixture.Store.DeleteCalls);
        Assert.AreEqual(0, (await fixture.Repository.GetDueAsync(CancellationToken.None)).Count);
        Assert.AreEqual(1, fixture.Logger.Entries.Count(entry => entry.Message.Contains("registration failed", StringComparison.Ordinal)));
    }

    [TestMethod]
    public async Task Sweep_LogsStateUpdateFailureWhenFailurePersistenceThrows()
    {
        var fixture = CreateFixture();
        await fixture.Store.WriteAsync(fixture.SessionId, new byte[] { 1 }, CancellationToken.None);
        fixture.Store.DeleteExceptionFactory = _ => new IOException("still locked");
        fixture.Repository.ThrowOnMarkFailed = true;

        await fixture.Service.ProcessPendingAsync(CancellationToken.None);

        var stored = fixture.Repository.GetStored(fixture.SessionId);
        Assert.IsNotNull(stored);
        Assert.AreEqual("pending", stored.Status);
        Assert.AreEqual(0, stored.Attempts);
        Assert.AreEqual(1, fixture.Logger.Entries.Count(entry => entry.Message.Contains("state update failed", StringComparison.Ordinal)));
    }

    [TestMethod]
    public async Task Sweep_RetriesRemovingStaleMetadataAfterDeletionSucceedsButRecordDeletionFails()
    {
        var fixture = CreateFixture();
        await fixture.Store.WriteAsync(fixture.SessionId, new byte[] { 1 }, CancellationToken.None);
        fixture.Repository.ThrowOnDeleteRecord = true;

        await fixture.Service.ProcessPendingAsync(CancellationToken.None);

        fixture.Repository.ThrowOnDeleteRecord = false;
        fixture.Store.DeleteExceptionFactory = _ => new DirectoryNotFoundException("already gone");

        await fixture.Service.ProcessPendingAsync(CancellationToken.None);

        Assert.AreEqual(0, (await fixture.Repository.GetDueAsync(CancellationToken.None)).Count);
        Assert.AreEqual(1, fixture.Logger.Entries.Count(entry => entry.Message.Contains("state removal failed", StringComparison.Ordinal)));
    }

    private static PaintTemporaryCleanupFixture CreateFixture(FakePaintTemporarySourceStore? store = null)
    {
        var repository = new FakePaintTemporaryCleanupRepository();
        var paintStore = store ?? new FakePaintTemporarySourceStore();
        var lifetime = new FakePaintTemporaryDataLifetime();
        var logger = new CapturingLogger<PaintTemporaryCleanupService>();
        var sessionId = Guid.NewGuid();

        return new PaintTemporaryCleanupFixture
        {
            SessionId = sessionId,
            Repository = repository,
            Store = paintStore,
            Lifetime = lifetime,
            Logger = logger,
            Service = new PaintTemporaryCleanupService(repository, paintStore, lifetime, logger),
        };
    }

    private sealed class PaintTemporaryCleanupFixture
    {
        public required Guid SessionId { get; init; }
        public required FakePaintTemporaryCleanupRepository Repository { get; init; }
        public required FakePaintTemporarySourceStore Store { get; init; }
        public required FakePaintTemporaryDataLifetime Lifetime { get; init; }
        public required CapturingLogger<PaintTemporaryCleanupService> Logger { get; init; }
        public required PaintTemporaryCleanupService Service { get; init; }
    }

    private sealed class FakePaintTemporaryDataLifetime : IPaintTemporaryDataLifetime
    {
        public HashSet<Guid> Retained { get; } = [];

        public bool ShouldRetainTemporaryData(Guid sessionId) => Retained.Contains(sessionId);
    }

    private class FakePaintTemporarySourceStore : IPaintTemporarySourceStore
    {
        private readonly Dictionary<Guid, byte[]> _sessionBytes = [];

        public Func<Guid, Exception>? DeleteExceptionFactory { get; set; }
        public int DeleteCalls { get; private set; }

        public virtual Task WriteAsync(Guid sessionId, ReadOnlyMemory<byte> bytes, CancellationToken cancellationToken)
        {
            _sessionBytes[sessionId] = bytes.ToArray();
            return Task.CompletedTask;
        }

        public Task<byte[]> ReadAsync(Guid sessionId, CancellationToken cancellationToken)
            => Task.FromResult(_sessionBytes[sessionId]);

        public virtual Task DeleteAsync(Guid sessionId, CancellationToken cancellationToken)
        {
            DeleteCalls++;
            if (DeleteExceptionFactory is not null)
            {
                throw DeleteExceptionFactory(sessionId);
            }

            _sessionBytes.Remove(sessionId);
            return Task.CompletedTask;
        }

        public Task<IReadOnlyList<Guid>> ListSessionIdsAsync(CancellationToken cancellationToken)
            => Task.FromResult<IReadOnlyList<Guid>>(_sessionBytes.Keys.ToArray());
    }

    private sealed class BlockingFakePaintTemporarySourceStore : FakePaintTemporarySourceStore
    {
        public TaskCompletionSource DeleteStarted { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource AllowDelete { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public int DeleteStartCalls { get; private set; }

        public override async Task DeleteAsync(Guid sessionId, CancellationToken cancellationToken)
        {
            DeleteStartCalls++;
            DeleteStarted.TrySetResult();
            await AllowDelete.Task.WaitAsync(cancellationToken);
            await base.DeleteAsync(sessionId, cancellationToken);
        }
    }

    private sealed class FakePaintTemporaryCleanupRepository : PaintTemporaryCleanupRepository
    {
        private readonly Dictionary<Guid, PaintTemporaryCleanupRecord> _records = [];

        public FakePaintTemporaryCleanupRepository()
            : base(new Database("Data Source=:memory:"))
        {
        }

        public bool ThrowOnRecordPending { get; set; }
        public bool ThrowOnMarkFailed { get; set; }
        public bool ThrowOnDeleteRecord { get; set; }

        public PaintTemporaryCleanupRecord? GetStored(Guid sessionId)
            => _records.TryGetValue(sessionId, out var record) ? record : null;

        public void SetAttempts(Guid sessionId, int attempts)
        {
            var record = _records[sessionId];
            _records[sessionId] = record with { Attempts = attempts };
        }

        public override Task RecordPendingAsync(Guid sessionId, CancellationToken cancellationToken = default)
        {
            if (ThrowOnRecordPending)
            {
                throw new InvalidOperationException("record failed");
            }

            if (_records.ContainsKey(sessionId))
            {
                return Task.CompletedTask;
            }

            var now = DateTimeOffset.UtcNow;
            _records[sessionId] = new PaintTemporaryCleanupRecord(sessionId, "pending", 0, null, now);
            return Task.CompletedTask;
        }

        public override Task<IReadOnlyList<PaintTemporaryCleanupRecord>> GetDueAsync(CancellationToken cancellationToken = default)
            => Task.FromResult<IReadOnlyList<PaintTemporaryCleanupRecord>>(
                _records.Values
                    .Where(record => record.Status is "pending" or "failed" && record.NextAttemptAt <= DateTimeOffset.UtcNow)
                    .OrderBy(record => record.SessionId)
                    .ToArray());

        public override Task<IReadOnlyList<PaintTemporaryCleanupRecord>> GetTerminalAsync(CancellationToken cancellationToken = default)
            => Task.FromResult<IReadOnlyList<PaintTemporaryCleanupRecord>>(
                _records.Values
                    .Where(record => record.Status == "terminal")
                    .OrderBy(record => record.SessionId)
                    .ToArray());

        public override Task MarkFailedAsync(Guid sessionId, string errorType, DateTimeOffset nextAttemptAt, CancellationToken cancellationToken = default)
        {
            if (ThrowOnMarkFailed)
            {
                throw new InvalidOperationException("mark failed");
            }

            var record = _records[sessionId];
            _records[sessionId] = record with
            {
                Status = "failed",
                Attempts = record.Attempts + 1,
                LastError = errorType,
                NextAttemptAt = nextAttemptAt,
            };
            return Task.CompletedTask;
        }

        public override Task MarkTerminalAsync(Guid sessionId, string errorType, CancellationToken cancellationToken = default)
        {
            var record = _records[sessionId];
            _records[sessionId] = record with
            {
                Status = "terminal",
                Attempts = record.Attempts + 1,
                LastError = errorType,
            };
            return Task.CompletedTask;
        }

        public override Task<bool> RequeueTerminalAsync(Guid sessionId, CancellationToken cancellationToken = default)
        {
            if (!_records.TryGetValue(sessionId, out var record) || record.Status != "terminal")
            {
                return Task.FromResult(false);
            }

            _records[sessionId] = record with
            {
                Status = "failed",
                Attempts = 0,
                NextAttemptAt = DateTimeOffset.UtcNow,
            };
            return Task.FromResult(true);
        }

        public override Task DeleteRecordAsync(Guid sessionId, CancellationToken cancellationToken = default)
        {
            if (ThrowOnDeleteRecord)
            {
                throw new InvalidOperationException("delete failed");
            }

            _records.Remove(sessionId);
            return Task.CompletedTask;
        }
    }

    private sealed class CapturingLogger<T> : ILogger<T>
    {
        public List<LogEntry> Entries { get; } = [];

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            var properties = state is IEnumerable<KeyValuePair<string, object?>> values
                ? values.ToDictionary(value => value.Key, value => value.Value)
                : [];
            Entries.Add(new LogEntry(logLevel, properties, formatter(state, exception)));
        }
    }

    private sealed record LogEntry(LogLevel Level, IReadOnlyDictionary<string, object?> Properties, string Message);
}
