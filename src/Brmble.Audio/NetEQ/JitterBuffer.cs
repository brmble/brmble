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

    // Pre-allocated buffers to avoid GC pressure on the playout thread
    private readonly short[] _frameBuffer = new short[FrameSize];
    private readonly short[] _secondFrameBuffer = new short[FrameSize];

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
            _expectedTimestamp = packet.Timestamp;
            _firstPacketReceived = false;
        }

        _lastInsertedSequence = packet.Sequence;

        // Set expected timestamp from first packet, or adjust backward
        // if an earlier packet arrives before playout has consumed it
        if (!_firstPacketReceived)
        {
            _expectedTimestamp = packet.Timestamp;
            _firstPacketReceived = true;
        }
        else if (packet.Timestamp < _expectedTimestamp)
        {
            _expectedTimestamp = packet.Timestamp;
        }

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

        // Peek to see if the expected packet is available (don't consume yet)
        bool packetAvailable = _packetBuffer.Contains(_expectedTimestamp);

        // Track late packets
        if (!packetAvailable && _firstPacketReceived)
        {
            if (_packetBuffer.Count > 0)
                _stats.LatePackets++;
        }

        var decision = _decisionLogic.Decide(
            packetAvailable,
            _packetBuffer.Count,
            _delayManager.TargetLevel,
            _previousDecision);

        // Use pre-allocated buffers instead of stackalloc
        Span<short> frame = _frameBuffer;

        // Consume the packet only for decisions that need it
        EncodedPacket? packet = decision != PlayoutDecision.Decelerate
            ? _packetBuffer.TryGetNext(_expectedTimestamp)
            : null;

        switch (decision)
        {
            case PlayoutDecision.Normal:
                _decoder.Decode(packet!.Payload, frame);
                frame[..FrameSize].CopyTo(output);
                frame[..FrameSize].CopyTo(_lastDecodedFrame);
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
                _decoder.Decode(packet!.Payload, mergeFrame);
                if (_hasLastDecodedFrame)
                    CrossFade(output, _lastDecodedFrame, mergeFrame);
                else
                    mergeFrame[..FrameSize].CopyTo(output);
                mergeFrame[..FrameSize].CopyTo(_lastDecodedFrame);
                _hasLastDecodedFrame = true;
                _stats.NormalFrames++;
                break;

            case PlayoutDecision.Accelerate:
                _decoder.Decode(packet!.Payload, frame);
                var nextPacket = _packetBuffer.TryGetNext(_expectedTimestamp + FrameSize);
                if (nextPacket != null)
                {
                    Span<short> nextFrame = _secondFrameBuffer;
                    _decoder.Decode(nextPacket.Payload, nextFrame);
                    CrossFade(output, frame, nextFrame);
                    _expectedTimestamp += FrameSize;
                    nextFrame[..FrameSize].CopyTo(_lastDecodedFrame);
                }
                else
                {
                    frame[..FrameSize].CopyTo(output);
                    frame[..FrameSize].CopyTo(_lastDecodedFrame);
                }
                _hasLastDecodedFrame = true;
                _stats.AccelerateFrames++;
                break;

            case PlayoutDecision.Decelerate:
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
                _expectedTimestamp -= FrameSize;
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

        // Advance expected timestamp
        _expectedTimestamp += FrameSize;

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

        // Reset state after prolonged silence to prevent timestamp drift.
        // When NAudio keeps calling GetAudio during silence, _expectedTimestamp
        // races ahead. After SilenceResetThreshold Expand frames, reset so the
        // next InsertPacket re-initializes _expectedTimestamp.
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
