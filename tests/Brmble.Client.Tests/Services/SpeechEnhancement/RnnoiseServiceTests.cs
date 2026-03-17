using System.Runtime.InteropServices;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Brmble.Client.Services.AppConfig;
using Brmble.Client.Services.SpeechEnhancement;

namespace Brmble.Client.Tests.Services.SpeechEnhancement;

[TestClass]
public class RnnoiseServiceTests
{
    [TestMethod]
    public void IsEnabled_ReturnsFalse_WhenDisabled()
    {
        using var service = new RnnoiseService(SpeechDenoiseMode.None);
        
        Assert.IsFalse(service.IsEnabled);
    }

    [TestMethod]
    public void IsEnabled_ReturnsTrue_WhenRnnoiseMode()
    {
        if (!NativeLibrary.TryLoad("renamenoise", out _))
        {
            Assert.Inconclusive("renamenoise.dll not found on this system");
            return;
        }
        
        using var service = new RnnoiseService(SpeechDenoiseMode.Rnnoise);
        
        Assert.IsTrue(service.IsEnabled);
    }

    [TestMethod]
    public void Constructor_DoesNotThrow_WhenDisabledAndNoDll()
    {
        var service = new RnnoiseService(SpeechDenoiseMode.None);
        
        Assert.IsNotNull(service);
    }

    [TestMethod]
    public void Dispose_IsIdempotent()
    {
        using var service = new RnnoiseService(SpeechDenoiseMode.Rnnoise);
        
        service.Dispose();
        service.Dispose();
    }
}
