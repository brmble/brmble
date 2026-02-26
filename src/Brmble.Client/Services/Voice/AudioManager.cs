using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using Brmble.Client.Services.SpeechEnhancement;
using MumbleVoiceEngine.Pipeline;
using NAudio.Wave;

namespace Brmble.Client.Services.Voice;

public enum TransmissionMode { Continuous, VoiceActivity, PushToTalk }

internal static class AudioLog
{
    private static readonly string LogPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Brmble", "audio.log");

    static AudioLog()
    {
        var dir = Path.GetDirectoryName(LogPath);
        if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
            Directory.CreateDirectory(dir);
    }

    public static void Write(string msg)
    {
        try
        {
            File.AppendAllText(LogPath, $"[{DateTime.Now:HH:mm:ss.fff}] {msg}\n");
        }
        catch { }
    }
}

internal static class Win32RawInput
{
    public const uint WM_INPUT = 0x00FF;
    public const uint RID_INPUT = 0x10000003;
    public const uint RIDEV_REMOVE = 0x00000001;    // Remove device registration
    public const uint RIDEV_INPUTSINK = 0x00000100; // Receive input even when window not focused
    public const uint RIDEV_NOLEGACY = 0x00000030;  // Don't receive legacy messages (blocks key)
    public const uint RIM_TYPEKEYBOARD = 1;         // Matches RAWINPUTHEADER.dwType for keyboards
    public const ushort HID_USAGE_PAGE_GENERIC = 0x01;
    public const ushort HID_USAGE_GENERIC_KEYBOARD = 0x06;
    public const ushort HID_USAGE_GENERIC_MOUSE = 0x02;

    public const int WH_MOUSE_LL = 14;
    public const int WH_KEYBOARD_LL = 13;
    public const int WM_KEYDOWN = 0x0100;
    public const int WM_KEYUP = 0x0101;
    public const int WM_SYSKEYDOWN = 0x0104;
    public const int WM_SYSKEYUP = 0x0105;
    public const int WM_LBUTTONDOWN = 0x0201;
    public const int WM_RBUTTONDOWN = 0x0204;
    public const int WM_MBUTTONDOWN = 0x0207;
    public const int WM_XBUTTONDOWN = 0x020B;
    public const int WM_LBUTTONUP = 0x0202;
    public const int WM_RBUTTONUP = 0x0205;
    public const int WM_MBUTTONUP = 0x0208;
    public const int WM_XBUTTONUP = 0x020C;

    public const int XBUTTON1 = 1;
    public const int XBUTTON2 = 2;

