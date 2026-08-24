using Brmble.Server.Paint;
using Microsoft.Extensions.Options;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Paint;

[TestClass]
public sealed class FilePaintTemporarySourceStoreTests
{
    private readonly List<string> _pathsToDelete = [];

    [TestCleanup]
    public void Cleanup()
    {
        foreach (var path in _pathsToDelete)
        {
            try
            {
                if (Directory.Exists(path))
                {
                    Directory.Delete(path, recursive: true);
                }
                else if (File.Exists(path))
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
    public async Task Store_IsolatesSessionsAndDeletesOnlyRequestedSession()
    {
        var root = TrackDirectory(Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N")));
        var store = CreateStore(root);
        var first = Guid.NewGuid();
        var second = Guid.NewGuid();

        await store.WriteAsync(first, new byte[] { 1, 2, 3 }, CancellationToken.None);
        await store.WriteAsync(second, new byte[] { 4, 5, 6 }, CancellationToken.None);
        await store.DeleteAsync(first, CancellationToken.None);

        await Assert.ThrowsExceptionAsync<FileNotFoundException>(() =>
            store.ReadAsync(first, CancellationToken.None));
        CollectionAssert.AreEqual(new byte[] { 4, 5, 6 },
            await store.ReadAsync(second, CancellationToken.None));
        CollectionAssert.Contains((await store.ListSessionIdsAsync(CancellationToken.None)).ToArray(), second);
    }

    [TestMethod]
    public async Task Write_CreatesMissingRootAndSessionDirectory()
    {
        var root = TrackDirectory(Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"), "missing-root"));
        var store = CreateStore(root);
        var sessionId = Guid.NewGuid();

        await store.WriteAsync(sessionId, new byte[] { 1, 2, 3 }, CancellationToken.None);

        Assert.IsTrue(Directory.Exists(root));
        Assert.IsTrue(Directory.Exists(Path.Combine(root, sessionId.ToString("N"))));
        CollectionAssert.AreEqual(new byte[] { 1, 2, 3 },
            await store.ReadAsync(sessionId, CancellationToken.None));
        if (!OperatingSystem.IsWindows())
        {
            var mode = File.GetUnixFileMode(root);
            Assert.AreEqual(UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute, mode);
        }
    }

    [TestMethod]
    public void Constructor_WhenConfiguredRootIsAFile_ThrowsIOException()
    {
        var root = TrackFile(Path.GetTempFileName());

        Assert.ThrowsException<IOException>(() => CreateStore(root));
    }

    [TestMethod]
    public async Task Write_ReplacesExistingSourceAtomically()
    {
        var root = TrackDirectory(Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N")));
        var store = CreateStore(root);
        var sessionId = Guid.NewGuid();

        await store.WriteAsync(sessionId, new byte[] { 1, 2, 3 }, CancellationToken.None);
        await store.WriteAsync(sessionId, new byte[] { 9, 8, 7, 6 }, CancellationToken.None);

        CollectionAssert.AreEqual(new byte[] { 9, 8, 7, 6 },
            await store.ReadAsync(sessionId, CancellationToken.None));
    }

    [TestMethod]
    public async Task ListSessionIds_IgnoresUnexpectedDirectories()
    {
        var root = TrackDirectory(Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N")));
        var store = CreateStore(root);
        var sessionId = Guid.NewGuid();
        Directory.CreateDirectory(Path.Combine(root, "not-a-guid"));

        await store.WriteAsync(sessionId, new byte[] { 1 }, CancellationToken.None);

        var sessionIds = await store.ListSessionIdsAsync(CancellationToken.None);
        CollectionAssert.AreEquivalent(new[] { sessionId }, sessionIds.ToArray());
    }

    [TestMethod]
    public async Task DeleteAsync_RemovesWholeSessionDirectoryIncludingInterruptedTempFiles()
    {
        var root = TrackDirectory(Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N")));
        var store = CreateStore(root);
        var sessionId = Guid.NewGuid();
        var sessionDirectory = Path.Combine(root, sessionId.ToString("N"));

        await store.WriteAsync(sessionId, new byte[] { 1, 2, 3 }, CancellationToken.None);
        await File.WriteAllBytesAsync(Path.Combine(sessionDirectory, "source.tmp-orphan"), [9, 9, 9]);

        await store.DeleteAsync(sessionId, CancellationToken.None);

        Assert.IsFalse(Directory.Exists(sessionDirectory));
    }

    private FilePaintTemporarySourceStore CreateStore(string root)
        => new(Options.Create(new PaintStorageOptions { RootPath = root }));

    private string TrackDirectory(string path)
    {
        _pathsToDelete.Add(path);
        return path;
    }

    private string TrackFile(string path)
    {
        _pathsToDelete.Add(path);
        return path;
    }
}
