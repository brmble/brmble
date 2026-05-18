using System;
using System.Runtime.InteropServices;

namespace Brmble.Client.Services.Voice.Input;

/// <summary>
/// Win32 MSLLHOOKSTRUCT layout used by WH_MOUSE_LL callbacks. Lives at
/// namespace scope so InputRouter and its test seam share the exact same
/// definition (two copies would silently drift in layout if a field changed).
/// </summary>
[StructLayout(LayoutKind.Sequential)]
public struct MSLLHOOKSTRUCT
{
    public int ptX;
    public int ptY;
    public int mouseData;
    public int flags;
    public int time;
    public IntPtr dwExtraInfo;
}
