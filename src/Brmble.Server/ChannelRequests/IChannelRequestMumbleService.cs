namespace Brmble.Server.ChannelRequests;

public sealed record CreatedMumbleChannel(int ChannelId, string ChannelName);

public interface IChannelRequestMumbleService
{
    Task<bool> ChannelNameExistsAsync(string normalizedChannelName);
    Task<CreatedMumbleChannel?> FindChannelByNameAsync(string normalizedChannelName);
    Task<CreatedMumbleChannel> CreateChannelAsync(string channelName);
}
