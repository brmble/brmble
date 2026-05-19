using Brmble.Server.Auth;
using Brmble.Server.Events;

namespace Brmble.Server.Mumble;

public sealed record ChannelChatAccessRequest(int[] ChannelIds);

public sealed record ChannelChatAccessState(bool CanRead, bool CanSend);

public sealed record ChannelChatAccessResponse(Dictionary<string, ChannelChatAccessState> Channels);

public static class ChannelChatAccessEndpoints
{
    public static IEndpointRouteBuilder MapChannelChatAccessEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/chat/channel-access", async (
            ChannelChatAccessRequest request,
            HttpContext httpContext,
            ICertificateHashExtractor certHashExtractor,
            UserRepository userRepo,
            ISessionMappingService sessionMapping,
            IMumbleAclService aclService) =>
        {
            var certHash = certHashExtractor.GetCertHash(httpContext);
            if (string.IsNullOrWhiteSpace(certHash))
            {
                return Results.Unauthorized();
            }

            var user = await userRepo.GetByCertHash(certHash);
            if (user is null)
            {
                return Results.Unauthorized();
            }

            if (!sessionMapping.TryGetSessionByUserId(user.Id, out var sessionId))
            {
                return Results.StatusCode(StatusCodes.Status403Forbidden);
            }

            var channels = new Dictionary<string, ChannelChatAccessState>();
            foreach (var channelId in request.ChannelIds.Where(id => id > 0).Distinct())
            {
                var allowed = await aclService.HasTextMessagePermissionAsync(sessionId, channelId);
                channels[channelId.ToString()] = new ChannelChatAccessState(allowed, allowed);
            }

            return Results.Ok(new ChannelChatAccessResponse(channels));
        });

        return app;
    }
}
