using System.Diagnostics;
using System.Threading.Channels;

namespace Brmble.Server.Games.Continuous;

public sealed record RealtimeControl(
    string Type,
    long? SessionId,
    long? Sequence,
    string Json,
    bool Coalescible);

public sealed record RealtimeOutbound(
    string Type,
    long? SessionId,
    long? Sequence,
    string Json,
    bool IsControl);

public sealed class RealtimeSnapshotMailbox
{
    private const int ControlCapacity = 16;
    private const int OrdinaryControlCapacity = ControlCapacity - 2;
    private const int ControlBurstLimit = 4;

    private readonly object _gate = new();
    private readonly Channel<RealtimeControl> _controls = Channel.CreateBounded<RealtimeControl>(
        new BoundedChannelOptions(ControlCapacity)
        {
            FullMode = BoundedChannelFullMode.DropWrite,
            SingleReader = true
        });
    private readonly Channel<string> _snapshots = Channel.CreateBounded<string>(
        new BoundedChannelOptions(1)
        {
            FullMode = BoundedChannelFullMode.DropOldest,
            SingleReader = true
        });
    private readonly SemaphoreSlim _available = new(0);
    private readonly CancellationTokenSource _terminalOrOverload = new();
    private int _controlCount;
    private int _ordinaryControlCount;
    private int _snapshotCount;
    private int _controlsSinceSnapshot;
    private int _droppedSnapshots;
    private bool _overloaded;
    private bool _sealed;
    private long _terminalAvailableTimestamp;

    public int DroppedSnapshots => Volatile.Read(ref _droppedSnapshots);
    public bool Overloaded => Volatile.Read(ref _overloaded);
    public CancellationToken TerminalOrOverload => _terminalOrOverload.Token;
    public long TerminalAvailableTimestamp => Volatile.Read(ref _terminalAvailableTimestamp);

    public void WriteControl(RealtimeControl control)
    {
        ArgumentNullException.ThrowIfNull(control);

        lock (_gate)
        {
            if (_sealed) return;
            if (control.Coalescible && TryReplaceControl(control))
                return;

            var terminal = IsTerminal(control);
            if (_controlCount >= ControlCapacity ||
                (!terminal && _ordinaryControlCount >= OrdinaryControlCapacity) ||
                !_controls.Writer.TryWrite(control))
            {
                if (terminal)
                {
                    Volatile.Write(ref _overloaded, true);
                    _ = _terminalOrOverload.CancelAsync();
                }
                return;
            }

            _controlCount++;
            if (!terminal)
                _ordinaryControlCount++;
            _available.Release();
        }
    }

    public void ReplaceSnapshot(string json)
    {
        ArgumentNullException.ThrowIfNull(json);

        lock (_gate)
        {
            if (_sealed)
                return;

            var wasEmpty = _snapshotCount == 0;
            if (!wasEmpty)
                Interlocked.Increment(ref _droppedSnapshots);
            else
                _snapshotCount = 1;

            if (!_snapshots.Writer.TryWrite(json))
                throw new InvalidOperationException("Snapshot channel rejected a replacement.");

            if (wasEmpty)
                _available.Release();
        }
    }

    public bool SealTerminal(RealtimeControl terminal)
    {
        ArgumentNullException.ThrowIfNull(terminal);
        if (terminal.Type != "matchClosed" || terminal.Coalescible)
            throw new ArgumentException("A terminal seal requires a non-coalescible matchClosed control.", nameof(terminal));

        lock (_gate)
        {
            if (_sealed) return false;
            _sealed = true;
            Volatile.Write(ref _terminalAvailableTimestamp, Stopwatch.GetTimestamp());
            while (_snapshots.Reader.TryRead(out _)) { }
            _snapshotCount = 0;
            if (_controlCount >= ControlCapacity || !_controls.Writer.TryWrite(terminal))
            {
                _overloaded = true;
                _ = _terminalOrOverload.CancelAsync();
                return false;
            }

            _controlCount++;
            _available.Release();
            _ = _terminalOrOverload.CancelAsync();
            return true;
        }
    }

    public async ValueTask<RealtimeOutbound> ReadNextAsync(CancellationToken cancellationToken)
    {
        while (true)
        {
            await _available.WaitAsync(cancellationToken);

            lock (_gate)
            {
                if (_controlsSinceSnapshot >= ControlBurstLimit && TryReadSnapshot(out var snapshot))
                    return Snapshot(snapshot);

                if (TryReadControl(out var control))
                    return Control(control);

                if (TryReadSnapshot(out snapshot))
                    return Snapshot(snapshot);
            }
        }
    }

    private bool TryReplaceControl(RealtimeControl replacement)
    {
        var pending = new List<RealtimeControl>(_controlCount);
        var replaced = false;

        while (_controls.Reader.TryRead(out var current))
        {
            if (!replaced && SameKey(current, replacement))
            {
                pending.Add(replacement);
                replaced = true;
            }
            else
            {
                pending.Add(current);
            }
        }

        foreach (var control in pending)
        {
            if (!_controls.Writer.TryWrite(control))
                throw new InvalidOperationException("Control channel rejected a coalesced entry.");
        }

        return replaced;
    }

    private bool TryReadControl(out RealtimeControl control)
    {
        if (!_controls.Reader.TryRead(out control!))
            return false;

        _controlCount--;
        if (!IsTerminal(control))
            _ordinaryControlCount--;
        _controlsSinceSnapshot++;
        return true;
    }

    private bool TryReadSnapshot(out string snapshot)
    {
        if (!_snapshots.Reader.TryRead(out snapshot!))
            return false;

        _snapshotCount = 0;
        _controlsSinceSnapshot = 0;
        return true;
    }

    private static bool SameKey(RealtimeControl current, RealtimeControl replacement)
    {
        if (!current.Coalescible || current.Type != replacement.Type)
            return false;

        return replacement.SessionId is not null
            ? current.SessionId == replacement.SessionId
            : replacement.Sequence is not null && current.Sequence == replacement.Sequence;
    }

    private static bool IsTerminal(RealtimeControl control) =>
        !control.Coalescible && control.Type is "welcome" or "matchClosed";

    private static RealtimeOutbound Control(RealtimeControl control) => new(
        control.Type, control.SessionId, control.Sequence, control.Json, IsControl: true);

    private static RealtimeOutbound Snapshot(string json) =>
        new("snapshot", null, null, json, IsControl: false);
}
