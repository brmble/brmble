using System.Diagnostics;
using MumbleVoiceEngine.Pipeline;
using NAudio.Wave;

namespace Brmble.Client.Services.Voice;

/// <summary>
/// Manages audio I/O: mic capture via EncodePipeline, per-user speaker
/// playback via UserAudioPipeline, mute/deafen state, and speaking detection.
/// </summary>
internal sealed class AudioManager : IDisposable
{
    private readonly object _lock = new();

    // Encode (mic → network)
    private EncodePipeline? _encodePipeline;
    private WaveInEvent? _waveIn;
    private volatile bool _micStarted;

    // Decode (network → speakers)
    private readonly Dictionary<uint, UserAudioPipeline> _pipelines = new();
    private readonly Dictionary<uint, WaveOutEvent> _players = new();

    // State
    private volatile bool _muted;
    private volatile bool _deafened;

    // Speaking detection
    private readonly Dictionary<uint, DateTime> _lastVoicePacket = new();
    private readonly Timer _speakingTimer;
    private const int SpeakingTimeoutMs = 200;

    /// <summary>Fired when an encoded voice packet is ready to send to the server.</summary>
    public event Action<ReadOnlyMemory<byte>>? SendVoicePacket;

    /// <summary>Fired when a user starts speaking (first voice packet after silence).</summary>
    public event Action<uint>? UserStartedSpeaking;

    /// <summary>Fired when a user stops speaking (no packets for SpeakingTimeoutMs).</summary>
    public event Action<uint>? UserStoppedSpeaking;

    public bool IsMuted => _muted;
    public bool IsDeafened => _deafened;

    public AudioManager()
    {
        _speakingTimer = new Timer(CheckSpeakingState, null, 100, 100);
    }

    /// <summary>Start mic capture and encoding. No-op if already started or muted.</summary>
    public void StartMic()
    {
        lock (_lock)
        {
            if (_micStarted || _muted) return;

            _encodePipeline ??= new EncodePipeline(
                sampleRate: 48000, channels: 1, bitrate: 72000,
                onPacketReady: packet => SendVoicePacket?.Invoke(packet));

            if (_waveIn == null)
            {
                _waveIn = new WaveInEvent
                {
                    DeviceNumber = -1,
                    BufferMilliseconds = 20,
                    WaveFormat = new WaveFormat(48000, 16, 1)
                };
                _waveIn.DataAvailable += OnMicData;
            }

            // Log available input devices
            DevLog.Log($"[Audio] Input devices ({WaveInEvent.DeviceCount}):");
            for (int i = -1; i < WaveInEvent.DeviceCount; i++)
            {
                var caps = WaveInEvent.GetCapabilities(i);
                DevLog.Log($"[Audio]   [{i}]{(i == -1 ? " (DEFAULT)" : "")} {caps.ProductName} (channels: {caps.Channels})");
            }

            _waveIn.StartRecording();
            _micStarted = true;
            DevLog.Log("[Audio] Mic started, using device -1 (Windows default)");
        }
    }

    /// <summary>Stop mic capture and dispose encode pipeline. No-op if not started.</summary>
    public void StopMic()
    {
        lock (_lock)
        {
            if (!_micStarted) return;

            _waveIn?.StopRecording();
            _encodePipeline?.Dispose();
            _encodePipeline = null;
            _micStarted = false;
            Debug.WriteLine("[Audio] Mic stopped");
        }
    }

    private int _micDataCount;
    private void OnMicData(object? sender, WaveInEventArgs e)
    {
        if (_muted) return;
        _micDataCount++;
        if (_micDataCount % 250 == 1) // log every ~5 seconds at 20ms intervals
            DevLog.Log($"[Audio] OnMicData #{_micDataCount}: {e.BytesRecorded}B");
        _encodePipeline?.SubmitPcm(new ReadOnlySpan<byte>(e.Buffer, 0, e.BytesRecorded));
    }

