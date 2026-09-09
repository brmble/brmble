namespace Brmble.Server.Paint;

public interface IPaintTemporaryDataLifetime
{
    bool ShouldRetainTemporaryData(Guid sessionId);
}
