using Brmble.Client.Services.Voice.Projection;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services;

/// <summary>
/// The design's central property: given the same starting point and the same final snapshot,
/// any permutation of the intervening events — with any subset dropped — converges on the same
/// projection. Ordering and delivery become irrelevant to correctness.
/// </summary>
[TestClass]
public class UserProjectionConvergenceTests
{
    private static readonly MumbleUserInput[] Users =
    [
        new(1, "Alice", 0, false, false, null, null, false),
        new(2, "Bob", 0, false, false, null, null, false),
        new(3, "Carol", 0, false, false, null, null, false)
    ];

    private static readonly ServerSnapshot Final = new("inst-a", 100,
        new Dictionary<uint, ServerMappingEntry>
        {
            [1] = new("@alice:test", "retro", true, "cert-a"),
            // Session 2 is deliberately absent. Events below enrich it, so a patch-only
            // reconciliation would leave it enriched in some trials and not others — this is
            // what makes the property test able to catch a §4.3 regression rather than passing
            // trivially because the final snapshot overwrites everything.
            [3] = new("@carol:test", "pip", null, null)
        });

    private static ServerEvent[] BuildEvents() =>
    [
        new(ServerEventKind.CompanionChanged, "inst-a", 10, 11, 1, new ServerMappingEntry(null, "bee", null, null)),
        new(ServerEventKind.BrmbleActivated, "inst-a", 11, 12, 2),
        new(ServerEventKind.CompanionChanged, "inst-a", 12, 20, 3, new ServerMappingEntry(null, "floppy", null, null)),
        new(ServerEventKind.BrmbleDeactivated, "inst-a", 20, 21, 1),
        new(ServerEventKind.MappingRemoved, "inst-a", 21, 25, 2),
        new(ServerEventKind.CompanionChanged, "inst-a", 25, 26, 1, new ServerMappingEntry(null, "pip", null, null))
    ];

    private static UserProjectionStore Seeded()
    {
        var store = new UserProjectionStore();
        foreach (var user in Users) store.ApplyMumbleUserState(user);
        store.ApplyServerSnapshot(new ServerSnapshot("inst-a", 10,
            new Dictionary<uint, ServerMappingEntry>
            {
                [1] = new("@alice:test", "retro", null, null),
                [2] = new("@bob:test", "bee", null, null),
                [3] = new("@carol:test", "pip", null, null)
            }));
        return store;
    }

    private static string Describe(IReadOnlyDictionary<uint, UserProjection> rows) =>
        string.Join("|", rows.OrderBy(r => r.Key).Select(r =>
            $"{r.Key}:{r.Value.Name}:{r.Value.MatrixUserId}:{r.Value.CompanionId}:" +
            $"{r.Value.IsBrmbleClient?.ToString() ?? "unknown"}:{r.Value.CertHash ?? "none"}"));

    [TestMethod]
    public void AnyPermutationWithAnyDropsConvergesOnTheSameProjection()
    {
        var reference = Seeded();
        foreach (var evt in BuildEvents()) reference.ApplyServerEvent(evt);
        reference.ApplyServerSnapshot(Final);
        var expected = Describe(reference.Snapshot());

        var random = new Random(20260801);

        for (var trial = 0; trial < 500; trial++)
        {
            var events = BuildEvents().ToList();

            // Shuffle.
            for (var i = events.Count - 1; i > 0; i--)
            {
                var j = random.Next(i + 1);
                (events[i], events[j]) = (events[j], events[i]);
            }

            // Drop an arbitrary subset.
            events = events.Where(_ => random.Next(4) != 0).ToList();

            var store = Seeded();
            foreach (var evt in events) store.ApplyServerEvent(evt);
            store.ApplyServerSnapshot(Final);

            Assert.AreEqual(expected, Describe(store.Snapshot()),
                $"trial {trial} diverged with {events.Count} of 6 events");
        }
    }

    [TestMethod]
    public void ASessionTheFinalSnapshotOmitsEndsUnknownRegardlessOfWhatEventsSaid()
    {
        // Guards the guard: this is the case that makes the permutation test load-bearing. If
        // snapshot reconciliation regressed to patch-only, session 2 would keep whatever the
        // events happened to set and the permutations would diverge.
        var withEvent = Seeded();
        withEvent.ApplyServerEvent(new ServerEvent(ServerEventKind.BrmbleActivated, "inst-a", 10, 12, 2));
        withEvent.ApplyServerSnapshot(Final);

        var withoutEvent = Seeded();
        withoutEvent.ApplyServerSnapshot(Final);

        Assert.IsNull(withEvent.Snapshot()[2].IsBrmbleClient);
        Assert.IsNull(withEvent.Snapshot()[2].MatrixUserId);
        Assert.AreEqual(Describe(withoutEvent.Snapshot()), Describe(withEvent.Snapshot()));
    }

    [TestMethod]
    public void ADroppedEventNeverProducesAConfidentlyWrongValue()
    {
        // The failure this design exists to remove: a lost event must leave a field unknown or
        // stale-but-true, never asserted wrong.
        var store = Seeded();

        // Alice's deactivation is dropped; her later companion change still arrives.
        store.ApplyServerEvent(new ServerEvent(
            ServerEventKind.CompanionChanged, "inst-a", 20, 26, 1,
            new ServerMappingEntry(null, "pip", null, null)));

        var alice = store.Snapshot()[1];
        Assert.AreEqual("retro", alice.CompanionId, "the gapped event must not be applied");
        Assert.IsNull(alice.IsBrmbleClient, "and must not invent a badge state");
    }

    [TestMethod]
    public void AGapIsAlwaysReportedSoTheCallerCanRepairIt()
    {
        var store = Seeded();

        var change = store.ApplyServerEvent(new ServerEvent(
            ServerEventKind.CompanionChanged, "inst-a", 50, 51, 1,
            new ServerMappingEntry(null, "pip", null, null)));

        Assert.IsTrue(change.NeedsSnapshot);
    }
}
