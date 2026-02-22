using Microsoft.ML.OnnxRuntime;
using Microsoft.ML.OnnxRuntime.Tensors;

namespace Brmble.Client.Services.SpeechEnhancement;

public sealed class GtcrnModel : IDisposable
{
    private readonly InferenceSession _session;
    private readonly int _sampleRate = 16000;
    private readonly int _expectedSamples = 320;

    public GtcrnModel(string modelPath)
    {
        if (!File.Exists(modelPath))
            throw new FileNotFoundException($"Model not found: {modelPath}");
        
        var sessionOptions = new SessionOptions();
        sessionOptions.GraphOptimizationLevel = GraphOptimizationLevel.ORT_ENABLE_ALL;
        _session = new InferenceSession(modelPath, sessionOptions);
    }

    public ReadOnlySpan<float> Process(ReadOnlySpan<float> input16kHz)
    {
        if (input16kHz.Length == 0)
            return ReadOnlySpan<float>.Empty;

        var input = new float[_expectedSamples];
        var len = Math.Min(input16kHz.Length, _expectedSamples);
        input16kHz.Slice(0, len).CopyTo(input.AsSpan(0, len));

        var inputTensor = new DenseTensor<float>(input, new[] { 1, _expectedSamples });
        var inputs = new List<NamedOnnxValue>
        {
            NamedOnnxValue.CreateFromTensor("input", inputTensor)
        };

        using var results = _session.Run(inputs);
        var output = results.FirstOrDefault()?.AsTensor<float>().ToArray() ?? Array.Empty<float>();

        return new ReadOnlySpan<float>(output);
    }

    public void Dispose() => _session.Dispose();
}
