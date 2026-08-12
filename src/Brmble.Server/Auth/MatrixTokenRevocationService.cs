using Brmble.Server.Matrix;
using Microsoft.Extensions.Options;

namespace Brmble.Server.Auth;

internal sealed class MatrixTokenRevocationService : BackgroundService
{
    private readonly MatrixTokenStore _tokens;
    private readonly IMatrixAppService _matrix;
    private readonly MatrixSettings _settings;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<MatrixTokenRevocationService> _logger;

    public MatrixTokenRevocationService(MatrixTokenStore tokens, IMatrixAppService matrix,
        IOptions<MatrixSettings> settings, TimeProvider timeProvider,
        ILogger<MatrixTokenRevocationService> logger)
    {
        _tokens = tokens;
        _matrix = matrix;
        _settings = settings.Value;
        _timeProvider = timeProvider;
        _logger = logger;
    }

    internal async Task<int> RevokeExpiredOnceAsync(CancellationToken cancellationToken)
    {
        var now = _timeProvider.GetUtcNow();
        var due = await _tokens.GetRevocationDueAsync(now.ToUnixTimeMilliseconds());
        var revoked = 0;
        foreach (var lease in due)
        {
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                await _matrix.RevokeAccessToken(lease.AccessToken, cancellationToken);
                if (await _tokens.ClearIfCurrentAsync(lease.UserId, lease.StoredValue)) revoked++;
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
            catch (Exception ex)
            {
                var delay = GetRetryDelay(lease.RevocationAttemptCount);
                await _tokens.ScheduleRevocationRetryIfCurrentAsync(lease.UserId, lease.StoredValue,
                    now.Add(delay).ToUnixTimeMilliseconds());
                _logger.LogWarning("Failed to revoke expired Matrix token for user {UserId}; retry scheduled. FailureType={FailureType} Status={Status}",
                    lease.UserId, ex.GetType().Name, (ex as HttpRequestException)?.StatusCode);
            }
        }
        return revoked;
    }

    private TimeSpan GetRetryDelay(int currentAttemptCount)
    {
        var exponent = Math.Min(currentAttemptCount, 20);
        var seconds = Math.Min(_settings.AccessTokenRevocationRetryBaseSeconds * Math.Pow(2, exponent),
            _settings.AccessTokenRevocationRetryMaxSeconds);
        return TimeSpan.FromSeconds(seconds);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(_settings.AccessTokenRevocationSweepSeconds));
        while (await timer.WaitForNextTickAsync(stoppingToken))
            await RevokeExpiredOnceAsync(stoppingToken);
    }
}
