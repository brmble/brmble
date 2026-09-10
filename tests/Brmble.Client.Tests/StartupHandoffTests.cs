using System.Linq;
using System.Text.Json;
using System.Threading;
using Brmble.Client.Tests.Services;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests;

[TestClass]
public sealed class StartupHandoffTests
{
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
