using Brmble.Client.Overlay;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Overlay;

[TestClass]
public class CompanionOverlayRelayTests
{
    [TestMethod]
    public void UpdatePayload_BeforeAttachSink_ReplaysLatestOnAttach()
    {
        var relay = new CompanionOverlayRelay();
        relay.UpdatePayload("{\"type\":\"overlay.sync\",\"data\":{\"enabled\":true}}");

        string? received = null;
        relay.AttachSink(payload => received = payload);

        Assert.IsNotNull(received);
        StringAssert.Contains(received, "\"overlay.sync\"");
        StringAssert.Contains(received, "\"enabled\":true");
    }

    [TestMethod]
    public void UpdatePayload_AfterAttachSink_PushesImmediately()
    {
        var relay = new CompanionOverlayRelay();
        var pushes = 0;
        relay.AttachSink(_ => pushes++);

        relay.UpdatePayload("{\"type\":\"overlay.sync\",\"data\":{\"enabled\":false}}");
        relay.UpdatePayload("{\"type\":\"overlay.sync\",\"data\":{\"enabled\":true}}");

        Assert.AreEqual(2, pushes);
    }
}
