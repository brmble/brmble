using Brmble.Server.Auth;
using Brmble.Server.ChannelRequests;
using Brmble.Server.Events;
using Brmble.Server.Games.Duels;
using System.Text.Json;

namespace Brmble.Server.Games;

public static class GameEndpoints
{
    public record InviteDto(long TargetSessionId, string GameType, Dictionary<string, object?>? Options = null);
    public record OfferResponseDto(long? OfferId, long? MatchId, bool Accept)
    {
        public bool TryResolveOfferId(out long offerId)
        {
            offerId = OfferId is > 0 && MatchId is null ? OfferId.Value
                : MatchId is > 0 && OfferId is null ? MatchId.Value
                : 0;
            return offerId > 0;
        }
    }
    public record CancelOfferDto(long OfferId);
    public record ReadyDto(long ReservationId, bool? Ready);
    public record RematchDto(long SourceMatchId);
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

        app.MapPost("/games/respond", async (OfferResponseDto dto, HttpContext ctx,
            ICertificateHashExtractor certs, UserRepository users, IDuelOrchestrator orchestrator,
            ISessionMappingService sessions) =>
        {
            var user = await ResolveUserAsync(ctx, certs, users);
            if (user is null) return Results.Unauthorized();
            if (!sessions.TryGetSessionByUserId(user.UserId, out _))
                return Results.BadRequest(new { error = "You must be connected to Brmble." });
            if (!dto.TryResolveOfferId(out var offerId))
                return Results.BadRequest(new GameErrorWire(
                    "Exactly one positive offerId or matchId is required.",
                    DuelWire.Reason(DuelRejectReason.InvalidConfiguration)));
            var r = await orchestrator.RespondToOfferAsync(offerId, user.UserId, dto.Accept);
            return r.Success
                ? Results.Ok(new { offerId = r.OfferId, reservationId = r.ReservationId })
                : Results.BadRequest(new GameErrorWire(r.Error ?? "The response was rejected.", DuelWire.Reason(r.Reason)));
        });

        app.MapPost("/games/offers/cancel", async (CancelOfferDto dto, HttpContext ctx,
            ICertificateHashExtractor certs, UserRepository users, IDuelOrchestrator orchestrator,
            ISessionMappingService sessions) =>
        {
            var user = await ResolveUserAsync(ctx, certs, users);
            if (user is null) return Results.Unauthorized();
            if (!sessions.TryGetSessionByUserId(user.UserId, out _))
                return Results.BadRequest(new { error = "You must be connected to Brmble." });
            if (dto.OfferId <= 0)
                return InvalidCommandId("offerId");
            var r = await orchestrator.CancelOfferAsync(dto.OfferId, user.UserId);
            return CommandResult(r, "The offer could not be canceled.");
        });

        app.MapPost("/games/ready", async (ReadyDto dto, HttpContext ctx,
            ICertificateHashExtractor certs, UserRepository users, IDuelOrchestrator orchestrator,
            ISessionMappingService sessions) =>
        {
            var user = await ResolveUserAsync(ctx, certs, users);
            if (user is null) return Results.Unauthorized();
            if (!sessions.TryGetSessionByUserId(user.UserId, out _))
                return Results.BadRequest(new { error = "You must be connected to Brmble." });
            if (dto.ReservationId <= 0)
                return InvalidCommandId("reservationId");
            if (dto.Ready is null)
                return Results.BadRequest(new GameErrorWire(
                    "ready is required.", DuelWire.Reason(DuelRejectReason.InvalidConfiguration)));
            var response = dto.Ready.Value ? ReadyResponse.Accept : ReadyResponse.Decline;
            var r = await orchestrator.RespondReadyAsync(dto.ReservationId, user.UserId, response);
            return CommandResult(r, "The ready response was rejected.");
        });

        app.MapPost("/games/rematch", async (RematchDto dto, HttpContext ctx,
            ICertificateHashExtractor certs, UserRepository users, IDuelOrchestrator orchestrator,
            ISessionMappingService sessions) =>
        {
            var user = await ResolveUserAsync(ctx, certs, users);
            if (user is null) return Results.Unauthorized();
            if (!sessions.TryGetSessionByUserId(user.UserId, out _))
                return Results.BadRequest(new { error = "You must be connected to Brmble." });
            if (dto.SourceMatchId <= 0)
                return InvalidCommandId("sourceMatchId");
            var r = await orchestrator.RequestRematchAsync(dto.SourceMatchId, user.UserId);
            return CommandResult(r, "The rematch request was rejected.");
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
            ICertificateHashExtractor certs, UserRepository users, IDuelMatchRunnerRouter runner,
            ISessionMappingService sessions) =>
        {
            var user = await ResolveUserAsync(ctx, certs, users);
            if (user is null) return Results.Unauthorized();
            if (!sessions.TryGetSessionByUserId(user.UserId, out _))
                return Results.BadRequest(new { error = "You must be connected to Brmble." });
            if (runner.TryGetActiveMatch(user.UserId, out var active) && active.MatchId == dto.MatchId)
            {
                await runner.ForfeitAsync(dto.MatchId, user.UserId, "forfeit");
                return Results.Ok();
            }
            return Results.BadRequest(new GameErrorWire(
                "The requested match is not the authenticated user's active match.",
                DuelWire.Reason(DuelRejectReason.NotParticipant)));
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

    private static IResult CommandResult(DuelCommandResult result, string fallback) => result.Success
        ? Results.Ok(new { offerId = result.OfferId, reservationId = result.ReservationId })
        : Results.BadRequest(new GameErrorWire(result.Error ?? fallback, DuelWire.Reason(result.Reason)));

    private static IResult InvalidCommandId(string name) => Results.BadRequest(new GameErrorWire(
        $"{name} must be positive.", DuelWire.Reason(DuelRejectReason.InvalidConfiguration)));

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
