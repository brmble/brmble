using Microsoft.Extensions.Logging;

namespace Brmble.Server.Tests.TestSupport;

public sealed class CapturingLogger<T> : ILogger<T>
{
    private readonly List<string> _entries = [];
    private readonly object _lock = new();

    public IReadOnlyList<string> Entries
    {
        get
        {
            lock (_lock)
                return _entries.ToArray();
        }
    }

    public IDisposable BeginScope<TState>(TState state) where TState : notnull => NullScope.Instance;

    public bool IsEnabled(LogLevel logLevel) => true;

    public void Log<TState>(
        LogLevel logLevel,
        EventId eventId,
        TState state,
        Exception? exception,
        Func<TState, Exception?, string> formatter)
    {
        var rendered = formatter(state, exception);
        var entry = exception is null
            ? rendered
            : $"{rendered}{Environment.NewLine}{exception}";
        lock (_lock)
            _entries.Add(entry);
    }

    private sealed class NullScope : IDisposable
    {
        public static readonly NullScope Instance = new();
        public void Dispose() { }
    }
}
