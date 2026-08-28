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
    private int _controlCount;
    private int _snapshotCount;
    private int _controlsSinceSnapshot;
    private int _droppedSnapshots;
    private bool _overloaded;

    public int DroppedSnapshots => Volatile.Read(ref _droppedSnapshots);
    public bool Overloaded => Volatile.Read(ref _overloaded);

    public void WriteControl(RealtimeControl control)
    {
        ArgumentNullException.ThrowIfNull(control);

        lock (_gate)
        {
            if (control.Coalescible && TryReplaceControl(control))
                return;

            var terminal = IsTerminal(control);
            var capacity = terminal ? ControlCapacity : OrdinaryControlCapacity;
            if (_controlCount >= capacity || !_controls.Writer.TryWrite(control))
            {
                if (terminal)
                    Volatile.Write(ref _overloaded, true);
                return;
            }

            _controlCount++;
            _available.Release();
        }
    }

    public void ReplaceSnapshot(string json)
    {
        ArgumentNullException.ThrowIfNull(json);

        lock (_gate)
        {
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

    public async ValueTask<RealtimeOutbound> ReadNextAsync(CancellationToken cancellationToken)
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

        throw new InvalidOperationException("Mailbox availability signal was inconsistent with its queues.");
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
