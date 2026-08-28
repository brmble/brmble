using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Options;

namespace Brmble.Server.Games.Continuous;

public sealed class GamesRealtimeOptions
{
    public string? RealtimePublicWebSocketUrl { get; set; }
    public string[] RealtimeAllowedOrigins { get; set; } = [];
    public int PerUserTicketLimit { get; set; } = 2;
    public int GlobalTicketLimit { get; set; } = 10_000;
}

public sealed record IssuedTicket(string Token, DateTimeOffset ExpiresAt);
public sealed record TicketScope(long StableUserId, long SessionId, long MatchId, RealtimeRole Role);

public sealed class RealtimeTicketLimitException : Exception
{
    public RealtimeTicketLimitException() : base("The realtime ticket limit was reached.") { }
}

public sealed class RealtimeTicketStore : IDisposable
{
    private static readonly TimeSpan Lifetime = TimeSpan.FromSeconds(15);
    private readonly object _sync = new();
    private readonly Dictionary<string, Entry> _tickets = new(StringComparer.Ordinal);
    private readonly TimeProvider _time;
    private readonly int _perUserLimit;
    private readonly int _globalLimit;
    private readonly PeriodicTimer _timer;
    private readonly CancellationTokenSource _stopping = new();
    private readonly Task _scavenger;
    private bool _disposed;

    public RealtimeTicketStore(TimeProvider time, IOptions<GamesRealtimeOptions> options)
    {
        _time = time;
        _perUserLimit = options.Value.PerUserTicketLimit;
        _globalLimit = options.Value.GlobalTicketLimit;
        _timer = new PeriodicTimer(TimeSpan.FromSeconds(5), time);
        _scavenger = ScavengePeriodicallyAsync();
    }

    public int Count
    {
        get { lock (_sync) return _tickets.Count; }
    }

    internal IReadOnlyCollection<string> DebugKeys
    {
        get { lock (_sync) return _tickets.Keys.ToArray(); }
    }

    public IssuedTicket Issue(long stableUserId, long sessionId, long matchId, RealtimeRole role)
    {
        var now = _time.GetUtcNow();
        var expiresAt = now.Add(Lifetime);
        var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');
        var key = Hash(token);

        lock (_sync)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            RemoveExpired(now);
            if (_tickets.Count >= _globalLimit
                || _tickets.Values.Count(x => x.Scope.StableUserId == stableUserId) >= _perUserLimit)
                throw new RealtimeTicketLimitException();
            _tickets.Add(key, new Entry(
                new TicketScope(stableUserId, sessionId, matchId, role), expiresAt));
        }

        return new IssuedTicket(token, expiresAt);
    }

    public bool TryConsume(string token, out TicketScope scope)
    {
        ArgumentNullException.ThrowIfNull(token);
        var key = Hash(token);
        lock (_sync)
        {
            var now = _time.GetUtcNow();
            RemoveExpired(now);
            if (!_tickets.Remove(key, out var entry) || now >= entry.ExpiresAt)
            {
                scope = null!;
                return false;
            }

            scope = entry.Scope;
            return true;
        }
    }

    public void Scavenge()
    {
        lock (_sync) RemoveExpired(_time.GetUtcNow());
    }

    public void Dispose()
    {
        lock (_sync)
        {
            if (_disposed) return;
            _disposed = true;
        }
        _stopping.Cancel();
        _timer.Dispose();
        try { _scavenger.GetAwaiter().GetResult(); }
        catch (OperationCanceledException) { }
        _stopping.Dispose();
    }

    private async Task ScavengePeriodicallyAsync()
    {
        try
        {
            while (await _timer.WaitForNextTickAsync(_stopping.Token).ConfigureAwait(false))
                Scavenge();
        }
        catch (OperationCanceledException) when (_stopping.IsCancellationRequested) { }
    }

    private void RemoveExpired(DateTimeOffset now)
    {
        foreach (var key in _tickets.Where(x => now >= x.Value.ExpiresAt).Select(x => x.Key).ToArray())
            _tickets.Remove(key);
    }

    private static string Hash(string token) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    private sealed record Entry(TicketScope Scope, DateTimeOffset ExpiresAt);
}

internal sealed class GamesRealtimeOptionsValidator(IHostEnvironment environment)
    : IValidateOptions<GamesRealtimeOptions>
{
    public ValidateOptionsResult Validate(string? name, GamesRealtimeOptions options)
    {
        if (options.PerUserTicketLimit <= 0 || options.GlobalTicketLimit <= 0)
            return ValidateOptionsResult.Fail("Games realtime ticket limits must be positive.");
        if (environment.IsDevelopment()) return ValidateOptionsResult.Success;
        return Uri.TryCreate(options.RealtimePublicWebSocketUrl, UriKind.Absolute, out var uri)
            && string.Equals(uri.Scheme, "wss", StringComparison.OrdinalIgnoreCase)
            ? ValidateOptionsResult.Success
            : ValidateOptionsResult.Fail("Games:RealtimePublicWebSocketUrl must be an absolute wss URL.");
    }
}
