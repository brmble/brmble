using SoundTouch;

namespace Brmble.Audio.NetEQ;

/// <summary>
/// Pitch-preserving time-stretching for NetEQ Accelerate / Decelerate.
/// Thin wrapper over SoundTouch.Net tuned for voice: smaller sequence/seek/overlap
/// windows than the music defaults (which add ~100ms latency).
/// </summary>
public sealed class TimeStretcher : IDisposable
{
    private readonly SoundTouchProcessor? _processor;
    private readonly bool _initOk;
    private readonly float[] _floatInScratch;
    private readonly float[] _floatOutScratch;

    public TimeStretcher(int sampleRate, int maxFrameSamples = 4096)
    {
        _floatInScratch = new float[maxFrameSamples];
        _floatOutScratch = new float[maxFrameSamples * 2];

        try
        {
            _processor = new SoundTouchProcessor
            {
                SampleRate = sampleRate,
                Channels = 1,
                Tempo = 1.0,
                Pitch = 1.0,
                Rate = 1.0,
            };
            _processor.SetSetting(SettingId.SequenceDurationMs, 40);
            _processor.SetSetting(SettingId.SeekWindowDurationMs, 15);
            _processor.SetSetting(SettingId.OverlapDurationMs, 8);
            _initOk = true;
        }
        catch (Exception ex)
        {
            _initOk = false;
            System.Diagnostics.Debug.WriteLine(
                $"[TimeStretcher] SoundTouch initialization failed, falling back to cross-fade: {ex.Message}");
            System.Console.Error.WriteLine(
                $"[TimeStretcher] SoundTouch initialization failed, falling back to cross-fade: {ex.Message}");
        }
    }

    public bool IsOperational => _initOk;

    private static short FloatToShort(float v)
    {
        if (float.IsNaN(v) || float.IsInfinity(v)) return 0;
        return (short)Math.Clamp((int)(v * 32767.0f), short.MinValue, short.MaxValue);
    }

    public int Process(ReadOnlySpan<short> input, double tempo, Span<short> output)
    {
        if (!_initOk || _processor is null)
            return 0;

        _processor.Tempo = tempo;

        int len = input.Length;
        for (int i = 0; i < len; i++)
            _floatInScratch[i] = input[i] / 32768.0f;

        _processor.PutSamples(_floatInScratch.AsSpan(0, len), len);

        int available = _processor.ReceiveSamples(_floatOutScratch, _floatOutScratch.Length);
        int toCopy = Math.Min(available, output.Length);
        for (int i = 0; i < toCopy; i++)
            output[i] = FloatToShort(_floatOutScratch[i]);
        return toCopy;
    }

    public int Flush(Span<short> output)
    {
        if (!_initOk || _processor is null) return 0;
        _processor.Flush();
        int available = _processor.ReceiveSamples(_floatOutScratch, _floatOutScratch.Length);
        int toCopy = Math.Min(available, output.Length);
        for (int i = 0; i < toCopy; i++)
            output[i] = FloatToShort(_floatOutScratch[i]);
        return toCopy;
    }

    public void Reset()
    {
        _processor?.Clear();
    }

    public void Dispose()
    {
        // SoundTouchProcessor is not IDisposable; Clear releases internal buffers.
        _processor?.Clear();
    }
}
