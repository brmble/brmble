using System.Text.Json;
using Brmble.Server.Games.Continuous;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Games.Continuous;

[TestClass]
public class RealtimeSnapshotMailboxTests
{
    [TestMethod]
    public async Task SlowWriter_ReceivesLatestSnapshotNotTwentyQueuedSnapshots()
    {
        var box = new RealtimeSnapshotMailbox();
        for (var i = 1; i <= 20; i++)
            box.ReplaceSnapshot($"s{i}");

        Assert.AreEqual("s20", (await box.ReadNextAsync(default)).Json);
        Assert.AreEqual(19, box.DroppedSnapshots);
    }

    [TestMethod]
    public async Task CoalescibleControlsReplaceTheirOwnKeyAndTerminalControlsAlwaysFit()
    {
        var box = new RealtimeSnapshotMailbox();
        for (var i = 1; i <= 30; i++)
            box.WriteControl(Reject(sequence: 7, reason: $"r{i}"));
        box.WriteControl(MatchClosed(sequence: 121));

        var drained = await TakeAsync(box, 2);

        Assert.AreEqual(1, drained.Count(c => c.Type == "inputRejected"));
        Assert.AreEqual("r30", Reason(drained.Single(c => c.Type == "inputRejected")));
        Assert.IsTrue(drained.Any(c => c.Type == "matchClosed"));
        Assert.IsFalse(box.Overloaded);
    }

    [TestMethod]
    public async Task SendLoopFairness_EmitsAtMostFourControlsBeforeTheLatestSnapshot()
    {
        var box = new RealtimeSnapshotMailbox();
        for (var i = 1; i <= 6; i++)
            box.WriteControl(ConnectionState(sessionId: i, state: "reconnecting"));
        box.ReplaceSnapshot("s1");

        var first = await TakeAsync(box, 5);

        Assert.AreEqual(4, first.Count(x => x.IsControl));
        Assert.AreEqual("s1", first[4].Json);
    }

    [TestMethod]
    public async Task Coalescing_UsesTypeAndMatchingIdentifierWithoutReorderingOtherControls()
    {
        var box = new RealtimeSnapshotMailbox();
        box.WriteControl(ConnectionState(1, "disconnected"));
        box.WriteControl(ConnectionState(2, "reconnecting"));
        box.WriteControl(ConnectionState(1, "reconnecting"));
        box.WriteControl(Reject(1, "old"));
        box.WriteControl(Reject(2, "other"));
        box.WriteControl(Reject(1, "latest"));

        var controls = await TakeAsync(box, 4);

        CollectionAssert.AreEqual(
            new[] { "reconnecting", "reconnecting", "latest", "other" },
            controls.Select(StateOrReason).ToArray());
    }

    [TestMethod]
    public async Task ReservedSlots_KeepWelcomeAndMatchClosedWhenOrdinaryControlsReachFourteen()
    {
        var box = new RealtimeSnapshotMailbox();
        for (var i = 1; i <= 15; i++)
            box.WriteControl(ConnectionState(i, "reconnecting"));
        box.WriteControl(Welcome());
        box.WriteControl(MatchClosed(121));

        var controls = await TakeAsync(box, 16);

        Assert.AreEqual(14, controls.Count(x => x.Type == "connectionState"));
        Assert.AreEqual(1, controls.Count(x => x.Type == "welcome"));
        Assert.AreEqual(1, controls.Count(x => x.Type == "matchClosed"));
        Assert.IsFalse(box.Overloaded);
    }

    [TestMethod]
    public async Task FullTerminalReserve_MarksOverloadedWithoutLosingQueuedTerminalControls()
    {
        var box = new RealtimeSnapshotMailbox();
        for (var i = 1; i <= 14; i++)
            box.WriteControl(ConnectionState(i, "reconnecting"));
        box.WriteControl(Welcome());
        box.WriteControl(MatchClosed(121));
        box.WriteControl(MatchClosed(122));

        var controls = await TakeAsync(box, 16);

        Assert.IsTrue(box.Overloaded);
        Assert.AreEqual(1, controls.Count(x => x.Type == "welcome"));
        Assert.AreEqual(1, controls.Count(x => x.Type == "matchClosed"));
        Assert.IsTrue(controls.Any(x => x.Type == "matchClosed" && x.Sequence == 121));
    }

    [TestMethod]
    public async Task EmptyMailbox_CancellationCancelsPendingReadAndLeavesMailboxUsable()
    {
        var box = new RealtimeSnapshotMailbox();
        using var cancellation = new CancellationTokenSource();
        var pending = box.ReadNextAsync(cancellation.Token).AsTask();

        cancellation.Cancel();

        await Assert.ThrowsExceptionAsync<OperationCanceledException>(() => pending);
        box.ReplaceSnapshot("after-cancellation");
        Assert.AreEqual("after-cancellation", (await box.ReadNextAsync(default)).Json);
    }

    [TestMethod]
    public async Task ConcurrentSnapshotWriters_LeaveOneReadableSnapshotWithoutLostWakeup()
    {
        var box = new RealtimeSnapshotMailbox();
        var pending = box.ReadNextAsync(default).AsTask();

        await Task.WhenAll(Enumerable.Range(0, 50).Select(i => Task.Run(() => box.ReplaceSnapshot($"s{i}"))));
        var outbound = await pending.WaitAsync(TimeSpan.FromSeconds(2));

        Assert.IsFalse(outbound.IsControl);
        Assert.IsTrue(outbound.Json.StartsWith('s'));
        Assert.IsTrue(box.DroppedSnapshots >= 0);
    }

    private static async Task<List<RealtimeOutbound>> TakeAsync(RealtimeSnapshotMailbox box, int count)
    {
        var result = new List<RealtimeOutbound>(count);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
        while (result.Count < count)
            result.Add(await box.ReadNextAsync(timeout.Token));
        return result;
    }

    private static RealtimeControl ConnectionState(long sessionId, string state) => new(
        "connectionState", sessionId, null,
        JsonSerializer.Serialize(new { state }), Coalescible: true);

    private static RealtimeControl Reject(long sequence, string reason) => new(
        "inputRejected", null, sequence,
        JsonSerializer.Serialize(new { reason }), Coalescible: true);

    private static RealtimeControl Welcome() =>
        new("welcome", null, null, "{}", Coalescible: false);

    private static RealtimeControl MatchClosed(long sequence) =>
        new("matchClosed", null, sequence, "{}", Coalescible: false);

    private static string StateOrReason(RealtimeOutbound outbound)
    {
        using var json = JsonDocument.Parse(outbound.Json);
        return json.RootElement.TryGetProperty("state", out var state)
            ? state.GetString()!
            : json.RootElement.GetProperty("reason").GetString()!;
    }

    private static string Reason(RealtimeOutbound outbound)
    {
        using var json = JsonDocument.Parse(outbound.Json);
        return json.RootElement.GetProperty("reason").GetString()!;
    }
}
