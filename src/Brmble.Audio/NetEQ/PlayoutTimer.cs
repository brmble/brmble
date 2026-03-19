using System.Diagnostics;

namespace Brmble.Audio.NetEQ;

/// <summary>
/// Dedicated high-priority thread that calls a callback every 20ms.
/// Uses Stopwatch-based drift compensation for accurate timing.
/// </summary>
public class PlayoutTimer : IDisposable
{
    private const int TickIntervalMs = 20;
    private readonly Action _onTick;
    private Thread? _thread;
    private volatile bool _running;

    public PlayoutTimer(Action onTick)
    {
        _onTick = onTick;
    }

    public void Start()
    {
        if (_running) return;
        _running = true;
        _thread = new Thread(RunLoop)
        {
            Name = "Brmble.PlayoutTimer",
            Priority = ThreadPriority.AboveNormal,
            IsBackground = true
        };
        _thread.Start();
    }

    public void Stop()
    {
        _running = false;
        _thread?.Join(timeout: TimeSpan.FromMilliseconds(200));
        _thread = null;
    }

    private void RunLoop()
    {
        var sw = Stopwatch.StartNew();
        long nextTickMs = TickIntervalMs;

        while (_running)
        {
            long elapsed = sw.ElapsedMilliseconds;
            long sleepMs = nextTickMs - elapsed;

            if (sleepMs > 1)
                Thread.Sleep((int)(sleepMs - 1));

            // Spin-wait for the remaining time for precision
            while (sw.ElapsedMilliseconds < nextTickMs && _running)
                Thread.SpinWait(10);

            if (!_running) break;

            try
            {
                _onTick();
            }
            catch (Exception)
            {
                // Don't let callback exceptions kill the timer thread.
            }

            // Drift compensation: schedule next tick relative to start
            nextTickMs += TickIntervalMs;

            // If we've fallen behind by more than 3 ticks, reset
            if (sw.ElapsedMilliseconds > nextTickMs + TickIntervalMs * 3)
                nextTickMs = sw.ElapsedMilliseconds + TickIntervalMs;
        }
    }

    public void Dispose()
    {
        Stop();
    }
}
