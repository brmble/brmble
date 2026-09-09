namespace Brmble.Client.Services.Voice;

/// <summary>
/// Rate-limits snapshot requests. A client whose cursor cannot be repaired — a server bug, a
/// truncated event stream — would otherwise request a snapshot for every event it receives.
/// </summary>
/// <remarks>
/// Time is passed in rather than read from a clock so the policy is testable without waiting.
///
/// <para>
/// <see cref="Complete"/> is called when the request is <em>sent</em>, not when a snapshot
/// arrives. The server silently drops a <c>requestSnapshot</c> that lands inside its own
/// one-second per-socket cooldown and sends no reply of any kind, so completing on receipt
/// would wedge <c>_inFlight</c> permanently on the first refusal.
/// </para>
/// </remarks>
internal sealed class ResyncThrottle
{
    /// <summary>
    /// Matches the server's own per-socket cooldown. Below this, extra requests are not merely
    /// wasteful — they are dropped without a reply, so the client waits for a snapshot the
    /// server already decided not to send.
    /// </summary>
    private static readonly TimeSpan MinimumSpacing = TimeSpan.FromSeconds(1);
    private static readonly TimeSpan MaximumDelay = TimeSpan.FromSeconds(30);

    private readonly object _gate = new();
    private bool _inFlight;
    private TimeSpan? _lastCompleted;

    /// <summary>
    /// A request has been sent that no snapshot has yet answered. Only a request made while
    /// this is set widens the delay — that is what "gaps persist" means. Widening on every
    /// request instead would penalise the healthy single resync that immediately succeeds.
    /// </summary>
    private bool _awaitingRepair;

    public TimeSpan CurrentDelay { get; private set; } = MinimumSpacing;

    public bool TryBegin(TimeSpan now)
    {
        lock (_gate)
        {
            if (_inFlight) return false;
            if (_lastCompleted is { } last && now - last < CurrentDelay) return false;

            // Widen only now that we know the previous request failed to repair the cursor.
            // Doing this in Complete would apply the wider delay to the very request that is
            // still in flight and may yet succeed.
            if (_awaitingRepair)
            {
                var doubled = CurrentDelay * 2;
                CurrentDelay = doubled > MaximumDelay ? MaximumDelay : doubled;
            }

            _inFlight = true;
            return true;
        }
    }

    /// <summary>
    /// Marks the request sent. Called on send rather than on receipt: a request the server
    /// drops inside its cooldown produces no reply at all.
    /// </summary>
    public void Complete(TimeSpan now)
    {
        lock (_gate)
        {
            _inFlight = false;
            _lastCompleted = now;
            _awaitingRepair = true;
        }
    }

    /// <summary>A snapshot landed and the cursor is healthy, so the backoff has done its job.</summary>
    public void OnSnapshotApplied()
    {
        lock (_gate)
        {
            CurrentDelay = MinimumSpacing;
            _awaitingRepair = false;
        }
    }
}
