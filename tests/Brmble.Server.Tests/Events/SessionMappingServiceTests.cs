using Brmble.Server.Events;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Events;

[TestClass]
public class SessionMappingServiceTests
{
    private SessionMappingService _svc = null!;

    [TestInitialize]
    public void Setup() => _svc = new SessionMappingService();

    [TestMethod]
    public void SetNameForSession_AllowsLookupByName()
    {
        _svc.SetNameForSession("Alice", 1);
        Assert.IsTrue(_svc.TryGetSessionId("Alice", out var sid));
        Assert.AreEqual(1, sid);
    }

    [TestMethod]
    public void TryAddMatrixUser_ReturnsTrueFirstTime_FalseSecondTime()
    {
        _svc.SetNameForSession("Alice", 1);
        Assert.IsTrue(_svc.TryAddMatrixUser(1, "@1:server", "Alice", 1L, "bee"));
        Assert.IsFalse(_svc.TryAddMatrixUser(1, "@1:server", "Alice", 1L, "bee"));
    }

    [TestMethod]
    public void TryGetMatrixUserId_ReturnsMappingAfterAdd()
    {
        _svc.SetNameForSession("Alice", 1);
        _svc.TryAddMatrixUser(1, "@1:server", "Alice", 1L, "bee");
        Assert.IsTrue(_svc.TryGetMatrixUserId(1, out var matrixId));
        Assert.AreEqual("@1:server", matrixId);
    }

    [TestMethod]
    public void TryGetMatrixUserId_ReturnsFalseWhenNotMapped()
    {
        Assert.IsFalse(_svc.TryGetMatrixUserId(999, out var matrixId));
        Assert.IsNull(matrixId);
    }

    [TestMethod]
    public void RemoveSession_CleansUpBothMaps()
    {
        _svc.SetNameForSession("Alice", 1);
        _svc.TryAddMatrixUser(1, "@1:server", "Alice", 1L, "bee");
        _svc.RemoveSession(1);
        Assert.IsFalse(_svc.TryGetMatrixUserId(1, out _));
        Assert.IsFalse(_svc.TryGetSessionId("Alice", out _));
        Assert.IsFalse(_svc.TryGetSessionByUserId(1L, out _));
    }

    [TestMethod]
    public void RemoveSession_CleansUpNameEvenWithoutMatrixMapping()
    {
        _svc.SetNameForSession("Bob", 2);
        _svc.RemoveSession(2);
        Assert.IsFalse(_svc.TryGetSessionId("Bob", out _));
    }

    [TestMethod]
    public void GetSnapshot_ReturnsCurrentMappings()
    {
        _svc.SetNameForSession("Alice", 1);
        _svc.TryAddMatrixUser(1, "@1:server", "Alice", 1L, "bee");
        _svc.SetNameForSession("Bob", 2);
        _svc.TryAddMatrixUser(2, "@2:server", "Bob", 2L, "bee");
        var snapshot = _svc.GetSnapshot();
        Assert.AreEqual(2, snapshot.Count);
        Assert.AreEqual("@1:server", snapshot[1].MatrixUserId);
        Assert.AreEqual("Alice", snapshot[1].MumbleName);
        Assert.AreEqual(1L, snapshot[1].UserId);
        Assert.AreEqual("@2:server", snapshot[2].MatrixUserId);
    }

    [TestMethod]
    public void GetSnapshot_IsIsolatedFromMutations()
    {
        _svc.SetNameForSession("Alice", 1);
        _svc.TryAddMatrixUser(1, "@1:server", "Alice", 1L, "bee");
        var snapshot = _svc.GetSnapshot();
        _svc.RemoveSession(1);
        Assert.AreEqual(1, snapshot.Count);
    }

    [TestMethod]
    public void TryGetSessionByUserId_ReturnsSessionAfterAdd()
    {
        _svc.SetNameForSession("Alice", 1);
        _svc.TryAddMatrixUser(1, "@1:server", "Alice", 42L, "bee");
        Assert.IsTrue(_svc.TryGetSessionByUserId(42L, out var sessionId));
        Assert.AreEqual(1, sessionId);
    }

    [TestMethod]
    public void TryAddMatrixUser_ExistingSession_RefreshesUserIdIndex()
    {
        Assert.IsTrue(_svc.TryAddMatrixUser(1, "@old:server", "Alice", 10L, "bee"));

        Assert.IsFalse(_svc.TryAddMatrixUser(1, "@new:server", "Alice", 42L, "bee"));

        Assert.IsTrue(_svc.TryGetSessionByUserId(42L, out var sessionId));
        Assert.AreEqual(1, sessionId);
    }

    [TestMethod]
    public void TryGetMappingByUserId_DoesNotReturnMappingForDifferentUser()
    {
        Assert.IsTrue(_svc.TryAddMatrixUser(1, "@old:server", "Alice", 10L, "bee"));
        Assert.IsFalse(_svc.TryAddMatrixUser(1, "@new:server", "Alice", 42L, "bee"));

        Assert.IsFalse(_svc.TryGetMappingByUserId(42L, out _, out _));
    }

    [TestMethod]
    public void TryGetSessionByUserId_ReturnsFalseWhenNotMapped()
    {
        Assert.IsFalse(_svc.TryGetSessionByUserId(999L, out _));
    }

    [TestMethod]
    public void TryGetMappingByUserId_ReturnsSessionAndMapping()
    {
        Assert.IsTrue(_svc.TryAddMatrixUser(1, "@alice:server", "Alice", 42L, "bee"));

        Assert.IsTrue(_svc.TryGetMappingByUserId(42L, out var sessionId, out var mapping));
        Assert.AreEqual(1, sessionId);
        Assert.AreEqual("@alice:server", mapping!.MatrixUserId);
        Assert.AreEqual("Alice", mapping.MumbleName);
    }

