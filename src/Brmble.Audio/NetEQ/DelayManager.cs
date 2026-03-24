namespace Brmble.Audio.NetEQ;

/// <summary>
/// Calculates the optimal jitter buffer target level using relative delay
/// measurement and a histogram with forget factor.
/// Target level is in units of frames (20ms each).
/// </summary>
public class DelayManager
{
    private const int SampleRate = 48000;
    private const int FrameSizeMs = 20;
    private const int FrameSizeSamples = 960;
    private const double ForgetFactor = 0.9993;
    private const double TargetPercentile = 0.95;
    private const int HistogramBuckets = 50;
    private const int WindowDurationMs = 2000;

    private readonly int _minLevel;
    private readonly int _maxLevel;
    private readonly double[] _histogram;
    private readonly Queue<(long iat, long arrivalMs)> _window = new();
    private long _minIat = long.MaxValue;

    public int TargetLevel { get; private set; }

    public DelayManager(int minLevel = 1, int maxLevel = 15)
    {
        _minLevel = minLevel;
        _maxLevel = maxLevel;
        _histogram = new double[HistogramBuckets];
        TargetLevel = _minLevel;
    }

    public void Update(long timestamp, long arrivalMs)
    {
        long expectedMs = timestamp * 1000 / SampleRate;
        long iat = arrivalMs - expectedMs;

        _window.Enqueue((iat, arrivalMs));

        while (_window.Count > 0 && arrivalMs - _window.Peek().arrivalMs > WindowDurationMs)
            _window.Dequeue();

        _minIat = long.MaxValue;
        foreach (var entry in _window)
        {
            if (entry.iat < _minIat)
                _minIat = entry.iat;
        }

        long relativeDelayMs = iat - _minIat;

        int bucket = (int)(relativeDelayMs / FrameSizeMs);
        bucket = Math.Clamp(bucket, 0, HistogramBuckets - 1);

        for (int i = 0; i < _histogram.Length; i++)
            _histogram[i] *= ForgetFactor;

        _histogram[bucket] += 1.0;

        double total = 0;
        for (int i = 0; i < _histogram.Length; i++)
            total += _histogram[i];

        if (total <= 0)
        {
            TargetLevel = _minLevel;
            return;
        }

        double cumulative = 0;
        for (int i = 0; i < _histogram.Length; i++)
        {
            cumulative += _histogram[i] / total;
            if (cumulative >= TargetPercentile)
            {
                TargetLevel = Math.Clamp(i + 1, _minLevel, _maxLevel);
                return;
            }
        }

        TargetLevel = _maxLevel;
    }

    public void Reset()
    {
        Array.Clear(_histogram);
        _window.Clear();
        _minIat = long.MaxValue;
        TargetLevel = _minLevel;
    }
}
