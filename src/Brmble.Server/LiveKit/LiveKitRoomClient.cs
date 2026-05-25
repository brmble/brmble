using Livekit.Server.Sdk.Dotnet;
using Microsoft.Extensions.Options;

namespace Brmble.Server.LiveKit;

public sealed class LiveKitRoomClient : ILiveKitRoomClient
{
    private readonly LiveKitSettings _settings;

    public LiveKitRoomClient(IOptions<LiveKitSettings> settings)
    {
        _settings = settings.Value;
    }

    public async Task RemoveParticipant(string roomName, string participantIdentity)
    {
        var roomService = CreateRoomServiceClient();

        await roomService.RemoveParticipant(new RoomParticipantIdentity
        {
            Room = roomName,
            Identity = participantIdentity
        });
    }

    public async Task<IReadOnlyList<string>> ListParticipantIdentities(string roomName)
    {
        var roomService = CreateRoomServiceClient();
        var response = await roomService.ListParticipants(new ListParticipantsRequest
        {
            Room = roomName
        });

        return response.Participants.Select(p => p.Identity).ToList();
    }

    private RoomServiceClient CreateRoomServiceClient()
    {
        return new RoomServiceClient(
            _settings.ServerUrl,
            _settings.ApiKey,
            _settings.ApiSecret);
    }
}
