namespace Brmble.Server.Paint;

public interface IPaintParticipationLifecycle
{
    Task HandleSessionDisconnectedAsync(int mumbleSessionId);
    Task HandleSessionChannelChangedAsync(
        int mumbleSessionId,
        int previousChannelId,
        int currentChannelId);
}
