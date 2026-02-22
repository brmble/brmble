using Microsoft.VisualStudio.TestTools.UnitTesting;
using Brmble.Client.Services.SpeechEnhancement;

namespace Brmble.Client.Tests.Services.SpeechEnhancement;

[TestClass]
public class GtcrnModelTests
{
    [TestMethod]
    public void LoadModel_ThrowsFileNotFound_WhenModelMissing()
    {
        var modelPath = "nonexistent.onnx";
        
        Assert.ThrowsException<FileNotFoundException>(() => new GtcrnModel(modelPath));
    }

    [TestMethod]
    public void Enhance_Disabled_ReturnsNull()
    {
        var service = new SpeechEnhancementService(modelsPath: "models", enabled: false);
        
        var input = new float[320];
        for (int i = 0; i < 320; i++)
            input[i] = (float)Math.Sin(2 * Math.PI * 440 * i / 16000);
        
        var result = service.Enhance(input);
        
        Assert.IsNull(result);
        
        service.Dispose();
    }
}
