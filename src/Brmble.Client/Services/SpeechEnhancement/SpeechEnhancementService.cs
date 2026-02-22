namespace Brmble.Client.Services.SpeechEnhancement;

public enum GtcrnModelVariant
{
    Dns3,
    VctkDemand
}

public sealed class SpeechEnhancementService : IDisposable
{
    private readonly GtcrnModel? _model;
    private readonly bool _enabled;
    private readonly string _modelsPath;

    public bool IsEnabled => _enabled;

    public SpeechEnhancementService(string modelsPath, bool enabled = true, GtcrnModelVariant variant = GtcrnModelVariant.Dns3)
    {
        _modelsPath = modelsPath;
        _enabled = enabled;

        // Note: variant parameter reserved for future use. Currently only gtcrn_simple.onnx is available.
        if (!enabled)
            return;

        var modelFile = "gtcrn_simple.onnx";

        var modelPath = Path.Combine(modelsPath, modelFile);
        
        try
        {
            _model = new GtcrnModel(modelPath);
        }
        catch (FileNotFoundException)
        {
            _enabled = false;
        }
    }

    public float[]? Enhance(float[] input16kHz)
    {
        if (!_enabled || _model == null)
            return null;

        return _model.Process(input16kHz);
    }

    public void Dispose()
    {
        _model?.Dispose();
    }
}
