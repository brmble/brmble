namespace Brmble.Server.Paint;

public interface IPaintTemporarySourceStore
{
    Task WriteAsync(Guid sessionId, ReadOnlyMemory<byte> bytes, CancellationToken cancellationToken);
    Task<byte[]> ReadAsync(Guid sessionId, CancellationToken cancellationToken);
    Task DeleteAsync(Guid sessionId, CancellationToken cancellationToken);
    Task<IReadOnlyList<Guid>> ListSessionIdsAsync(CancellationToken cancellationToken);
}
