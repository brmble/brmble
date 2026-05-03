using Brmble.Client.Bridge;

namespace Brmble.Client.Services.Idle;

/// <summary>
/// Periodically pushes idle data ({voiceIdle map, systemIdle, isLocked}) to the
/// frontend via the bridge. The actual AFK threshold logic lives in the
/// frontend's <c>useIdleActions</c> hook — this service just publishes the raw
/// values it observes.
/// </summary>
public sealed class IdleService : IService, IDisposable
{
    public string ServiceName => "idle";

    private const int PUSH_INTERVAL_MS = 10_000;

    private NativeBridge? _bridge;
    private System.Threading.Timer? _pushTimer;
    private bool _disposed;

    public VoiceIdleTracker VoiceTracker { get; } = new();
    public SystemIdleTracker? SystemTracker { get; private set; }

    public void Initialize(NativeBridge bridge)
    {
        _bridge = bridge;
    }

    /// <summary>
    /// Constructs the SystemIdleTracker once a Win32 hwnd is available so the
    /// tracker can register for <c>WM_WTSSESSION_CHANGE</c>.
    /// </summary>
    public void AttachWindow(IntPtr hwnd)
    {
        SystemTracker?.Dispose();
        SystemTracker = new SystemIdleTracker(hwnd);
    }

    public void RegisterHandlers(NativeBridge bridge)
    {
        // No JS-initiated commands today — frontend listens for voice.idleUpdate
        // and decides locally whether to fire voice.leaveVoice. Reserved for future
        // manual-AFK or per-user broadcast features.
    }

    /// <summary>Starts the periodic push timer. Idempotent.</summary>
    public void Start()
    {
        Stop();
        _pushTimer = new System.Threading.Timer(
            _ => PushIdleUpdate(),
            state: null,
            dueTime: PUSH_INTERVAL_MS,
            period: PUSH_INTERVAL_MS);
    }

    /// <summary>Stops the push timer and clears the voice tracker state.</summary>
    public void Stop()
    {
        _pushTimer?.Dispose();
        _pushTimer = null;
        VoiceTracker.Clear();
    }

    /// <summary>
    /// Builds and sends a single voice.idleUpdate. Public for testability —
    /// production callers should not invoke this directly.
    /// </summary>
    internal void PushIdleUpdate()
    {
        if (_bridge == null) return;

        var voiceIdle = VoiceTracker.GetCurrent();
        var systemIdle = SystemTracker?.GetIdleSeconds() ?? 0;
        var locked = SystemTracker?.IsLocked ?? false;

        _bridge.Send("voice.idleUpdate", new
        {
            voiceIdle,
            systemIdle,
            isLocked = locked,
        });
        _bridge.NotifyUiThread();
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        Stop();
        SystemTracker?.Dispose();
    }
}
