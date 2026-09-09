using Brmble.Server.Data;
using Brmble.Server.Paint;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Paint;

[TestClass]
public sealed class PaintTemporaryCleanupRepositoryTests
{
    private readonly List<string> _pathsToDelete = [];

    [TestCleanup]
    public void Cleanup()
    {
        foreach (var path in _pathsToDelete)
        {
            try
            {
                if (File.Exists(path))
                {
                    File.Delete(path);
                }
            }
            catch
            {
                // Best-effort temp cleanup for tests.
            }
        }
    }

    [TestMethod]
    public async Task RecordPending_IsIdempotentBySessionId()
    {
        var repository = CreateRepository();
        var sessionId = Guid.NewGuid();

        await repository.RecordPendingAsync(sessionId, CancellationToken.None);
        await repository.RecordPendingAsync(sessionId, CancellationToken.None);

        Assert.AreEqual(1, (await repository.GetDueAsync(CancellationToken.None)).Count);
    }

    [TestMethod]
    public async Task DeleteRecord_RemovesSuccessfulCleanupMetadata()
    {
        var repository = CreateRepository();
        var sessionId = Guid.NewGuid();
        await repository.RecordPendingAsync(sessionId, CancellationToken.None);

        await repository.DeleteRecordAsync(sessionId, CancellationToken.None);

        Assert.AreEqual(0, (await repository.GetDueAsync(CancellationToken.None)).Count);
    }

    [TestMethod]
    public async Task GetDue_ExcludesTerminalRowsAndGetTerminalExposesThem()
    {
        var repository = CreateRepository();
        var sessionId = Guid.NewGuid();
        await repository.RecordPendingAsync(sessionId, CancellationToken.None);
        await repository.MarkTerminalAsync(sessionId, "UnauthorizedAccessException", CancellationToken.None);

        Assert.AreEqual(0, (await repository.GetDueAsync(CancellationToken.None)).Count);
        var terminal = await repository.GetTerminalAsync(CancellationToken.None);
        Assert.AreEqual(1, terminal.Count);
        Assert.AreEqual(sessionId, terminal[0].SessionId);
        Assert.AreEqual("terminal", terminal[0].Status);
    }

    [TestMethod]
    public async Task RequeueTerminal_MakesOnlyTerminalRowImmediatelyRetryable()
    {
        var repository = CreateRepository();
        var sessionId = Guid.NewGuid();
        await repository.RecordPendingAsync(sessionId, CancellationToken.None);
        await repository.MarkTerminalAsync(sessionId, "UnauthorizedAccessException", CancellationToken.None);

        Assert.IsTrue(await repository.RequeueTerminalAsync(sessionId, CancellationToken.None));

        var due = await repository.GetDueAsync(CancellationToken.None);
        Assert.AreEqual(1, due.Count);
        Assert.AreEqual("failed", due[0].Status);
        Assert.AreEqual(0, due[0].Attempts);
        Assert.AreEqual("UnauthorizedAccessException", due[0].LastError);
        Assert.AreEqual(0, (await repository.GetTerminalAsync(CancellationToken.None)).Count);
    }

    [TestMethod]
    public async Task MarkFailed_TracksAttemptsAndHidesTheRowUntilItsRetryTime()
    {
        var repository = CreateRepository();
        var sessionId = Guid.NewGuid();
        var nextAttemptAt = DateTimeOffset.UtcNow.AddMinutes(5);
        await repository.RecordPendingAsync(sessionId, CancellationToken.None);

        await repository.MarkFailedAsync(sessionId, "IOException", nextAttemptAt, CancellationToken.None);

        Assert.AreEqual(0, (await repository.GetDueAsync(CancellationToken.None)).Count);
        var row = ReadRow(sessionId);
        Assert.IsNotNull(row);
        Assert.AreEqual("failed", row.Status);
        Assert.AreEqual(1, row.Attempts);
        Assert.AreEqual("IOException", row.LastError);
        Assert.IsTrue(row.NextAttemptAt >= nextAttemptAt.AddSeconds(-1));
    }

    [TestMethod]
    public async Task RecordPending_DoesNotReactivateTerminalRow()
    {
        var repository = CreateRepository();
        var sessionId = Guid.NewGuid();
        await repository.RecordPendingAsync(sessionId, CancellationToken.None);
        await repository.MarkTerminalAsync(sessionId, "UnauthorizedAccessException", CancellationToken.None);

        await repository.RecordPendingAsync(sessionId, CancellationToken.None);

        Assert.AreEqual(0, (await repository.GetDueAsync(CancellationToken.None)).Count);
        Assert.AreEqual(1, (await repository.GetTerminalAsync(CancellationToken.None)).Count);
    }

    [TestMethod]
    public async Task RequeueTerminal_ReturnsFalseForMissingAndNonTerminalRows()
    {
        var repository = CreateRepository();
        var pendingSessionId = Guid.NewGuid();
        await repository.RecordPendingAsync(pendingSessionId, CancellationToken.None);

        Assert.IsFalse(await repository.RequeueTerminalAsync(Guid.NewGuid(), CancellationToken.None));
        Assert.IsFalse(await repository.RequeueTerminalAsync(pendingSessionId, CancellationToken.None));
    }

    private PaintTemporaryCleanupRepository CreateRepository()
    {
        var path = TrackFile(Path.Combine(Path.GetTempPath(), $"brmble-temp-cleanup-{Guid.NewGuid():N}.db"));
        var database = new Database($"Data Source={path}");
        database.Initialize();
        _database = database;
        return new PaintTemporaryCleanupRepository(database);
    }

    private PaintTemporaryCleanupRow? ReadRow(Guid sessionId)
    {
        using var connection = _database!.CreateConnection();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT session_id, status, attempts, last_error, next_attempt_at
            FROM paint_temporary_cleanup
            WHERE session_id = $sessionId
            """;
        var parameter = command.CreateParameter();
        parameter.ParameterName = "$sessionId";
        parameter.Value = sessionId.ToString();
        command.Parameters.Add(parameter);
        using var reader = command.ExecuteReader();
        if (!reader.Read())
        {
            return null;
        }

        return new PaintTemporaryCleanupRow(
            Guid.Parse(reader.GetString(0)),
            reader.GetString(1),
            reader.GetInt32(2),
            reader.IsDBNull(3) ? null : reader.GetString(3),
            DateTimeOffset.Parse(reader.GetString(4)));
    }

    private string TrackFile(string path)
    {
        _pathsToDelete.Add(path);
        return path;
    }

    private Database? _database;

    private sealed record PaintTemporaryCleanupRow(
        Guid SessionId,
        string Status,
        int Attempts,
        string? LastError,
        DateTimeOffset NextAttemptAt);
}
