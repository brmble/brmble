using System.Net.Http.Json;
using System.Text.Json.Serialization;

namespace Brmble.Client.Services.Moderator;

public class ModeratorRole
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public ModeratorPermissions Permissions { get; set; }
}

public class ModeratorAssignment
{
    public string Id { get; set; } = string.Empty;
    public int UserId { get; set; }
    public string RoleId { get; set; } = string.Empty;
    public int ChannelId { get; set; }
    public DateTime AssignedAt { get; set; }
}

public class ModeratorAssignmentWithRole : ModeratorAssignment
{
    public string RoleName { get; set; } = string.Empty;
    public ModeratorPermissions RolePermissions { get; set; }
}

public class ModeratorService
{
    private readonly HttpClient _http;
    private string? _baseUrl;

    public ModeratorService(HttpClient http)
    {
        _http = http;
    }

    public void SetBaseUrl(string? baseUrl)
    {
        _baseUrl = baseUrl?.TrimEnd('/');
    }

    public async Task<IReadOnlyList<ModeratorRole>> GetRolesAsync()
    {
        if (_baseUrl == null) return [];
        var response = await _http.GetAsync($"{_baseUrl}/api/admin/moderator-roles");
        response.EnsureSuccessStatusCode();
        var roles = await response.Content.ReadFromJsonAsync<List<ModeratorRole>>();
        return roles ?? [];
    }

    public async Task<ModeratorRole> CreateRoleAsync(string name, ModeratorPermissions permissions)
    {
        var response = await _http.PostAsJsonAsync($"{_baseUrl}/api/admin/moderator-roles", new { Name = name, Permissions = (int)permissions });
        response.EnsureSuccessStatusCode();
        var role = await response.Content.ReadFromJsonAsync<ModeratorRole>();
        return role ?? throw new InvalidOperationException("Failed to create role");
    }

    public async Task UpdateRoleAsync(string id, string? name, ModeratorPermissions? permissions)
    {
        var response = await _http.PutAsJsonAsync($"{_baseUrl}/api/admin/moderator-roles/{id}", new { Name = name, Permissions = permissions.HasValue ? (int)permissions.Value : (int?)null });
        response.EnsureSuccessStatusCode();
    }

    public async Task DeleteRoleAsync(string id)
    {
        var response = await _http.DeleteAsync($"{_baseUrl}/api/admin/moderator-roles/{id}");
        response.EnsureSuccessStatusCode();
    }

    public async Task<IReadOnlyList<ModeratorAssignmentWithRole>> GetChannelModeratorsAsync(int channelId)
    {
        if (_baseUrl == null) return [];
        var response = await _http.GetAsync($"{_baseUrl}/api/channels/{channelId}/moderators");
        response.EnsureSuccessStatusCode();
        var moderators = await response.Content.ReadFromJsonAsync<List<ModeratorAssignmentWithRole>>();
        return moderators ?? [];
    }

    public async Task<ModeratorAssignment> AssignModeratorAsync(string roleId, int channelId, int userId)
    {
        var response = await _http.PostAsJsonAsync($"{_baseUrl}/api/channels/{channelId}/moderators", new { RoleId = roleId, UserId = userId });
        response.EnsureSuccessStatusCode();
        var assignment = await response.Content.ReadFromJsonAsync<ModeratorAssignment>();
        return assignment ?? throw new InvalidOperationException("Failed to assign moderator");
    }

    public async Task RemoveModeratorAsync(string assignmentId, int channelId)
    {
        var response = await _http.DeleteAsync($"{_baseUrl}/api/channels/{channelId}/moderators/{assignmentId}");
        response.EnsureSuccessStatusCode();
    }

    public async Task<ModeratorPermissions> GetUserPermissionsForChannelAsync(int userId, int channelId)
    {
        if (_baseUrl == null) return ModeratorPermissions.None;
        var moderators = await GetChannelModeratorsAsync(channelId);
        var userMod = moderators.FirstOrDefault(m => m.UserId == userId);
        return userMod?.RolePermissions ?? ModeratorPermissions.None;
    }
}
