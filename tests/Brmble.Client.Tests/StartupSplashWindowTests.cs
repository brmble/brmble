using System.Reflection;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests;

[TestClass]
public sealed class StartupSplashWindowTests
{
    [TestMethod]
    public void LoadingSplashStaysAboveLauncherWithoutTakingFocus()
    {
        var extendedStyle = StartupSplashWindow.GetExtendedWindowStyle();

        Assert.AreNotEqual(0u, extendedStyle & 0x00000008u, "The splash must stay above the launcher window.");
        Assert.AreNotEqual(0u, extendedStyle & 0x08000000u, "The splash must not steal keyboard focus.");
    }

    [TestMethod]
    public void LoadingSplashUsesPerPixelLayering()
    {
        var extendedStyle = StartupSplashWindow.GetExtendedWindowStyle();

        Assert.AreNotEqual(
            0u,
            extendedStyle & 0x00080000u,
            "The splash must use a layered window for per-pixel transparency.");
    }

    [TestMethod]
    public void LoadingSplashKeepsLogoAtFullAlpha()
    {
        Assert.AreEqual(1f, StartupSplashWindow.GetLogoAlpha());
    }

    [TestMethod]
    public void ErrorSplashCloseButtonIsOnlyHitInsideItsBounds()
    {
        Assert.IsFalse(StartupSplashWindow.IsCloseButtonHit(false, 180, 20));
        Assert.IsTrue(StartupSplashWindow.IsCloseButtonHit(true, 180, 20));
        Assert.IsFalse(StartupSplashWindow.IsCloseButtonHit(true, 165, 20));
    }

    [TestMethod]
    public void StartupSplashCanResolveItsModuleHandle()
    {
        var method = typeof(StartupSplashWindow).GetMethod(
            "GetModuleHandle",
            BindingFlags.NonPublic | BindingFlags.Static);

        Assert.IsNotNull(method);

        try
        {
            var moduleHandle = method.Invoke(null, new object?[] { null });
            Assert.AreNotEqual(IntPtr.Zero, moduleHandle);
        }
        catch (TargetInvocationException exception)
        {
            Assert.Fail($"The native module-handle import could not be called: {exception.InnerException}");
        }
    }

    [TestMethod]
    public async Task StartupPreviewDelayYieldsToTheMessageLoop()
    {
        var previousValue = Environment.GetEnvironmentVariable("BRMBLE_STARTUP_DELAY_SECONDS");
        try
        {
            Environment.SetEnvironmentVariable("BRMBLE_STARTUP_DELAY_SECONDS", "1");
            var method = typeof(Program).GetMethod(
                "ApplyStartupTestDelayAsync",
                BindingFlags.NonPublic | BindingFlags.Static);

            Assert.IsNotNull(method);
            var delayTask = method!.Invoke(null, null) as Task;

            Assert.IsNotNull(delayTask);
            Assert.IsFalse(delayTask!.IsCompleted, "The preview delay must yield instead of blocking the UI thread.");
            await delayTask;
        }
        finally
        {
            Environment.SetEnvironmentVariable("BRMBLE_STARTUP_DELAY_SECONDS", previousValue);
        }
    }
}
