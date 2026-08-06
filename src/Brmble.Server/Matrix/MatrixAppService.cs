using System.Net.Http.Headers;
using System.Net;
using System.Text;
using System.Text.Json;
using Brmble.Server.Paint;
using Microsoft.Extensions.Options;

namespace Brmble.Server.Matrix;

public interface IMatrixAppService
{
    Task SendMessage(string roomId, string displayName, string text, string? authorMatrixUserId = null);
    Task<string> CreateRoom(string name);
    Task<string> CreatePaintRoom(string name, IReadOnlyList<string> invitedMatrixUserIds);
    Task<string> CreateCustomCompanionGalleryRoom();
    Task<string> CreateDMRoom(string localpartA, string localpartB);
    Task SetRoomName(string roomId, string name);
    Task<string> RegisterUser(string localpart, string displayName);
    Task<string> LoginUser(string localpart);
    Task EnsureUserInRooms(string localpart, IEnumerable<string> roomIds);
    Task<bool> EnsureUserInRoom(string localpart, string roomId);
    Task SetDisplayName(string localpart, string displayName);
    Task SetAvatarUrl(string localpart, string avatarUrl);
    Task<string> UploadMedia(byte[] data, string contentType, string fileName);
    Task SendImageMessage(string roomId, string displayName, string mxcUrl, string fileName, string mimetype, int size, string? authorMatrixUserId = null);
    Task SetAccountData(string localpart, string eventType, string jsonContent);
    Task<string?> GetAccountData(string localpart, string eventType);
    Task<string> SendStateEvent(string roomId, string eventType, string stateKey, string jsonContent);
    Task RedactRoomEvent(string roomId, string eventId, string reason);
    Task InvitePaintUser(string roomId, string matrixUserId);
    Task<JsonElement> GetRoomEvent(string roomId, string eventId);
    Task<string?> GetRoomMembership(string roomId, string matrixUserId);
    Task<byte[]> DownloadMedia(string mxcUrl, CancellationToken cancellationToken);
    Task<byte[]> DownloadMedia(string mxcUrl, long maxBytes, CancellationToken cancellationToken)
        => DownloadMedia(mxcUrl, cancellationToken);
    Task<MatrixPaintRoomCleanupResult> DeletePaintRoomAsync(string roomId, CancellationToken cancellationToken);
}

