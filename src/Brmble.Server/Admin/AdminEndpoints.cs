using Brmble.Server.Mumble;
using Microsoft.Extensions.Options;

namespace Brmble.Server.Admin;

public static class AdminEndpoints
{
    public static IEndpointRouteBuilder MapAdminEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/admin/registered-users", async (
            IMumbleRegistrationService registrationService) =>
        {
            try
            {
                var users = await registrationService.GetRegisteredUsersAsync();
                return Results.Ok(users);
            }
            catch (Exception ex)
            {
                return Results.Problem(
                    detail: $"Failed to retrieve registered users: {ex.Message}",
                    statusCode: 500);
            }
        });

        return app;
    }
}
