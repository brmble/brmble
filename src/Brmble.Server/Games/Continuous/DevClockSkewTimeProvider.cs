namespace Brmble.Server.Games.Continuous;

/// <summary>
/// Development-only. Shifts the wall clock the server stamps its snapshots with,
/// without touching any timing behaviour.
/// </summary>
/// <remarks>
/// The client renders remote players by sampling a buffer of snapshots at
/// "server now minus the interpolation delay". It once did that arithmetic with its
/// own <c>Date.now()</c> against timestamps written by the server's clock, so any
/// disagreement between the two machines slid the render point along the buffer or
/// off the end of it: the opponent was drawn deep in the past, or froze between
/// snapshots and jumped at the snapshot rate.
///
/// That defect is unreachable on one machine, because both sides read the same
/// clock and the offset is exactly zero. Two clients side by side on a developer's
/// desk, and every automated test, are all in that blind spot — which is how it
/// reached a playtest. This provider manufactures the disagreement so the behaviour
/// can be seen and the correction verified locally.
///
/// Only <see cref="GetUtcNow"/> is shifted. <see cref="GetTimestamp"/> is the
/// monotonic clock that paces the simulation, budgets input rates and drives timers;
/// shifting that would change how the server behaves rather than how its output is
/// labelled, and the point here is to change nothing but the label.
/// </remarks>
public sealed class DevClockSkewTimeProvider(TimeProvider inner, TimeSpan skew) : TimeProvider
{
    public TimeSpan Skew { get; } = skew;

    public override DateTimeOffset GetUtcNow() => inner.GetUtcNow() + Skew;

    public override long GetTimestamp() => inner.GetTimestamp();

    public override long TimestampFrequency => inner.TimestampFrequency;

    public override TimeZoneInfo LocalTimeZone => inner.LocalTimeZone;

    public override ITimer CreateTimer(TimerCallback callback, object? state, TimeSpan dueTime, TimeSpan period) =>
        inner.CreateTimer(callback, state, dueTime, period);
}
