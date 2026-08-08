using System.Text.Json;
using Brmble.Client.Services.Voice;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services;

[TestClass]
public sealed class MumbleAdapterCredentialTests
{
    [TestMethod]
    public void RewriteMatrixHomeserverUrl_PreservesMessageDeletionCapability()
    {
        var credentials = JsonSerializer.SerializeToElement(new
        {
            matrix = new
            {
                homeserverUrl = "http://localhost:8008",
                accessToken = "token",
                userId = "@alice:test",
                roomMap = new Dictionary<string, string>(),
                messageDeletion = new
                {
                    canModerate = true,
                    maxAgeMs = 86_400_000
                }
            }
        });

        var rewritten = MumbleAdapter.RewriteMatrixHomeserverUrl(
            credentials,
            "https://api.example/");

        var matrix = rewritten.GetProperty("matrix");
        Assert.AreEqual(
            "https://api.example",
            matrix.GetProperty("homeserverUrl").GetString());
        Assert.IsTrue(
            matrix.GetProperty("messageDeletion")
                .GetProperty("canModerate")
                .GetBoolean());
        Assert.AreEqual(
            86_400_000,
            matrix.GetProperty("messageDeletion")
                .GetProperty("maxAgeMs")
                .GetInt64());
    }
}
