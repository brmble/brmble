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
        Assert.IsTrue(_svc.TryAddMatrixUser(1, "@1:server", "Alice"));
        Assert.IsFalse(_svc.TryAddMatrixUser(1, "@1:server", "Alice"));
    }

    [TestMethod]
    public void TryGetMatrixUserId_ReturnsMappingAfterAdd()
    {
        _svc.SetNameForSession("Alice", 1);
        _svc.TryAddMatrixUser(1, "@1:server", "Alice");
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
        _svc.TryAddMatrixUser(1, "@1:server", "Alice");
        _svc.RemoveSession(1);
        Assert.IsFalse(_svc.TryGetMatrixUserId(1, out _));
        Assert.IsFalse(_svc.TryGetSessionId("Alice", out _));
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
        _svc.TryAddMatrixUser(1, "@1:server", "Alice");
        _svc.SetNameForSession("Bob", 2);
        _svc.TryAddMatrixUser(2, "@2:server", "Bob");
        var snapshot = _svc.GetSnapshot();
        Assert.AreEqual(2, snapshot.Count);
        Assert.AreEqual("@1:server", snapshot[1].MatrixUserId);
        Assert.AreEqual("Alice", snapshot[1].MumbleName);
        Assert.AreEqual("@2:server", snapshot[2].MatrixUserId);
    }

    [TestMethod]
    public void GetSnapshot_IsIsolatedFromMutations()
    {
        _svc.SetNameForSession("Alice", 1);
        _svc.TryAddMatrixUser(1, "@1:server", "Alice");
        var snapshot = _svc.GetSnapshot();
        _svc.RemoveSession(1);
        Assert.AreEqual(1, snapshot.Count);
    }
}