    /// <summary>
    /// Feed an incoming voice packet for a user. Decodes Opus and queues PCM
    /// for speaker playback. Creates per-user pipeline lazily.
    /// Called from MumbleSharp process thread.
    /// </summary>
    public void FeedVoice(uint userId, byte[] opusData, long sequence)
    {
        if (_deafened) return;

        bool startedSpeaking = false;
        lock (_lock)
        {
            if (!_pipelines.TryGetValue(userId, out var pipeline))
            {
                pipeline = new UserAudioPipeline(sampleRate: 48000, channels: 1);
                _pipelines[userId] = pipeline;

                var player = new WaveOutEvent
                {
                    DesiredLatency = 80,
                    NumberOfBuffers = 4
                };
                player.Init(pipeline);
                player.Play();
                _players[userId] = player;

                DevLog.Log($"[Audio] Created playback pipeline for user {userId}, using device -1 (Windows default)");
            }

            pipeline.FeedEncodedPacket(opusData, sequence);

            // Speaking detection: track first packet after silence
            var now = DateTime.UtcNow;
            if (!_lastVoicePacket.ContainsKey(userId))
                startedSpeaking = true;
            _lastVoicePacket[userId] = now;
        }

        if (startedSpeaking)
            UserStartedSpeaking?.Invoke(userId);
    }

    /// <summary>Clean up a user's audio pipeline when they disconnect.</summary>
    public void RemoveUser(uint userId)
    {
        bool wasSpeaking;
        lock (_lock)
        {
            if (_players.Remove(userId, out var player))
            {
                player.Stop();
                player.Dispose();
            }
            if (_pipelines.Remove(userId, out var pipeline))
                pipeline.Dispose();
            wasSpeaking = _lastVoicePacket.Remove(userId);
        }

        if (wasSpeaking)
            UserStoppedSpeaking?.Invoke(userId);
    }

    /// <summary>Set mute state. Stops/starts mic capture accordingly.</summary>
    public void SetMuted(bool muted)
    {
        _muted = muted;
        if (muted)
            StopMic();
        else
            StartMic();
    }

    /// <summary>Set deafen state. Stops all playback when deafened.</summary>
    public void SetDeafened(bool deafened)
    {
        _deafened = deafened;
        if (deafened)
        {
            List<uint> wasSpeaking;
            lock (_lock)
            {
                foreach (var player in _players.Values)
                {
                    player.Stop();
                    player.Dispose();
                }
                foreach (var pipeline in _pipelines.Values)
                    pipeline.Dispose();
                _players.Clear();
                _pipelines.Clear();

                wasSpeaking = new List<uint>(_lastVoicePacket.Keys);
                _lastVoicePacket.Clear();
            }

            foreach (var userId in wasSpeaking)
                UserStoppedSpeaking?.Invoke(userId);
        }
    }

    private void CheckSpeakingState(object? state)
    {
        List<uint> stopped;
        lock (_lock)
        {
            var now = DateTime.UtcNow;
            stopped = new List<uint>();
            foreach (var (userId, lastPacket) in _lastVoicePacket)
            {
                if ((now - lastPacket).TotalMilliseconds > SpeakingTimeoutMs)
                    stopped.Add(userId);
            }
            foreach (var userId in stopped)
                _lastVoicePacket.Remove(userId);
        }

        foreach (var userId in stopped)
            UserStoppedSpeaking?.Invoke(userId);
    }

    public void Dispose()
    {
        _speakingTimer.Dispose();
        StopMic();
        _waveIn?.Dispose();
        _waveIn = null;
        _encodePipeline?.Dispose();
        _encodePipeline = null;

        lock (_lock)
        {
            foreach (var player in _players.Values)
            {
                player.Stop();
                player.Dispose();
            }
            foreach (var pipeline in _pipelines.Values)
                pipeline.Dispose();
            _players.Clear();
            _pipelines.Clear();
            _lastVoicePacket.Clear();
        }
    }
}
