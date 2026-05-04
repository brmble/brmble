using System.Collections.Concurrent;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Text.Json;
using Brmble.Client.Bridge;
using Brmble.Client.Services.Voice;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services;

internal static class NativeBridgeTestHarness
{
    public static NativeBridge Create()
    {
        var bridge = (NativeBridge)RuntimeHelpers.GetUninitializedObject(typeof(NativeBridge));
        SetField(bridge, "_handlers", new Dictionary<string, List<Func<JsonElement, Task>>>());
        SetField(bridge, "_pendingMessages", new ConcurrentQueue<string>());
        return bridge;
    }

    public static async Task InvokeAsync(NativeBridge bridge, string type, JsonElement data)
    {
        var handlers = (Dictionary<string, List<Func<JsonElement, Task>>>)GetField(bridge, "_handlers");
        foreach (var handler in handlers[type])
            await handler(data);
    }

    public static List<(string Type, string DataJson)> DrainMessages(NativeBridge bridge)
    {
        var queue = (ConcurrentQueue<string>)GetField(bridge, "_pendingMessages");
        var result = new List<(string Type, string DataJson)>();

        while (queue.TryDequeue(out var json))
        {
            using var doc = JsonDocument.Parse(json);
            var type = doc.RootElement.GetProperty("type").GetString() ?? string.Empty;
            var dataJson = doc.RootElement.GetProperty("data").GetRawText();
            result.Add((type, dataJson));
        }

        return result;
    }

    private static object GetField(object instance, string name)
        => instance.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(instance)!;

    private static void SetField(object instance, string name, object? value)
        => instance.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)!.SetValue(instance, value);
}

internal static class MumbleAdapterTestHarness
{
    public static MumbleAdapter CreateWithBridge(NativeBridge bridge, string? apiUrl = null)
    {
        var adapter = (MumbleAdapter)RuntimeHelpers.GetUninitializedObject(typeof(MumbleAdapter));
        SetField(adapter, "_bridge", bridge);
        SetField(adapter, "_apiUrl", apiUrl);
        return adapter;
    }

    private static void SetField(object instance, string name, object? value)
        => instance.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)!.SetValue(instance, value);
}

[TestClass]
public class MumbleAdapterParseTests
{
    [TestMethod]
    public async Task ActiveShareFailure_IsNotCollapsedIntoEmptyShares()
    {
        var bridge = NativeBridgeTestHarness.Create();
        var adapter = MumbleAdapterTestHarness.CreateWithBridge(bridge, apiUrl: "https://api.example.com");
        adapter.RegisterHandlers(bridge);

        using var doc = JsonDocument.Parse("""
        {
            "roomName": "channel-1"
        }
        """);

        await NativeBridgeTestHarness.InvokeAsync(bridge, "livekit.checkActiveShare", doc.RootElement.Clone());
        var sent = NativeBridgeTestHarness.DrainMessages(bridge);

        Assert.IsTrue(sent.Any(x => x.Type == "livekit.activeShareError"));
        Assert.IsFalse(sent.Any(x => x.Type == "livekit.activeShareResult" && x.DataJson.Contains("\"shares\"")));
    }

    [TestMethod]
    public void ParseBrmbleApiUrl_ValidComment_ReturnsUrl()
    {
        var text = """Welcome!<!--brmble:{"apiUrl":"https://noscope.it:1912"}-->""";
        Assert.AreEqual("https://noscope.it:1912", MumbleAdapter.ParseBrmbleApiUrl(text));
    }

    [TestMethod]
    public void ParseBrmbleApiUrl_NoComment_ReturnsNull()
    {
        Assert.IsNull(MumbleAdapter.ParseBrmbleApiUrl("Welcome to the server!"));
    }

    [TestMethod]
    public void ParseBrmbleApiUrl_NullInput_ReturnsNull()
    {
        Assert.IsNull(MumbleAdapter.ParseBrmbleApiUrl(null));
    }

    [TestMethod]
    public void ParseBrmbleApiUrl_MalformedJson_ReturnsNull()
    {
        Assert.IsNull(MumbleAdapter.ParseBrmbleApiUrl("<!--brmble:{bad json}-->"));
    }

    [TestMethod]
    public void ParseBrmbleApiUrl_CommentWithHtmlAround_ReturnsUrl()
    {
        var text = "<b>Welcome!</b>\n<!--brmble:{\"apiUrl\":\"https://example.com\"}-->\n<p>Enjoy</p>";
        Assert.AreEqual("https://example.com", MumbleAdapter.ParseBrmbleApiUrl(text));
    }

    [TestMethod]
    public void ParseBrmbleApiUrl_SingleQuotedJson_ReturnsUrl()
    {
        var text = "Welcome!<!--brmble:{'apiUrl':'https://noscope.it:1912'}-->";
        Assert.AreEqual("https://noscope.it:1912", MumbleAdapter.ParseBrmbleApiUrl(text));
    }

