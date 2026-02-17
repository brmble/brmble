namespace Brmble.Client;

/// <summary>
/// Simple dev-only logger that writes to both Console and a log file.
/// Also redirects all Console.WriteLine to the log file.
/// </summary>
internal static class DevLog
{
    public static readonly string LogPath = Path.Combine(
        AppDomain.CurrentDomain.BaseDirectory, "brmble-debug.log");

    private static readonly object Lock = new();

    public static void Init()
    {
        // Clear log on startup
        try { File.WriteAllText(LogPath, ""); }
        catch { /* ignore */ }

        // Redirect Console.Out to a writer that also appends to the log file
        var original = Console.Out;
        Console.SetOut(new TeeWriter(original, LogPath, Lock));

        Log("=== Brmble started ===");
    }

    public static void Log(string message)
    {
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] {message}");
    }

    /// <summary>
    /// TextWriter that writes to both the original Console and a log file.
    /// </summary>
    private class TeeWriter : TextWriter
    {
        private readonly TextWriter _original;
        private readonly string _path;
        private readonly object _lock;

        public TeeWriter(TextWriter original, string path, object lockObj)
        {
            _original = original;
            _path = path;
            _lock = lockObj;
        }

        public override System.Text.Encoding Encoding => _original.Encoding;

        public override void WriteLine(string? value)
        {
            _original.WriteLine(value);
            lock (_lock)
            {
                try { File.AppendAllText(_path, value + "\n"); }
                catch { /* ignore */ }
            }
        }

        public override void Write(string? value)
        {
            _original.Write(value);
            lock (_lock)
            {
                try { File.AppendAllText(_path, value); }
                catch { /* ignore */ }
            }
        }
    }
}
