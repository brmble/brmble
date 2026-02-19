using System.Runtime.InteropServices;

namespace Brmble.Client.Services.Certificate;

internal static class Win32FileDialog
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct OPENFILENAME
    {
        public uint lStructSize;
        public IntPtr hwndOwner;
        public IntPtr hInstance;
        [MarshalAs(UnmanagedType.LPWStr)] public string? lpstrFilter;
        [MarshalAs(UnmanagedType.LPWStr)] public string? lpstrCustomFilter;
        public uint nMaxCustFilter;
        public uint nFilterIndex;
        public IntPtr lpstrFile;
        public uint nMaxFile;
        public IntPtr lpstrFileTitle;
        public uint nMaxFileTitle;
        [MarshalAs(UnmanagedType.LPWStr)] public string? lpstrInitialDir;
        [MarshalAs(UnmanagedType.LPWStr)] public string? lpstrTitle;
        public uint Flags;
        public short nFileOffset;
        public short nFileExtension;
        [MarshalAs(UnmanagedType.LPWStr)] public string? lpstrDefExt;
        public IntPtr lCustData;
        public IntPtr lpfnHook;
        [MarshalAs(UnmanagedType.LPWStr)] public string? lpTemplateName;
        public IntPtr pvReserved;
        public uint dwReserved;
        public uint FlagsEx;
    }

    [DllImport("comdlg32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool GetOpenFileName(ref OPENFILENAME ofn);

    [DllImport("comdlg32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool GetSaveFileName(ref OPENFILENAME ofn);

    private const uint OFN_FILEMUSTEXIST  = 0x1000;
    private const uint OFN_PATHMUSTEXIST  = 0x0800;
    private const uint OFN_OVERWRITEPROMPT = 0x0002;
    private const int  MAX_PATH           = 32768;

    /// <summary>
    /// Opens a Win32 file-open dialog. Returns the selected path, or null if cancelled.
    /// Filter format: "Display Name\0*.ext\0\0" (null-separated pairs, double-null terminated).
    /// </summary>
    public static string? OpenFile(string title, string filter, string defaultExt)
    {
        string? result = null;
        var thread = new Thread(() =>
        {
            IntPtr buf = Marshal.AllocHGlobal(MAX_PATH * sizeof(char));
            try
            {
                // Zero the buffer
                for (int i = 0; i < MAX_PATH * sizeof(char); i++)
                    Marshal.WriteByte(buf, i, 0);

                var ofn = new OPENFILENAME
                {
                    lStructSize    = (uint)Marshal.SizeOf<OPENFILENAME>(),
                    hwndOwner      = IntPtr.Zero,
                    lpstrFilter    = filter,
                    lpstrTitle     = title,
                    lpstrFile      = buf,
                    nMaxFile       = MAX_PATH,
                    lpstrDefExt    = defaultExt,
                    Flags          = OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST,
                };
                if (GetOpenFileName(ref ofn))
                    result = Marshal.PtrToStringUni(buf);
            }
            finally
            {
                Marshal.FreeHGlobal(buf);
            }
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        thread.Join();
        return result;
    }

    /// <summary>
    /// Opens a Win32 file-save dialog. Returns the chosen path, or null if cancelled.
    /// </summary>
    public static string? SaveFile(string title, string filter, string defaultExt, string? suggestedName = null)
    {
        string? result = null;
        var thread = new Thread(() =>
        {
            IntPtr buf = Marshal.AllocHGlobal(MAX_PATH * sizeof(char));
            try
            {
                // Zero, then write suggested name if provided
                for (int i = 0; i < MAX_PATH * sizeof(char); i++)
                    Marshal.WriteByte(buf, i, 0);

                if (suggestedName != null)
                {
                    var encoded = System.Text.Encoding.Unicode.GetBytes(suggestedName + '\0');
                    Marshal.Copy(encoded, 0, buf, Math.Min(encoded.Length, MAX_PATH * sizeof(char) - 2));
                }

                var ofn = new OPENFILENAME
                {
                    lStructSize  = (uint)Marshal.SizeOf<OPENFILENAME>(),
                    hwndOwner    = IntPtr.Zero,
                    lpstrFilter  = filter,
                    lpstrTitle   = title,
                    lpstrFile    = buf,
                    nMaxFile     = MAX_PATH,
                    lpstrDefExt  = defaultExt,
                    Flags        = OFN_OVERWRITEPROMPT,
                };
                if (GetSaveFileName(ref ofn))
                    result = Marshal.PtrToStringUni(buf);
            }
            finally
            {
                Marshal.FreeHGlobal(buf);
            }
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        thread.Join();
        return result;
    }
}
