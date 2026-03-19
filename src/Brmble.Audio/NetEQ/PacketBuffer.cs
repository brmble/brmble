using Brmble.Audio.NetEQ.Models;

namespace Brmble.Audio.NetEQ;

/// <summary>
/// Stores encoded Opus packets sorted by timestamp.
/// Thread-safe: one producer (network thread) and one consumer (playout thread).
/// </summary>
public class PacketBuffer
{
    private readonly SortedList<long, EncodedPacket> _packets = new();
    private readonly object _lock = new();
    private readonly int _maxCapacity;
    private long _lastDecodedTimestamp = -1;

    // Packets this far behind lastDecoded are considered stale (in timestamp units).
    private const int StaleThreshold = 5 * 960; // 5 frames

    public PacketBuffer(int maxCapacity = 25) // ~500ms at 20ms/frame
    {
        _maxCapacity = maxCapacity;
    }

    public int Count
    {
        get { lock (_lock) return _packets.Count; }
    }

    /// <summary>
    /// Check if a packet with the given timestamp exists in the buffer.
    /// Does not consume the packet.
    /// </summary>
    public bool Contains(long timestamp)
    {
        lock (_lock)
            return _packets.ContainsKey(timestamp);
    }

    /// <summary>
    /// Insert an encoded packet. Rejects duplicates and stale packets.
    /// Returns true if the packet was accepted.
    /// </summary>
    public bool Insert(EncodedPacket packet)
    {
        lock (_lock)
        {
            // Reject stale
            if (_lastDecodedTimestamp >= 0 &&
                packet.Timestamp < _lastDecodedTimestamp - StaleThreshold)
                return false;

            // Reject duplicate
            if (_packets.ContainsKey(packet.Timestamp))
                return false;

            _packets.Add(packet.Timestamp, packet);

            // Enforce capacity — drop oldest
            while (_packets.Count > _maxCapacity)
                _packets.RemoveAt(0);

            return true;
        }
    }

    /// <summary>
    /// Try to retrieve the packet matching expectedTimestamp.
    /// Removes it from the buffer if found.
    /// </summary>
    public EncodedPacket? TryGetNext(long expectedTimestamp)
    {
        lock (_lock)
        {
            if (_packets.Remove(expectedTimestamp, out var packet))
            {
                _lastDecodedTimestamp = expectedTimestamp;
                return packet;
            }
            // Also advance lastDecoded even on miss (so stale check works)
            if (expectedTimestamp > _lastDecodedTimestamp)
                _lastDecodedTimestamp = expectedTimestamp;
            return null;
        }
    }

    /// <summary>
    /// Clear all packets and reset state. Used on sequence reset / reconnect.
    /// </summary>
    public void Flush()
    {
        lock (_lock)
        {
            _packets.Clear();
            _lastDecodedTimestamp = -1;
        }
    }
}
