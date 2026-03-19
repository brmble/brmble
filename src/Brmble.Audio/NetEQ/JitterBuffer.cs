using Brmble.Audio.Codecs;
using Brmble.Audio.Diagnostics;
using Brmble.Audio.NetEQ.Models;

namespace Brmble.Audio.NetEQ;

/// <summary>
/// Adaptive jitter buffer for a single speaker. Orchestrates PacketBuffer,
/// DelayManager, and DecisionLogic to produce continuous PCM output.
/// Thread safety: InsertPacket() from network thread, GetAudio() from playout thread.
/// </summary>
public class JitterBuffer : IDisposable
{
    private const int FrameSize = 960; // 20ms at 48kHz

    private readonly IOpusDecoder _decoder;
    private readonly PacketBuffer _packetBuffer;
    private readonly DelayManager _delayManager;
    private readonly DecisionLogic _decisionLogic;
    private readonly JitterBufferStats _stats;

    // Pre-allocated buffers — large enough for max Opus frame (120ms = 5760 samples)
    private const int MaxDecodeSamples = 5760;
    private readonly short[] _frameBuffer = new short[MaxDecodeSamples];
    private readonly short[] _secondFrameBuffer = new short[MaxDecodeSamples];

    // SyncBuffer for excess decoded samples (when frame > 20ms)
    private readonly SyncBuffer _syncBuffer = new(capacity: MaxDecodeSamples);

    // Cross-fade buffer for Merge/Accelerate/Decelerate
    private const int OverlapSamples = 96; // 2ms at 48kHz

    private PlayoutDecision _previousDecision = PlayoutDecision.Normal;
    private readonly short[] _lastDecodedFrame = new short[FrameSize];
    private bool _hasLastDecodedFrame;
    private bool _firstPacketReceived;
    private bool _playoutStarted; // true once we've buffered enough to start
    private readonly int _initialBufferFrames;
    private bool _disposed;

    // Sequence reset detection
    private const int SequenceResetThreshold = 100;
    private long _lastInsertedSequence = -1;

    public float Volume { get; set; } = 1.0f;

    public bool IsSpeaking { get; private set; }
    private int _realAudioTicks;
    private const int SpeakingThreshold = 3;

    // Silence detection: reset state after prolonged silence
    private int _consecutiveExpandCount;
    private const int SilenceResetThreshold = 25; // 25 frames = 500ms

    public JitterBuffer(IOpusDecoder decoder, int initialBufferFrames = 3)
    {
        _decoder = decoder;
        _initialBufferFrames = initialBufferFrames;
        _packetBuffer = new PacketBuffer();
        _delayManager = new DelayManager();
        _decisionLogic = new DecisionLogic();
        _stats = new JitterBufferStats();
    }

    /// <summary>
    /// Insert an encoded packet from the network thread.
    /// </summary>
    public void InsertPacket(EncodedPacket packet)
    {
        // Detect sequence reset (large backward jump)
        if (_lastInsertedSequence >= 0 &&
            packet.Sequence < _lastInsertedSequence - SequenceResetThreshold)
        {
            _packetBuffer.Flush();
            _delayManager.Reset();
            _firstPacketReceived = false;
            _playoutStarted = false;
        }

        _lastInsertedSequence = packet.Sequence;

        if (!_firstPacketReceived)
            _firstPacketReceived = true;

        if (!_packetBuffer.Insert(packet))
        {
            _stats.DuplicatePackets++;
            return;
        }

        _delayManager.Update(packet.Timestamp, packet.ArrivalTimeMs);
    }

