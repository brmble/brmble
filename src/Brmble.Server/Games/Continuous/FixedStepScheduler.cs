namespace Brmble.Server.Games.Continuous;

public readonly record struct CyclePlan(int Ticks, bool Overloaded, long NextDeadline);

public sealed class FixedStepScheduler
{
    private readonly TimeProvider _clock;
    private readonly int _tickRate;
    private readonly int _maxCatchUpTicks;
    private readonly long _basePeriod;
    private readonly long _remainder;
    private long _carry;

    public FixedStepScheduler(TimeProvider clock, int tickRate, int maxCatchUpTicks)
    {
        ArgumentNullException.ThrowIfNull(clock);
        if (tickRate <= 0)
            throw new ArgumentOutOfRangeException(nameof(tickRate));
        if (maxCatchUpTicks <= 0)
            throw new ArgumentOutOfRangeException(nameof(maxCatchUpTicks));
        if (clock.TimestampFrequency < tickRate)
            throw new ArgumentOutOfRangeException(nameof(tickRate));

        _clock = clock;
        _tickRate = tickRate;
        _maxCatchUpTicks = maxCatchUpTicks;
        _basePeriod = clock.TimestampFrequency / tickRate;
        _remainder = clock.TimestampFrequency % tickRate;
    }

    public long NextDeadline { get; private set; }

    public void Start(long timestamp)
    {
        NextDeadline = timestamp;
        _carry = 0;
    }

    public CyclePlan PlanCycle()
    {
        var now = _clock.GetTimestamp();
        var ticks = 0;

        while (now >= NextDeadline && ticks < _maxCatchUpTicks)
        {
            ticks++;
            AdvanceDeadline();
        }

        if (now < NextDeadline)
            return new CyclePlan(ticks, false, NextDeadline);

        _carry = 0;
        NextDeadline = now;
        AdvanceDeadline();
        return new CyclePlan(ticks, true, NextDeadline);
    }

    public long AdvanceDeadline()
    {
        _carry += _remainder;
        var period = _basePeriod;
        if (_carry >= _tickRate)
        {
            _carry -= _tickRate;
            period++;
        }

        NextDeadline += period;
        return NextDeadline;
    }
}
