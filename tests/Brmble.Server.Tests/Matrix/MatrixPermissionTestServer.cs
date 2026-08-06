using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Matrix;

internal sealed class MatrixPermissionTestServer : HttpMessageHandler
{
    private const string RoomId = "!dm:server";
    private readonly HashSet<string> _joinedUsers = [];

    public string? LastRedactionActor { get; private set; }

    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        var path = request.RequestUri?.AbsolutePath ?? string.Empty;
        var actor = QueryValue(request.RequestUri, "user_id");

        if (path.EndsWith("/createRoom", StringComparison.Ordinal))
        {
            using var document = JsonDocument.Parse(await request.Content!.ReadAsStringAsync(cancellationToken));
            AssertTrustedPrivateChat(document.RootElement);
            _joinedUsers.Add(actor ?? throw new InvalidOperationException("createRoom actor missing"));

            return JsonResponse(HttpStatusCode.OK, $$"""{"room_id":"{{RoomId}}"}""");
        }

        if (path.Contains("/join/", StringComparison.Ordinal))
        {
            _joinedUsers.Add(actor ?? throw new InvalidOperationException("join actor missing"));
            return JsonResponse(HttpStatusCode.OK, "{}");
        }

        if (path.Contains("/redact/", StringComparison.Ordinal))
        {
            if (actor is null || !_joinedUsers.Contains(actor))
            {
                return JsonResponse(
                    HttpStatusCode.Forbidden,
                    """{"errcode":"M_FORBIDDEN","error":"User is not joined to the room"}""");
            }

            LastRedactionActor = actor;
            return JsonResponse(HttpStatusCode.OK, """{"event_id":"$redaction:server"}""");
        }

        return JsonResponse(HttpStatusCode.OK, "{}");
    }

    private static void AssertTrustedPrivateChat(JsonElement content)
    {
        if (content.GetProperty("preset").GetString() != "trusted_private_chat")
            throw new InvalidOperationException("DM test did not create a trusted private chat");

        var powerLevels = content.GetProperty("initial_state")
            .EnumerateArray()
            .Single(state => state.GetProperty("type").GetString() == "m.room.power_levels")
            .GetProperty("content");
        Assert.AreEqual(0, powerLevels.GetProperty("redact").GetInt32());
    }

    private static string? QueryValue(Uri? uri, string name)
    {
        if (uri is null)
            return null;

        var pair = uri.Query.TrimStart('?')
            .Split('&', StringSplitOptions.RemoveEmptyEntries)
            .Select(value => value.Split('=', 2))
            .FirstOrDefault(value => value.Length == 2 && value[0] == name);
        return pair is null ? null : Uri.UnescapeDataString(pair[1]);
    }

    private static HttpResponseMessage JsonResponse(HttpStatusCode status, string json) =>
        new(status)
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json")
        };
}
