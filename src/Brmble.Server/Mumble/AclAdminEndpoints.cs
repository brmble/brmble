using Brmble.Server.Auth;

namespace Brmble.Server.Mumble;

public static class AclAdminEndpoints
{
    public static IEndpointRouteBuilder MapAclAdminEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/acl/channels/{channelId:int}");

        group.MapGet("", async (
            int channelId,
            HttpContext httpContext,
            ICertificateHashExtractor certHashExtractor,
            UserRepository userRepo,
            IAclAuthorizationService authorization,
            IAclSnapshotRepository snapshots,
            IAclSyncCoordinator coordinator) =>
        {
            var auth = await ResolveAuthorizedUser(httpContext, certHashExtractor, userRepo, authorization, channelId);
            if (auth.Result is not null)
            {
                return auth.Result;
            }

            var cached = await snapshots.GetAsync(channelId);
            var canonical = await coordinator.RefreshFromReadAsync(channelId, cached?.SnapshotHash);
            return Results.Ok(new { snapshot = canonical, cached });
        });

        group.MapPut("", async (
            int channelId,
            AclUpdateRequest request,
            HttpContext httpContext,
            ICertificateHashExtractor certHashExtractor,
            UserRepository userRepo,
            IAclAuthorizationService authorization,
            AclValidationService validation,
            IAclSyncCoordinator coordinator,
            ILoggerFactory loggerFactory) =>
        {
            var auth = await ResolveAuthorizedUser(httpContext, certHashExtractor, userRepo, authorization, channelId);
            if (auth.Result is not null)
            {
                return auth.Result;
            }

            var valid = validation.ValidateUpdate(request);
            if (!valid.Valid)
            {
                return Results.BadRequest(new { error = valid.Error });
            }

            var result = await coordinator.WriteAndRefreshAsync(channelId, request);
            loggerFactory.CreateLogger("Brmble.Server.Mumble.AclAudit")
                .LogInformation("ACL setChannel actor={UserId} channel={ChannelId} success={Success}", auth.User!.Id, channelId, result.Success);
            if (result.Success)
            {
                return Results.Ok(result);
            }

            if (result.Error == "ACL changed since it was opened.")
            {
                return Results.Conflict(result);
            }

            return Results.Accepted(value: result);
        });

        group.MapPost("groups/add", async (
            int channelId,
            AclGroupMemberRequest request,
            HttpContext httpContext,
            ICertificateHashExtractor certHashExtractor,
            UserRepository userRepo,
            IAclAuthorizationService authorization,
            IAclSyncCoordinator coordinator,
            ILoggerFactory loggerFactory) =>
        {
            var auth = await ResolveAuthorizedUser(httpContext, certHashExtractor, userRepo, authorization, channelId);
            if (auth.Result is not null)
            {
                return auth.Result;
            }

            if (request.Session <= 0 || string.IsNullOrWhiteSpace(request.Group))
            {
                return Results.BadRequest(new { error = "Session and group are required." });
            }

            var result = await coordinator.AddUserToGroupAndRefreshAsync(channelId, request.Session, request.Group);
            loggerFactory.CreateLogger("Brmble.Server.Mumble.AclAudit")
                .LogInformation("ACL groupAdd actor={UserId} channel={ChannelId} targetSession={Session} success={Success}", auth.User!.Id, channelId, request.Session, result.Success);
            return result.Success ? Results.Ok(result) : Results.Accepted(value: result);
        });

        group.MapPost("groups/remove", async (
            int channelId,
            AclGroupMemberRequest request,
            HttpContext httpContext,
            ICertificateHashExtractor certHashExtractor,
            UserRepository userRepo,
            IAclAuthorizationService authorization,
            IAclSyncCoordinator coordinator,
            ILoggerFactory loggerFactory) =>
        {
            var auth = await ResolveAuthorizedUser(httpContext, certHashExtractor, userRepo, authorization, channelId);
            if (auth.Result is not null)
            {
                return auth.Result;
            }

            if (request.Session <= 0 || string.IsNullOrWhiteSpace(request.Group))
            {
                return Results.BadRequest(new { error = "Session and group are required." });
            }

            var result = await coordinator.RemoveUserFromGroupAndRefreshAsync(channelId, request.Session, request.Group);
            loggerFactory.CreateLogger("Brmble.Server.Mumble.AclAudit")
                .LogInformation("ACL groupRemove actor={UserId} channel={ChannelId} targetSession={Session} success={Success}", auth.User!.Id, channelId, request.Session, result.Success);
            return result.Success ? Results.Ok(result) : Results.Accepted(value: result);
        });

        return app;
    }

    private static async Task<(User? User, IResult? Result)> ResolveAuthorizedUser(
        HttpContext httpContext,
        ICertificateHashExtractor certHashExtractor,
        UserRepository userRepo,
        IAclAuthorizationService authorization,
        int channelId)
    {
        var certHash = certHashExtractor.GetCertHash(httpContext);
        if (string.IsNullOrWhiteSpace(certHash))
        {
            return (null, Results.Unauthorized());
        }

        var user = await userRepo.GetByCertHash(certHash);
        if (user is null)
        {
            return (null, Results.Unauthorized());
        }

        if (!await authorization.CanManageChannelAclAsync(user.Id, channelId))
        {
            return (null, Results.StatusCode(StatusCodes.Status403Forbidden));
        }

        return (user, null);
    }
}
