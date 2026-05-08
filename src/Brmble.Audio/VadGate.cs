using System.Threading;

namespace Brmble.Audio;

/// <summary>
/// Two-state voice-activity gate with hysteresis, hangover, and onset-lookback.
/// Single-threaded for processing; <see cref="SetSensitivity"/> may be called from
/// any thread and takes effect on the next <see cref="Process"/> call.
/// </summary>
public sealed class VadGate
{
    public const int FrameSamples = 480; // 10 ms @ 48 kHz
    private enum GateState { Closed, Open }

    private readonly IVadDetector _vad;
    private VadGateConfig _config;
    private GateState _state = GateState.Closed;
    private long _lastActiveMs;
    private readonly short[][] _ring;
    private int _ringPos;

    public VadGate(IVadDetector vad, VadGateConfig initial)
    {
        _vad = vad ?? throw new ArgumentNullException(nameof(vad));
        _config = initial ?? throw new ArgumentNullException(nameof(initial));
        if (initial.OnsetLookbackFrames < 1)
            throw new ArgumentOutOfRangeException(nameof(initial), "OnsetLookbackFrames must be >= 1");
        _vad.Mode = initial.VadMode;
        _ring = new short[initial.OnsetLookbackFrames][];
        for (int i = 0; i < _ring.Length; i++) _ring[i] = new short[FrameSamples];
    }

    public bool IsOpen => _state == GateState.Open;
    public double LastRms { get; private set; }

    public void SetSensitivity(VadSensitivity level)
    {
        var cfg = VadGateConfig.FromSensitivity(level);
        Interlocked.Exchange(ref _config, cfg);
        _vad.Mode = cfg.VadMode;
    }

    public GateDecision Process(short[] frame, long nowMs)
    {
        if (frame is null || frame.Length != FrameSamples)
            throw new ArgumentException($"Frame must be exactly {FrameSamples} samples", nameof(frame));

        var cfg = Volatile.Read(ref _config);
        bool isSpeech = _vad.IsSpeech(frame);
        double rms = ComputeRms(frame);
        LastRms = rms;

        GateDecision decision;
        if (_state == GateState.Closed)
        {
            if (isSpeech && rms >= cfg.OpenRmsThreshold)
            {
                _state = GateState.Open;
                _lastActiveMs = nowMs;
                // Snapshot the ring (which holds N priors) + current → N+1 frames total.
                decision = new GateDecision.OpenWithLookback(SnapshotLookbackPlusCurrent(frame));
            }
            else
            {
                decision = new GateDecision.Stay();
            }
        }
        else // Open
        {
            if (isSpeech && rms >= cfg.CloseRmsThreshold) _lastActiveMs = nowMs;

            if (nowMs - _lastActiveMs >= cfg.HangoverMs)
            {
                _state = GateState.Closed;
                decision = new GateDecision.CloseWithTerminator();
            }
            else
            {
                decision = new GateDecision.PassThrough(frame);
            }
        }

        // Push current to the ring AFTER the snapshot so the next gate-open sees it
        // as a prior. Doing this before the snapshot would overwrite the oldest prior
        // and emit one fewer lookback frame than documented.
        Array.Copy(frame, _ring[_ringPos], FrameSamples);
        _ringPos = (_ringPos + 1) % _ring.Length;

        return decision;
    }

    private IReadOnlyList<short[]> SnapshotLookbackPlusCurrent(short[] current)
    {
        // _ring holds the last `_ring.Length` priors (current is NOT yet written).
        // Walk oldest→newest, then append current.
        var result = new List<short[]>(_ring.Length + 1);
        int oldest = _ringPos; // position about to be overwritten = oldest entry
        for (int i = 0; i < _ring.Length; i++)
        {
            int idx = (oldest + i) % _ring.Length;
            var copy = new short[FrameSamples];
            Array.Copy(_ring[idx], copy, FrameSamples);
            result.Add(copy);
        }
        var currentCopy = new short[FrameSamples];
        Array.Copy(current, currentCopy, FrameSamples);
        result.Add(currentCopy);
        return result;
    }

    private static double ComputeRms(short[] frame)
    {
        long sumSq = 0;
        for (int i = 0; i < frame.Length; i++) sumSq += frame[i] * frame[i];
        return Math.Sqrt(sumSq / (double)frame.Length);
    }
}
