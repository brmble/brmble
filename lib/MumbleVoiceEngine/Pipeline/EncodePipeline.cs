namespace MumbleVoiceEngine.Pipeline;

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
    private int _target;

    public EncodePipeline(int sampleRate, int channels, int bitrate,
        Action<ReadOnlyMemory<byte>> onPacketReady, int frameSize = 960)
    {
        _frameSize = frameSize;
        _frameSizeBytes = frameSize * sizeof(short) * channels;
        _accumulator = new byte[_frameSizeBytes];
        _onPacketReady = onPacketReady;

        _encoder = new OpusEncoder(sampleRate, channels)
        {
            Bitrate = bitrate,
            EnableForwardErrorCorrection = true
        };
    }

    public void SetTarget(int target) => _target = target;

    public void ResetSequence() => _sequenceNumber = 0;

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
                EncodeAndEmit();
                _accumulatorPos = 0;
            }
        }
    }

    private void EncodeAndEmit()
    {
        var encoded = new byte[_frameSizeBytes]; // max output (actual will be much smaller)
        int encodedLen = _encoder.Encode(_accumulator, 0, encoded, 0, _frameSize);

        var opusData = new byte[encodedLen];
        Array.Copy(encoded, opusData, encodedLen);

        byte[] packet = VoicePacketBuilder.Build(opusData, _sequenceNumber, _target);
        _sequenceNumber++;

        _onPacketReady(packet);
    }

    public void Dispose()
    {
        _encoder.Dispose();
    }
}
