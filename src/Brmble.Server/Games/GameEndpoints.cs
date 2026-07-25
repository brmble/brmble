using Brmble.Server.Auth;
using Brmble.Server.ChannelRequests;
using Brmble.Server.Events;
using Brmble.Server.Games.Duels;
using System.Text.Json;

namespace Brmble.Server.Games;

public static class GameEndpoints
{
    public record InviteDto(long TargetSessionId, string GameType, Dictionary<string, object?>? Options = null);
    public record RespondDto(long? OfferId, long? MatchId, bool Accept)
    {
        public long ResolvedOfferId => OfferId ?? MatchId ?? 0;
    }
    public record ActionDto(long MatchId, Dictionary<string, object?> Action);
    public record ForfeitDto(long MatchId);
    public record GameSettingsDto(bool ChallengesBlocked);

    public static IEndpointRouteBuilder MapGameEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/games/queue", async (HttpContext ctx,
            ICertificateHashExtractor certs, UserRepository users, IDuelSnapshotProvider snapshots,
            ISessionMappingService sessions) =>
        {
            var user = await ResolveUserAsync(ctx, certs, users);
            if (user is null) return Results.Unauthorized();
            if (!sessions.TryGetSessionByUserId(user.UserId, out var session))
                return Results.BadRequest(new { error = "You must be connected to Brmble." });
            return Results.Ok(DuelWire.ToSnapshot(await snapshots.GetSnapshotForSessionAsync(session)));
        });

        app.MapPost("/games/invite", async (InviteDto dto, HttpContext ctx,
            ICertificateHashExtractor certs, UserRepository users, IDuelOrchestrator orchestrator,
            ISessionMappingService sessions) =>
        {
            var user = await ResolveUserAsync(ctx, certs, users);
            if (user is null) return Results.Unauthorized();
            if (!sessions.TryGetSessionByUserId(user.UserId, out var session))
                return Results.BadRequest(new { error = "You must be connected to Brmble to start a game." });
            // dto.TargetSessionId is a Mumble session id supplied by the web client.
            var options = ConvertOptions(dto.Options);
            var r = await orchestrator.CreateChallengeAsync(session, dto.TargetSessionId, dto.GameType, options);
            if (r.Success) return Results.Ok(new { offerId = r.OfferId, matchId = r.OfferId });
            return Results.BadRequest(new GameErrorWire(r.Error ?? "The challenge was rejected.", DuelWire.Reason(r.Reason)));
        });

        app.MapPost("/games/respond", async (RespondDto dto, HttpContext ctx,
            ICertificateHashExtractor certs, UserRepository users, IDuelOrchestrator orchestrator,
            ISessionMappingService sessions) =>
        {
            var user = await ResolveUserAsync(ctx, certs, users);
            if (user is null) return Results.Unauthorized();
            if (!sessions.TryGetSessionByUserId(user.UserId, out _))
                return Results.BadRequest(new { error = "You must be connected to Brmble." });
            var r = await orchestrator.RespondToOfferAsync(dto.ResolvedOfferId, user.UserId, dto.Accept);
            return r.Success
                ? Results.Ok(new { offerId = r.OfferId, reservationId = r.ReservationId })
                : Results.BadRequest(new GameErrorWire(r.Error ?? "The response was rejected.", DuelWire.Reason(r.Reason)));
        });

        app.MapPost("/games/action", async (ActionDto dto, HttpContext ctx,
            ICertificateHashExtractor certs, UserRepository users, GameSessionManager mgr,
            ISessionMappingService sessions) =>
        {
            var user = await ResolveUserAsync(ctx, certs, users);
            if (user is null) return Results.Unauthorized();
            if (!sessions.TryGetSessionByUserId(user.UserId, out var session))
                return Results.BadRequest(new { error = "You must be connected to Brmble." });
            await mgr.ActionAsync(dto.MatchId, session, dto.Action);
            return Results.Ok();
        });

        app.MapPost("/games/forfeit", async (ForfeitDto dto, HttpContext ctx,
            ICertificateHashExtractor certs, UserRepository users, IDuelOrchestrator orchestrator,
            IDuelMatchRunnerRouter runner,
            ISessionMappingService sessions) =>
        {
            var user = await ResolveUserAsync(ctx, certs, users);
            if (user is null) return Results.Unauthorized();
            if (!sessions.TryGetSessionByUserId(user.UserId, out _))
                return Results.BadRequest(new { error = "You must be connected to Brmble." });
            var cancellation = await orchestrator.CancelOfferAsync(dto.MatchId, user.UserId);
            if (cancellation.Success) return Results.Ok();
            if (runner.TryGetActiveMatch(user.UserId, out var active) && active.MatchId == dto.MatchId)
            {
                await runner.ForfeitAsync(dto.MatchId, user.UserId, "forfeit");
                return Results.Ok();
            }
            return Results.BadRequest(new GameErrorWire(
                cancellation.Error ?? "No matching offer or active match was found.",
                DuelWire.Reason(cancellation.Reason)));
        });

        app.MapGet("/games/stats/{gameType}", async (string gameType, string? window, HttpContext ctx,
            ICertificateHashExtractor certs, UserRepository users, GameStatsService stats) =>
        {
            var user = await ResolveUserAsync(ctx, certs, users);
            if (user is null) return Results.Unauthorized();
            var (from, to) = ResolveWindow(window);
            var s = await stats.GetWindowedStatsAsync(user.UserId, gameType, from, to);
            return Results.Ok(s);
        });

        app.MapGet("/games/head-to-head/{opponentSessionId}", async (long opponentSessionId, HttpContext ctx,
            ICertificateHashExtractor certs, UserRepository users, GameStatsService stats,
            ISessionMappingService sessions) =>
        {
            var user = await ResolveUserAsync(ctx, certs, users);
            if (user is null) return Results.Unauthorized();
            // The web client only knows the opponent's Mumble session id; resolve it to
            // the stable user id the head-to-head cache is keyed on.
            if (!sessions.GetSnapshot().TryGetValue((int)opponentSessionId, out var mapping))
                return Results.Ok(new HeadToHeadStats(0, 0, 0, Array.Empty<HeadToHeadGame>()));
            var h2h = await stats.GetHeadToHeadAsync(user.UserId, mapping.UserId);
            return Results.Ok(h2h);
        });

        app.MapGet("/games/settings", async (HttpContext ctx,
            ICertificateHashExtractor certs, UserRepository users) =>
        {
            var user = await ResolveUserAsync(ctx, certs, users);
            if (user is null) return Results.Unauthorized();
            var blocked = await users.GetChallengesBlocked(user.UserId);
            return Results.Ok(new GameSettingsDto(blocked));
        });

        app.MapPost("/games/settings", async (GameSettingsDto dto, HttpContext ctx,
            ICertificateHashExtractor certs, UserRepository users) =>
        {
            var user = await ResolveUserAsync(ctx, certs, users);
            if (user is null) return Results.Unauthorized();
            await users.SetChallengesBlocked(user.UserId, dto.ChallengesBlocked);
            return Results.Ok(new GameSettingsDto(dto.ChallengesBlocked));
        });

        return app;
    }

    private static (DateTimeOffset from, DateTimeOffset to) ResolveWindow(string? window)
    {
        var now = DateTimeOffset.UtcNow;
        return window switch
        {
            "week" => (now.AddDays(-7), now),
            "month" => (now.AddMonths(-1), now),
            _ => (DateTimeOffset.UnixEpoch, now),
        };
    }

    private static IReadOnlyDictionary<string, object?>? ConvertOptions(Dictionary<string, object?>? options)
    {
        if (options is null) return null;
        return options.ToDictionary(x => x.Key, x => x.Value is JsonElement element
            ? element.ValueKind switch
            {
                JsonValueKind.Number when element.TryGetInt64(out var integer) => integer,
                JsonValueKind.Number => element.GetDouble(),
                JsonValueKind.String => element.GetString(),
                JsonValueKind.True => true,
                JsonValueKind.False => false,
                JsonValueKind.Null => null,
                _ => x.Value,
            }
            : x.Value);
    }

    private static async Task<AuthenticatedChannelRequestUser?> ResolveUserAsync(
        HttpContext httpContext,
        ICertificateHashExtractor certHashExtractor,
        UserRepository userRepo)
    {
        var certHash = certHashExtractor.GetCertHash(httpContext);
        if (string.IsNullOrWhiteSpace(certHash))
        {
            return null;
        }

        var user = await userRepo.GetByCertHash(certHash);
        return user is null ? null : new AuthenticatedChannelRequestUser(user.Id, user.DisplayName);
    }
}
