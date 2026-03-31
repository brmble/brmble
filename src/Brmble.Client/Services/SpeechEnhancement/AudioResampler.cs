using MumbleVoiceEngine.Audio;

namespace Brmble.Client.Services.SpeechEnhancement;

public sealed class AudioResampler : IDisposable
{
    private R8BrainResampler? _resampler;
    private readonly int _sourceRate;
    private readonly int _targetRate;
    private double[]? _scratchInput;

    public AudioResampler(int sourceRate, int targetRate, int channels)
    {
        if (channels != 1)
            throw new ArgumentOutOfRangeException(nameof(channels), "Only mono (1 channel) is supported");
        _sourceRate = sourceRate;
        _targetRate = targetRate;
        // Max input length: 20ms at source rate is a safe upper bound
        int maxInLen = sourceRate / 1000 * 20;
        _resampler = new R8BrainResampler(sourceRate, targetRate, maxInLen);
    }

    public float[] Resample(ReadOnlySpan<float> input)
    {
        if (input.Length == 0)
            return Array.Empty<float>();

        if (_resampler == null)
            throw new ObjectDisposedException(nameof(AudioResampler));

        // Reuse scratch buffer for float→double conversion
        if (_scratchInput == null || _scratchInput.Length != input.Length)
            _scratchInput = new double[input.Length];
        for (int i = 0; i < input.Length; i++)
            _scratchInput[i] = input[i];

        int outSamples = _resampler.Process(_scratchInput, out double[] doubleOutput);

        // Convert double→float
        var output = new float[outSamples];
        for (int i = 0; i < outSamples; i++)
            output[i] = (float)doubleOutput[i];

        return output;
    }

    public void Dispose()
    {
        _resampler?.Dispose();
        _resampler = null;
    }
}
