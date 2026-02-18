namespace Brmble.Server.Mumble;

public record MumbleUser(string Name, string CertHash, int SessionId);
public record MumbleChannel(int Id, string Name);

public interface IMumbleEventHandler
{
    Task OnUserConnected(MumbleUser user);
    Task OnUserDisconnected(MumbleUser user);
    Task OnUserTextMessage(MumbleUser sender, string text, int channelId);
    Task OnChannelCreated(MumbleChannel channel);
    Task OnChannelRemoved(MumbleChannel channel);
    Task OnChannelRenamed(MumbleChannel channel);
}
