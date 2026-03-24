namespace Brmble.Audio.NetEQ;

/// <summary>
/// Single-producer single-consumer ring buffer for PCM samples.
/// Used between PlayoutTimer (writer) and NAudio callback (reader).
/// Uses a lock for simplicity — contention is negligible at 20ms intervals.
/// On overrun, oldest samples are dropped.
/// </summary>
public class RingBuffer
{
    private readonly short[] _buffer;
    private int _readPos;
    private int _writePos;
    private int _count;
    private readonly object _lock = new();

    public RingBuffer(int capacity = 4800) // 100ms at 48kHz
    {
        _buffer = new short[capacity];
    }

    public int AvailableSamples
    {
        get { lock (_lock) return _count; }
    }

    public void Write(ReadOnlySpan<short> samples)
    {
        lock (_lock)
        {
            for (int i = 0; i < samples.Length; i++)
            {
                if (_count >= _buffer.Length)
                {
                    // Overrun: advance read position (drop oldest)
                    _readPos = (_readPos + 1) % _buffer.Length;
                    _count--;
                }
                _buffer[_writePos] = samples[i];
                _writePos = (_writePos + 1) % _buffer.Length;
                _count++;
            }
        }
    }

    public int Read(Span<short> output)
    {
        lock (_lock)
        {
            int toRead = Math.Min(output.Length, _count);
            for (int i = 0; i < toRead; i++)
            {
                output[i] = _buffer[_readPos];
                _readPos = (_readPos + 1) % _buffer.Length;
            }
            _count -= toRead;
            return toRead;
        }
    }
}
