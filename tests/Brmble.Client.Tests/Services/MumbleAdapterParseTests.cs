using System.Text.Json;
using Brmble.Client.Services.Voice;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services;

[TestClass]
public class MumbleAdapterParseTests
{
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
}
