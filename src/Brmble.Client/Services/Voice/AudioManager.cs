using System.Diagnostics;
using MumbleVoiceEngine.Pipeline;
using NAudio.Wave;

namespace Brmble.Client.Services.Voice;

public enum TransmissionMode { Continuous, VoiceActivity, PushToTalk }

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
    private volatile TransmissionMode _transmissionMode = TransmissionMode.Continuous;
    private volatile bool _pttActive;
    internal const int PttHotkeyId = 1;
    private int _hotkeyId = -1;
    private IntPtr _hwnd;
    private const int RmsThreshold = 300; // ~1% of 16-bit max (32767)

    // Speaking detection
    private readonly Dictionary<uint, DateTime> _lastVoicePacket = new();
    private readonly Timer _speakingTimer;
    private const int SpeakingTimeoutMs = 200;
    private uint _localUserId = 0;

    public void SetLocalUserId(uint sessionId) => _localUserId = sessionId;

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

            _waveIn.StartRecording();
            _micStarted = true;
            Debug.WriteLine("[Audio] Mic started");
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

    private void OnMicData(object? sender, WaveInEventArgs e)
    {
        if (_muted) return;
        if (_transmissionMode == TransmissionMode.PushToTalk && !_pttActive) return;
        if (_transmissionMode == TransmissionMode.VoiceActivity && !IsAboveThreshold(e.Buffer, e.BytesRecorded)) return;

        // Local speaking detection - track in _lastVoicePacket like remote users
        lock (_lock)
        {
            if (!_lastVoicePacket.ContainsKey(_localUserId))
            {
                UserStartedSpeaking?.Invoke(_localUserId);
            }
            _lastVoicePacket[_localUserId] = DateTime.UtcNow;
        }

        _encodePipeline?.SubmitPcm(new ReadOnlySpan<byte>(e.Buffer, 0, e.BytesRecorded));
    }

    /// <summary>RMS check: returns true if the audio chunk is loud enough to transmit.</summary>
    private static bool IsAboveThreshold(byte[] buffer, int bytesRecorded)
    {
        long sumSq = 0;
        int samples = bytesRecorded / 2; // 16-bit samples
        for (int i = 0; i < bytesRecorded - 1; i += 2)
        {
            short sample = (short)(buffer[i] | (buffer[i + 1] << 8));
            sumSq += sample * sample;
        }
        if (samples == 0) return false;
        var rms = Math.Sqrt(sumSq / (double)samples);
        return rms >= RmsThreshold;
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

                Debug.WriteLine($"[Audio] Created playback pipeline for user {userId}");
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

    /// <summary>
    /// Sets the transmission mode. For PTT, registers a global Win32 hotkey.
    /// Pass hwnd = IntPtr.Zero to skip hotkey registration (e.g. in tests).
    /// </summary>
    public void SetTransmissionMode(TransmissionMode mode, string? key, IntPtr hwnd)
    {
        _pttActive = false;
        _hwnd = hwnd;
        _transmissionMode = mode;

        // Unregister any existing hotkey
        if (_hotkeyId >= 0 && _hwnd != IntPtr.Zero)
        {
            UnregisterHotKey(_hwnd, _hotkeyId);
            _hotkeyId = -1;
        }

        if (mode == TransmissionMode.PushToTalk && key != null && hwnd != IntPtr.Zero)
        {
            var vk = KeyNameToVirtualKey(key);
            if (vk != 0)
            {
                _hotkeyId = PttHotkeyId;
                if (!RegisterHotKey(hwnd, _hotkeyId, 0, (uint)vk))
                {
                    _hotkeyId = -1;
                    Debug.WriteLine($"[Audio] RegisterHotKey failed for vk=0x{vk:X2}");
                }
            }
        }

        // For PTT, start with mic off until key pressed
        if (mode == TransmissionMode.PushToTalk)
            StopMic();
        else if (!_muted)
            StartMic();
    }

    /// <summary>Called from WndProc when WM_HOTKEY fires.</summary>
    public void HandleHotKey(int id, bool keyDown)
    {
        if (id != _hotkeyId || _transmissionMode != TransmissionMode.PushToTalk) return;
        SetPttActive(keyDown);
    }

    /// <summary>Start or stop mic for PTT.</summary>
    private void SetPttActive(bool active)
    {
        _pttActive = active;
        if (active && !_muted)
            StartMic();
        else
            StopMic();
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
        if (_hotkeyId >= 0 && _hwnd != IntPtr.Zero)
        {
            UnregisterHotKey(_hwnd, _hotkeyId);
            _hotkeyId = -1;
        }
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

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern bool UnregisterHotKey(IntPtr hWnd, int id);

    /// <summary>
    /// Maps JS key names (from e.key / e.code) to Win32 virtual key codes.
    /// Covers common PTT keys. Returns 0 if unknown.
    /// </summary>
    internal static int KeyNameToVirtualKey(string key) => key switch
    {
        "Space"  => 0x20,
        "F1"     => 0x70, "F2" => 0x71, "F3" => 0x72, "F4" => 0x73,
        "F5"     => 0x74, "F6" => 0x75, "F7" => 0x76, "F8" => 0x77,
        "F9"     => 0x78, "F10" => 0x79, "F11" => 0x7A, "F12" => 0x7B,
        "CapsLock" => 0x14,
        "Tab"    => 0x09,
        "Shift"  => 0x10, "Control" => 0x11, "Alt" => 0x12,
        "Insert" => 0x2D,
        _ when key.Length == 1 => char.ToUpper(key[0]),
        _ => 0
    };
}

