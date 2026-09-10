using System.Linq;
using System.Text.Json;
using System.Threading;
using System.IO;
using Brmble.Client.Tests.Services;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests;

[TestClass]
public sealed class StartupHandoffTests
{
    [TestMethod]
    public void WebViewInitializationUsesStableControllerReferenceAfterCreation()
    {
        var sourcePath = Path.GetFullPath(Path.Combine(
            AppContext.BaseDirectory,
            "..", "..", "..", "..", "..", "src", "Brmble.Client", "Program.cs"));
        var source = File.ReadAllText(sourcePath);
        var assignmentStart = source.IndexOf(
            "var controller = await env.CreateCoreWebView2ControllerAsync(hwnd);",
            StringComparison.Ordinal);
        if (assignmentStart < 0)
        {
            assignmentStart = source.IndexOf(
                "_controller = await env.CreateCoreWebView2ControllerAsync(hwnd);",
                StringComparison.Ordinal);
        }
        var catchStart = source.IndexOf(
            "catch (Exception ex)",
            assignmentStart,
            StringComparison.Ordinal);
        var initialization = source.Substring(assignmentStart, catchStart - assignmentStart);

        Assert.IsTrue(assignmentStart >= 0);
        Assert.IsTrue(catchStart > assignmentStart);
        StringAssert.Contains(initialization, "_controller = controller;");
        Assert.IsFalse(
            initialization.Contains("_controller.", StringComparison.Ordinal)
                || initialization.Contains("_controller!", StringComparison.Ordinal),
            "Initialization must use its stable local controller reference after cancellation can clear the static field.");
    }

    [TestMethod]
    public void NavigationCompletionChecksCancellationBeforeDereferencingController()
    {
        var sourcePath = Path.GetFullPath(Path.Combine(
            AppContext.BaseDirectory,
            "..", "..", "..", "..", "..", "src", "Brmble.Client", "Program.cs"));
        var source = File.ReadAllText(sourcePath);
        var handlerStart = source.IndexOf(
            "onMainNavigationCompleted = (_, e) =>",
            StringComparison.Ordinal);
        var handlerEnd = source.IndexOf("};", handlerStart, StringComparison.Ordinal);
        var handler = source.Substring(handlerStart, handlerEnd - handlerStart);
        var cancellationCheck = handler.IndexOf(
            "if (_startupCancelled || controller is null)",
            StringComparison.Ordinal);
        var controllerDereference = handler.IndexOf(
            "controller.CoreWebView2.NavigationCompleted -= onMainNavigationCompleted;",
            StringComparison.Ordinal);

        Assert.IsTrue(handlerStart >= 0);
        Assert.IsTrue(handlerEnd > handlerStart);
        Assert.IsTrue(cancellationCheck >= 0);
        Assert.IsTrue(controllerDereference >= 0);
        Assert.IsTrue(
            cancellationCheck < controllerDereference,
            "A queued navigation completion must not dereference a controller cleared by cancellation.");
    }

    [TestMethod]
    public async Task SuccessfulNavigationDoesNotRevealUntilAppReady()
    {
        var bridge = NativeBridgeTestHarness.Create();
        var readyCount = 0;
        var failureCount = 0;
        var handoff = new StartupHandoff(
            onReady: () => readyCount++,
            onFailure: () => failureCount++);
        handoff.Register(bridge);

        handoff.OnMainNavigationCompleted(isSuccess: true);

        Assert.AreEqual(0, readyCount);
        Assert.AreEqual(0, failureCount);

        await NativeBridgeTestHarness.InvokeAsync(
            bridge,
            StartupHandoff.ReadyMessageType,
            JsonSerializer.SerializeToElement(new { }));

        Assert.AreEqual(1, readyCount);
        Assert.AreEqual(0, failureCount);
    }

    [TestMethod]
    public async Task AppReadyRevealsExactlyOnce()
    {
        var bridge = NativeBridgeTestHarness.Create();
        var readyCount = 0;
        var handoff = new StartupHandoff(
            onReady: () => Interlocked.Increment(ref readyCount),
            onFailure: () => { });
        handoff.Register(bridge);
        var data = JsonSerializer.SerializeToElement(new { });

        await Task.WhenAll(
            Enumerable.Range(0, 8)
                .Select(_ => NativeBridgeTestHarness.InvokeAsync(
                    bridge,
                    StartupHandoff.ReadyMessageType,
                    data)));

        Assert.AreEqual(1, readyCount);
    }

    [TestMethod]
    public async Task FailedNavigationShowsFailureAndBlocksLaterAppReady()
    {
        var bridge = NativeBridgeTestHarness.Create();
        var readyCount = 0;
        var failureCount = 0;
        var handoff = new StartupHandoff(
            onReady: () => readyCount++,
            onFailure: () => failureCount++);
        handoff.Register(bridge);

        handoff.OnMainNavigationCompleted(isSuccess: false);

        await NativeBridgeTestHarness.InvokeAsync(
            bridge,
            StartupHandoff.ReadyMessageType,
            JsonSerializer.SerializeToElement(new { }));

        Assert.AreEqual(0, readyCount);
        Assert.AreEqual(1, failureCount);
    }

    [TestMethod]
    public async Task AppReadyBlocksALateFailureTransition()
    {
        var bridge = NativeBridgeTestHarness.Create();
        var readyCount = 0;
        var failureCount = 0;
        var handoff = new StartupHandoff(
            onReady: () => readyCount++,
            onFailure: () => failureCount++);
        handoff.Register(bridge);

        await NativeBridgeTestHarness.InvokeAsync(
            bridge,
            StartupHandoff.ReadyMessageType,
            JsonSerializer.SerializeToElement(new { }));

        handoff.OnMainNavigationCompleted(isSuccess: false);

        Assert.AreEqual(1, readyCount);
        Assert.AreEqual(0, failureCount);
    }
}
