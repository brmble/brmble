using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace Brmble.Server.Matrix;

public interface IMatrixAppService
{
    Task SendMessage(string roomId, string displayName, string text);
    Task<string> CreateRoom(string name);
    Task SetRoomName(string roomId, string name);
    Task<string> RegisterUser(string localpart, string displayName);
    Task<string> LoginUser(string localpart);
    Task EnsureUserInRooms(string localpart, IEnumerable<string> roomIds);
    Task SetDisplayName(string localpart, string displayName);
}

public class MatrixAppService : IMatrixAppService
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly string _homeserverUrl;
    private readonly string _appServiceToken;
    private readonly string _botUserId;
    private readonly string _serverDomain;
    private readonly ILogger<MatrixAppService> _logger;

    public MatrixAppService(IHttpClientFactory httpClientFactory, IOptions<MatrixSettings> settings, ILogger<MatrixAppService> logger)
    {
        _httpClientFactory = httpClientFactory;
        _homeserverUrl = settings.Value.HomeserverUrl;
        _appServiceToken = settings.Value.AppServiceToken;
        _serverDomain = settings.Value.ServerDomain;
        _botUserId = $"@brmble:{_serverDomain}";
        _logger = logger;
    }

    public async Task SendMessage(string roomId, string displayName, string text)
    {
        var txnId = Guid.NewGuid().ToString("N");
        var url = $"{_homeserverUrl}/_matrix/client/v3/rooms/{Uri.EscapeDataString(roomId)}/send/m.room.message/{txnId}";
        var body = JsonSerializer.Serialize(new
        {
            msgtype = "m.text",
            body = $"[{displayName}]: {text}"
        });
        await SendRequest(HttpMethod.Put, url, body);
    }

    public async Task<string> CreateRoom(string name)
    {
        var url = $"{_homeserverUrl}/_matrix/client/v3/createRoom";
        var body = JsonSerializer.Serialize(new
        {
            name,
            preset = "private_chat"
        });
        var response = await SendRequest(HttpMethod.Post, url, body);
        var json = JsonSerializer.Deserialize<JsonElement>(response);
        return json.GetProperty("room_id").GetString()
            ?? throw new InvalidOperationException("Matrix did not return a room_id");
    }

    public async Task SetRoomName(string roomId, string name)
    {
        var url = $"{_homeserverUrl}/_matrix/client/v3/rooms/{Uri.EscapeDataString(roomId)}/state/m.room.name";
        var body = JsonSerializer.Serialize(new { name });
        await SendRequest(HttpMethod.Put, url, body);
    }

    public async Task<string> RegisterUser(string localpart, string displayName)
    {
        var url = $"{_homeserverUrl}/_matrix/client/v3/register?kind=user";
        var body = JsonSerializer.Serialize(new { type = "m.login.application_service", username = localpart });
        var response = await SendRequestCore(HttpMethod.Post, url, body, userId: null);
        var json = JsonSerializer.Deserialize<JsonElement>(response);
        var accessToken = json.GetProperty("access_token").GetString()
            ?? throw new InvalidOperationException("Matrix did not return an access_token");

        // Set display name on the Matrix profile (best-effort; don't fail registration if this fails)
        if (!string.IsNullOrEmpty(displayName))
        {
            var userId = $"@{localpart}:{_serverDomain}";
            var nameUrl = $"{_homeserverUrl}/_matrix/client/v3/profile/{Uri.EscapeDataString(userId)}/displayname";
            var nameBody = JsonSerializer.Serialize(new { displayname = displayName });
            try
            {
                await SendRequest(HttpMethod.Put, nameUrl, nameBody, actAs: userId);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to set Matrix display name for user {UserId}", userId);
            }
        }

        return accessToken;
    }

    public async Task<string> LoginUser(string localpart)
    {
        var url = $"{_homeserverUrl}/_matrix/client/v3/login";
        var body = JsonSerializer.Serialize(new
        {
            type = "m.login.application_service",
            identifier = new { type = "m.id.user", user = $"@{localpart}:{_serverDomain}" }
        });
        var response = await SendRequest(HttpMethod.Post, url, body);
        var json = JsonSerializer.Deserialize<JsonElement>(response);
        return json.GetProperty("access_token").GetString()
            ?? throw new InvalidOperationException("Matrix did not return an access_token");
    }

    public async Task EnsureUserInRooms(string localpart, IEnumerable<string> roomIds)
    {
        var userId = $"@{localpart}:{_serverDomain}";

        // Fetch rooms the user has already joined to avoid redundant invite+join calls
        var alreadyJoined = new HashSet<string>();
        try
        {
            var joinedRoomsUrl = $"{_homeserverUrl}/_matrix/client/v3/joined_rooms";
            var joinedResponse = await SendRequest(HttpMethod.Get, joinedRoomsUrl, "{}", actAs: userId);
            var joinedJson = JsonSerializer.Deserialize<JsonElement>(joinedResponse);
            if (joinedJson.TryGetProperty("joined_rooms", out var arr))
            {
                foreach (var r in arr.EnumerateArray())
                {
                    var id = r.GetString();
                    if (id is not null) alreadyJoined.Add(id);
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug("Could not fetch joined rooms for {UserId}, will attempt all invites: {Error}", userId, ex.Message);
        }

        foreach (var roomId in roomIds)
        {
            if (alreadyJoined.Contains(roomId))
            {
                _logger.LogDebug("User {UserId} already in {RoomId}, skipping invite+join", userId, roomId);
                continue;
            }

            try
            {
                // Invite via appservice bot
                var inviteUrl = $"{_homeserverUrl}/_matrix/client/v3/rooms/{Uri.EscapeDataString(roomId)}/invite";
                var inviteBody = JsonSerializer.Serialize(new { user_id = userId });
                await SendRequest(HttpMethod.Post, inviteUrl, inviteBody);
            }
            catch (Exception ex)
            {
                // Already invited or joined — ignore
                _logger.LogDebug("Invite {UserId} to {RoomId} skipped: {Error}", userId, roomId, ex.Message);
            }

            try
            {
                // Join as the user (appservice can act on behalf of managed users)
                var joinUrl = $"{_homeserverUrl}/_matrix/client/v3/join/{Uri.EscapeDataString(roomId)}";
                await SendRequest(HttpMethod.Post, joinUrl, "{}", actAs: userId);
            }
            catch (Exception ex)
            {
                _logger.LogWarning("Failed to join {UserId} to {RoomId}: {Error}", userId, roomId, ex.Message);
            }
        }
    }

    public async Task SetDisplayName(string localpart, string displayName)
    {
        var userId = $"@{localpart}:{_serverDomain}";
        var url = $"{_homeserverUrl}/_matrix/client/v3/profile/{Uri.EscapeDataString(userId)}/displayname";
        var body = JsonSerializer.Serialize(new { displayname = displayName });
        await SendRequest(HttpMethod.Put, url, body, actAs: userId);
    }

    private Task<string> SendRequest(HttpMethod method, string url, string jsonBody, string? actAs = null)
        => SendRequestCore(method, url, jsonBody, actAs ?? _botUserId);

    private async Task<string> SendRequestCore(HttpMethod method, string url, string jsonBody, string? userId)
    {
        var client = _httpClientFactory.CreateClient();
        var urlWithUser = userId is not null
            ? $"{url}{(url.Contains('?') ? '&' : '?')}user_id={Uri.EscapeDataString(userId)}"
            : url;
        var request = new HttpRequestMessage(method, urlWithUser)
        {
            Content = new StringContent(jsonBody, Encoding.UTF8, "application/json")
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _appServiceToken);
        _logger.LogDebug("Matrix request: {Method} {Url}", method, urlWithUser);
        var response = await client.SendAsync(request);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync();
            _logger.LogError("Matrix request failed: {Method} {Url} → {Status} {Body}", method, urlWithUser, (int)response.StatusCode, body);
        }
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadAsStringAsync();
    }
}
