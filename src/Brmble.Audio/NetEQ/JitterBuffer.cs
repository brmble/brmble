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

    private long _expectedTimestamp;
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

        // First drain any excess samples from previous large-frame decode
        if (_syncBuffer.AvailableSamples >= FrameSize)
        {
            _syncBuffer.Read(output[..FrameSize]);
            _stats.NormalFrames++;
            _previousDecision = PlayoutDecision.Normal;
            _consecutiveExpandCount = 0;
            _realAudioTicks = Math.Min(_realAudioTicks + 1, SpeakingThreshold + 1);
            IsSpeaking = _realAudioTicks >= SpeakingThreshold;
            // Apply volume
            float v = Volume;
            if (v < 0.999f || v > 1.001f)
                for (int i = 0; i < FrameSize; i++)
                    output[i] = (short)Math.Clamp(output[i] * v, short.MinValue, short.MaxValue);
            return;
        }

        // Check if packets are available (sequence-agnostic)
        bool packetAvailable = _packetBuffer.Count > 0;

        var decision = _decisionLogic.Decide(
            packetAvailable,
            _packetBuffer.Count,
            _delayManager.TargetLevel,
            _previousDecision);

        // Use pre-allocated buffers instead of stackalloc
        Span<short> frame = _frameBuffer;

        // Pop the next packet sequentially (sorted by sequence number)
        // Don't consume for Decelerate (we repeat the last frame instead)
        EncodedPacket? packet = (decision != PlayoutDecision.Decelerate && decision != PlayoutDecision.Expand)
            ? _packetBuffer.TryPopFirst()
            : null;

        switch (decision)
        {
            case PlayoutDecision.Normal:
                DecodeToOutput(packet!.Payload, frame, output);
                output[..FrameSize].CopyTo(_lastDecodedFrame);
                _hasLastDecodedFrame = true;
                _stats.NormalFrames++;
                break;

            case PlayoutDecision.Expand:
                _decoder.DecodePlc(frame);
                frame[..FrameSize].CopyTo(output);
                frame[..FrameSize].CopyTo(_lastDecodedFrame);
                _hasLastDecodedFrame = true;
                _stats.ExpandFrames++;
                break;

            case PlayoutDecision.Merge:
                Span<short> mergeFrame = _secondFrameBuffer;
                DecodeToOutput(packet!.Payload, mergeFrame, mergeFrame);
                if (_hasLastDecodedFrame)
                    CrossFade(output, _lastDecodedFrame, mergeFrame);
                else
                    mergeFrame[..FrameSize].CopyTo(output);
                output[..FrameSize].CopyTo(_lastDecodedFrame);
                _hasLastDecodedFrame = true;
                _stats.NormalFrames++;
                break;

            case PlayoutDecision.Accelerate:
                // Decode current and skip one to shrink buffer
                DecodeToOutput(packet!.Payload, frame, output);
                var nextPacket = _packetBuffer.TryPopFirst();
                if (nextPacket != null)
                {
                    // Decode the skipped packet to keep decoder state consistent
                    Span<short> nextFrame = _secondFrameBuffer;
                    _decoder.Decode(nextPacket.Payload, nextFrame);
                    // Don't store excess — we're skipping this frame
                }
                output[..FrameSize].CopyTo(_lastDecodedFrame);
                _hasLastDecodedFrame = true;
                _stats.AccelerateFrames++;
                break;

            case PlayoutDecision.Decelerate:
                // Repeat last frame to grow the buffer
                if (_hasLastDecodedFrame)
                {
                    _lastDecodedFrame.AsSpan(0, FrameSize).CopyTo(output);
                }
                else
                {
                    _decoder.DecodePlc(frame);
                    frame[..FrameSize].CopyTo(output);
                    frame[..FrameSize].CopyTo(_lastDecodedFrame);
                    _hasLastDecodedFrame = true;
                }
                _stats.DecelerateFrames++;
                break;
        }

        // Apply volume
        float vol = Volume;
        if (vol < 0.999f || vol > 1.001f)
        {
            for (int i = 0; i < FrameSize; i++)
                output[i] = (short)Math.Clamp(output[i] * vol, short.MinValue, short.MaxValue);
        }

        // Update speaking state
        bool isRealAudio = decision is PlayoutDecision.Normal
            or PlayoutDecision.Merge
            or PlayoutDecision.Accelerate
            or PlayoutDecision.Decelerate;

        if (isRealAudio)
            _realAudioTicks = Math.Min(_realAudioTicks + 1, SpeakingThreshold + 1);
        else
            _realAudioTicks = Math.Max(_realAudioTicks - 1, 0);

        IsSpeaking = _realAudioTicks >= SpeakingThreshold;
        _previousDecision = decision;

        // After prolonged silence, reset so initial buffering kicks in again
        if (decision == PlayoutDecision.Expand)
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
