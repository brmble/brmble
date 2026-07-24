using System.Net;
using System.Net.Http.Json;
using Brmble.Server.Auth;
using Brmble.Server.Data;
using Brmble.Server.Paint;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Moq;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Paint;

[TestClass]
public sealed class PaintEndpointsTests
{
    [TestMethod]
    public void PaintEventNames_MatchCanonicalContract()
    {
        var expected = new[]
        {
            "paint.sourceAttached", "paint.invited", "paint.participantJoined", "paint.participantLeft",
            "paint.previewUpdated", "paint.strokeCommitted", "paint.strokeUndone", "paint.canvasCleared",
            "paint.sessionEnded", "paint.sessionExpired", "paint.sessionUnavailable", "paint.roomCleanupFailed",
        };

        CollectionAssert.AreEquivalent(expected, PaintEventNames.BroadcastEvents.ToArray());
    }

    [TestMethod]
    public void MapPaintEndpoints_MapsAllContractRoutes()
    {
        var builder = WebApplication.CreateSlimBuilder();
        builder.Services.AddSingleton(new Mock<ICertificateHashExtractor>().Object);
        builder.Services.AddSingleton<UserRepository>();
        builder.Services.AddSingleton<IPaintPresence>(new TestPaintPresence());
        builder.Services.AddSingleton<PaintSessionManager>();
        var app = builder.Build();

        app.MapPaintEndpoints();

        var endpoints = ((IEndpointRouteBuilder)app).DataSources.SelectMany(source => source.Endpoints)
            .OfType<RouteEndpoint>()
            .Select(endpoint => endpoint.RoutePattern.RawText)
            .ToHashSet(StringComparer.Ordinal);

        CollectionAssert.IsSubsetOf(new[]
        {
            "/paint/sessions", "/paint/sessions/{id:guid}/source", "/paint/sessions/{id:guid}",
            "/paint/sessions/{id:guid}/join", "/paint/sessions/{id:guid}/leave", "/paint/sessions/{id:guid}/stroke",
            "/paint/sessions/{id:guid}/preview", "/paint/sessions/{id:guid}/undo", "/paint/sessions/{id:guid}/clear",
            "/paint/sessions/{id:guid}/end",
        }, endpoints.ToArray());
    }

    private sealed class TestPaintPresence : IPaintPresence
    {
        public bool TryGetParticipant(long userId, out PaintPresenceParticipant participant)
        {
            participant = null!;
            return false;
        }

        public IReadOnlyList<PaintPresenceParticipant> GetParticipantsInChannel(int channelId) => [];
    }
}
