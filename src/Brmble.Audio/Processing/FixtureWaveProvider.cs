using System;
using System.IO;
using System.Threading;
using NAudio.Wave;

namespace Brmble.Audio.Processing;

/// <summary>
/// An <see cref="IWaveIn"/> implementation that emits frames read from a WAV file
/// on a timer, loop-playing if configured. Used to replace the microphone for A/B
/// testing via the "Replay test fixture" Advanced setting.
/// Requires input file at 48 kHz mono 16-bit PCM.
/// </summary>
public sealed class FixtureWaveProvider : IWaveIn
{
    public WaveFormat WaveFormat { get; set; }
    public event EventHandler<WaveInEventArgs>? DataAvailable;
    public event EventHandler<StoppedEventArgs>? RecordingStopped;

    private readonly byte[] _fileBytes;
    private readonly int _frameBytes;
    private readonly int _frameMs;
    private readonly bool _loop;
    private Timer? _timer;
    private int _readPos;

    public FixtureWaveProvider(string wavPath, int frameMs = 20, bool loop = true)
    {
        _frameMs = frameMs;
        _loop = loop;
        using var reader = new WaveFileReader(wavPath);
        if (reader.WaveFormat.Encoding != WaveFormatEncoding.Pcm ||
            reader.WaveFormat.SampleRate != 48000 ||
            reader.WaveFormat.Channels != 1 ||
            reader.WaveFormat.BitsPerSample != 16)
        {
            throw new InvalidDataException($"fixture must be 48 kHz mono 16-bit PCM; got {reader.WaveFormat}");
        }
        WaveFormat = reader.WaveFormat;
        using var ms = new MemoryStream();
        reader.CopyTo(ms);
        _fileBytes = ms.ToArray();
        _frameBytes = 48 * frameMs * 2; // 48 samples/ms * frameMs * 2 bytes/sample
    }

    public void StartRecording()
    {
        _readPos = 0;
        _timer = new Timer(Tick, null, 0, _frameMs);
    }

    public void StopRecording()
    {
        _timer?.Dispose();
        _timer = null;
        RecordingStopped?.Invoke(this, new StoppedEventArgs());
    }

    private void Tick(object? _)
    {
        try
        {
            var frame = new byte[_frameBytes];
            int need = _frameBytes;
            int offset = 0;
            while (need > 0)
            {
                int available = _fileBytes.Length - _readPos;
                if (available <= 0)
                {
                    if (!_loop) { StopRecording(); return; }
                    _readPos = 0;
                    available = _fileBytes.Length;
                }
                int take = Math.Min(need, available);
                Buffer.BlockCopy(_fileBytes, _readPos, frame, offset, take);
                _readPos += take;
                offset += take;
                need -= take;
            }
            DataAvailable?.Invoke(this, new WaveInEventArgs(frame, _frameBytes));
        }
        catch (Exception ex)
        {
            RecordingStopped?.Invoke(this, new StoppedEventArgs(ex));
        }
    }

    public void Dispose()
    {
        StopRecording();
    }
}
