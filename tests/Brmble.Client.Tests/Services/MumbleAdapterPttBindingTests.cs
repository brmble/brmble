using System.Reflection;
using Brmble.Client.Services.Voice;
using Brmble.Client.Services.Voice.Input;
using Brmble.Client.Tests.Services.Input;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services;

[TestClass]
public class MumbleAdapterPttBindingTests
{
    private const int VK_F = 0x46;

    [TestMethod]
    public void SetTransmissionMode_WhenPttKeyIsOmitted_PreservesExistingPttBinding()
    {
        var backend = new FakeInputBackend();
        using var router = new InputRouter(backend);
        var adapter = new MumbleAdapter(null!, IntPtr.Zero);
        ReplaceInputRouter(adapter, router);

        var states = new List<bool>();
        router.PttStateChanged += state => states.Add(state);

        adapter.SetTransmissionMode("pushToTalk", "KeyF");
        adapter.SetTransmissionMode("pushToTalk", null);

        backend.KeyDownStates[VK_F] = true;
        router.TickPollOnce();

        CollectionAssert.AreEqual(new[] { true }, states);
        adapter.Disconnect();
    }

    private static void ReplaceInputRouter(MumbleAdapter adapter, InputRouter router)
    {
        var field = typeof(MumbleAdapter).GetField("_inputRouter", BindingFlags.Instance | BindingFlags.NonPublic)
            ?? throw new InvalidOperationException("MumbleAdapter._inputRouter field not found.");
        field.SetValue(adapter, router);
    }
}
