using Brmble.Server.Mumble;

namespace Brmble.Server.Auth;

public static class AdminEndpoints
{
    public static IEndpointRouteBuilder MapAdminEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/admin");

        group.MapGet("/registered-users", async (
            HttpContext httpContext,
            ICertificateHashExtractor certHashExtractor,
            UserRepository userRepo,
            IMumbleRegistrationService registrationService,
            Brmble.Server.Mumble.IAclAuthorizationService aclAuthService) =>
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

            // Restrict to users who can manage root channel ACLs (server admins)
            var canManageRoot = await aclAuthService.CanManageChannelAclAsync(user.Id, channelId: 0);
            if (!canManageRoot)
            {
                return Results.Forbid();
            }

            try
            {
                var users = await registrationService.GetRegisteredUsersAsync();
                return Results.Ok(users);
            }
            catch (MumbleRegistrationException ex)
            {
                return Results.Problem(
                    detail: ex.Message,
                    statusCode: StatusCodes.Status503ServiceUnavailable,
                    title: "Unable to load registered users");
            }
        });

        return app;
    }
}
