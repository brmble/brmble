namespace Brmble.Client.Services.SpeechEnhancement;

public sealed class AudioResampler
{
    private readonly int _sourceRate;
    private readonly int _targetRate;
    private readonly float[]? _antiAliasFilter;

    public AudioResampler(int sourceRate, int targetRate, int channels)
    {
        _sourceRate = sourceRate;
        _targetRate = targetRate;

        // Build an anti-aliasing low-pass filter only when downsampling.
        // Cutoff is set at the Nyquist frequency of the target rate to eliminate
        // frequencies that would alias after the sample-rate reduction.
        if (targetRate < sourceRate)
        {
            var normalizedCutoff = (double)targetRate / (2.0 * sourceRate);
            _antiAliasFilter = DesignLowPassFilter(normalizedCutoff, filterTaps: 65);
        }
    }

    public float[] Resample(ReadOnlySpan<float> input)
    {
        if (input.Length == 0)
            return Array.Empty<float>();

        // Apply the anti-aliasing filter before downsampling to prevent aliasing
        // artifacts (e.g. 48 kHz → 16 kHz needs energy above 8 kHz removed first).
        ReadOnlySpan<float> filtered = _antiAliasFilter is not null
            ? ApplyFirFilter(_antiAliasFilter, input)
            : input;

        var outputLength = (int)((long)filtered.Length * _targetRate / _sourceRate);
        var output = new float[outputLength];

        var ratio = (double)_sourceRate / _targetRate;

        for (int i = 0; i < outputLength; i++)
        {
            var sourceIndex = i * ratio;
            var sourceIndexInt = (int)sourceIndex;
            var fraction = sourceIndex - sourceIndexInt;

            if (sourceIndexInt >= filtered.Length - 1)
            {
                output[i] = sourceIndexInt < filtered.Length ? filtered[sourceIndexInt] : 0;
            }
            else
            {
                output[i] = (float)((1 - fraction) * filtered[sourceIndexInt] + fraction * filtered[sourceIndexInt + 1]);
            }
        }

        return output;
    }

    // Zero-phase linear convolution with implicit zero-padding at boundaries.
    private static float[] ApplyFirFilter(float[] filter, ReadOnlySpan<float> input)
    {
        var output = new float[input.Length];
        var half = filter.Length / 2;

        for (int i = 0; i < input.Length; i++)
        {
            double sum = 0;
            for (int j = 0; j < filter.Length; j++)
            {
                var idx = i + half - j;
                if ((uint)idx < (uint)input.Length)
                    sum += filter[j] * input[idx];
            }
            output[i] = (float)sum;
        }

        return output;
    }

    // Windowed-sinc (Hamming) FIR low-pass filter design.
    // normalizedCutoff is the cutoff as a fraction of the source sampling rate (0 < fc < 0.5).
    private static float[] DesignLowPassFilter(double normalizedCutoff, int filterTaps)
    {
        // Odd tap count ensures a symmetric, linear-phase filter.
        if (filterTaps % 2 == 0) filterTaps++;

        var half = filterTaps / 2;
        var h = new float[filterTaps];
        double sum = 0;

        for (int i = 0; i < filterTaps; i++)
        {
            int n = i - half;
            // Hamming window reduces sidelobe ripple (~43 dB stopband attenuation).
            double window = 0.54 - 0.46 * Math.Cos(2 * Math.PI * i / (filterTaps - 1));
            // Ideal low-pass impulse response (sinc function).
            double sinc = n == 0
                ? 2.0 * normalizedCutoff
                : Math.Sin(2 * Math.PI * normalizedCutoff * n) / (Math.PI * n);
            h[i] = (float)(window * sinc);
            sum += h[i];
        }

        // Normalize to unity DC gain.
        for (int i = 0; i < filterTaps; i++)
            h[i] /= (float)sum;

        return h;
    }
}