    [TestMethod]
    public void ParseSessionMappings_WithIsBrmbleClient_RoundTrips()
    {
        var json = JsonDocument.Parse("""
        {
            "1": { "matrixUserId": "@alice:localhost", "mumbleName": "Alice", "isBrmbleClient": true },
            "2": { "matrixUserId": "@bob:localhost", "mumbleName": "Bob", "isBrmbleClient": false }
        }
        """);

        var result = MumbleAdapter.ParseSessionMappings(json.RootElement);

        Assert.AreEqual(2, result.Count);
        Assert.IsTrue(result[1].IsBrmbleClient, "Alice should be a Brmble client");
        Assert.IsFalse(result[2].IsBrmbleClient, "Bob should not be a Brmble client");
        Assert.AreEqual("@alice:localhost", result[1].MatrixUserId);
        Assert.AreEqual("Bob", result[2].MumbleName);
    }

    [TestMethod]
    public void ParseSessionMappings_MissingIsBrmbleClient_DefaultsToFalse()
    {
        var json = JsonDocument.Parse("""
        {
            "5": { "matrixUserId": "@user:localhost", "mumbleName": "User" }
        }
        """);

        var result = MumbleAdapter.ParseSessionMappings(json.RootElement);

        Assert.AreEqual(1, result.Count);
        Assert.IsFalse(result[5].IsBrmbleClient, "Missing isBrmbleClient should default to false");
    }

    [TestMethod]
    public void ParseSessionMappings_SkipsEntriesWithMissingRequiredFields()
    {
        var json = JsonDocument.Parse("""
        {
            "1": { "matrixUserId": "@alice:localhost" },
            "2": { "mumbleName": "Bob" },
            "3": { "matrixUserId": "@charlie:localhost", "mumbleName": "Charlie" }
        }
        """);

        var result = MumbleAdapter.ParseSessionMappings(json.RootElement);

        Assert.AreEqual(1, result.Count, "Only the complete entry should be parsed");
        Assert.IsTrue(result.ContainsKey(3));
    }

    [TestMethod]
    public void ParseSessionMappings_SkipsNonNumericKeys()
    {
        var json = JsonDocument.Parse("""
        {
            "abc": { "matrixUserId": "@x:localhost", "mumbleName": "X" },
            "42": { "matrixUserId": "@y:localhost", "mumbleName": "Y" }
        }
        """);

        var result = MumbleAdapter.ParseSessionMappings(json.RootElement);

        Assert.AreEqual(1, result.Count);
        Assert.IsTrue(result.ContainsKey(42));
    }

    [TestMethod]
    public void ParseSessionMappings_EmptyObject_ReturnsEmpty()
    {
        var json = JsonDocument.Parse("{}");
        var result = MumbleAdapter.ParseSessionMappings(json.RootElement);
        Assert.AreEqual(0, result.Count);
    }

    // Transmission mode parsing tests
    [TestMethod]
    public void ParseTransmissionMode_PushToTalkPlus_ReturnsCorrectEnum()
    {
        var result = MumbleAdapter.ParseTransmissionMode("pushToTalkPlus");
        Assert.AreEqual(TransmissionMode.PushToTalkPlus, result);
    }

    [TestMethod]
    public void ParseTransmissionMode_PushToTalk_ReturnsCorrectEnum()
    {
        var result = MumbleAdapter.ParseTransmissionMode("pushToTalk");
        Assert.AreEqual(TransmissionMode.PushToTalk, result);
    }

    [TestMethod]
    public void ParseTransmissionMode_VoiceActivity_ReturnsCorrectEnum()
    {
        var result = MumbleAdapter.ParseTransmissionMode("voiceActivity");
        Assert.AreEqual(TransmissionMode.VoiceActivity, result);
    }

    [TestMethod]
    public void ParseTransmissionMode_Continuous_ReturnsCorrectEnum()
    {
        var result = MumbleAdapter.ParseTransmissionMode("continuous");
        Assert.AreEqual(TransmissionMode.Continuous, result);
    }

    [TestMethod]
    public void ParseTransmissionMode_Unknown_DefaultsToContinuous()
    {
        var result = MumbleAdapter.ParseTransmissionMode("invalidMode");
        Assert.AreEqual(TransmissionMode.Continuous, result);
    }

    // DTX behavior tests
    [TestMethod]
    public void ShouldEnableDtx_PushToTalk_ReturnsFalse()
    {
        Assert.IsFalse(MumbleAdapter.ShouldEnableDtx(TransmissionMode.PushToTalk));
    }

    [TestMethod]
    public void ShouldEnableDtx_PushToTalkPlus_ReturnsFalse()
    {
        Assert.IsFalse(MumbleAdapter.ShouldEnableDtx(TransmissionMode.PushToTalkPlus));
    }

    [TestMethod]
    public void ShouldEnableDtx_VoiceActivity_ReturnsTrue()
    {
        Assert.IsTrue(MumbleAdapter.ShouldEnableDtx(TransmissionMode.VoiceActivity));
    }

    [TestMethod]
    public void ShouldEnableDtx_Continuous_ReturnsTrue()
    {
        Assert.IsTrue(MumbleAdapter.ShouldEnableDtx(TransmissionMode.Continuous));
    }
}
