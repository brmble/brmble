namespace MumbleVoiceEngine.Pipeline;

using System.Buffers;
using System.Runtime.InteropServices;
using MumbleVoiceEngine.Codec;
using MumbleVoiceEngine.Protocol;

/// <summary>
/// Encode pipeline: accumulates PCM → Opus encode → voice packet.
/// Emits complete voice packets via callback when a full frame is encoded.
/// </summary>
public class EncodePipeline : IDisposable
{
    private readonly OpusEncoder _encoder;
    private readonly int _frameSize;        // samples per frame (960)
    private readonly int _frameSizeBytes;   // bytes per frame (1920 for mono 16-bit)
    private readonly byte[] _accumulator;
    private int _accumulatorPos;
    private long _sequenceNumber;
    private readonly Action<ReadOnlyMemory<byte>> _onPacketReady;
    private float _volume = 1.0f;
    private int _target;

    public EncodePipeline(int sampleRate, int channels, int bitrate,
        Action<ReadOnlyMemory<byte>> onPacketReady, int frameSize = 960,
        bool dtx = false, long initialSequence = 0)
    {
        _frameSize = frameSize;
        _frameSizeBytes = frameSize * sizeof(short) * channels;
        _accumulator = new byte[_frameSizeBytes];
        _onPacketReady = onPacketReady;
        _sequenceNumber = initialSequence;

        var application = bitrate >= 32000 ? Application.Audio : Application.Voip;
        _encoder = new OpusEncoder(sampleRate, channels, application)
        {
            Bitrate = bitrate,
            EnableForwardErrorCorrection = true,
            Vbr = true,
            Complexity = 10,
            SignalType = OpusSignalType.Voice,
            Bandwidth = OpusBandwidth.Fullband,
            PacketLossPercentage = 3,
            Dtx = dtx
        };

        if (!_encoder.PermittedFrameSizes.Contains(_frameSize))
            throw new ArgumentException(
                $"Frame size {_frameSize} samples is not permitted by the Opus encoder at {sampleRate} Hz. " +
                $"Permitted sizes: {string.Join(", ", _encoder.PermittedFrameSizes)}",
                nameof(frameSize));
    }

    public void SetTarget(int target) => _target = target;

    public void SetVolume(float volume) => _volume = Math.Clamp(volume, 0f, 2.5f);

    public long CurrentSequence => _sequenceNumber;

    public void UpdatePacketLoss(int observedLossPercent)
    {
        int clamped = Math.Clamp(observedLossPercent + 5, 5, 25);
        _encoder.PacketLossPercentage = clamped;
    }

    /// <summary>
    /// Submit raw PCM audio. Voice packets are emitted via onPacketReady
    /// when a full Opus frame has been accumulated and encoded.
    /// </summary>
    public void SubmitPcm(ReadOnlySpan<byte> pcm)
    {
        int offset = 0;
        while (offset < pcm.Length)
        {
            int needed = _frameSizeBytes - _accumulatorPos;
            int toCopy = Math.Min(needed, pcm.Length - offset);
            pcm.Slice(offset, toCopy).CopyTo(_accumulator.AsSpan(_accumulatorPos));
            _accumulatorPos += toCopy;
            offset += toCopy;

            if (_accumulatorPos >= _frameSizeBytes)
            {
                EncodeAndEmit(terminator: false);
                _accumulatorPos = 0;
            }
        }
    }

    /// <summary>
    /// End the current voice transmission. If the accumulator contains a partial
    /// frame, it is zero-padded to a full frame, encoded, and emitted with the
    /// Mumble Opus terminator flag set so receivers see a clean end-of-stream.
    /// If the accumulator is empty, no packet is emitted (matches upstream
    /// Mumble behaviour). After this call, no further packets will be produced
    /// unless new PCM is submitted (which restarts the stream at the next
    /// sequence number — callers normally Dispose() right after FlushFinal()).
    /// </summary>
    public void FlushFinal()
    {
        if (_accumulatorPos == 0)
            return;

        // Zero-pad the partial frame so Opus encodes a fixed-size frame.
        Array.Clear(_accumulator, _accumulatorPos, _frameSizeBytes - _accumulatorPos);
        _accumulatorPos = _frameSizeBytes;
        EncodeAndEmit(terminator: true);
        _accumulatorPos = 0;
    }

    // Opus specification guarantees a single packet never exceeds 1275 bytes.
    // Using _frameSizeBytes as the output buffer can be smaller than this maximum
    // for short frames (e.g. 10ms mono = 960 bytes) at high bitrates, causing
    // encode failures. Use the spec-defined safe maximum instead.
    private const int MaxOpusPacketBytes = 1275;

    private void EncodeAndEmit(bool terminator)
    {
        byte[] scaled;

        if (_volume != 1.0f)
        {
            scaled = ArrayPool<byte>.Shared.Rent(_accumulatorPos);
            try
            {
                var samples = MemoryMarshal.Cast<byte, short>(
                    _accumulator.AsSpan(0, _accumulatorPos));
                var scaledSamples = MemoryMarshal.Cast<byte, short>(
                    scaled.AsSpan(0, _accumulatorPos));

                for (int i = 0; i < samples.Length; i++)
                {
                    float scaledSample = samples[i] * _volume;
                    scaledSamples[i] = (short)Math.Clamp(
                        scaledSample, short.MinValue, short.MaxValue);
                }
            }
            catch
            {
                ArrayPool<byte>.Shared.Return(scaled);
                throw;
            }
        }
        else
        {
            scaled = _accumulator;
        }

        try
        {
            var encoded = new byte[MaxOpusPacketBytes];
            int encodedLen = _encoder.Encode(scaled, 0, encoded, 0, _frameSize);

            var opusData = new byte[encodedLen];
            Array.Copy(encoded, opusData, encodedLen);

            byte[] packet = VoicePacketBuilder.Build(opusData, _sequenceNumber, _target, terminator);
            _sequenceNumber++;

            _onPacketReady(packet);
        }
        finally
        {
            if (_volume != 1.0f)
            {
                ArrayPool<byte>.Shared.Return(scaled);
            }
        }
    }

    public void Dispose()
    {
        _encoder.Dispose();
    }
}
