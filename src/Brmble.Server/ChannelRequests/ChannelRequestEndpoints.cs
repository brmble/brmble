using Brmble.Server.Auth;
using Brmble.Server.Mumble;

namespace Brmble.Server.ChannelRequests;

public static class ChannelRequestEndpoints
{
    public static IEndpointRouteBuilder MapChannelRequestEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/channel-requests", async (
            CreateChannelRequestDto request,
            HttpContext httpContext,
            ICertificateHashExtractor certHashExtractor,
            UserRepository userRepo,
            ChannelRequestService service) =>
        {
            var user = await ResolveUserAsync(httpContext, certHashExtractor, userRepo);
            if (user is null)
            {
                return Results.Unauthorized();
            }

            var result = await service.CreateAsync(user, request.ChannelName, request.Reason);
            return result.Success
                ? Results.Created($"/channel-requests/{result.Request!.Id}", ChannelRequestDto.FromModel(result.Request))
                : Results.Json(new { error = result.Error }, statusCode: result.Error!.StatusCode);
        }).RequireRateLimiting("channel-request-create");

        app.MapGet("/channel-requests/mine", async (
            HttpContext httpContext,
            ICertificateHashExtractor certHashExtractor,
            UserRepository userRepo,
            ChannelRequestService service,
            string? status,
            int? limit) =>
        {
            var user = await ResolveUserAsync(httpContext, certHashExtractor, userRepo);
            if (user is null)
            {
                return Results.Unauthorized();
            }

            if (!ChannelRequestStatus.IsValidFilter(status))
            {
                return Results.BadRequest(new { error = $"Invalid status filter. Valid values: {string.Join(", ", ChannelRequestStatus.All)}, all." });
            }

            var items = await service.ListMineAsync(user.UserId, status, limit ?? 25);
            return Results.Ok(new ChannelRequestListResponse(items.Select(ChannelRequestDto.FromModel).ToList()));
        });

        app.MapGet("/admin/channel-requests", async (
            HttpContext httpContext,
            ICertificateHashExtractor certHashExtractor,
            UserRepository userRepo,
            IAclAuthorizationService aclAuthorizationService,
            ChannelRequestService service,
            string? status,
            int? limit) =>
        {
            var (admin, failure) = await ResolveAdminAsync(httpContext, certHashExtractor, userRepo, aclAuthorizationService);
            if (failure is not null)
            {
                return failure;
            }

            if (!ChannelRequestStatus.IsValidFilter(status))
            {
                return Results.BadRequest(new { error = $"Invalid status filter. Valid values: {string.Join(", ", ChannelRequestStatus.All)}, all." });
            }

            var items = await service.ListAdminAsync(status, limit ?? 50);
            return Results.Ok(new ChannelRequestListResponse(items.Select(ChannelRequestDto.FromModel).ToList()));
        });

        app.MapPost("/admin/channel-requests/{id:long}/approve", async (
            long id,
            HttpContext httpContext,
            ICertificateHashExtractor certHashExtractor,
            UserRepository userRepo,
            IAclAuthorizationService aclAuthorizationService,
            ChannelRequestService service) =>
        {
            var (admin, failure) = await ResolveAdminAsync(httpContext, certHashExtractor, userRepo, aclAuthorizationService);
            if (failure is not null)
            {
                return failure;
            }

            var result = await service.ApproveAsync(id, admin!);
            return result.Success
                ? Results.Ok(ChannelRequestDto.FromModel(result.Request!))
                : Results.Json(new { error = result.Error }, statusCode: result.Error!.StatusCode);
        });

        app.MapPost("/admin/channel-requests/{id:long}/deny", async (
            long id,
            DenyChannelRequestDto request,
            HttpContext httpContext,
            ICertificateHashExtractor certHashExtractor,
            UserRepository userRepo,
            IAclAuthorizationService aclAuthorizationService,
            ChannelRequestService service) =>
        {
            var (admin, failure) = await ResolveAdminAsync(httpContext, certHashExtractor, userRepo, aclAuthorizationService);
            if (failure is not null)
            {
                return failure;
            }

            var result = await service.DenyAsync(id, admin!, request.Reason);
            return result.Success
                ? Results.Ok(ChannelRequestDto.FromModel(result.Request!))
                : Results.Json(new { error = result.Error }, statusCode: result.Error!.StatusCode);
        });

        return app;
    }

    private static async Task<AuthenticatedChannelRequestUser?> ResolveUserAsync(
        HttpContext httpContext,
        ICertificateHashExtractor certHashExtractor,
        UserRepository userRepo)
    {
        var certHash = certHashExtractor.GetCertHash(httpContext);
        if (string.IsNullOrWhiteSpace(certHash))
        {
            return null;
        }

        var user = await userRepo.GetByCertHash(certHash);
        return user is null ? null : new AuthenticatedChannelRequestUser(user.Id, user.DisplayName);
    }

    private static async Task<(AuthenticatedChannelRequestUser? User, IResult? Failure)> ResolveAdminAsync(
        HttpContext httpContext,
        ICertificateHashExtractor certHashExtractor,
        UserRepository userRepo,
        IAclAuthorizationService aclAuthorizationService)
    {
        var user = await ResolveUserAsync(httpContext, certHashExtractor, userRepo);
        if (user is null)
        {
            return (null, Results.Unauthorized());
        }

        return await aclAuthorizationService.CanManageChannelAclAsync(user.UserId, 0)
            ? (user, null)
            : (null, Results.StatusCode(StatusCodes.Status403Forbidden));
    }
}
