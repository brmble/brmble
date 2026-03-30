using Brmble.Server.Data;

namespace Brmble.Server.Moderator;

public static class ModeratorEndpoints
{
    public static IEndpointRouteBuilder MapModeratorEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/admin/moderator-roles", async (IModeratorService moderatorService) =>
        {
            var roles = await moderatorService.GetRolesAsync();
            return Results.Ok(roles.Select(r => new
            {
                r.Id,
                r.Name,
                Permissions = (int)r.Permissions
            }));
        });

        app.MapPost("/api/admin/moderator-roles", async (
            IModeratorService moderatorService,
            CreateRoleRequest request) =>
        {
            if (string.IsNullOrWhiteSpace(request.Name))
                return Results.BadRequest("Role name is required");
            
            var role = await moderatorService.CreateRoleAsync(request.Name, request.Permissions);
            return Results.Created($"/api/admin/moderator-roles/{role.Id}", new
            {
                role.Id,
                role.Name,
                Permissions = (int)role.Permissions
            });
        });

        app.MapPut("/api/admin/moderator-roles/{id}", async (
            IModeratorService moderatorService,
            string id,
            UpdateRoleRequest request) =>
        {
            await moderatorService.UpdateRoleAsync(id, request.Name, request.Permissions);
            return Results.NoContent();
        });

        app.MapDelete("/api/admin/moderator-roles/{id}", async (
            IModeratorService moderatorService,
            string id) =>
        {
            await moderatorService.DeleteRoleAsync(id);
            return Results.NoContent();
        });

        app.MapGet("/api/channels/{channelId}/moderators", async (
            IModeratorService moderatorService,
            int channelId) =>
        {
            var moderators = await moderatorService.GetChannelModeratorsAsync(channelId);
            return Results.Ok(moderators.Select(m => new
            {
                m.Id,
                m.UserId,
                m.RoleId,
                m.RoleName,
                RolePermissions = (int)m.RolePermissions,
                m.AssignedAt
            }));
        });

        app.MapPost("/api/channels/{channelId}/moderators", async (
            IModeratorService moderatorService,
            int channelId,
            CreateAssignmentRequest request) =>
        {
            if (string.IsNullOrWhiteSpace(request.RoleId))
                return Results.BadRequest("Role ID is required");
            
            var assignment = await moderatorService.AssignModeratorAsync(
                request.RoleId, channelId, request.UserId, assignedBy: 0);
            
            return Results.Created($"/api/channels/{channelId}/moderators/{assignment.Id}", new
            {
                assignment.Id,
                assignment.UserId,
                assignment.RoleId,
                assignment.AssignedAt
            });
        });

        app.MapDelete("/api/channels/{channelId}/moderators/{assignmentId}", async (
            IModeratorService moderatorService,
            int channelId,
            string assignmentId) =>
        {
            await moderatorService.RemoveModeratorAsync(assignmentId);
            return Results.NoContent();
        });

        return app;
    }
}

public record CreateRoleRequest(string Name, ModeratorPermissions Permissions);
public record UpdateRoleRequest(string? Name, ModeratorPermissions? Permissions);
public record CreateAssignmentRequest(string RoleId, int UserId);
