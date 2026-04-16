namespace MumbleVoiceEngine.Pipeline;

using System;
using System.Threading;
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
    private readonly int _sampleRate;
    private readonly int _channels;
    private readonly int _bytesPerSample;

    private const int PlcFrameSamples = 960;
    private const int MaxPlcFrames = 4;
    private const int MaxGapFrames = 10;
    private const int LossReportIntervalMs = 5000;

    private readonly byte[] _plcBuffer;

    // Decoded PCM queue — written by network thread, read by audio thread
    private readonly Queue<byte[]> _pcmQueue = new();
    private long _lastSequence = -1;
    private int _lostPackets;
    private int _totalExpected;
    private byte[]? _currentFrame;
    private int _currentFrameOffset;

    private readonly object _lock = new();
    private float _volume = 1.0f;
    private Action<int>? _onLossReport;
    private Timer? _lossTimer;

    public WaveFormat WaveFormat { get; }

    public float Volume
    {
        get => Volatile.Read(ref _volume);
        set => Volatile.Write(ref _volume, Math.Clamp(value, 0f, 2.5f));
    }

    public UserAudioPipeline(int sampleRate = 48000, int channels = 1)
    {
        _sampleRate = sampleRate;
        _channels = channels;
        _bytesPerSample = sizeof(short) * channels;
        WaveFormat = new WaveFormat(sampleRate, 16, channels);
        _decoder = new OpusDecoder(sampleRate, channels);
        _plcBuffer = new byte[PlcFrameSamples * _bytesPerSample];

        _lossTimer = new Timer(_ => {
            try
            {
                int loss = GetAndResetLossPercent();
                _onLossReport?.Invoke(loss);
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"Loss callback error: {ex.Message}");
            }
        }, null, LossReportIntervalMs, LossReportIntervalMs);
    }

    public void SetLossCallback(Action<int> callback) => _onLossReport = callback;

    private long CalculateGap(long current, long last)
    {
        long gap = current - last - 1;
        if (gap < -1000000)
            gap += int.MaxValue;
        return Math.Max(0, gap);
    }

    private void GeneratePLC(int frames)
    {
        int count = Math.Min(frames, MaxPlcFrames);
        for (int i = 0; i < count; i++)
        {
            Array.Clear(_plcBuffer, 0, _plcBuffer.Length);
            _decoder.Decode(null, 0, 0, _plcBuffer, 0);
            lock (_lock)
            {
                _pcmQueue.Enqueue(_plcBuffer.ToArray());
            }
        }
    }

    /// <summary>
    /// Feed an incoming Opus packet. Decodes immediately and queues PCM.
    /// Called from the network/process thread.
    /// </summary>
    public void FeedEncodedPacket(byte[] opusData, long sequence)
    {
        if (_lastSequence >= 0)
        {
            long gap = CalculateGap(sequence, _lastSequence);
            if (gap > 0)
            {
                _lostPackets += (int)gap;
                if (gap <= MaxGapFrames)
                {
                    GeneratePLC((int)gap);
                }
            }
        }
        _lastSequence = sequence;

        var samples = OpusDecoder.GetSamples(opusData, 0, opusData.Length, _sampleRate);
        if (samples <= 0) return;

        var decoded = new byte[samples * _bytesPerSample];
        _decoder.Decode(opusData, 0, opusData.Length, decoded, 0);

        lock (_lock)
        {
            _pcmQueue.Enqueue(decoded);
            _totalExpected++;
        }
    }

    /// <summary>
    /// IWaveProvider.Read — called by NAudio playback device on its audio thread.
    /// Pulls decoded PCM from the queue, returns silence if empty. Applies volume.
    /// </summary>
    public int GetAndResetLossPercent()
    {
        lock (_lock)
        {
            if (_totalExpected == 0) return 0;
            int loss = (int)(_lostPackets / (float)_totalExpected * 100);
            _lostPackets = 0;
            _totalExpected = 0;
            return loss;
        }
    }

    public int Read(byte[] buffer, int offset, int count)
    {
        float volume;
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

            // Capture volume inside lock to ensure consistent read
            volume = Volatile.Read(ref _volume);
        }

        // Apply volume outside lock to reduce contention
        if (volume != 1.0f)
            ApplyVolume(buffer, offset, count, volume);
        
        return count;
    }

    private void ApplyVolume(byte[] buffer, int offset, int length, float volume)
    {
        for (int i = offset; i < offset + length - 1; i += 2)
        {
            short sample = (short)(buffer[i] | (buffer[i + 1] << 8));
            float adjusted = sample * volume;
            adjusted = Math.Clamp(adjusted, short.MinValue, short.MaxValue);
            short clampedSample = (short)adjusted;
            buffer[i] = (byte)(clampedSample & 0xFF);
            buffer[i + 1] = (byte)((clampedSample >> 8) & 0xFF);
        }
    }

    public void Dispose()
    {
        _lossTimer?.Dispose();
        _decoder.Dispose();
    }
}