    /// <summary>
    /// Produce 20ms (960 samples) of audio for the playout thread.
    /// Always writes exactly FrameSize samples to output.
    /// </summary>
    public void GetAudio(Span<short> output)
    {
        if (output.Length < FrameSize)
            throw new ArgumentException($"Output must be at least {FrameSize} samples");

        _stats.TotalFrames++;
        _stats.BufferLevel = _packetBuffer.Count;
        _stats.TargetLevel = _delayManager.TargetLevel;

        // Wait for initial buffer to fill before starting playout.
        // Until then, return silence to avoid PLC noise on a fresh decoder.
        if (!_playoutStarted && _initialBufferFrames > 0)
        {
            if (_firstPacketReceived && _packetBuffer.Count >= _initialBufferFrames)
                _playoutStarted = true;
            else
            {
                output[..FrameSize].Clear();
                return;
            }
        }

        // Fill SyncBuffer from packets until we have enough for one output frame.
        // This handles both small frames (<960, e.g. 10ms) and large frames (>960, e.g. 60ms).
        Span<short> frame = _frameBuffer;
        while (_syncBuffer.AvailableSamples < FrameSize && _packetBuffer.Count > 0)
        {
            var pkt = _packetBuffer.TryPopFirst();
            if (pkt == null) break;
            int decoded = _decoder.Decode(pkt.Payload, frame);
            if (decoded > 0)
                _syncBuffer.Write(frame[..decoded]);
        }

        // If SyncBuffer has enough, serve from it directly
        if (_syncBuffer.AvailableSamples >= FrameSize)
        {
            _syncBuffer.Read(output[..FrameSize]);
            output[..FrameSize].CopyTo(_lastDecodedFrame);
            _hasLastDecodedFrame = true;
            _stats.NormalFrames++;
            _stats.TotalFrames++; // already incremented above, adjust
            _stats.TotalFrames--; // undo double-count
            _previousDecision = PlayoutDecision.Normal;
            _consecutiveExpandCount = 0;
            _realAudioTicks = Math.Min(_realAudioTicks + 1, SpeakingThreshold + 1);
            IsSpeaking = _realAudioTicks >= SpeakingThreshold;
            float v = Volume;
            if (v < 0.999f || v > 1.001f)
                for (int i = 0; i < FrameSize; i++)
                    output[i] = (short)Math.Clamp(output[i] * v, short.MinValue, short.MaxValue);
            return;
        }

        // Not enough samples even after draining all packets — check what to do
        bool packetAvailable = _syncBuffer.AvailableSamples > 0;

        // If we reach here, buffer is empty or has < 960 samples.
        // Use PLC to fill (maintains decoder state for smooth transitions).
        {
            int partial = _syncBuffer.AvailableSamples > 0
                ? _syncBuffer.Read(output[..FrameSize])
                : 0;

            if (partial < FrameSize)
            {
                _decoder.DecodePlc(frame);
                frame[..(FrameSize - partial)].CopyTo(output[partial..FrameSize]);
            }

            output[..FrameSize].CopyTo(_lastDecodedFrame);
            _hasLastDecodedFrame = true;
            _stats.ExpandFrames++;
            _previousDecision = PlayoutDecision.Expand;
        }

        // Apply volume
        float vol = Volume;
        if (vol < 0.999f || vol > 1.001f)
        {
            for (int i = 0; i < FrameSize; i++)
                output[i] = (short)Math.Clamp(output[i] * vol, short.MinValue, short.MaxValue);
        }

        // Update speaking state
        bool isRealAudio = _previousDecision is PlayoutDecision.Normal
            or PlayoutDecision.Merge
            or PlayoutDecision.Accelerate
            or PlayoutDecision.Decelerate;

        if (isRealAudio)
            _realAudioTicks = Math.Min(_realAudioTicks + 1, SpeakingThreshold + 1);
        else
            _realAudioTicks = Math.Max(_realAudioTicks - 1, 0);

        IsSpeaking = _realAudioTicks >= SpeakingThreshold;

        // After prolonged silence, reset so initial buffering kicks in again
        if (_previousDecision == PlayoutDecision.Expand)
        {
            _consecutiveExpandCount++;
            if (_consecutiveExpandCount >= SilenceResetThreshold)
            {
                _firstPacketReceived = false;
                _playoutStarted = false;
                _packetBuffer.Flush();
                _consecutiveExpandCount = 0;
            }
        }
        else
        {
            _consecutiveExpandCount = 0;
        }
    }

    /// <summary>
    /// Linear cross-fade between outgoing and incoming frames.
    /// </summary>
    private static void CrossFade(Span<short> output, ReadOnlySpan<short> outgoing, ReadOnlySpan<short> incoming)
    {
        int nonOverlap = FrameSize - OverlapSamples;
        outgoing[..nonOverlap].CopyTo(output);

        for (int i = 0; i < OverlapSamples; i++)
        {
            float alpha = (float)i / OverlapSamples;
            output[nonOverlap + i] = (short)(
                outgoing[nonOverlap + i] * (1 - alpha) +
                incoming[i] * alpha);
        }
    }

    /// <summary>
    /// Decode a packet into the output buffer (FrameSize samples).
    /// If the decoded frame is larger than FrameSize, excess goes into SyncBuffer.
    /// </summary>
    private void DecodeToOutput(byte[] payload, Span<short> decodeBuf, Span<short> output)
    {
        int decoded = _decoder.Decode(payload, decodeBuf);
        if (decoded <= FrameSize)
        {
            decodeBuf[..Math.Min(decoded, FrameSize)].CopyTo(output[..FrameSize]);
            // Zero-fill if decoded < FrameSize
            if (decoded < FrameSize)
                output[decoded..FrameSize].Clear();
        }
        else
        {
            // Output first 960 samples, store rest in SyncBuffer
            decodeBuf[..FrameSize].CopyTo(output[..FrameSize]);
            _syncBuffer.Write(decodeBuf[FrameSize..decoded]);
        }
    }

    public JitterBufferStats GetStats() => _stats.Snapshot();

    public void Dispose()
    {
        if (!_disposed)
        {
            _decoder.Dispose();
            _disposed = true;
        }
    }
}