    [StructLayout(LayoutKind.Sequential)]
    public struct MSLLHOOKSTRUCT
    {
        public int ptX;
        public int ptY;
        public int mouseData;
        public int flags;
        public int time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct RAWINPUTHEADER
    {
        public uint dwType;
        public uint dwSize;
        public IntPtr hDevice;
        public IntPtr wParam;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct RAWKEYBOARD
    {
        public ushort MakeCode;
        public ushort Flags;
        public ushort Reserved;
        public ushort VKey;
        public uint Message;
        public uint ExtraInformation;
    }

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern int GetRawInputData(IntPtr hRawInput, uint uiCommand, IntPtr pData, ref uint pcbSize, uint cbSizeHeader);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern bool RegisterRawInputDevices(RAWINPUTDEVICE[] pRawInputDevices, uint uiNumDevices, uint cbSize);

    public delegate IntPtr LowLevelMouseProc(int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern IntPtr SetWindowsHookEx(int idHook, LowLevelMouseProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern IntPtr GetModuleHandle(string? lpModuleName);

    [StructLayout(LayoutKind.Sequential)]
    public struct RAWINPUTDEVICE
    {
        public ushort usUsagePage;
        public ushort usUsage;
        public uint dwFlags;
        public IntPtr hwndTarget;
    }
}

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
internal const int MuteHotkeyId = 2;
internal const int MuteDeafenHotkeyId = 4;
internal const int ContinuousHotkeyId = 5;
internal const int LeaveVoiceHotkeyId = 6;
private int _hotkeyId = -1;
private int _muteHotkeyId = -1;
private int _muteDeafenHotkeyId = -1;
private int _continuousHotkeyId = -1;
private int _leaveVoiceHotkeyId = -1;
    // Stored key names for suspend/resume during shortcut recording
    private string? _muteKeyName;
    private string? _muteDeafenKeyName;
    private string? _leaveVoiceKeyName;
    private IntPtr _hwnd;
    private const int RmsThreshold = 300; // ~1% of 16-bit max (32767)
    private const float TargetRms = 1500f;  // Target RMS for AGC (quiet boost target)
    private const float LoudRms = 8000f;     // Threshold for compression

    // Raw Input for PTT key detection (non-blocking)
    private int _pttVk;
    private bool _rawInputRegistered;

    // Polling for PTT key (works globally without blocking keys)
    private System.Threading.Timer? _pttPollingTimer;
    private bool _pttKeyWasDown;

    // Speaking detection
    private readonly Dictionary<uint, DateTime> _lastVoicePacket = new();
    private readonly Timer _speakingTimer;
    private const int SpeakingTimeoutMs = 200;
    private uint _localUserId = 0;

    // Volume controls
    private volatile float _inputVolume = 1.0f;
    private volatile float _outputVolume = 1.0f;
    private volatile float _maxAmplification = 1.0f;

    // Speech enhancement
    private SpeechEnhancementService? _speechEnhancement;
    private AudioResampler? _to16kResampler;
    private AudioResampler? _to48kResampler;

    public void SetLocalUserId(uint sessionId) => _localUserId = sessionId;

    /// <summary>Fired when an encoded voice packet is ready to send to the server.</summary>
    public event Action<ReadOnlyMemory<byte>>? SendVoicePacket;

    /// <summary>Fired when a user starts speaking (first voice packet after silence).</summary>
    public event Action<uint>? UserStartedSpeaking;

    /// <summary>Fired when a user stops speaking (no packets for SpeakingTimeoutMs).</summary>
    public event Action<uint>? UserStoppedSpeaking;

    public event Action? ToggleMuteRequested;
    public event Action? ToggleDeafenRequested;
    public event Action? ToggleContinuousRequested;
    public event Action? ToggleLeaveVoiceRequested;

    public bool IsMuted => _muted;
    public bool IsDeafened => _deafened;
    public TransmissionMode TransmissionMode => _transmissionMode;

    public void SetInputVolume(int percentage) => _inputVolume = Math.Clamp(percentage, 0, 250) / 100f;
    public void SetMaxAmplification(int percentage) => _maxAmplification = Math.Clamp(percentage, 100, 400) / 100f;

    public void ConfigureSpeechEnhancement(string modelsPath, bool enabled, GtcrnModelVariant variant)
    {
        lock (_lock)
        {
            _speechEnhancement?.Dispose();
            _to16kResampler = null;
            _to48kResampler = null;

            if (!enabled)
            {
                _speechEnhancement = null;
                return;
            }

            _speechEnhancement = new SpeechEnhancementService(modelsPath, enabled, variant);
            _to16kResampler = new AudioResampler(48000, 16000, 1);
            _to48kResampler = new AudioResampler(16000, 48000, 1);
        }
    }

    public void SetOutputVolume(int percentage)
    {
        _outputVolume = Math.Clamp(percentage, 0, 250) / 100f;
        lock (_lock)
        {
            foreach (var pipeline in _pipelines.Values)
                pipeline.Volume = _outputVolume;
        }
    }

    public AudioManager(IntPtr hwnd = default)
    {
        _hwnd = hwnd;
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
            AudioLog.Write("[Audio] Mic started");
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
            AudioLog.Write("[Audio] Mic stopped");
        }
    }

    private void OnMicData(object? sender, WaveInEventArgs e)
    {
        if (_muted) return;
        if (_transmissionMode == TransmissionMode.PushToTalk && !_pttActive) return;

        // Apply AGC first (boost quiet audio, compress loud before user gain)
        if (_maxAmplification != 1.0f)
            ApplyAGC(e.Buffer, e.BytesRecorded);

        // Apply input volume (after AGC to avoid clipping on boost)
        if (_inputVolume != 1.0f)
            ApplyInputVolume(e.Buffer, e.BytesRecorded);

        // Apply speech enhancement if enabled
        if (_speechEnhancement?.IsEnabled == true && _to16kResampler != null && _to48kResampler != null)
        {
            try
            {
                // Convert byte buffer to normalized float samples (48kHz, range [-1, 1])
                var sampleCount = e.BytesRecorded / 2;
                var samples48k = new float[sampleCount];
                for (int i = 0; i < sampleCount; i++)
                {
                    samples48k[i] = (short)(e.Buffer[i * 2] | (e.Buffer[i * 2 + 1] << 8)) / 32768f;
                }

                // Resample to 16kHz
                var samples16k = _to16kResampler.Resample(samples48k);

                // Enhance
                var enhanced16k = _speechEnhancement.Enhance(samples16k);

                if (enhanced16k != null)
                {
                    // Resample back to 48kHz
                    var enhanced48k = _to48kResampler.Resample(enhanced16k);

                    // Convert normalized floats back to int16 bytes
                    int samplesToCopy = Math.Min(enhanced48k.Length, sampleCount);
                    for (int i = 0; i < samplesToCopy; i++)
                    {
                        var sample = (short)Math.Clamp(enhanced48k[i] * 32768f, short.MinValue, short.MaxValue);
                        e.Buffer[i * 2] = (byte)(sample & 0xFF);
                        e.Buffer[i * 2 + 1] = (byte)((sample >> 8) & 0xFF);
                    }

                    // If the enhanced buffer is shorter than the original, zero-fill the remainder
                    if (samplesToCopy < sampleCount)
                    {
                        for (int i = samplesToCopy; i < sampleCount; i++)
                        {
                            e.Buffer[i * 2] = 0;
                            e.Buffer[i * 2 + 1] = 0;
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                // Enhancement failed — disable it so voice is never silenced by an error
                AudioLog.Write($"[Audio] Speech enhancement error, disabling: {ex.Message}");
                _speechEnhancement = null;
            }
        }

        // Voice activity check on processed signal
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

    private void ApplyInputVolume(byte[] buffer, int bytesRecorded)
    {
        for (int i = 0; i < bytesRecorded - 1; i += 2)
        {
            short sample = (short)(buffer[i] | (buffer[i + 1] << 8));
            float adjusted = sample * _inputVolume;
            adjusted = Math.Clamp(adjusted, short.MinValue, short.MaxValue);
            short clampedSample = (short)adjusted;
            buffer[i] = (byte)(clampedSample & 0xFF);
            buffer[i + 1] = (byte)((clampedSample >> 8) & 0xFF);
        }
    }

    private void ApplyAGC(byte[] buffer, int bytesRecorded)
    {
        // Calculate RMS of the chunk
        long sumSq = 0;
        int samples = bytesRecorded / 2;
        for (int i = 0; i < bytesRecorded - 1; i += 2)
        {
            short sample = (short)(buffer[i] | (buffer[i + 1] << 8));
            sumSq += (long)sample * sample;
        }
        if (samples == 0) return;
        float rms = (float)Math.Sqrt(sumSq / (double)samples);

        float gain = 1.0f;

        if (rms < TargetRms && rms > 0)
        {
            // Quiet audio: apply boost up to maxAmplification
            float neededBoost = TargetRms / rms;
            gain = Math.Min(neededBoost, _maxAmplification);
        }
        else if (rms > LoudRms)
        {
            // Loud audio: gentle compression
            gain = LoudRms / rms;
            // Soft knee: blend between 1 and gain
            float excess = (rms - LoudRms) / LoudRms;
            gain = 1.0f - (1.0f - gain) * Math.Min(excess * 2, 1.0f);
        }

        if (gain != 1.0f)
        {
            for (int i = 0; i < bytesRecorded - 1; i += 2)
            {
                short sample = (short)(buffer[i] | (buffer[i + 1] << 8));
                float adjusted = sample * gain;
                adjusted = Math.Clamp(adjusted, short.MinValue, short.MaxValue);
                short clampedSample = (short)adjusted;
                buffer[i] = (byte)(clampedSample & 0xFF);
                buffer[i + 1] = (byte)((clampedSample >> 8) & 0xFF);
            }
        }
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
                pipeline.Volume = _outputVolume;
                _pipelines[userId] = pipeline;

                var player = new WaveOutEvent
                {
                    DesiredLatency = 80,
                    NumberOfBuffers = 4
                };
                player.Init(pipeline);
                player.Play();
                _players[userId] = player;

                AudioLog.Write($"[Audio] Created playback pipeline for user {userId}");
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

    private bool RegisterSingleHotkey(ref int hotkeyId, int id, string? key, IntPtr hwnd)
    {
        if (hotkeyId >= 0 && hwnd != IntPtr.Zero)
        {
            UnregisterHotKey(hwnd, hotkeyId);
            hotkeyId = -1;
        }
        
        if (key == null || hwnd == IntPtr.Zero) return false;
        
        var vk = KeyNameToVirtualKey(key);
        if (vk == 0) return false;
        
        hotkeyId = id;
        return RegisterHotKey(hwnd, hotkeyId, 0, (uint)vk);
    }

    /// <summary>
    /// Sets the transmission mode. For PTT, configures keyboard polling (via GetAsyncKeyState)
    /// and mouse hooks for key/button detection, without blocking keys in other apps
    /// (unlike RegisterHotKey). Pass hwnd = IntPtr.Zero to skip registration (e.g. in tests).
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

        // Unregister raw input for PTT
        UnregisterRawInputKeyboard();

        // Stop polling when not in PTT mode
        if (mode != TransmissionMode.PushToTalk)
        {
            StopPttPolling();
        }

        if (mode == TransmissionMode.PushToTalk && key != null && hwnd != IntPtr.Zero)
        {
            var vk = KeyNameToVirtualKey(key);
            AudioLog.Write($"[Audio] SetTransmissionMode PTT: key={key}, vk=0x{vk:X2}, hwnd={hwnd}");

            bool isMouseButton = key is "XButton1" or "XButton2" or "MouseLeft" or "MouseRight" or "MouseMiddle";

            // Stop any existing polling before reconfiguring (switching from keyboard to mouse PTT)
            StopPttPolling();

            if (isMouseButton)
            {
                RegisterMouseHookForButton(key);
            }
            else if (vk != 0)
            {
                // Use keyboard polling via GetAsyncKeyState - works globally without blocking keys
                _pttVk = vk;
                _pttKeyWasDown = false;
                StartPttPolling();
                AudioLog.Write($"[Audio] PTT polling started for vk=0x{vk:X2}");
            }
            else
            {
                AudioLog.Write($"[Audio] KeyNameToVirtualKey returned 0 for key={key}");
            }
        }
        else
        {
            // Not PTT mode - stop polling
            StopPttPolling();
        }

        // For PTT, start with mic off until key pressed
        if (mode == TransmissionMode.PushToTalk)
            StopMic();
        else if (!_muted)
            StartMic();
    }

    private void StartPttPolling()
    {
        StopPttPolling();
        // Poll every 50ms for PTT key state
        _pttPollingTimer = new System.Threading.Timer(PttPollCallback, null, 0, 50);
    }

    private void StopPttPolling()
    {
        _pttPollingTimer?.Dispose();
        _pttPollingTimer = null;
    }

    private void PttPollCallback(object? state)
    {
        if (_pttVk == 0 || _transmissionMode != TransmissionMode.PushToTalk)
            return;

        // GetAsyncKeyState returns negative if key is currently pressed
        short keyState = GetAsyncKeyState(_pttVk);
        bool isKeyDown = (keyState & 0x8000) != 0;

        if (isKeyDown && !_pttKeyWasDown)
        {
            _pttKeyWasDown = true;
            AudioLog.Write($"[Audio] PTT key down (polling)");
            SetPttActive(true);
        }
        else if (!isKeyDown && _pttKeyWasDown)
        {
            _pttKeyWasDown = false;
            AudioLog.Write($"[Audio] PTT key up (polling)");
            SetPttActive(false);
        }
    }

    public void SetShortcut(string action, string? key)
    {
        AudioLog.Write($"[Audio] SetShortcut: action={action}, key={key}, _hwnd={_hwnd}");
        if (_hwnd == IntPtr.Zero) return;

        bool isMouseButton = key is "XButton1" or "XButton2" or "MouseLeft" or "MouseRight" or "MouseMiddle";

        if (isMouseButton)
        {
            RegisterMouseHookForShortcut(action, key);
            return;
        }
        
        switch (action)
        {
            case "pushToTalk":
                RegisterMouseHookForButton(key);
                break;
            case "toggleMute":
                _muteKeyName = key;
                RegisterSingleHotkey(ref _muteHotkeyId, MuteHotkeyId, key, _hwnd);
                break;
            case "toggleMuteDeafen":
                _muteDeafenKeyName = key;
                RegisterSingleHotkey(ref _muteDeafenHotkeyId, MuteDeafenHotkeyId, key, _hwnd);
                break;
            case "continuousTransmission":
                RegisterSingleHotkey(ref _continuousHotkeyId, ContinuousHotkeyId, key, _hwnd);
                break;
            case "toggleLeaveVoice":
                _leaveVoiceKeyName = key;
                RegisterSingleHotkey(ref _leaveVoiceHotkeyId, LeaveVoiceHotkeyId, key, _hwnd);
                break;
        }
    }

    /// <summary>
    /// Temporarily unregisters all shortcut hotkeys so the JS shortcut recorder
    /// can capture keypresses that would otherwise be swallowed by RegisterHotKey.
    /// </summary>
    public void SuspendHotkeys()
    {
        AudioLog.Write("[Audio] SuspendHotkeys");
        if (_hwnd == IntPtr.Zero) return;

        if (_muteHotkeyId >= 0) { UnregisterHotKey(_hwnd, _muteHotkeyId); _muteHotkeyId = -1; }
        if (_muteDeafenHotkeyId >= 0) { UnregisterHotKey(_hwnd, _muteDeafenHotkeyId); _muteDeafenHotkeyId = -1; }
        if (_leaveVoiceHotkeyId >= 0) { UnregisterHotKey(_hwnd, _leaveVoiceHotkeyId); _leaveVoiceHotkeyId = -1; }
    }

    /// <summary>
    /// Re-registers all shortcut hotkeys after the JS shortcut recorder is done.
    /// </summary>
    public void ResumeHotkeys()
    {
        AudioLog.Write("[Audio] ResumeHotkeys");
        if (_hwnd == IntPtr.Zero) return;

        if (_muteKeyName != null)
            RegisterSingleHotkey(ref _muteHotkeyId, MuteHotkeyId, _muteKeyName, _hwnd);
        if (_muteDeafenKeyName != null)
            RegisterSingleHotkey(ref _muteDeafenHotkeyId, MuteDeafenHotkeyId, _muteDeafenKeyName, _hwnd);
        if (_leaveVoiceKeyName != null)
            RegisterSingleHotkey(ref _leaveVoiceHotkeyId, LeaveVoiceHotkeyId, _leaveVoiceKeyName, _hwnd);
    }

    /// <summary>Called from WndProc when WM_HOTKEY fires.</summary>
    public void HandleHotKey(int id, bool keyDown)
    {
        AudioLog.Write($"[Audio] HandleHotKey: id={id}, keyDown={keyDown}, _hotkeyId={_hotkeyId}, _transmissionMode={_transmissionMode}");
        if (id == _hotkeyId && _transmissionMode == TransmissionMode.PushToTalk)
        {
            AudioLog.Write($"[Audio] PTT activated: keyDown={keyDown}");
            SetPttActive(keyDown);
        }
        else if (id == _muteHotkeyId && keyDown)
        {
            AudioLog.Write($"[Audio] ToggleMute hotkey");
            ToggleMuteRequested?.Invoke();
        }
        else if (id == _muteDeafenHotkeyId && keyDown)
        {
            AudioLog.Write($"[Audio] ToggleMuteDeafen hotkey");
            ToggleMuteRequested?.Invoke();
            ToggleDeafenRequested?.Invoke();
        }
        else if (id == _continuousHotkeyId && keyDown)
        {
            AudioLog.Write($"[Audio] ToggleContinuous hotkey");
            ToggleContinuousRequested?.Invoke();
        }
        else if (id == _leaveVoiceHotkeyId && keyDown)
        {
            AudioLog.Write($"[Audio] ToggleLeaveVoice hotkey");
            ToggleLeaveVoiceRequested?.Invoke();
        }
    }

    private Win32RawInput.LowLevelMouseProc? _mouseHookProc;
    private IntPtr _mouseHookHandle = IntPtr.Zero;

    private void UnregisterMouseHook()
    {
        if (_mouseHookHandle != IntPtr.Zero)
        {
            Win32RawInput.UnhookWindowsHookEx(_mouseHookHandle);
            _mouseHookHandle = IntPtr.Zero;
            AudioLog.Write($"[Audio] Mouse hook unregistered");
        }
    }

    private string? _shortcutActionForMouse;
    private string? _shortcutKeyForMouse;

    private IntPtr MouseHookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0)
        {
            int msg = wParam.ToInt32();
            bool isButtonDown = msg == Win32RawInput.WM_LBUTTONDOWN ||
                               msg == Win32RawInput.WM_RBUTTONDOWN ||
                               msg == Win32RawInput.WM_MBUTTONDOWN ||
                               msg == Win32RawInput.WM_XBUTTONDOWN;
            bool isButtonUp = msg == Win32RawInput.WM_LBUTTONUP ||
                             msg == Win32RawInput.WM_RBUTTONUP ||
                             msg == Win32RawInput.WM_MBUTTONUP ||
                             msg == Win32RawInput.WM_XBUTTONUP;

            if ((isButtonDown || isButtonUp) && _shortcutKeyForMouse != null)
            {
                int buttonNumber = -1;
                if (msg == Win32RawInput.WM_LBUTTONDOWN || msg == Win32RawInput.WM_LBUTTONUP)
                    buttonNumber = 0;
                else if (msg == Win32RawInput.WM_RBUTTONDOWN || msg == Win32RawInput.WM_RBUTTONUP)
                    buttonNumber = 1;
                else if (msg == Win32RawInput.WM_MBUTTONDOWN || msg == Win32RawInput.WM_MBUTTONUP)
                    buttonNumber = 2;
                else if (msg == Win32RawInput.WM_XBUTTONDOWN || msg == Win32RawInput.WM_XBUTTONUP)
                {
                    var hookStruct = Marshal.PtrToStructure<Win32RawInput.MSLLHOOKSTRUCT>(lParam);
                    int xButtons = (hookStruct.mouseData >> 16) & 0xFFFF;
                    if (xButtons == Win32RawInput.XBUTTON1)
                        buttonNumber = 3;
                    else if (xButtons == Win32RawInput.XBUTTON2)
                        buttonNumber = 4;
                }

                int expectedButton = _shortcutKeyForMouse switch
                {
                    "MouseLeft" => 0,
                    "MouseMiddle" => 2,
                    "MouseRight" => 1,
                    "XButton1" => 3,
                    "XButton2" => 4,
                    _ => -1
                };

                if (buttonNumber == expectedButton && isButtonDown)
                {
                    AudioLog.Write($"[Audio] Mouse hook: action={_shortcutActionForMouse}, button={buttonNumber}");

                    switch (_shortcutActionForMouse)
                    {
                        case "pushToTalk":
                            if (_transmissionMode == TransmissionMode.PushToTalk)
                                SetPttActive(true);
                            break;
                        case "toggleMute":
                            ToggleMuteRequested?.Invoke();
                            break;
                        case "toggleMuteDeafen":
                            ToggleMuteRequested?.Invoke();
                            ToggleDeafenRequested?.Invoke();
                            break;
                        case "continuousTransmission":
                            ToggleContinuousRequested?.Invoke();
                            break;
                        case "toggleLeaveVoice":
                            ToggleLeaveVoiceRequested?.Invoke();
                            break;
                    }
                }
                else if (buttonNumber == expectedButton && !isButtonDown && _shortcutActionForMouse == "pushToTalk")
                {
                    if (_transmissionMode == TransmissionMode.PushToTalk)
                        SetPttActive(false);
                }
            }
        }

        return Win32RawInput.CallNextHookEx(_mouseHookHandle, nCode, wParam, lParam);
    }

    private void RegisterMouseHookForShortcut(string action, string? key)
    {
        UnregisterMouseHook();
        _shortcutActionForMouse = null;
        _shortcutKeyForMouse = null;

        if (key == null || _hwnd == IntPtr.Zero)
            return;

        _shortcutActionForMouse = action;
        _shortcutKeyForMouse = key;
        AudioLog.Write($"[Audio] Registering mouse hook for action={action}, key={key}");

        _mouseHookProc = MouseHookCallback;
        IntPtr hModule = Win32RawInput.GetModuleHandle(null);
        _mouseHookHandle = Win32RawInput.SetWindowsHookEx(Win32RawInput.WH_MOUSE_LL, _mouseHookProc, hModule, 0);

        if (_mouseHookHandle != IntPtr.Zero)
        {
            AudioLog.Write($"[Audio] Mouse hook registered successfully");
        }
        else
        {
            int error = Marshal.GetLastWin32Error();
            AudioLog.Write($"[Audio] Mouse hook registration failed, error={error}");
        }
    }

    private void RegisterMouseHookForButton(string? key)
    {
        if (key != null)
            RegisterMouseHookForShortcut("pushToTalk", key);
    }

    /// <summary>Called from WndProc on WM_INPUT for raw keyboard/mouse input.</summary>
    public void HandleRawInput(IntPtr wParam, IntPtr lParam)
    {
        uint pcbSize = 0;
        Win32RawInput.GetRawInputData(lParam, Win32RawInput.RID_INPUT, IntPtr.Zero, ref pcbSize, (uint)Marshal.SizeOf<Win32RawInput.RAWINPUTHEADER>());

        if (pcbSize == 0) return;

        IntPtr buffer = Marshal.AllocHGlobal((int)pcbSize);
        try
        {
            if (Win32RawInput.GetRawInputData(lParam, Win32RawInput.RID_INPUT, buffer, ref pcbSize, (uint)Marshal.SizeOf<Win32RawInput.RAWINPUTHEADER>()) == pcbSize)
            {
                var header = Marshal.PtrToStructure<Win32RawInput.RAWINPUTHEADER>(buffer);
                if (header.dwType == Win32RawInput.RIM_TYPEKEYBOARD)
                {
                    var keyboard = Marshal.PtrToStructure<Win32RawInput.RAWKEYBOARD>(buffer + Marshal.SizeOf<Win32RawInput.RAWINPUTHEADER>());
                    int vk = keyboard.VKey;
                    bool isKeyDown = (keyboard.Flags & 0x01) == 0; // RI_KEY_BREAK is 0x01

                    AudioLog.Write($"[Audio] RawInput: vk=0x{vk:X2} ('{VirtualKeyToString(vk)}'), down={isKeyDown}, pttVk=0x{_pttVk:X2}, mode={_transmissionMode}");

                    // Check if this is our PTT key
                    if (vk == _pttVk && _transmissionMode == TransmissionMode.PushToTalk)
                    {
                        AudioLog.Write($"[Audio] RawInput PTT MATCH: vk=0x{vk:X2}, down={isKeyDown}");
                        SetPttActive(isKeyDown);
                    }
                }
            }
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    private static string VirtualKeyToString(int vk) => vk switch
    {
        0x30 => "0", 0x31 => "1", 0x32 => "2", 0x33 => "3", 0x34 => "4",
        0x35 => "5", 0x36 => "6", 0x37 => "7", 0x38 => "8", 0x39 => "9",
        0x41 => "A", 0x42 => "B", 0x43 => "C", 0x44 => "D", 0x45 => "E",
        0x46 => "F", 0x47 => "G", 0x48 => "H", 0x49 => "I", 0x4A => "J",
        0x4B => "K", 0x4C => "L", 0x4D => "M", 0x4E => "N", 0x4F => "O",
        0x50 => "P", 0x51 => "Q", 0x52 => "R", 0x53 => "S", 0x54 => "T",
        0x55 => "U", 0x56 => "V", 0x57 => "W", 0x58 => "X", 0x59 => "Y",
        0x5A => "Z",
        _ => $"vk{vk}"
    };

    private bool RegisterRawInputKeyboard(IntPtr hwnd)
    {
        // Use RIDEV_INPUTSINK only (not NOLEGACY) to allow keys to pass through
        // WebView2 will capture keys when focused, but they'll pass through when not focused
        var rid = new Win32RawInput.RAWINPUTDEVICE
        {
            usUsagePage = Win32RawInput.HID_USAGE_PAGE_GENERIC,
            usUsage = Win32RawInput.HID_USAGE_GENERIC_KEYBOARD,
            dwFlags = Win32RawInput.RIDEV_INPUTSINK,
            hwndTarget = hwnd
        };

        AudioLog.Write($"[Audio] RegisterRawInputKeyboard: hwnd={hwnd}, flags=0x{rid.dwFlags:X}");

        if (Win32RawInput.RegisterRawInputDevices(new[] { rid }, 1, (uint)Marshal.SizeOf<Win32RawInput.RAWINPUTDEVICE>()))
        {
            _rawInputRegistered = true;
            AudioLog.Write("[Audio] RegisterRawInputKeyboard: SUCCESS");
            return true;
        }
        AudioLog.Write($"[Audio] RegisterRawInputKeyboard: FAILED, error={Marshal.GetLastWin32Error()}");
        return false;
    }

    private void UnregisterRawInputKeyboard()
    {
        if (_rawInputRegistered)
        {
            var rid = new Win32RawInput.RAWINPUTDEVICE
            {
                usUsagePage = Win32RawInput.HID_USAGE_PAGE_GENERIC,
                usUsage = Win32RawInput.HID_USAGE_GENERIC_KEYBOARD,
                dwFlags = Win32RawInput.RIDEV_REMOVE, // Use RIDEV_REMOVE to unregister
                hwndTarget = IntPtr.Zero
            };
            Win32RawInput.RegisterRawInputDevices(new[] { rid }, 1, (uint)Marshal.SizeOf<Win32RawInput.RAWINPUTDEVICE>());
            _rawInputRegistered = false;
        }
        _pttVk = 0;
    }

    /// <summary>Handle PTT key from JavaScript when app is focused.</summary>
    public void HandlePttKeyFromJs(bool pressed)
    {
        AudioLog.Write($"[Audio] HandlePttKeyFromJs: pressed={pressed}, mode={_transmissionMode}");
        if (_transmissionMode == TransmissionMode.PushToTalk)
        {
            SetPttActive(pressed);
        }
    }

    /// <summary>Start or stop mic for PTT.</summary>
    private void SetPttActive(bool active)
    {
        AudioLog.Write($"[Audio] SetPttActive: active={active}, _pttActive={_pttActive}, muted={_muted}");
        _pttActive = active;
        if (active && !_muted)
        {
            AudioLog.Write("[Audio] Starting mic for PTT");
            StartMic();
        }
        else
        {
            AudioLog.Write("[Audio] Stopping mic for PTT");
            StopMic();
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
        _speechEnhancement?.Dispose();
        _speakingTimer.Dispose();
        StopPttPolling();
        UnregisterRawInputKeyboard();
        UnregisterMouseHook();
        if (_hotkeyId >= 0 && _hwnd != IntPtr.Zero)
        {
            UnregisterHotKey(_hwnd, _hotkeyId);
            _hotkeyId = -1;
        }
        if (_muteHotkeyId >= 0 && _hwnd != IntPtr.Zero)
        {
            UnregisterHotKey(_hwnd, _muteHotkeyId);
            _muteHotkeyId = -1;
        }
        if (_muteDeafenHotkeyId >= 0 && _hwnd != IntPtr.Zero)
        {
            UnregisterHotKey(_hwnd, _muteDeafenHotkeyId);
            _muteDeafenHotkeyId = -1;
        }
        if (_continuousHotkeyId >= 0 && _hwnd != IntPtr.Zero)
        {
            UnregisterHotKey(_hwnd, _continuousHotkeyId);
            _continuousHotkeyId = -1;
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

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int vKey);

    /// <summary>
    /// Maps JS key codes (from e.code) to Win32 virtual key codes.
    /// Covers common keys including mouse buttons. Returns 0 if unknown.
    /// </summary>
    internal static int KeyNameToVirtualKey(string key) => key switch
    {
        // Function keys
        "F1" => 0x70, "F2" => 0x71, "F3" => 0x72, "F4" => 0x73,
        "F5" => 0x74, "F6" => 0x75, "F7" => 0x76, "F8" => 0x77,
        "F9" => 0x78, "F10" => 0x79, "F11" => 0x7A, "F12" => 0x7B,
        "F13" => 0x7C, "F14" => 0x7D, "F15" => 0x7E, "F16" => 0x7F,
        "F17" => 0x80, "F18" => 0x81, "F19" => 0x82, "F20" => 0x83,
        "F21" => 0x84, "F22" => 0x85, "F23" => 0x86, "F24" => 0x87,

        // Modifier keys
        "ShiftLeft" => 0x10, "ShiftRight" => 0x10,
        "ControlLeft" => 0x11, "ControlRight" => 0x11,
        "AltLeft" => 0x12, "AltRight" => 0x12,
        "MetaLeft" => 0x5B, "MetaRight" => 0x5C, // Windows key
        "CapsLock" => 0x14,
        "NumLock" => 0x90,
        "ScrollLock" => 0x91,

        // Special keys
        "Space" => 0x20,
        "Tab" => 0x09,
        "Backspace" => 0x08,
        "Enter" => 0x0D,
        "Escape" => 0x1B,
        "Delete" => 0x2E,
        "Insert" => 0x2D,
        "Home" => 0x24,
        "End" => 0x23,
        "PageUp" => 0x21,
        "PageDown" => 0x22,
        "PrintScreen" => 0x2C,
        "Pause" => 0x13,

        // Arrow keys
        "ArrowUp" => 0x26, "ArrowDown" => 0x28,
        "ArrowLeft" => 0x25, "ArrowRight" => 0x27,

        // Mouse buttons
        "MouseLeft" => 0x01,
        "MouseRight" => 0x02,
        "MouseMiddle" => 0x04,
        "MouseXButton1" => 0x05,
        "MouseXButton2" => 0x06,
        // Alternative names (some browsers use these)
        "XButton1" => 0x05,
        "XButton2" => 0x06,
        "Back" => 0x0A,
        "Forward" => 0x0B,

        // Numpad
        "Numpad0" => 0x60, "Numpad1" => 0x61, "Numpad2" => 0x62,
        "Numpad3" => 0x63, "Numpad4" => 0x64, "Numpad5" => 0x65,
        "Numpad6" => 0x66, "Numpad7" => 0x67, "Numpad8" => 0x68,
        "Numpad9" => 0x69,
        "NumpadDecimal" => 0x6E,
        "NumpadDivide" => 0x6F,
        "NumpadMultiply" => 0x6A,
        "NumpadSubtract" => 0x6D,
        "NumpadAdd" => 0x6B,
        "NumpadEnter" => 0x0D,

        // Punctuation and numbers (top row)
        "Digit0" => 0x30, "Digit1" => 0x31, "Digit2" => 0x32,
        "Digit3" => 0x33, "Digit4" => 0x34, "Digit5" => 0x35,
        "Digit6" => 0x36, "Digit7" => 0x37, "Digit8" => 0x38,
        "Digit9" => 0x39,

        // Letters
        "KeyA" => 0x41, "KeyB" => 0x42, "KeyC" => 0x43, "KeyD" => 0x44,
        "KeyE" => 0x45, "KeyF" => 0x46, "KeyG" => 0x47, "KeyH" => 0x48,
        "KeyI" => 0x49, "KeyJ" => 0x4A, "KeyK" => 0x4B, "KeyL" => 0x4C,
        "KeyM" => 0x4D, "KeyN" => 0x4E, "KeyO" => 0x4F, "KeyP" => 0x50,
        "KeyQ" => 0x51, "KeyR" => 0x52, "KeyS" => 0x53, "KeyT" => 0x54,
        "KeyU" => 0x55, "KeyV" => 0x56, "KeyW" => 0x57, "KeyX" => 0x58,
        "KeyY" => 0x59, "KeyZ" => 0x5A,

        // Punctuation
        "Minus" => 0xBD,
        "Equal" => 0xBB,
        "BracketLeft" => 0xDB, "BracketRight" => 0xDD,
        "Backslash" => 0xDC,
        "Semicolon" => 0xBA,
        "Quote" => 0xDE,
        "Comma" => 0xBC,
        "Period" => 0xBE,
        "Slash" => 0xBF,
        "Backquote" => 0xC0,

        _ => 0
    };
}

