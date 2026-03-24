namespace Brmble.Audio.NetEQ;

/// <summary>
/// Circular buffer for decoded PCM samples.
/// Holds excess samples when a decoded frame is larger than 20ms (960 samples).
/// Single-threaded use only (called within GetAudio on playout thread).
/// </summary>
public class SyncBuffer
{
    private readonly short[] _buffer;
    private int _readPos;
    private int _writePos;
    private int _count;

    public SyncBuffer(int capacity = 5760) // max Opus frame at 48kHz
    {
        _buffer = new short[capacity];
    }

    public int AvailableSamples => _count;

    public void Write(ReadOnlySpan<short> samples)
    {
        for (int i = 0; i < samples.Length && _count < _buffer.Length; i++)
        {
            _buffer[_writePos] = samples[i];
            _writePos = (_writePos + 1) % _buffer.Length;
            _count++;
        }
    }

    public int Read(Span<short> output)
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

    public void Clear()
    {
        _readPos = 0;
        _writePos = 0;
        _count = 0;
    }
}
