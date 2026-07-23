using Brmble.Server.Auth;
using Brmble.Server.ChannelRequests;
using Brmble.Server.Events;

namespace Brmble.Server.Games;

public static class GameEndpoints
{
    public record InviteDto(long TargetSessionId, string GameType, Dictionary<string, object?>? Options = null);
    public record RespondDto(long MatchId, bool Accept);
    public record ActionDto(long MatchId, Dictionary<string, object?> Action);
    public record ForfeitDto(long MatchId);
    public record GameSettingsDto(bool ChallengesBlocked);

    public static IEndpointRouteBuilder MapGameEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/games/invite", async (InviteDto dto, HttpContext ctx,
            ICertificateHashExtractor certs, UserRepository users, GameSessionManager mgr,
            ISessionMappingService sessions) =>
        {
            var user = await ResolveUserAsync(ctx, certs, users);
            if (user is null) return Results.Unauthorized();
            if (!sessions.TryGetSessionByUserId(user.UserId, out var session))
                return Results.BadRequest(new { error = "You must be connected to Brmble to start a game." });
            // dto.TargetSessionId is a Mumble session id supplied by the web client.
            var r = await mgr.InviteAsync(session, dto.TargetSessionId, dto.GameType, dto.Options);
            if (r.Success) return Results.Ok(new { matchId = r.MatchId });
            // Emit a stable machine-readable reason code alongside the human text so
            // the client can branch without regex-matching the message string.
            var reason = r.Reason switch
            {
                InviteRejectReason.Blocked => "blocked",
                InviteRejectReason.ChannelBusy => "channelBusy",
                _ => (string?)null,
            };
            return Results.BadRequest(new { error = r.Error, reason });
        });

        app.MapPost("/games/respond", async (RespondDto dto, HttpContext ctx,
            ICertificateHashExtractor certs, UserRepository users, GameSessionManager mgr,
            ISessionMappingService sessions) =>
        {
            var user = await ResolveUserAsync(ctx, certs, users);
            if (user is null) return Results.Unauthorized();
            if (!sessions.TryGetSessionByUserId(user.UserId, out var session))
                return Results.BadRequest(new { error = "You must be connected to Brmble." });
            await mgr.RespondAsync(dto.MatchId, session, dto.Accept);
            return Results.Ok();
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
            ICertificateHashExtractor certs, UserRepository users, GameSessionManager mgr,
            ISessionMappingService sessions) =>
        {
            var user = await ResolveUserAsync(ctx, certs, users);
            if (user is null) return Results.Unauthorized();
            if (!sessions.TryGetSessionByUserId(user.UserId, out var session))
                return Results.BadRequest(new { error = "You must be connected to Brmble." });
            await mgr.ForfeitAsync(dto.MatchId, session, "forfeit");
            return Results.Ok();
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
