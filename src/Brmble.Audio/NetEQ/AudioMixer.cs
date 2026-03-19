namespace Brmble.Audio.NetEQ;

/// <summary>
/// Mixes audio from multiple JitterBuffers into a single output stream.
/// Drives the PlayoutTimer tick: calls GetAudio on each buffer, mixes, writes to RingBuffer.
/// </summary>
public class AudioMixer : IDisposable
{
    private const int FrameSize = 960;

    private readonly Dictionary<uint, JitterBuffer> _buffers = new();
    private readonly RingBuffer _ringBuffer;
    private readonly PlayoutTimer _timer;
    private readonly object _lock = new();

    // Reusable buffers to avoid allocation on audio thread
    private readonly short[] _mixBuffer = new short[FrameSize];
    private readonly short[] _userBuffer = new short[FrameSize];
    private readonly int[] _mixAccumulator = new int[FrameSize];

    public RingBuffer Output => _ringBuffer;

    public AudioMixer()
    {
        _ringBuffer = new RingBuffer(capacity: 4800); // 100ms
        _timer = new PlayoutTimer(OnTick);
    }

    public void Start() => _timer.Start();
    public void Stop() => _timer.Stop();

    public void AddBuffer(uint userId, JitterBuffer buffer)
    {
        lock (_lock)
            _buffers[userId] = buffer;
    }

    public void RemoveBuffer(uint userId)
    {
        lock (_lock)
        {
            if (_buffers.Remove(userId, out var buffer))
                buffer.Dispose();
        }
    }

    public JitterBuffer? GetBuffer(uint userId)
    {
        lock (_lock)
            return _buffers.TryGetValue(userId, out var buf) ? buf : null;
    }

    public IReadOnlyCollection<uint> GetActiveUserIds()
    {
        lock (_lock)
            return _buffers.Keys.ToArray();
    }

    /// <summary>
    /// Check if a user is currently speaking.
    /// </summary>
    public bool IsUserSpeaking(uint userId)
    {
        lock (_lock)
            return _buffers.TryGetValue(userId, out var buf) && buf.IsSpeaking;
    }

    private void OnTick()
    {
        Array.Clear(_mixAccumulator);

        lock (_lock)
        {
            foreach (var buffer in _buffers.Values)
            {
                buffer.GetAudio(_userBuffer);
                for (int i = 0; i < FrameSize; i++)
                    _mixAccumulator[i] += _userBuffer[i];
            }
        }

        // Clip to short range
        for (int i = 0; i < FrameSize; i++)
            _mixBuffer[i] = (short)Math.Clamp(_mixAccumulator[i], short.MinValue, short.MaxValue);

        _ringBuffer.Write(_mixBuffer);
    }

    public void Dispose()
    {
        _timer.Dispose();
        lock (_lock)
        {
            foreach (var buffer in _buffers.Values)
                buffer.Dispose();
            _buffers.Clear();
        }
    }
}
