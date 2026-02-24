namespace MumbleVoiceEngine.Pipeline;

using System;
using System.Collections.Generic;
using System.Threading;
using NAudio.Wave;
using MumbleVoiceEngine.Codec;

/// <summary>
/// Per-user decode pipeline with optional jitter buffer.
/// Implements IWaveProvider so NAudio can play it directly.
/// </summary>
public class UserAudioPipeline : IWaveProvider, IDisposable
{
    private readonly OpusDecoder _decoder;
    private readonly int _sampleRate;
    private readonly int _channels;
    private readonly int _bytesPerSample;

    private readonly object _lock = new();
    private float _volume = 1.0f;

    public WaveFormat WaveFormat { get; }

    public int JitterBufferMs
    {
        get => Volatile.Read(ref _jitterBufferMs);
        set => Volatile.Write(ref _jitterBufferMs, value);
    }
    private int _jitterBufferMs = 30;

    private long _nextExpectedSequence;
    private readonly SortedDictionary<long, byte[]> _encodedBuffer = new();
    private readonly Timer? _jitterTimer;

    private readonly Queue<byte[]> _pcmQueue = new();
    private byte[]? _currentFrame;
    private int _currentFrameOffset;

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

        if (_jitterBufferMs > 0)
        {
            _jitterTimer = new Timer(ProcessJitterBuffer, null, Timeout.Infinite, Timeout.Infinite);
        }
    }

    private void ProcessJitterBuffer(object? state)
    {
        if (_jitterBufferMs <= 0) return;

        lock (_lock)
        {
            TryReleasePackets();
        }
    }

    private void TryReleasePackets()
    {
        while (_encodedBuffer.Count > 0)
        {
            if (!_encodedBuffer.TryGetValue(_nextExpectedSequence, out var opusData))
            {
                break;
            }

            _encodedBuffer.Remove(_nextExpectedSequence);
            DecodeAndQueue(opusData);
            _nextExpectedSequence++;
        }
    }

    private void DecodeAndQueue(byte[] opusData)
    {
        var samples = OpusDecoder.GetSamples(opusData, 0, opusData.Length, _sampleRate);
        if (samples <= 0) return;

        var decoded = new byte[samples * _bytesPerSample];
        _decoder.Decode(opusData, 0, opusData.Length, decoded, 0);
        _pcmQueue.Enqueue(decoded);
    }

    public void FeedEncodedPacket(byte[] opusData, long sequence)
    {
        if (_jitterBufferMs <= 0)
        {
            DecodeAndQueue(opusData);
            return;
        }

        lock (_lock)
        {
            if (sequence < _nextExpectedSequence)
            {
                return;
            }

            if (sequence > _nextExpectedSequence + 10)
            {
                return;
            }

            _encodedBuffer[sequence] = opusData;
            TryReleasePackets();

            _jitterTimer?.Change(_jitterBufferMs, Timeout.Infinite);
        }
    }

    public int Read(byte[] buffer, int offset, int count)
    {
        float volume;
        lock (_lock)
        {
            int written = 0;

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

            while (written < count)
            {
                if (!_pcmQueue.TryDequeue(out var frame))
                {
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
                    Array.Copy(frame, 0, buffer, offset + written, needed);
                    written += needed;
                    _currentFrame = frame;
                    _currentFrameOffset = needed;
                }
            }

            volume = Volatile.Read(ref _volume);
        }

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
        _jitterTimer?.Dispose();
        _decoder.Dispose();
    }
}
