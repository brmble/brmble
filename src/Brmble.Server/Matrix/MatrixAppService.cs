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
}

public class MatrixAppService : IMatrixAppService
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly string _homeserverUrl;
    private readonly string _appServiceToken;

    private readonly string _botUserId;

    public MatrixAppService(IHttpClientFactory httpClientFactory, IOptions<MatrixSettings> settings)
    {
        _httpClientFactory = httpClientFactory;
        _homeserverUrl = settings.Value.HomeserverUrl;
        _appServiceToken = settings.Value.AppServiceToken;
        _botUserId = $"@brmble:{settings.Value.ServerDomain}";
    }

    public async Task SendMessage(string roomId, string displayName, string text)
    {
        var txnId = Guid.NewGuid().ToString("N");
        var url = $"{_homeserverUrl}/_matrix/client/v3/rooms/{roomId}/send/m.room.message/{txnId}";
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
        var url = $"{_homeserverUrl}/_matrix/client/v3/rooms/{roomId}/state/m.room.name";
        var body = JsonSerializer.Serialize(new { name });
        await SendRequest(HttpMethod.Put, url, body);
    }

    private async Task<string> SendRequest(HttpMethod method, string url, string jsonBody)
    {
        var client = _httpClientFactory.CreateClient();
        var urlWithUser = $"{url}{(url.Contains('?') ? '&' : '?')}user_id={Uri.EscapeDataString(_botUserId)}";
        var request = new HttpRequestMessage(method, urlWithUser)
        {
            Content = new StringContent(jsonBody, Encoding.UTF8, "application/json")
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _appServiceToken);
        var response = await client.SendAsync(request);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadAsStringAsync();
    }
}
