using Microsoft.VisualStudio.TestTools.UnitTesting;
using Brmble.Client.Services.AppConfig;
using Brmble.Client.Services.SpeechEnhancement;

namespace Brmble.Client.Tests.Services.SpeechEnhancement;

[TestClass]
public class RnnoiseServiceTests
{
    [TestMethod]
    public void IsEnabled_ReturnsFalse_WhenDisabledMode()
    {
        using var service = new RnnoiseService(SpeechDenoiseMode.Disabled);
        Assert.IsFalse(service.IsEnabled);
    }

    [TestMethod]
    public void IsEnabled_IsFalse_WhenDllMissing()
    {
        using var service = new RnnoiseService(SpeechDenoiseMode.Rnnoise);
        Assert.IsFalse(service.IsEnabled);
    }

    [TestMethod]
    public void Process_ThrowsInvalidOperationException_WhenNotEnabled()
    {
        using var service = new RnnoiseService(SpeechDenoiseMode.Disabled);
        var buffer = new float[480];
        Assert.ThrowsException<InvalidOperationException>(() => service.Process(buffer));
    }

    [TestMethod]
    public void Process_ThrowsInvalidOperationException_WhenDllMissing()
    {
        using var service = new RnnoiseService(SpeechDenoiseMode.Rnnoise);
        var buffer = new float[480];
        Assert.ThrowsException<InvalidOperationException>(() => service.Process(buffer));
    }

    [TestMethod]
    public void FrameSize_Returns480()
    {
        Assert.AreEqual(480, RnnoiseService.FrameSize);
    }
}
