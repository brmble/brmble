using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Brmble.Server.Paint;

public sealed class FilePaintTemporarySourceStore : IPaintTemporarySourceStore
{
    private readonly string _rootPath;
    private readonly ILogger<FilePaintTemporarySourceStore>? _logger;

    public FilePaintTemporarySourceStore(
        IOptions<PaintStorageOptions> options,
        ILogger<FilePaintTemporarySourceStore>? logger = null)
    {
        ArgumentNullException.ThrowIfNull(options);
        if (string.IsNullOrWhiteSpace(options.Value.RootPath))
        {
            throw new ArgumentException("Paint storage root path is required.", nameof(options));
        }

        _rootPath = options.Value.RootPath;
        _logger = logger;

        Directory.CreateDirectory(_rootPath);
        ApplyOwnerOnlyDirectoryMode(_rootPath);
    }

    public async Task WriteAsync(Guid sessionId, ReadOnlyMemory<byte> bytes, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        var sessionDirectory = SessionDirectory(sessionId);
        Directory.CreateDirectory(sessionDirectory);
        ApplyOwnerOnlyDirectoryMode(sessionDirectory);

        var tempPath = Path.Combine(sessionDirectory, $"source.tmp-{Guid.NewGuid():N}");
        var sourcePath = SourcePath(sessionId);
        try
        {
            await using (var stream = new FileStream(tempPath, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                await stream.WriteAsync(bytes, cancellationToken);
                await stream.FlushAsync(cancellationToken);
            }

            File.Move(tempPath, sourcePath, overwrite: true);
        }
        catch
        {
            TryDeleteTempFile(tempPath);
            throw;
        }
    }

    public Task<byte[]> ReadAsync(Guid sessionId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        var sourcePath = SourcePath(sessionId);
        if (!File.Exists(sourcePath))
        {
            throw new FileNotFoundException("Paint session source was not found.", sourcePath);
        }

        return File.ReadAllBytesAsync(sourcePath, cancellationToken);
    }

    public Task DeleteAsync(Guid sessionId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        var sessionDirectory = SessionDirectory(sessionId);
        if (!Directory.Exists(sessionDirectory))
        {
            return Task.CompletedTask;
        }

        Directory.Delete(sessionDirectory, recursive: true);
        if (Directory.Exists(sessionDirectory))
        {
            throw new IOException($"Failed to delete paint session directory '{sessionDirectory}'.");
        }

        return Task.CompletedTask;
    }

    public Task<IReadOnlyList<Guid>> ListSessionIdsAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        if (!Directory.Exists(_rootPath))
        {
            return Task.FromResult<IReadOnlyList<Guid>>([]);
        }

        var sessionIds = new List<Guid>();
        foreach (var directory in Directory.EnumerateDirectories(_rootPath))
        {
            cancellationToken.ThrowIfCancellationRequested();

            var name = Path.GetFileName(directory);
            if (Guid.TryParseExact(name, "N", out var sessionId))
            {
                sessionIds.Add(sessionId);
                continue;
            }

            _logger?.LogWarning("Ignoring unexpected paint session directory entry: {DirectoryName}", name);
        }

        return Task.FromResult<IReadOnlyList<Guid>>(sessionIds);
    }

    private string SessionDirectory(Guid sessionId)
        => Path.Combine(_rootPath, sessionId.ToString("N"));

    private string SourcePath(Guid sessionId)
        => Path.Combine(SessionDirectory(sessionId), "source.bin");

    private static void ApplyOwnerOnlyDirectoryMode(string path)
    {
        if (!OperatingSystem.IsWindows())
        {
            File.SetUnixFileMode(path,
                UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        }
    }

    private static void TryDeleteTempFile(string path)
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
            // Best effort only; leftover temp files are removed by session-directory cleanup.
        }
    }
}
