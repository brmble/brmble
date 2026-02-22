using Microsoft.VisualStudio.TestTools.UnitTesting;
using Brmble.Client.Services.SpeechEnhancement;

namespace Brmble.Client.Tests;

[TestClass]
public class GtcrnModelTests
{
    [TestMethod]
    public void LoadModel_ThrowsFileNotFound_WhenModelMissing()
    {
        var modelPath = "nonexistent.onnx";
        
        Assert.ThrowsException<FileNotFoundException>(() => new GtcrnModel(modelPath));
    }
}
