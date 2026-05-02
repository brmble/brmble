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

        // Always populate ring buffer (used for onset lookback when we open later).
        Array.Copy(frame, _ring[_ringPos], FrameSamples);
        _ringPos = (_ringPos + 1) % _ring.Length;

        if (_state == GateState.Closed)
        {
            if (isSpeech && rms >= cfg.OpenRmsThreshold)
            {
                _state = GateState.Open;
                _lastActiveMs = nowMs;
                return new GateDecision.OpenWithLookback(SnapshotLookbackPlusCurrent(frame));
            }
            return new GateDecision.Stay();
        }
        else // Open
        {
            if (isSpeech && rms >= cfg.CloseRmsThreshold) _lastActiveMs = nowMs;

            if (nowMs - _lastActiveMs >= cfg.HangoverMs)
            {
                _state = GateState.Closed;
                return new GateDecision.CloseWithTerminator();
            }

            return new GateDecision.PassThrough(frame);
        }
    }

    private IReadOnlyList<short[]> SnapshotLookbackPlusCurrent(short[] current)
    {
        // _ring already contains [..., previous frames, current] because we just pushed `frame`.
        // Walk from oldest to newest, ending with the current frame.
        var result = new List<short[]>(_ring.Length);
        int oldest = _ringPos; // position just written to is now treated as "next slot" — start from here for oldest
        for (int i = 0; i < _ring.Length; i++)
        {
            int idx = (oldest + i) % _ring.Length;
            // Skip lookback slots that haven't been filled yet by skipping zero buffers
            // produced by initial state: a fresh ring is all-zero, which is fine — encoding
            // 30 ms of silence at the start of speech is harmless.
            var copy = new short[FrameSamples];
            Array.Copy(_ring[idx], copy, FrameSamples);
            result.Add(copy);
        }
        return result;
    }

    private static double ComputeRms(short[] frame)
    {
        long sumSq = 0;
        for (int i = 0; i < frame.Length; i++) sumSq += frame[i] * frame[i];
        return Math.Sqrt(sumSq / (double)frame.Length);
    }
}
