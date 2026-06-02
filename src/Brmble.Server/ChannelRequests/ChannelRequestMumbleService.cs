using Brmble.Server.Mumble;

namespace Brmble.Server.ChannelRequests;

public sealed class ChannelRequestMumbleService : IChannelRequestMumbleService
{
    private readonly IMumbleAclIceClient _iceClient;

    public ChannelRequestMumbleService(IMumbleAclIceClient iceClient) => _iceClient = iceClient;

    public async Task<bool> ChannelNameExistsAsync(string normalizedChannelName) =>
        await FindChannelByNameAsync(normalizedChannelName) is not null;

    public async Task<CreatedMumbleChannel?> FindChannelByNameAsync(string normalizedChannelName)
    {
        var channels = await _iceClient.GetChannelsAsync();
        var match = channels.Values.FirstOrDefault(channel =>
            string.Equals(channel.name.Trim(), normalizedChannelName, StringComparison.OrdinalIgnoreCase));

        return match is null ? null : new CreatedMumbleChannel(match.id, match.name);
    }

    public async Task<CreatedMumbleChannel> CreateChannelAsync(string channelName)
    {
        var channelId = await _iceClient.AddChannelAsync(channelName, parentId: 0);
        return new CreatedMumbleChannel(channelId, channelName);
    }
}
