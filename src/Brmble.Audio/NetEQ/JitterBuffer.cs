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
    private readonly TimeStretcher _timeStretcher;

    // Tempo constants for time-stretching: >1 plays faster (Accelerate), <1 plays slower (Decelerate).
    private const double AccelerateTempo = 1.20;
    private const double DecelerateTempo = 0.83;

    // Scratch buffer for TimeStretcher output — 2× FrameSize to accommodate any over-production.
    private readonly short[] _stretchScratch = new short[FrameSize * 2];

    // Pre-allocated buffers — large enough for max Opus frame (120ms = 5760 samples)
    private const int MaxDecodeSamples = 5760;
    private readonly short[] _frameBuffer = new short[MaxDecodeSamples];
    private readonly short[] _secondFrameBuffer = new short[MaxDecodeSamples];

    // SyncBuffer for excess decoded samples (when frame > 20ms)
    private readonly SyncBuffer _syncBuffer = new(capacity: MaxDecodeSamples);

    // Cross-fade buffer for Merge/Accelerate/Decelerate
    private const int OverlapSamples = 96; // 2ms at 48kHz

    private readonly short[] _lastDecodedFrame = new short[FrameSize];
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

    /// <summary>
    /// The playout decision made on the most recent GetAudio call.
    /// Diagnostic-only; useful in tests and monitoring.
    /// </summary>
    public PlayoutDecision LastDecision { get; private set; } = PlayoutDecision.Normal;

    public JitterBuffer(IOpusDecoder decoder,
                        int initialBufferFrames = 3,
                        int minLevel = 1,
                        int maxLevel = 15,
                        double targetPercentile = 0.95)
    {
        _decoder = decoder;
        _initialBufferFrames = initialBufferFrames;
        _packetBuffer = new PacketBuffer();
        _delayManager = new DelayManager(minLevel, maxLevel, targetPercentile);
        _decisionLogic = new DecisionLogic();
        _stats = new JitterBufferStats();
        _timeStretcher = new TimeStretcher(sampleRate: 48000);
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
            _timeStretcher.Reset();
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

        // Determine playout decision now that the sync buffer is up-to-date.
        bool packetAvailable = _syncBuffer.AvailableSamples >= FrameSize;
        var decision = _decisionLogic.Decide(
            packetAvailable: packetAvailable,
            bufferLevel: _packetBuffer.Count,
            targetLevel: _delayManager.TargetLevel,
            previousDecision: LastDecision);

        switch (decision)
        {
            case PlayoutDecision.Normal:
                _syncBuffer.Read(output[..FrameSize]);
                output[..FrameSize].CopyTo(_lastDecodedFrame);
                _stats.NormalFrames++;
                _consecutiveExpandCount = 0;
                break;

            case PlayoutDecision.Expand:
            {
                bool isUnderflow = _syncBuffer.AvailableSamples == 0 && _packetBuffer.Count == 0;

                int partial = _syncBuffer.AvailableSamples > 0
                    ? _syncBuffer.Read(output[..FrameSize])
                    : 0;

                if (partial < FrameSize)
                {
                    _decoder.DecodePlc(frame);
                    frame[..(FrameSize - partial)].CopyTo(output[partial..FrameSize]);
                }

                output[..FrameSize].CopyTo(_lastDecodedFrame);
                _stats.ExpandFrames++;
                if (isUnderflow)
                    _stats.Underflows++;
                _consecutiveExpandCount++;
                break;
            }

            case PlayoutDecision.Accelerate:
            {
                // TODO: consider warming the stretcher from the Normal-path frames so it's primed
                // when Accelerate fires. Today the stretcher enters Accelerate cold, so the first
                // ~2 Accelerate frames usually fall back to CrossFade (warmup underproduction).
                // Read one frame from sync buffer into _frameBuffer.
                _syncBuffer.Read(_frameBuffer.AsSpan(0, FrameSize));

                // Try to decode a second frame from the next packet.
                bool secondFrameAvailable = false;
                var nextPkt = _packetBuffer.TryPopFirst();
                if (nextPkt != null)
                {
                    // Decode into _secondFrameBuffer; excess samples spill into SyncBuffer.
                    int decoded2 = _decoder.Decode(nextPkt.Payload, _secondFrameBuffer.AsSpan());
                    if (decoded2 > 0)
                    {
                        if (decoded2 > FrameSize)
                            _syncBuffer.Write(_secondFrameBuffer.AsSpan(FrameSize, decoded2 - FrameSize));
                        secondFrameAvailable = true;
                    }
                }

                if (secondFrameAvailable)
                {
                    // Attempt pitch-preserving time-stretch at AccelerateTempo.
                    // Feed only the first frame; SoundTouch needs warmup (~1 sequence window =
                    // 40ms) before it produces FrameSize samples. During warmup, produced < FrameSize
                    // and we fall back to CrossFade to avoid audio gaps.
                    int produced = _timeStretcher.IsOperational
                        ? _timeStretcher.Process(_frameBuffer.AsSpan(0, FrameSize), AccelerateTempo, _stretchScratch)
                        : 0;

                    if (produced >= FrameSize)
                    {
                        // Stretch succeeded: output the compressed frame and push the second
                        // frame back to the sync buffer so it plays next tick (net effect: one
                        // frame consumed, buffer level reduced by one).
                        _stretchScratch.AsSpan(0, FrameSize).CopyTo(output[..FrameSize]);
                        _syncBuffer.Write(_secondFrameBuffer.AsSpan(0, FrameSize));
                    }
                    else
                    {
                        // Warmup or non-operational: fall back to CrossFade. Reset the stretcher
                        // so partial output it produced (and that we can't use) doesn't leak into
                        // the next stretching attempt — otherwise the next successful Process call
                        // would emit already-played audio.
                        _timeStretcher.Reset();
                        CrossFade(output, _frameBuffer.AsSpan(0, FrameSize), _secondFrameBuffer.AsSpan(0, FrameSize));
                    }
                }
                else
                {
                    // No second packet decoded yet — output the single frame unmodified.
                    // We still count this as Accelerate: the decision was Accelerate;
                    // the effective stretch is skipped only because input wasn't there.
                    _frameBuffer.AsSpan(0, FrameSize).CopyTo(output[..FrameSize]);
                }

                output[..FrameSize].CopyTo(_lastDecodedFrame);
                _stats.AccelerateFrames++;
                _consecutiveExpandCount = 0;
                break;
            }

            case PlayoutDecision.Decelerate:
            {
                // Read one frame from sync buffer.
                _syncBuffer.Read(_frameBuffer.AsSpan(0, FrameSize));

                // Attempt pitch-preserving time-stretch at DecelerateTempo (<1 = slower).
                // Same warmup caveat as Accelerate: fall back to CrossFade until the stretcher
                // has accumulated enough internal history to produce a full output frame.
                int produced = _timeStretcher.IsOperational
                    ? _timeStretcher.Process(_frameBuffer.AsSpan(0, FrameSize), DecelerateTempo, _stretchScratch)
                    : 0;

                if (produced >= FrameSize)
                {
                    _stretchScratch.AsSpan(0, FrameSize).CopyTo(output[..FrameSize]);
                }
                else
                {
                    // Reset the stretcher on fallback — see Accelerate branch for rationale.
                    _timeStretcher.Reset();
                    CrossFade(output, _lastDecodedFrame.AsSpan(), _frameBuffer.AsSpan(0, FrameSize));
                }

                output[..FrameSize].CopyTo(_lastDecodedFrame);
                _stats.DecelerateFrames++;
                _consecutiveExpandCount = 0;
                break;
            }

            case PlayoutDecision.Merge:
            {
                // Merge keeps CrossFade — stretching a PLC-tail → speech transition adds more
                // artifacts than it removes, since the outgoing frame is already a PLC estimate.
                // Transition from PLC tail back to real audio via cross-fade.
                _syncBuffer.Read(_frameBuffer.AsSpan(0, FrameSize));
                CrossFade(output, _lastDecodedFrame.AsSpan() /* PLC tail */, _frameBuffer.AsSpan(0, FrameSize));
                output[..FrameSize].CopyTo(_lastDecodedFrame);
                _stats.MergeFrames++;
                _consecutiveExpandCount = 0;
                break;
            }

            default:
                // Safety: treat unknown decisions as Normal if sync buffer has data, else Expand.
                if (packetAvailable)
                {
                    _syncBuffer.Read(output[..FrameSize]);
                    output[..FrameSize].CopyTo(_lastDecodedFrame);
                    _stats.NormalFrames++;
                }
                else
                {
                    _decoder.DecodePlc(frame);
                    frame[..FrameSize].CopyTo(output[..FrameSize]);
                    output[..FrameSize].CopyTo(_lastDecodedFrame);
                    _stats.ExpandFrames++;
                    _consecutiveExpandCount++;
                }
                break;
        }

        // Update decision tracking
        LastDecision = decision;

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

        // After prolonged silence, reset so initial buffering kicks in again
        if (_consecutiveExpandCount >= SilenceResetThreshold)
        {
            _firstPacketReceived = false;
            _playoutStarted = false;
            _packetBuffer.Flush();
            _timeStretcher.Reset();
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
            _timeStretcher.Dispose();
            _disposed = true;
        }
    }
}
