using System.Runtime.InteropServices;

namespace Brmble.Client;

/// <summary>
/// Stamps the System.AppUserModel.ID property on .lnk shortcuts so the Windows
/// taskbar associates pinned/Start Menu shortcuts with the same AppUserModelID
/// that the running process declares via SetCurrentProcessExplicitAppUserModelID.
/// Without this, runtime WM_SETICON updates (theme-aware icons) won't apply to
/// pinned taskbar shortcuts because the shortcut still carries the launcher's
/// implicit identity.
/// </summary>
internal static class ShortcutAppId
{
    // PKEY_AppUserModel_ID = {9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3}, pid 5
    private static readonly Guid AppUserModelIdFmtId =
        new("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");

    private const int GPS_READWRITE = 2;
    private const ushort VT_LPWSTR = 31;

    [StructLayout(LayoutKind.Sequential)]
    private struct PROPERTYKEY
    {
        public Guid fmtid;
        public uint pid;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROPVARIANT
    {
        public ushort vt;
        public ushort wReserved1;
        public ushort wReserved2;
        public ushort wReserved3;
        public IntPtr p;
        public IntPtr p2;
    }

    [ComImport]
    [Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPropertyStore
    {
        int GetCount(out uint cProps);
        int GetAt(uint iProp, out PROPERTYKEY pkey);
        int GetValue(ref PROPERTYKEY key, out PROPVARIANT pv);
        int SetValue(ref PROPERTYKEY key, ref PROPVARIANT pv);
        int Commit();
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    private static extern void SHGetPropertyStoreFromParsingName(
        [MarshalAs(UnmanagedType.LPWStr)] string pszPath,
        IntPtr zero,
        int flags,
        ref Guid iid,
        [MarshalAs(UnmanagedType.Interface)] out IPropertyStore ppv);

    [DllImport("propsys.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    private static extern void InitPropVariantFromString(
        [MarshalAs(UnmanagedType.LPWStr)] string psz,
        out PROPVARIANT ppropvar);

    [DllImport("ole32.dll", PreserveSig = false)]
    private static extern void PropVariantClear(ref PROPVARIANT pvar);

    /// <summary>
    /// Stamps <paramref name="appId"/> as System.AppUserModel.ID on the given .lnk file
    /// if it isn't already set to that value. Silently no-ops on missing files or errors —
    /// this is a best-effort affordance for taskbar icon consistency.
    /// </summary>
    public static void Stamp(string lnkPath, string appId)
    {
        if (!File.Exists(lnkPath)) return;

        IPropertyStore? store = null;
        var iid = typeof(IPropertyStore).GUID;
        var key = new PROPERTYKEY { fmtid = AppUserModelIdFmtId, pid = 5 };
        var pv = default(PROPVARIANT);

        try
        {
            SHGetPropertyStoreFromParsingName(lnkPath, IntPtr.Zero, GPS_READWRITE, ref iid, out store);

            // Read existing value; skip the write if it already matches.
            store.GetValue(ref key, out pv);
            string? existing = pv.vt == VT_LPWSTR ? Marshal.PtrToStringUni(pv.p) : null;
            PropVariantClear(ref pv);

            if (string.Equals(existing, appId, StringComparison.Ordinal)) return;

            InitPropVariantFromString(appId, out pv);
            store.SetValue(ref key, ref pv);
            store.Commit();
        }
        catch
        {
            // Best-effort: a failure here just means pinned shortcuts may not pick up
            // theme-aware icons. The running process still has the explicit AppID set.
        }
        finally
        {
            try { PropVariantClear(ref pv); } catch { }
            if (store is not null) Marshal.ReleaseComObject(store);
        }
    }

    /// <summary>
    /// Stamps the Brmble shortcuts that Velopack creates by default.
    /// Walks the conventional Start Menu and Desktop locations.
    /// </summary>
    public static void StampVelopackShortcuts(string appId, string packTitle)
    {
        var startMenu = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "Microsoft", "Windows", "Start Menu", "Programs", packTitle + ".lnk");
        var desktop = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
            packTitle + ".lnk");

        Stamp(startMenu, appId);
        Stamp(desktop, appId);
    }
}
