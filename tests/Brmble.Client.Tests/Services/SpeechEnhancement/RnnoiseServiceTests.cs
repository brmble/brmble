using Microsoft.VisualStudio.TestTools.UnitTesting;
using Brmble.Client.Services.AppConfig;
using Brmble.Client.Services.SpeechEnhancement;
using System.Runtime.InteropServices;

namespace Brmble.Client.Tests.Services.SpeechEnhancement;

[TestClass]
public class RnnoiseServiceTests
{
    private static bool IsDllPresent()
    {
        try
        {
            return RuntimeInformation.IsOSPlatform(OSPlatform.Windows) && 
                   NativeLibrary.TryLoad("renamenoise.dll", out _);
        }
        catch
        {
            return false;
        }
    }

    private static readonly bool _dllPresent = IsDllPresent();

    [TestMethod]
    public void IsEnabled_ReturnsFalse_WhenDisabledMode()
    {
        using var service = new RnnoiseService(SpeechDenoiseMode.Disabled);
        Assert.IsFalse(service.IsEnabled);
    }

    [TestMethod]
    public void IsEnabled_ReturnsFalse_WhenDllMissing()
    {
        if (_dllPresent)
        {
            Assert.Inconclusive("renamenoise.dll is present; test assumes DLL is missing.");
            return;
        }
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
        if (_dllPresent)
        {
            Assert.Inconclusive("renamenoise.dll is present; test assumes DLL is missing.");
            return;
        }
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
