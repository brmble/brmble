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

        if (!enabled)
            return;

        if (variant != GtcrnModelVariant.Dns3)
            throw new NotSupportedException(
                $"Model variant '{variant}' is not supported. Only '{GtcrnModelVariant.Dns3}' is currently available.");

        var modelFile = "gtcrn_simple.onnx";

        var modelPath = Path.Combine(modelsPath, modelFile);
        
        try
        {
            _model = new GtcrnModel(modelPath);
        }
        catch (FileNotFoundException ex)
        {
            Console.Error.WriteLine(
                $"Speech enhancement model file not found at '{modelPath}'. " +
                $"Disabling speech enhancement. Details: {ex.Message}");
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
