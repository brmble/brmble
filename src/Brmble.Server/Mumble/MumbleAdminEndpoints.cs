using Brmble.Server.Mumble;

namespace Brmble.Server.Mumble;

public static class MumbleAdminEndpoints
{
    public static IEndpointRouteBuilder MapMumbleAdminEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/admin/registered-users", async (
            IMumbleRegistrationService registration) =>
        {
            try
            {
                var users = await registration.GetRegisteredUsersAsync();
                return Results.Ok(users.Select(kvp => new
                {
                    userId = kvp.Key,
                    name = kvp.Value
                }));
            }
            catch (MumbleRegistrationException ex)
            {
                return Results.Problem(ex.Message);
            }
        });

        return app;
    }
}
