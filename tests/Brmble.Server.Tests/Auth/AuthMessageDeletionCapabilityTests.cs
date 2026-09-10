using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Moq;

namespace Brmble.Server.Tests.Auth;

[TestClass]
public sealed class AuthMessageDeletionCapabilityTests
{
    [TestMethod]
    public async Task AuthToken_ReturnsCurrentMessageModerationHint()
    {
        using var factory = new Integration.BrmbleServerFactory();
        using var client = factory.CreateClient();
        factory.AclAuthorizationMock
            .Setup(acl => acl.CanModerateServerAsync(factory.AliceUserId))
            .ReturnsAsync(true);

        var response = await client.PostAsJsonAsync(
            "/auth/token",
            new { mumbleUsername = "Alice" });

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        using var document = await JsonDocument.ParseAsync(
            await response.Content.ReadAsStreamAsync());
        var capability = document.RootElement
            .GetProperty("matrix")
            .GetProperty("messageDeletion");

        Assert.IsTrue(capability.GetProperty("canModerate").GetBoolean());
        Assert.AreEqual(
            86_400_000,
            capability.GetProperty("maxAgeMs").GetInt64());
    }
}
