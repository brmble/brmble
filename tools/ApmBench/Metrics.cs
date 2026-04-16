namespace Brmble.Tools.ApmBench;

public readonly record struct AudioStats(double RmsDbfs, double PeakDbfs, int ClippedSamples, int SampleCount);

public static class Metrics
{
    public static AudioStats Measure(ReadOnlySpan<byte> pcm16)
    {
        int samples = pcm16.Length / 2;
        if (samples == 0) return new AudioStats(-120.0, -120.0, 0, 0);

        double sumSq = 0;
        int peak = 0;
        int clipped = 0;
        for (int i = 0; i < samples; i++)
        {
            short s = (short)(pcm16[i * 2] | (pcm16[i * 2 + 1] << 8));
            int abs = s == short.MinValue ? short.MaxValue : Math.Abs((int)s);
            if (abs > peak) peak = abs;
            if (s == short.MaxValue || s == short.MinValue) clipped++;
            double n = s / 32768.0;
            sumSq += n * n;
        }

        double rms = Math.Sqrt(sumSq / samples);
        double peakNorm = peak / 32768.0;
        double rmsDbfs = rms > 0 ? 20.0 * Math.Log10(rms) : -120.0;
        double peakDbfs = peakNorm > 0 ? 20.0 * Math.Log10(peakNorm) : -120.0;
        return new AudioStats(rmsDbfs, peakDbfs, clipped, samples);
    }
}
