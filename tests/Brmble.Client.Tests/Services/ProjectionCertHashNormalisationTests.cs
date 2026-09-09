using System.Collections.Concurrent;
using System.Net;
using System.Reflection;
using Brmble.Client.Services.Voice.Projection;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using MumbleSharp;
using MumbleSharp.Model;

namespace Brmble.Client.Tests.Services;

/// <summary>
/// The seam between MumbleAdapter's translation and the store's reset occupant check.
/// </summary>
/// <remarks>
/// MumbleSharp initialises <c>User.CertificateHash</c> to <see cref="string.Empty"/> and never
/// nulls it, so "this user has no certificate" only reaches the store as <c>null</c> if the
/// adapter normalises it. Whether it does decides two things: whether
/// <c>IsSameOccupant</c> consults the name at all, and whether <c>UserProjection.CertHash</c>
/// can fall back to the server's recorded copy.
/// </remarks>
[TestClass]
public class ProjectionCertHashNormalisationTests
{
    private static MumbleUserInput Translate(User user)
    {
        var bridge = NativeBridgeTestHarness.Create();
        var adapter = MumbleAdapterTestHarness.CreateWithBridge(bridge);
        var method = typeof(Brmble.Client.Services.Voice.MumbleAdapter)
            .GetMethod("ToProjectionInput", BindingFlags.Instance | BindingFlags.NonPublic)!;
        return (MumbleUserInput)method.Invoke(adapter, [user])!;
    }

    private static User UserWithoutCertificate(uint session, string name)
    {
        var bridge = NativeBridgeTestHarness.Create();
        var adapter = MumbleAdapterTestHarness.CreateWithBridge(bridge);
        var connection = new MumbleConnection(
            new IPEndPoint(IPAddress.Loopback, 64738), adapter, voiceSupport: false);
        adapter.Initialise(connection);
        // CertificateHash is deliberately left at its default rather than assigned.
        return new User(adapter, session) { Name = name };
    }

    [TestMethod]
    public void AnUnauthenticatedUserTranslatesToANullCertHash()
    {
        var input = Translate(UserWithoutCertificate(5, "Alice"));

        Assert.IsNull(input.CertHash,
            "an empty hash is an absent certificate, not a certificate whose value is empty");
    }

    [TestMethod]
    public void TwoUnauthenticatedUsersAreNotTreatedAsTheSameOccupant()
    {
        // Session 5 was Alice. She left unseen and Bob took the recycled id. Neither holds a
        // certificate. If the empty hash reached the store as "" the equality check would
        // succeed on two empty strings, the name would never be consulted, and Bob would
        // inherit Alice's identity — the exact recycling defect the occupant check prevents.
        var store = new UserProjectionStore();
        store.ApplyMumbleReset([Translate(UserWithoutCertificate(5, "Alice"))]);
        store.ApplyServerSnapshot(new ServerSnapshot("i", 1,
            new Dictionary<uint, ServerMappingEntry> { [5] = new("@alice:test", "retro", true, null) }));

        var change = store.ApplyMumbleReset([Translate(UserWithoutCertificate(5, "Bob"))]);

        var row = change.Changed.Single();
        Assert.AreEqual("Bob", row.Name);
        Assert.IsNull(row.MatrixUserId, "Bob must not inherit Alice's matrix id");
        Assert.IsNull(row.CompanionId, "Bob must not inherit Alice's companion");
        Assert.IsNull(row.IsBrmbleClient, "Bob must not inherit Alice's Brmble badge");
    }

    [TestMethod]
    public void AnUnauthenticatedUserKeepsIdentityWhenTheNameIsUnchanged()
    {
        // The other half of the rule: a certificate-less user who reconnects onto the same id
        // under the same name is the same person and keeps their enrichment.
        var store = new UserProjectionStore();
        store.ApplyMumbleReset([Translate(UserWithoutCertificate(5, "Alice"))]);
        store.ApplyServerSnapshot(new ServerSnapshot("i", 1,
            new Dictionary<uint, ServerMappingEntry> { [5] = new("@alice:test", "retro", true, null) }));

        var change = store.ApplyMumbleReset([Translate(UserWithoutCertificate(5, "Alice"))]);

        var row = change.Changed.Single();
        Assert.AreEqual("@alice:test", row.MatrixUserId);
        Assert.AreEqual("retro", row.CompanionId);
    }

    [TestMethod]
    public void AnAbsentLiveCertificateFallsBackToTheServersRecordedCopy()
    {
        // CertHash is MumbleCertHash ?? ServerCertHash. An empty live hash is not null, so it
        // would win the coalesce and blank a hash the server can still supply.
        var store = new UserProjectionStore();
        store.ApplyMumbleReset([Translate(UserWithoutCertificate(5, "Alice"))]);
        store.ApplyServerSnapshot(new ServerSnapshot("i", 1,
            new Dictionary<uint, ServerMappingEntry> { [5] = new("@alice:test", null, null, "stored-hash") }));

        Assert.AreEqual("stored-hash", store.Snapshot()[5].CertHash);
    }
}
