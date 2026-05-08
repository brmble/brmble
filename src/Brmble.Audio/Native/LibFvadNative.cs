using System.Runtime.InteropServices;

namespace Brmble.Audio.Native;

internal static class LibFvadNative
{
    private const string Library = "libfvad";

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    public static extern IntPtr fvad_new();

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    public static extern void fvad_free(IntPtr inst);

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    public static extern void fvad_reset(IntPtr inst);

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    public static extern int fvad_set_mode(IntPtr inst, int mode);

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    public static extern int fvad_set_sample_rate(IntPtr inst, int sample_rate);

    /// <summary>
    /// Returns 1 if active voice detected, 0 if not, -1 on error (e.g. wrong frame length).
    /// </summary>
    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    public static extern unsafe int fvad_process(IntPtr inst, short* frame, UIntPtr length);
}
