using Brmble.Server.Auth;
using Brmble.Server.ChannelRequests;

namespace Brmble.Server.Games;

public static class GameEndpoints
{
    public record InviteDto(long TargetUserId, string GameType);
    public record RespondDto(long MatchId, bool Accept);
    public record ActionDto(long MatchId, Dictionary<string, object?> Action);
    public record ForfeitDto(long MatchId);

    public static IEndpointRouteBuilder MapGameEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/games/invite", async (InviteDto dto, HttpContext ctx,
            ICertificateHashExtractor certs, UserRepository users, GameSessionManager mgr) =>
        {
            var user = await ResolveUserAsync(ctx, certs, users);
            if (user is null) return Results.Unauthorized();
            var r = await mgr.InviteAsync(user.UserId, dto.TargetUserId, dto.GameType);
            return r.Success ? Results.Ok(new { matchId = r.MatchId }) : Results.BadRequest(new { error = r.Error });
        });

        app.MapPost("/games/respond", async (RespondDto dto, HttpContext ctx,
            ICertificateHashExtractor certs, UserRepository users, GameSessionManager mgr) =>
        {
            var user = await ResolveUserAsync(ctx, certs, users);
            if (user is null) return Results.Unauthorized();
            await mgr.RespondAsync(dto.MatchId, user.UserId, dto.Accept);
            return Results.Ok();
        });

        app.MapPost("/games/action", async (ActionDto dto, HttpContext ctx,
            ICertificateHashExtractor certs, UserRepository users, GameSessionManager mgr) =>
        {
            var user = await ResolveUserAsync(ctx, certs, users);
            if (user is null) return Results.Unauthorized();
            await mgr.ActionAsync(dto.MatchId, user.UserId, dto.Action);
            return Results.Ok();
        });

        app.MapPost("/games/forfeit", async (ForfeitDto dto, HttpContext ctx,
            ICertificateHashExtractor certs, UserRepository users, GameSessionManager mgr) =>
        {
            var user = await ResolveUserAsync(ctx, certs, users);
            if (user is null) return Results.Unauthorized();
            await mgr.ForfeitAsync(dto.MatchId, user.UserId, "forfeit");
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
