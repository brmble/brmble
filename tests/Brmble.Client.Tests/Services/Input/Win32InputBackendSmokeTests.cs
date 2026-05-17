using Brmble.Client.Services.Voice.Input;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services.Input;

/// <summary>
/// Smoke tests for Win32InputBackend P/Invoke resolution. The FakeInputBackend
/// can't catch wrong DllImport entry-point mappings — those only fail when the
/// real backend is invoked at runtime. This test catches that class of bug
/// without requiring a connected server or focused window.
/// </summary>
[TestClass]
public class Win32InputBackendSmokeTests
{
    [TestMethod]
    public void GetAsyncKeyState_ResolvesPInvokeEntryPoint()
    {
        // Will throw EntryPointNotFoundException if DllImport's EntryPoint is wrong.
        IInputBackend backend = new Win32InputBackend(hwnd: nint.Zero);
        // VK_SPACE = 0x20. Result value is irrelevant; we just need the call
        // to complete without an EntryPointNotFoundException.
        _ = backend.GetAsyncKeyState(0x20);
    }
}