public class MatrixAppService : IMatrixAppService
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly string _homeserverUrl;
    private readonly string _appServiceToken;
    private readonly string? _adminAccessToken;
    private readonly string _botUserId;
    private readonly string _serverDomain;
    private readonly ILogger<MatrixAppService> _logger;

    public MatrixAppService(IHttpClientFactory httpClientFactory, IOptions<MatrixSettings> settings, ILogger<MatrixAppService> logger)
    {
        _httpClientFactory = httpClientFactory;
        _homeserverUrl = settings.Value.HomeserverUrl;
        _appServiceToken = settings.Value.AppServiceToken;
        _adminAccessToken = settings.Value.AdminAccessToken;
        _serverDomain = settings.Value.ServerDomain;
        _botUserId = $"@brmble:{_serverDomain}";
        _logger = logger;
        if (string.IsNullOrWhiteSpace(_adminAccessToken))
        {
            _logger.LogWarning("Matrix admin access token is not configured. Paint room cleanup cannot delete rooms and will be terminal. Configure Matrix__AdminAccessToken.");
        }
    }

    public async Task SendMessage(string roomId, string displayName, string text, string? authorMatrixUserId = null)
    {
        var txnId = Guid.NewGuid().ToString("N");
        var url = $"{_homeserverUrl}/_matrix/client/v3/rooms/{roomId}/send/m.room.message/{txnId}";
        var content = new Dictionary<string, object?>
        {
            ["msgtype"] = "m.text",
            ["body"] = $"[{displayName}]: {text}",
        };
        if (!string.IsNullOrWhiteSpace(authorMatrixUserId))
            content["com.brmble.author_matrix_user_id"] = authorMatrixUserId;

        var body = JsonSerializer.Serialize(content);
        await SendRequest(HttpMethod.Put, url, body);
    }

    public async Task<string> CreateRoom(string name)
    {
        var url = $"{_homeserverUrl}/_matrix/client/v3/createRoom";
        var body = JsonSerializer.Serialize(new
        {
            name,
            preset = "private_chat",
        });
        var response = await SendRequest(HttpMethod.Post, url, body);
        var json = JsonSerializer.Deserialize<JsonElement>(response);
        return json.GetProperty("room_id").GetString()
            ?? throw new InvalidOperationException("Matrix did not return a room_id");
    }

    public async Task<string> CreatePaintRoom(string name, IReadOnlyList<string> invitedMatrixUserIds)
    {
        var url = $"{_homeserverUrl}/_matrix/client/v3/createRoom";
        var body = JsonSerializer.Serialize(new
        {
            name,
            preset = "private_chat",
            invite = invitedMatrixUserIds,
            initial_state = new object[]
            {
                new { type = "m.room.join_rules", content = new { join_rule = "invite" } },
                new { type = "m.room.history_visibility", content = new { history_visibility = "invited" } },
                new { type = "m.room.power_levels", content = new { users_default = 0, invite = 50, users = new Dictionary<string, int> { [_botUserId] = 100 } } },
            },
        });
        var response = await SendRequest(HttpMethod.Post, url, body);
        var json = JsonSerializer.Deserialize<JsonElement>(response);
        return json.GetProperty("room_id").GetString()
            ?? throw new InvalidOperationException("Matrix did not return a room_id");
    }

    public async Task<string> CreateCustomCompanionGalleryRoom()
    {
        var url = $"{_homeserverUrl}/_matrix/client/v3/createRoom";
        var body = JsonSerializer.Serialize(new
        {
            name = "Brmble Custom Companions",
            preset = "private_chat",
            is_direct = false,
            initial_state = new object[]
            {
                new { type = "m.room.join_rules", content = new { join_rule = "invite" } },
                new { type = "m.room.history_visibility", content = new { history_visibility = "joined" } },
                new
                {
                    type = "m.room.power_levels",
                    content = new
                    {
                        users_default = 0,
                        events_default = 100,
                        state_default = 100,
                        invite = 100,
                        kick = 100,
                        ban = 100,
                        redact = 100,
                        users = new Dictionary<string, int> { [_botUserId] = 100 }
                    }
                }
            }
        });
        var response = await SendRequest(HttpMethod.Post, url, body);
        var json = JsonSerializer.Deserialize<JsonElement>(response);
        return json.GetProperty("room_id").GetString()
            ?? throw new InvalidOperationException("Matrix did not return a room_id");
    }

    public async Task SetRoomName(string roomId, string name)
    {
        var url = $"{_homeserverUrl}/_matrix/client/v3/rooms/{roomId}/state/m.room.name";
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
            identifier = new { type = "m.id.user", user = $"@{localpart}:{_serverDomain}" },
        });
        var response = await SendRequest(HttpMethod.Post, url, body);
        var json = JsonSerializer.Deserialize<JsonElement>(response);
        return json.GetProperty("access_token").GetString()
            ?? throw new InvalidOperationException("Matrix did not return an access_token");
    }

    public async Task EnsureUserInRooms(string localpart, IEnumerable<string> roomIds)
    {
        var userId = $"@{localpart}:{_serverDomain}";

        var alreadyJoined = new HashSet<string>();
        try
        {
            var joinedRoomsUrl = $"{_homeserverUrl}/_matrix/client/v3/joined_rooms";
            var joinedResponse = await SendRequest(HttpMethod.Get, joinedRoomsUrl, "{}", actAs: userId);
            var joinedJson = JsonSerializer.Deserialize<JsonElement>(joinedResponse);
            if (joinedJson.TryGetProperty("joined_rooms", out var arr))
            {
                foreach (var room in arr.EnumerateArray())
                {
                    var id = room.GetString();
                    if (id is not null)
                    {
                        alreadyJoined.Add(id);
                    }
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
                await InviteUserToRoom(roomId, userId);
            }
            catch (Exception ex)
            {
                _logger.LogDebug("Invite {UserId} to {RoomId} skipped: {Error}", userId, roomId, ex.Message);
            }

            try
            {
                var joinUrl = $"{_homeserverUrl}/_matrix/client/v3/join/{Uri.EscapeDataString(roomId)}";
                await SendRequest(HttpMethod.Post, joinUrl, "{}", actAs: userId);
            }
            catch (Exception ex)
            {
                _logger.LogWarning("Failed to join {UserId} to {RoomId}: {Error}", userId, roomId, ex.Message);
            }
        }
    }

    public async Task<bool> EnsureUserInRoom(string localpart, string roomId)
    {
        var userId = $"@{localpart}:{_serverDomain}";
        try
        {
            var joinedRoomsUrl = $"{_homeserverUrl}/_matrix/client/v3/joined_rooms";
            var joinedResponse = await SendRequest(HttpMethod.Get, joinedRoomsUrl, "{}", actAs: userId);
            var joinedJson = JsonSerializer.Deserialize<JsonElement>(joinedResponse);
            if (joinedJson.TryGetProperty("joined_rooms", out var rooms)
                && rooms.EnumerateArray().Any(room => room.GetString() == roomId))
            {
                return true;
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug("Could not fetch joined rooms for {UserId}: {Error}", userId, ex.Message);
        }

        try
        {
            await InviteUserToRoom(roomId, userId);
            var joinUrl = $"{_homeserverUrl}/_matrix/client/v3/join/{Uri.EscapeDataString(roomId)}";
            await SendRequest(HttpMethod.Post, joinUrl, "{}", actAs: userId);
            return true;
        }
        catch (Exception ex)
        {
            _logger.LogWarning("Failed to invite and join {UserId} to {RoomId}: {Error}", userId, roomId, ex.Message);
            return false;
        }
    }

    public async Task SetDisplayName(string localpart, string displayName)
    {
        var userId = $"@{localpart}:{_serverDomain}";
        var url = $"{_homeserverUrl}/_matrix/client/v3/profile/{Uri.EscapeDataString(userId)}/displayname";
        var body = JsonSerializer.Serialize(new { displayname = displayName });
        await SendRequest(HttpMethod.Put, url, body, actAs: userId);
    }

    public async Task SetAvatarUrl(string localpart, string avatarUrl)
    {
        var userId = $"@{localpart}:{_serverDomain}";
        var url = $"{_homeserverUrl}/_matrix/client/v3/profile/{Uri.EscapeDataString(userId)}/avatar_url";
        var body = JsonSerializer.Serialize(new { avatar_url = avatarUrl });
        await SendRequest(HttpMethod.Put, url, body, actAs: userId);
    }

    public async Task<string> UploadMedia(byte[] data, string contentType, string fileName)
    {
        var url = $"{_homeserverUrl}/_matrix/media/v3/upload?filename={Uri.EscapeDataString(fileName)}";
        var client = _httpClientFactory.CreateClient();
        var urlWithUser = $"{url}&user_id={Uri.EscapeDataString(_botUserId)}";
        var request = new HttpRequestMessage(HttpMethod.Post, urlWithUser)
        {
            Content = new ByteArrayContent(data),
        };
        request.Content.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _appServiceToken);
        _logger.LogDebug("Matrix upload: POST {Url} ({Size} bytes)", urlWithUser, data.Length);
        var response = await client.SendAsync(request);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync();
            _logger.LogError("Matrix upload failed: {Status} {Body}", (int)response.StatusCode, body);
        }

        response.EnsureSuccessStatusCode();
        var responseBody = await response.Content.ReadAsStringAsync();
        var json = JsonSerializer.Deserialize<JsonElement>(responseBody);
        return json.GetProperty("content_uri").GetString()
            ?? throw new InvalidOperationException("Matrix did not return a content_uri");
    }

    public async Task SendImageMessage(string roomId, string displayName, string mxcUrl, string fileName, string mimetype, int size, string? authorMatrixUserId = null)
    {
        var txnId = Guid.NewGuid().ToString("N");
        var url = $"{_homeserverUrl}/_matrix/client/v3/rooms/{roomId}/send/m.room.message/{txnId}";
        var content = new Dictionary<string, object?>
        {
            ["msgtype"] = "m.image",
            ["body"] = $"[{displayName}]: {fileName}",
            ["url"] = mxcUrl,
            ["info"] = new { mimetype, size },
        };
        if (!string.IsNullOrWhiteSpace(authorMatrixUserId))
            content["com.brmble.author_matrix_user_id"] = authorMatrixUserId;

        var body = JsonSerializer.Serialize(content);
        await SendRequest(HttpMethod.Put, url, body);
    }

    public async Task<string> CreateDMRoom(string localpartA, string localpartB)
    {
        var userIdA = $"@{localpartA}:{_serverDomain}";
        var userIdB = $"@{localpartB}:{_serverDomain}";

        var url = $"{_homeserverUrl}/_matrix/client/v3/createRoom";
        var body = JsonSerializer.Serialize(new
        {
            is_direct = true,
            preset = "trusted_private_chat",
            invite = new[] { userIdB },
        });
        var response = await SendRequest(HttpMethod.Post, url, body, actAs: userIdA);
        var json = JsonSerializer.Deserialize<JsonElement>(response);
        var roomId = json.GetProperty("room_id").GetString()
            ?? throw new InvalidOperationException("Matrix did not return a room_id");

        try
        {
            var joinUrl = $"{_homeserverUrl}/_matrix/client/v3/join/{Uri.EscapeDataString(roomId)}";
            await SendRequest(HttpMethod.Post, joinUrl, "{}", actAs: userIdB);
        }
        catch (Exception ex)
        {
            _logger.LogWarning("Failed to auto-join {UserB} to DM room {RoomId}: {Error}", userIdB, roomId, ex.Message);
        }

        return roomId;
    }

    public async Task SetAccountData(string localpart, string eventType, string jsonContent)
    {
        var userId = $"@{localpart}:{_serverDomain}";
        var url = $"{_homeserverUrl}/_matrix/client/v3/user/{Uri.EscapeDataString(userId)}/account_data/{Uri.EscapeDataString(eventType)}";
        await SendRequest(HttpMethod.Put, url, jsonContent, actAs: userId);
    }

    public async Task<string?> GetAccountData(string localpart, string eventType)
    {
        var userId = $"@{localpart}:{_serverDomain}";
        var url = $"{_homeserverUrl}/_matrix/client/v3/user/{Uri.EscapeDataString(userId)}/account_data/{Uri.EscapeDataString(eventType)}";
        try
        {
            return await SendRequest(HttpMethod.Get, url, "{}", actAs: userId);
        }
        catch (Exception)
        {
            return null;
        }
    }

    public async Task<string> SendStateEvent(string roomId, string eventType, string stateKey, string jsonContent)
    {
        var url = $"{_homeserverUrl}/_matrix/client/v3/rooms/{Uri.EscapeDataString(roomId)}/state/{Uri.EscapeDataString(eventType)}/{Uri.EscapeDataString(stateKey)}";
        var response = await SendRequest(HttpMethod.Put, url, jsonContent);
        var json = JsonSerializer.Deserialize<JsonElement>(response);
        return json.GetProperty("event_id").GetString()
            ?? throw new InvalidOperationException("Matrix did not return an event_id");
    }

    public Task RedactRoomEvent(string roomId, string eventId, string reason)
    {
        var txnId = Guid.NewGuid().ToString("N");
        var url = $"{_homeserverUrl}/_matrix/client/v3/rooms/{Uri.EscapeDataString(roomId)}/redact/{Uri.EscapeDataString(eventId)}/{txnId}";
        var body = JsonSerializer.Serialize(new { reason });
        return SendRequest(HttpMethod.Put, url, body);
    }

    public Task InvitePaintUser(string roomId, string matrixUserId)
    {
        return InviteUserToRoom(roomId, matrixUserId);
    }

    public async Task<JsonElement> GetRoomEvent(string roomId, string eventId)
    {
        var url = $"{_homeserverUrl}/_matrix/client/v3/rooms/{Uri.EscapeDataString(roomId)}/event/{Uri.EscapeDataString(eventId)}";
        var response = await SendRequest(HttpMethod.Get, url, "{}");
        return JsonSerializer.Deserialize<JsonElement>(response);
    }

    public async Task<string?> GetRoomMembership(string roomId, string matrixUserId)
    {
        var url = $"{_homeserverUrl}/_matrix/client/v3/rooms/{Uri.EscapeDataString(roomId)}/state/m.room.member/{Uri.EscapeDataString(matrixUserId)}";
        try
        {
            var response = await SendRequest(HttpMethod.Get, url, "{}");
            var json = JsonSerializer.Deserialize<JsonElement>(response);
            return json.TryGetProperty("membership", out var membership)
                ? membership.GetString()
                : null;
        }
        catch (HttpRequestException)
        {
            return null;
        }
    }

    public Task<byte[]> DownloadMedia(string mxcUrl, CancellationToken cancellationToken)
        => DownloadMedia(mxcUrl, long.MaxValue, cancellationToken);

    public async Task<byte[]> DownloadMedia(string mxcUrl, long maxBytes, CancellationToken cancellationToken)
    {
        var uri = new Uri(mxcUrl);
        var mediaId = uri.AbsolutePath.Trim('/');
        var url = $"{_homeserverUrl}/_matrix/media/v3/download/{Uri.EscapeDataString(uri.Authority)}/{mediaId}";
        var client = _httpClientFactory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _appServiceToken);
        using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        response.EnsureSuccessStatusCode();
        if (response.Content.Headers.ContentLength is long declaredLength && declaredLength > maxBytes)
        {
            throw new InvalidDataException("Matrix media exceeds the permitted size.");
        }

        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var bytes = new MemoryStream();
        var buffer = new byte[81920];
        long totalBytes = 0;
        int read;
        while ((read = await stream.ReadAsync(buffer, cancellationToken)) > 0)
        {
            totalBytes += read;
            if (totalBytes > maxBytes)
            {
                throw new InvalidDataException("Matrix media exceeds the permitted size.");
            }
            bytes.Write(buffer, 0, read);
        }

        return bytes.ToArray();
    }

    public async Task<MatrixPaintRoomCleanupResult> DeletePaintRoomAsync(string roomId, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(_adminAccessToken))
        {
            return new(false, "admin-token-missing", "MATRIX_ADMIN_TOKEN_MISSING", true);
        }

        var client = _httpClientFactory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Delete, $"{_homeserverUrl}/_synapse/admin/v2/rooms/{Uri.EscapeDataString(roomId)}");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _adminAccessToken);

        try
        {
            var response = await client.SendAsync(request, cancellationToken);
            if (response.IsSuccessStatusCode)
            {
                return new(true, "admin-delete", null);
            }

            var error = await response.Content.ReadAsStringAsync(cancellationToken);
            if (response.StatusCode == HttpStatusCode.NotFound && IsMatrixRoomNotFound(error))
            {
                return new(true, "admin-delete-already-absent", null);
            }
            return new(false, "failed", string.IsNullOrWhiteSpace(error) ? response.ReasonPhrase : error);
        }
        // Shutdown is not a cleanup failure. Reporting it as one would let the caller burn a
        // retry attempt per host restart and eventually mark the record terminal, leaking the room.
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            return new(false, "failed", ex.Message);
        }
    }

    private static bool IsMatrixRoomNotFound(string error)
    {
        try
        {
            using var document = JsonDocument.Parse(error);
            return document.RootElement.TryGetProperty("errcode", out var code)
                && code.GetString() == "M_NOT_FOUND";
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private Task<string> SendRequest(HttpMethod method, string url, string jsonBody, string? actAs = null)
        => SendRequestCore(method, url, jsonBody, actAs ?? _botUserId);

    private Task<string> SendRequestWithCancellation(HttpMethod method, string url, string jsonBody, CancellationToken cancellationToken, string? actAs = null)
        => SendRequestCore(method, url, jsonBody, actAs ?? _botUserId, cancellationToken);

    private async Task<string> SendRequestCore(HttpMethod method, string url, string jsonBody, string? userId, CancellationToken cancellationToken = default)
    {
        var client = _httpClientFactory.CreateClient();
        var urlWithUser = userId is not null
            ? $"{url}{(url.Contains('?') ? '&' : '?')}user_id={Uri.EscapeDataString(userId)}"
            : url;
        var request = new HttpRequestMessage(method, urlWithUser);
        if (method != HttpMethod.Get)
        {
            request.Content = new StringContent(jsonBody, Encoding.UTF8, "application/json");
        }

        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _appServiceToken);
        _logger.LogDebug("Matrix request: {Method} {Url}", method, urlWithUser);
        var response = await client.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            _logger.LogError("Matrix request failed: {Method} {Url} -> {Status} {Body}", method, urlWithUser, (int)response.StatusCode, body);
        }

        response.EnsureSuccessStatusCode();
        return await response.Content.ReadAsStringAsync(cancellationToken);
    }

    private Task LeaveRoomAsBotAsync(string roomId, CancellationToken cancellationToken)
    {
        var url = $"{_homeserverUrl}/_matrix/client/v3/rooms/{Uri.EscapeDataString(roomId)}/leave";
        return SendRequestWithCancellation(HttpMethod.Post, url, "{}", cancellationToken);
    }

    private Task InviteUserToRoom(string roomId, string matrixUserId)
    {
        var inviteUrl = $"{_homeserverUrl}/_matrix/client/v3/rooms/{Uri.EscapeDataString(roomId)}/invite";
        var inviteBody = JsonSerializer.Serialize(new { user_id = matrixUserId });
        return SendRequest(HttpMethod.Post, inviteUrl, inviteBody);
    }
}
