using Brmble.Audio;

namespace Brmble.Audio.Tests.Helpers;

/// <summary>
/// Mock <see cref="IVadDetector"/> that returns scripted answers per call.
/// Lets <see cref="VadGate"/> tests stay deterministic and free of native deps.
/// </summary>
internal sealed class FakeVadDetector : IVadDetector
{
    private readonly Queue<bool> _answers;
    public VadAggressiveness Mode { get; set; }
    public int Calls { get; private set; }

    public FakeVadDetector(params bool[] answers)
    {
        _answers = new Queue<bool>(answers);
    }

    public bool IsSpeech(ReadOnlySpan<short> frame)
    {
        Calls++;
        return _answers.Count > 0 ? _answers.Dequeue() : false;
    }
}

/// <summary>
/// Builds a 480-sample mono frame whose RMS approximately equals <paramref name="targetRms"/>.
/// Uses a simple square-wave pattern so RMS is deterministic.
/// </summary>
internal static class FrameFactory
{
    public static short[] WithRms(double targetRms)
    {
        var f = new short[480];
        short v = (short)Math.Clamp(Math.Round(targetRms), short.MinValue, short.MaxValue);
        for (int i = 0; i < f.Length; i++) f[i] = (i % 2 == 0) ? v : (short)-v;
        return f;
    }
}
