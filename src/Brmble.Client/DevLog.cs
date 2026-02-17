namespace Brmble.Client;

/// <summary>
/// Redirects Console output to both the console window and a log file.
/// Useful for capturing MumbleSharp diagnostics without an attached debugger.
/// </summary>
internal static class DevLog
{
    private static readonly string LogPath = Path.Combine(
        AppDomain.CurrentDomain.BaseDirectory, "brmble-debug.log");

    private static readonly object Lock = new();

    public static void Init()
    {
        try { File.WriteAllText(LogPath, ""); }
        catch { /* ignore */ }

        Console.SetOut(new TeeWriter(Console.Out, LogPath, Lock));
    }

    /// <summary>
    /// Writes to both the original Console and a log file.
    /// </summary>
    private sealed class TeeWriter(TextWriter original, string path, object lockObj) : TextWriter
    {
        public override System.Text.Encoding Encoding => original.Encoding;

        public override void WriteLine(string? value)
        {
            original.WriteLine(value);
            lock (lockObj)
            {
                try { File.AppendAllText(path, value + "\n"); }
                catch { /* ignore */ }
            }
        }

        public override void Write(string? value)
        {
            original.Write(value);
            lock (lockObj)
            {
                try { File.AppendAllText(path, value); }
                catch { /* ignore */ }
            }
        }
    }
}
