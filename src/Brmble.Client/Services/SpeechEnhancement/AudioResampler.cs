namespace Brmble.Client.Services.SpeechEnhancement;

public sealed class AudioResampler
{
    private readonly int _sourceRate;
    private readonly int _targetRate;

    public AudioResampler(int sourceRate, int targetRate, int channels)
    {
        _sourceRate = sourceRate;
        _targetRate = targetRate;
    }

    public float[] Resample(ReadOnlySpan<float> input)
    {
        if (input.Length == 0)
            return Array.Empty<float>();

        var outputLength = (int)((long)input.Length * _targetRate / _sourceRate);
        var output = new float[outputLength];

        var ratio = (double)_sourceRate / _targetRate;
        
        for (int i = 0; i < outputLength; i++)
        {
            var sourceIndex = i * ratio;
            var sourceIndexInt = (int)sourceIndex;
            var fraction = sourceIndex - sourceIndexInt;

            if (sourceIndexInt >= input.Length - 1)
            {
                output[i] = sourceIndexInt < input.Length ? input[sourceIndexInt] : 0;
            }
            else
            {
                output[i] = (float)((1 - fraction) * input[sourceIndexInt] + fraction * input[sourceIndexInt + 1]);
            }
        }

        return output;
    }
}
