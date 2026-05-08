using Brmble.Server.Mumble;
using System.Text.Json;

namespace Brmble.Server.Auth;

public static class AdminEndpoints
{
    public static IEndpointRouteBuilder MapAdminEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/admin");

        group.MapGet("/registered-users", GetRegisteredUsers);
        group.MapPut("/registered-users/{id}", RenameUser);
        group.MapDelete("/registered-users/{id}", DeleteUser);

        return app;
    }

    private static async Task<IResult> GetRegisteredUsers(
        HttpContext httpContext,
        ICertificateHashExtractor certHashExtractor,
        UserRepository userRepo,
        IMumbleRegistrationService mumbleService,
        ILogger<AdminService> logger)
    {
        var certHash = certHashExtractor.GetCertHash(httpContext);
        if (string.IsNullOrEmpty(certHash))
            return Results.Unauthorized();
        
        var adminUser = await userRepo.GetByCertHash(certHash);
        if (adminUser == null || adminUser.IsAdmin == 0)
            return Results.Forbid();
        
        var service = new AdminService(userRepo, mumbleService, logger);
        var users = await service.GetRegisteredUsersAsync();
        return Results.Ok(users);
    }

    private static async Task<IResult> RenameUser(
        long id,
        HttpContext httpContext,
        ICertificateHashExtractor certHashExtractor,
        UserRepository userRepo,
        ILogger<AdminService> logger)
    {
        var certHash = certHashExtractor.GetCertHash(httpContext);
        if (string.IsNullOrEmpty(certHash))
            return Results.Unauthorized();
        
        var adminUser = await userRepo.GetByCertHash(certHash);
        if (adminUser == null || adminUser.IsAdmin == 0)
            return Results.Forbid();
        
        // Parse displayName from body
        string? newName = null;
        try
        {
            using var doc = await JsonDocument.ParseAsync(httpContext.Request.Body);
            newName = doc.RootElement.TryGetProperty("displayName", out var prop)
                ? prop.GetString() : null;
        }
        catch { /* empty or invalid body */ }

        if (string.IsNullOrWhiteSpace(newName))
            return Results.BadRequest(new { error = "displayName is required" });

        var (isValid, error) = AdminService.ValidateDisplayName(newName);
        if (!isValid)
            return Results.BadRequest(new { error });

        await userRepo.UpdateDisplayName(id, newName);
        logger.LogInformation("Admin {AdminCertHash} renamed user {UserId} to {NewName}",
            certHash, id, newName);

        return Results.Ok(new { id, displayName = newName });
    }

    private static async Task<IResult> DeleteUser(
        long id,
        HttpContext httpContext,
        ICertificateHashExtractor certHashExtractor,
        UserRepository userRepo,
        IMumbleRegistrationService mumbleService,
        ILogger<AdminService> logger)
    {
        var certHash = certHashExtractor.GetCertHash(httpContext);
        if (string.IsNullOrEmpty(certHash))
            return Results.Unauthorized();
        
        var adminUser = await userRepo.GetByCertHash(certHash);
        if (adminUser == null || adminUser.IsAdmin == 0)
            return Results.Forbid();
        
        var service = new AdminService(userRepo, mumbleService, logger);
        var deleted = await service.DeleteUserAsync(id);
        
        if (!deleted)
            return Results.NotFound();
        
        logger.LogWarning("Admin {AdminCertHash} deleted user {UserId}", certHash, id);
        return Results.Ok();
    }
}
