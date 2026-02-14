namespace MumbleVoiceEngine.Pipeline;

using NAudio.Wave;
using MumbleVoiceEngine.Codec;

/// <summary>
/// Per-user decode pipeline: Opus decode → PCM queue.
/// Implements IWaveProvider so NAudio can play it directly.
/// Decodes eagerly on the network thread, buffers PCM for the audio thread.
/// </summary>
public class UserAudioPipeline : IWaveProvider, IDisposable
{
    private readonly OpusDecoder _decoder;
    private readonly int _frameSizeBytes; // 1920 for 960 samples mono 16-bit

    // Decoded PCM queue — written by network thread, read by audio thread
    private readonly Queue<byte[]> _pcmQueue = new();
    private byte[]? _currentFrame;
    private int _currentFrameOffset;

    private readonly object _lock = new();

    public WaveFormat WaveFormat { get; }

    public UserAudioPipeline(int sampleRate = 48000, int channels = 1, int frameSize = 960)
    {
        _frameSizeBytes = frameSize * sizeof(short) * channels;
        WaveFormat = new WaveFormat(sampleRate, 16, channels);
        _decoder = new OpusDecoder(sampleRate, channels);
    }

    /// <summary>
    /// Feed an incoming Opus packet. Decodes immediately and queues PCM.
    /// Called from the network/process thread.
    /// </summary>
    public void FeedEncodedPacket(byte[] opusData, long sequence)
    {
        var decoded = new byte[_frameSizeBytes];
        _decoder.Decode(opusData, 0, opusData.Length, decoded, 0);

        lock (_lock)
        {
            _pcmQueue.Enqueue(decoded);
        }
    }

    /// <summary>
    /// IWaveProvider.Read — called by NAudio playback device on its audio thread.
    /// Pulls decoded PCM from the queue, returns silence if empty.
    /// </summary>
    public int Read(byte[] buffer, int offset, int count)
    {
        lock (_lock)
        {
            int written = 0;

            // Continue from partial frame left over from previous Read
            if (_currentFrame != null)
            {
                int remaining = _currentFrame.Length - _currentFrameOffset;
                int toCopy = Math.Min(count, remaining);
                Array.Copy(_currentFrame, _currentFrameOffset, buffer, offset, toCopy);
                _currentFrameOffset += toCopy;
                written += toCopy;

                if (_currentFrameOffset >= _currentFrame.Length)
                {
                    _currentFrame = null;
                    _currentFrameOffset = 0;
                }
            }

            // Pull decoded frames from queue
            while (written < count)
            {
                if (!_pcmQueue.TryDequeue(out var frame))
                {
                    // No more data — fill remainder with silence
                    Array.Clear(buffer, offset + written, count - written);
                    written = count;
                    break;
                }

                int needed = count - written;
                if (frame.Length <= needed)
                {
                    Array.Copy(frame, 0, buffer, offset + written, frame.Length);
                    written += frame.Length;
                }
                else
                {
                    // Partial frame — save remainder for next Read
                    Array.Copy(frame, 0, buffer, offset + written, needed);
                    written += needed;
                    _currentFrame = frame;
                    _currentFrameOffset = needed;
                }
            }

            return count;
        }
    }

    public void Dispose()
    {
        _decoder.Dispose();
    }
}
