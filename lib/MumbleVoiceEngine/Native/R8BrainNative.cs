using System;
using System.IO;
using System.Runtime.InteropServices;

namespace MumbleVoiceEngine.Native;

internal enum R8BrainResolution
{
    R16Bit = 0,
    R16BitIR = 1,
    R24Bit = 2
}

internal static class R8BrainNative
{
    private static readonly nint _lib;

    static R8BrainNative()
    {
        var path = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "r8bsrc.dll");
        _lib = NativeLibrary.Load(path);
        r8b_create = Marshal.GetDelegateForFunctionPointer<r8b_create_delegate>(
            NativeLibrary.GetExport(_lib, "r8b_create"));
        r8b_delete = Marshal.GetDelegateForFunctionPointer<r8b_delete_delegate>(
            NativeLibrary.GetExport(_lib, "r8b_delete"));
        r8b_clear = Marshal.GetDelegateForFunctionPointer<r8b_clear_delegate>(
            NativeLibrary.GetExport(_lib, "r8b_clear"));
        r8b_process = Marshal.GetDelegateForFunctionPointer<r8b_process_delegate>(
            NativeLibrary.GetExport(_lib, "r8b_process"));
    }

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    internal delegate IntPtr r8b_create_delegate(
        double srcSampleRate, double dstSampleRate,
        int maxInLen, double reqTransBand, R8BrainResolution res);
    internal static readonly r8b_create_delegate r8b_create;

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    internal delegate void r8b_delete_delegate(IntPtr rs);
    internal static readonly r8b_delete_delegate r8b_delete;

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    internal delegate void r8b_clear_delegate(IntPtr rs);
    internal static readonly r8b_clear_delegate r8b_clear;

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    internal delegate int r8b_process_delegate(
        IntPtr rs, IntPtr ip0, int l, out IntPtr op0);
    internal static readonly r8b_process_delegate r8b_process;
}