    [TestMethod]
    public void TryUpdateCompanionId_UpdatesExistingMapping()
    {
        _svc.TryAddMatrixUser(42, "@alice:test", "Alice", 100L, "bee");

        var updated = _svc.TryUpdateCompanionId(42, "floppy");

        Assert.IsTrue(updated);
        Assert.AreEqual("floppy", _svc.GetSnapshot()[42].CompanionId);
    }

    [TestMethod]
    public void TryUpdateCompanionIdIfCurrent_PreservesNewerSelection()
    {
        _svc.TryAddMatrixUser(42, "@alice:test", "Alice", 100L, "bee");

        var updated = _svc.TryUpdateCompanionIdIfCurrent(42, "custom:$sprite:test", "floppy");

        Assert.IsFalse(updated);
        Assert.AreEqual("bee", _svc.GetSnapshot()[42].CompanionId);
    }

    [TestMethod]
    public void TryUpdateCompanionIdIfOwnedBy_UpdatesWhenSessionStillOwnedByUser()
    {
        _svc.TryAddMatrixUser(42, "@alice:test", "Alice", 100L, "bee");

        var updated = _svc.TryUpdateCompanionIdIfOwnedBy(42, 100L, "floppy");

        Assert.IsTrue(updated);
        Assert.AreEqual("floppy", _svc.GetSnapshot()[42].CompanionId);
    }

    [TestMethod]
    public void TryUpdateCompanionIdIfOwnedBy_RejectsRecycledSession()
    {
        // Session 42 was released by user 100 and reclaimed by user 200 — a write carrying
        // the old owner's userId must not land on the new owner's mapping.
        _svc.TryAddMatrixUser(42, "@bob:test", "Bob", 200L, "bee");

        var updated = _svc.TryUpdateCompanionIdIfOwnedBy(42, 100L, "floppy");

        Assert.IsFalse(updated);
        Assert.AreEqual("bee", _svc.GetSnapshot()[42].CompanionId);
    }

    [TestMethod]
    public void TryUpdateCompanionIdIfOwnedBy_ReturnsFalseWhenMappingIsMissing()
    {
        Assert.IsFalse(_svc.TryUpdateCompanionIdIfOwnedBy(42, 100L, "floppy"));
    }

    [TestMethod]
    public void TryUpdateCertHash_UpdatesExistingMapping()
    {
        _svc.TryAddMatrixUser(42, "@alice:test", "Alice", 100L, "bee");

        var updated = _svc.TryUpdateCertHash(42, "cert-alice");

        Assert.IsTrue(updated);
        Assert.AreEqual("cert-alice", _svc.GetSnapshot()[42].CertHash);
    }

    [TestMethod]
    public void Revision_StartsAtZeroAndIncrementsOnEverySuccessfulMutation()
    {
        Assert.AreEqual(0L, _svc.Revision);

        _svc.TryAddMatrixUser(1, "@1:server", "Alice", 1L, "bee");
        Assert.AreEqual(1L, _svc.Revision);

        _svc.TryUpdateCompanionId(1, "retro");
        Assert.AreEqual(2L, _svc.Revision);

        _svc.TryUpdateBrmbleStatus(1, true);
        Assert.AreEqual(3L, _svc.Revision);

        _svc.TryUpdateCertHash(1, "abc");
        Assert.AreEqual(4L, _svc.Revision);

        _svc.TryUpdateCompanionIdIfOwnedBy(1, 1L, "pip");
        Assert.AreEqual(5L, _svc.Revision);

        _svc.RemoveSession(1);
        Assert.AreEqual(6L, _svc.Revision);
    }

    [TestMethod]
    public void Revision_DoesNotIncrementWhenMutationDoesNotApply()
    {
        _svc.TryAddMatrixUser(1, "@1:server", "Alice", 1L, "bee");
        var before = _svc.Revision;

        // Session 99 has no mapping, so none of these change anything.
        Assert.IsFalse(_svc.TryUpdateCompanionId(99, "retro"));
        Assert.IsFalse(_svc.TryUpdateBrmbleStatus(99, true));
        Assert.IsFalse(_svc.TryUpdateCertHash(99, "abc"));
        _svc.RemoveSession(99);

        // A CAS whose expected value does not match must not bump either.
        Assert.IsFalse(_svc.TryUpdateCompanionIdIfCurrent(1, "notthecurrentone", "pip"));

        // Nor one whose owning userId does not match.
        Assert.IsFalse(_svc.TryUpdateCompanionIdIfOwnedBy(1, 999L, "pip"));

        Assert.AreEqual(before, _svc.Revision);
    }

    [TestMethod]
    public void InstanceId_IsStableWithinAnInstanceAndDiffersAcrossInstances()
    {
        var first = _svc.InstanceId;

        _svc.TryAddMatrixUser(1, "@1:server", "Alice", 1L, "bee");
        Assert.AreEqual(first, _svc.InstanceId, "InstanceId must not change while the process lives");
        Assert.IsFalse(string.IsNullOrWhiteSpace(first));

        var replacement = new SessionMappingService();
        Assert.AreNotEqual(first, replacement.InstanceId, "a restart must be observable");
        Assert.AreEqual(0L, replacement.Revision);
    }

    [TestMethod]
    public void Revision_IsMonotonicUnderConcurrentMutations()
    {
        for (var i = 0; i < 200; i++)
            _svc.TryAddMatrixUser(i, $"@{i}:server", $"U{i}", i, "bee");

        Parallel.For(0, 200, i => _svc.TryUpdateCompanionId(i, "retro"));

        // 200 adds + 200 updates, none of them lost to a read-modify-write race.
        Assert.AreEqual(400L, _svc.Revision);
    }
}
