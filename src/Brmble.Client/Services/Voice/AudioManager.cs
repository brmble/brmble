using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Buffers;
using Brmble.Audio;
using Brmble.Audio.Codecs;
using Brmble.Audio.Processing;
using Brmble.Audio.NetEQ;
using Brmble.Audio.NetEQ.Models;
using Brmble.Client.Services.AppConfig;
using MumbleVoiceEngine.Audio;
using MumbleVoiceEngine.Pipeline;
using NAudio.Wave;
using NAudio.CoreAudioApi;

namespace Brmble.Client.Services.Voice;

public enum TransmissionMode { Continuous, VoiceActivity, PushToTalk, PushToTalkPlus }

public sealed record AudioDeviceOption(string Id, string Name);

public sealed record AudioDevicesPayload(
    IReadOnlyList<AudioDeviceOption> Input,
    IReadOnlyList<AudioDeviceOption> Output
);

internal static class AudioLog
{
    private const int MaxQueueSize = 10000;

    private static readonly string LogPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Brmble", "audio.log");

    private static readonly System.Collections.Concurrent.ConcurrentQueue<string> _queue = new();
    private static readonly Thread _flushThread;
    private static readonly ManualResetEvent _signal = new(false);
    private static volatile bool _shutdown;

    static AudioLog()
    {
        var dir = Path.GetDirectoryName(LogPath);
        if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
            Directory.CreateDirectory(dir);

        _flushThread = new Thread(FlushLoop)
        {
            IsBackground = true,
            Name = "AudioLog-Flush",
            Priority = ThreadPriority.BelowNormal
        };
        _flushThread.Start();
    }

    public static void Write(string msg)
    {
        if (_queue.Count >= MaxQueueSize) return;
        _queue.Enqueue($"[{DateTime.Now:HH:mm:ss.fff}] {msg}");
        _signal.Set();
    }

    public static void Flush()
    {
        _shutdown = true;
        _signal.Set();
        _flushThread.Join(1000);
        _shutdown = false;
    }

    private static void FlushLoop()
    {
        var sb = new System.Text.StringBuilder();
        while (!_shutdown || _queue.Count > 0)
        {
            _signal.WaitOne();
            if (_shutdown)
            {
                DrainQueue(sb);
                break;
            }
            _signal.Reset();

            sb.Clear();
            while (_queue.TryDequeue(out var line))
            {
                sb.AppendLine(line);
            }

            if (sb.Length > 0)
            {
                try
                {
                    File.AppendAllText(LogPath, sb.ToString());
                }
                catch { }
            }
        }
    }

    private static void DrainQueue(System.Text.StringBuilder sb)
    {
        sb.Clear();
        while (_queue.TryDequeue(out var line))
        {
            sb.AppendLine(line);
        }
        if (sb.Length > 0)
        {
            try
            {
                File.AppendAllText(LogPath, sb.ToString());
            }
            catch { }
        }
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
    private IWaveIn? _waveIn;
    private volatile bool _micStarted;
    private string _captureApi = "wasapi";
    private string _inputDeviceId = "default";
    private string _outputDeviceId = "default";

    // Decode (network → speakers) — per-user JitterBuffer pipeline
    private readonly Dictionary<uint, JitterBuffer> _jitterBuffers = new();
    private readonly Dictionary<uint, IWavePlayer> _players = new();
    private readonly long _startTimestamp = Stopwatch.GetTimestamp();

    // State
    private volatile bool _muted;
    private volatile bool _deafened;
    private volatile TransmissionMode _transmissionMode = TransmissionMode.Continuous;
    private string? _lastTransmissionKey;
    private bool _transmissionConfigured;
    internal int TransmissionApplyCount { get; private set; } // diagnostic/test signal: increments each time SetTransmissionMode body runs
    private volatile bool _pttActive;
    private System.Threading.Timer? _pttSilenceTailTimer;
    private int _pttSilenceTailGeneration; // incremented each time the timer is cancelled/replaced

    // Speaking detection (polls per-user JitterBuffer.IsSpeaking directly)
    private readonly HashSet<uint> _currentlySpeaking = new();
    private readonly Timer _speakingTimer;
    private uint _localUserId = 0;
    private long _lastLocalAudioMs; // monotonic timestamp of last local audio submission
    private int _voiceHoldMs = 200;

    // VAD gate (active only in TransmissionMode.VoiceActivity)
    private IVadDetector? _vad;
    private VadGate? _vadGate;
    private readonly object _vadLock = new();
    private VadSensitivity _vadSensitivity = VadSensitivity.Balanced;
    private short[]? _vadFrameScratch; // reusable byte→short conversion buffer (capture thread only)

    // VAD meter event throttle
    private int _vadMeterSubscribers; // ref-counted; > 0 means publish events
    private long _vadMeterLastPostMs;

    // Volume controls
    private volatile float _inputVolume = 1.0f;
    private volatile float _outputVolume = 1.0f;
    private readonly Dictionary<uint, float> _userVolumes = new();
    private readonly HashSet<uint> _localMutes = new();
    
    // Encoder settings
    private int _opusBitrate = 72000;
    private int _opusFrameMs = 20;
    private bool _dtxEnabled;

    // Capture-side WebRTC APM processor. Hot-swapped when NS level changes.
    // Dedicated lock guards both the slot AND the in-flight Process() call:
    // the underlying APM owns native handles, so we cannot let SetNoiseSuppression
    // dispose the processor while the mic thread is mid-Process.
    private readonly object _processorLock = new();
    private WebRtcApmProcessor? _processor;
    private NoiseSuppressionLevel _noiseSuppressionLevel = NoiseSuppressionLevel.High;
    private bool _processorCreateFailed;
    [ThreadStatic] private static byte[]? _processorOutputScratch;

    // Packet loss tracking per user (EMA smoothing to prevent UI jitter)
    private double _smoothedLoss = -1; // -1 means 'no data'
    private readonly Dictionary<uint, PerUserLoss> _userLossTrackers = new();
    private int _totalReceived;
    private int _totalLost;
    public event Action<int?>? OnLossReport;

    private class PerUserLoss
    {
        public long LastSequence = -1;
        public int ReceivedUnits;
        public int LostUnits;
    }

    // Device→48kHz resampler (r8brain)
    private R8BrainResampler? _deviceResampler;
    private int _deviceSampleRate;
    private int _deviceMaxInLen;

    public void SetLocalUserId(uint sessionId) => _localUserId = sessionId;

    /// <summary>Fired when an encoded voice packet is ready to send to the server.</summary>
    public event Action<ReadOnlyMemory<byte>>? SendVoicePacket;

    /// <summary>Fired when a user starts speaking (first voice packet after silence).</summary>
    public event Action<uint>? UserStartedSpeaking;

    /// <summary>Fired when a user stops speaking (no packets for SpeakingTimeoutMs).</summary>
    public event Action<uint>? UserStoppedSpeaking;

    /// <summary>
    /// Fired at most every 50 ms while VAD mode is active and at least one subscriber is registered
    /// via <see cref="SetVadMeterSubscribed"/>. Args: (rms, isOpen).
    /// </summary>
    public event Action<double, bool>? VadMeterUpdated;

    public bool IsMuted => _muted;
    public bool IsDeafened => _deafened;
    public TransmissionMode TransmissionMode => _transmissionMode;

    public void SetInputVolume(int percentage)
    {
        _inputVolume = Math.Clamp(percentage, 0, 250) / 100f;
        _encodePipeline?.SetVolume(_inputVolume);
    }
    public void SetVoiceHoldMs(int ms) => _voiceHoldMs = Math.Clamp(ms, 100, 2000);

    public void ReportLoss(int rawLoss)
    {
        int clamped = Math.Clamp(rawLoss, 0, 100);
        _smoothedLoss = _smoothedLoss < 0 ? clamped : (_smoothedLoss * 0.8) + (clamped * 0.2);
        OnLossReport?.Invoke((int)Math.Round(_smoothedLoss));
    }

    public void ResetLossStats()
    {
        _smoothedLoss = -1;
        OnLossReport?.Invoke(null);
    }

    // Allowed Opus bitrates (bps). Must match the UI options in AudioSettingsTab.tsx.
    private static readonly int[] AllowedBitrates = { 24000, 40000, 56000, 72000, 96000, 128000 };

    // Allowed Opus frame durations (ms). Must match UI options and permitted Opus frame sizes.
    private static readonly int[] AllowedFrameMs = { 10, 20, 40, 60 };

    /// <summary>
    /// Clamps <paramref name="value"/> to the nearest entry in <paramref name="allowed"/>.
    /// If the value is not in the list the closest valid option is returned.
    /// </summary>
    private static int ClampToNearest(int value, int[] allowed)
    {
        int best = allowed[0];
        int bestDist = Math.Abs(value - best);
        foreach (var v in allowed)
        {
            int dist = Math.Abs(value - v);
            if (dist < bestDist) { bestDist = dist; best = v; }
        }
        return best;
    }

    public void SetOpusBitrate(int bitrate)
    {
        bitrate = ClampToNearest(bitrate, AllowedBitrates);
        lock (_lock)
        {
            if (_opusBitrate == bitrate) return;
            _opusBitrate = bitrate;
            // Pipeline must be recreated because application mode is set at construction time.
            // If the mic is active, recreate immediately so no audio is lost.
            RecreateEncodePipelineLocked();
        }
    }

    public void SetOpusFrameMs(int frameMs)
    {
        frameMs = ClampToNearest(frameMs, AllowedFrameMs);
        lock (_lock)
        {
            if (_opusFrameMs == frameMs) return;
            _opusFrameMs = frameMs;
            // Pipeline must be recreated because frame size is set at construction time.
            // If the mic is active, recreate immediately so no audio is lost.
            RecreateEncodePipelineLocked();
        }
    }

    public void SetDtx(bool enabled)
    {
        lock (_lock)
        {
            if (_dtxEnabled == enabled) return;
            _dtxEnabled = enabled;
            RecreateEncodePipelineLocked();
        }
    }

    /// <summary>
    /// Disposes and immediately recreates <see cref="_encodePipeline"/> with the current
    /// encoder settings. If the mic is not active the field is left null so the pipeline
    /// will be created lazily on the next <see cref="StartMic"/> call.
    /// Must be called with <see cref="_lock"/> held.
    /// </summary>
    private void RecreateEncodePipelineLocked()
    {
        long seq = _encodePipeline?.CurrentSequence ?? 0;
        _encodePipeline?.Dispose();
        _encodePipeline = null;

        if (_micStarted)
        {
            _encodePipeline = new EncodePipeline(
                sampleRate: 48000, channels: 1, bitrate: _opusBitrate,
                onPacketReady: packet => SendVoicePacket?.Invoke(packet),
                frameSize: 48000 / 1000 * _opusFrameMs,
                dtx: _dtxEnabled,
                initialSequence: seq);
            _encodePipeline.SetVolume(_inputVolume);
        }
    }

    public void SetNoiseSuppression(NoiseSuppressionLevel level)
    {
        lock (_processorLock)
        {
            if (_noiseSuppressionLevel == level && _processor != null) return;
            _processor?.Dispose();
            _processor = CreateProcessor(level);
            _processorCreateFailed = _processor == null;
            if (_processor != null)
            {
                _noiseSuppressionLevel = level;
                AudioLog.Write($"[Audio] Noise suppression set to {level}");
            }
        }
    }

    private static WebRtcApmProcessor? CreateProcessor(NoiseSuppressionLevel level)
    {
        try
        {
            return new WebRtcApmProcessor(level);
        }
        catch (Exception ex)
        {
            AudioLog.Write($"[Audio] Failed to create WebRTC APM processor: {ex.Message}");
            return null;
        }
    }

    public void SetCaptureApi(string api)
    {
        bool restartMic = false;

        lock (_lock)
        {
            // If the API is unchanged, avoid unnecessary restart.
            if (string.Equals(_captureApi, api, StringComparison.OrdinalIgnoreCase))
                return;

            // If the mic is currently running, stop it so we can recreate the capture device.
            if (_micStarted)
            {
                restartMic = true;
                StopMic();
            }

            // Dispose the existing capture device so it will be recreated
            // with the new capture API on the next StartMic().
            _waveIn?.Dispose();
            _waveIn = null;

            _captureApi = api;
            AudioLog.Write($"[Audio] SetCaptureApi: {_captureApi}");
        }

        // Restart microphone capture outside the lock to avoid re-entrancy issues.
        if (restartMic)
            StartMic();
    }

    public AudioDevicesPayload GetAudioDevices()
    {
        try
        {
            return new AudioDevicesPayload(
                EnumerateAudioDevices(DataFlow.Capture),
                EnumerateAudioDevices(DataFlow.Render));
        }
        catch (Exception ex)
        {
            AudioLog.Write($"[Audio] GetAudioDevices failed: {ex.Message}");
            return new AudioDevicesPayload(
                [new AudioDeviceOption("default", "Default (System)")],
                [new AudioDeviceOption("default", "Default (System)")]);
        }
    }

    public void SetInputDevice(string? deviceId)
    {
        var normalized = string.IsNullOrWhiteSpace(deviceId) ? "default" : deviceId;
        bool restartMic = false;

        lock (_lock)
        {
            if (string.Equals(_inputDeviceId, normalized, StringComparison.Ordinal))
                return;

            if (_micStarted)
            {
                restartMic = true;
                StopMicLocked();
            }

            _waveIn?.Dispose();
            _waveIn = null;
            _inputDeviceId = normalized;
            AudioLog.Write($"[Audio] SetInputDevice: {_inputDeviceId}");
        }

        if (restartMic)
            StartMic();
    }

    public void SetOutputDevice(string? deviceId)
    {
        var normalized = string.IsNullOrWhiteSpace(deviceId) ? "default" : deviceId;

        lock (_lock)
        {
            if (string.Equals(_outputDeviceId, normalized, StringComparison.Ordinal))
                return;

            _outputDeviceId = normalized;

            foreach (var player in _players.Values)
            {
                try
                {
                    player.Stop();
                    player.Dispose();
                }
                catch { }
            }

            _players.Clear();

            foreach (var (userId, jb) in _jitterBuffers)
            {
                var player = CreatePlayerFor(jb);
                player.Init(new JitterBufferWaveProvider(jb));
                player.Play();
                _players[userId] = player;
            }

            AudioLog.Write($"[Audio] SetOutputDevice: {_outputDeviceId}");
        }
    }

    public bool IsInputDeviceAvailable(string? deviceId)
        => IsDeviceAvailable(deviceId, DataFlow.Capture);

    public bool IsOutputDeviceAvailable(string? deviceId)
        => IsDeviceAvailable(deviceId, DataFlow.Render);

    public void SetOutputVolume(int percentage)
    {
        _outputVolume = Math.Clamp(percentage, 0, 250) / 100f;
        lock (_lock)
        {
            foreach (var (userId, jb) in _jitterBuffers)
            {
                if (!_userVolumes.ContainsKey(userId))
                    jb.Volume = _outputVolume;
            }
        }
    }

    public void SetUserVolume(uint userId, int percentage)
    {
        var volume = Math.Clamp(percentage, 0, 200) / 100f;
        lock (_lock)
        {
            _userVolumes[userId] = volume;
            if (_jitterBuffers.TryGetValue(userId, out var jb))
                jb.Volume = volume;
        }
    }

    public void SetLocalMute(uint userId, bool muted)
    {
        lock (_lock)
        {
            if (muted)
                _localMutes.Add(userId);
            else
                _localMutes.Remove(userId);
        }
    }

    public AudioManager(IntPtr hwnd = default)
    {
        // hwnd parameter retained for caller compatibility; AudioManager no longer
        // owns any Win32 input plumbing — InputRouter has taken over.
        _ = hwnd;
        _speakingTimer = new Timer(CheckSpeakingState, null, 100, 100);
    }

    /// <summary>
    /// IWaveProvider adapter that pulls PCM from a JitterBuffer on NAudio's callback thread.
    /// This pull-model avoids timing issues from a separate playout timer.
    /// </summary>
    private class JitterBufferWaveProvider : IWaveProvider
    {
        private readonly JitterBuffer _jitterBuffer;
        private readonly short[] _frameBuf = new short[960];
        public WaveFormat WaveFormat { get; } = new WaveFormat(48000, 16, 1);

        public JitterBufferWaveProvider(JitterBuffer jitterBuffer) => _jitterBuffer = jitterBuffer;

        public int Read(byte[] buffer, int offset, int count)
        {
            int bytesWritten = 0;
            while (bytesWritten < count)
            {
                int remaining = count - bytesWritten;
                int samplesToGet = Math.Min(remaining / sizeof(short), 960);
                if (samplesToGet < 960)
                {
                    // Partial frame at end — fill with silence
                    Array.Clear(buffer, offset + bytesWritten, remaining);
                    bytesWritten = count;
                    break;
                }

                _jitterBuffer.GetAudio(_frameBuf);

                for (int i = 0; i < 960; i++)
                {
                    buffer[offset + bytesWritten] = (byte)(_frameBuf[i] & 0xFF);
                    buffer[offset + bytesWritten + 1] = (byte)((_frameBuf[i] >> 8) & 0xFF);
                    bytesWritten += 2;
                }
            }
            return count;
        }
    }

    /// <summary>Start mic capture and encoding. No-op if already started or muted.</summary>
    public void StartMic()
    {
        lock (_lock)
        {
            StartMicLocked();
        }
    }

    /// <summary>
    /// Inner mic-start logic. Caller must hold <see cref="_lock"/>.
    /// May temporarily release and reacquire the lock for WASAPI stop-wait.
    /// </summary>
    private void StartMicLocked()
    {
        if (_micStarted || _muted) return;

        _micStarted = true;
        if (_encodePipeline == null)
            RecreateEncodePipelineLocked();


        if (_waveIn == null)
        {
            try
            {
                if (_captureApi == "wasapi")
                {
                    using var enumerator = new MMDeviceEnumerator();
                    using var device = ResolveCaptureDevice(enumerator);
                    var wasapi = new WasapiCapture(device, true, 20)
                    {
                        ShareMode = AudioClientShareMode.Shared
                    };
                    AudioLog.Write($"[Audio] WASAPI capture format: {wasapi.WaveFormat.SampleRate}Hz, {wasapi.WaveFormat.BitsPerSample}bit, {wasapi.WaveFormat.Channels}ch");
                    wasapi.RecordingStopped += (s, e) =>
                    {
                        if (e.Exception != null)
                        {
                            AudioLog.Write($"[Audio] WASAPI recording stopped with error: {e.Exception.Message}");
                        }
                    };
                    _waveIn = wasapi;
                }
                else
                {
                    _waveIn = new WaveInEvent
                    {
                        DeviceNumber = -1,
                        BufferMilliseconds = 20,
                        WaveFormat = new WaveFormat(48000, 16, 1)
                    };
                }
                _waveIn.DataAvailable += OnMicData;
            }
            catch (COMException ex)
            {
                // Capture device couldn't be acquired — e.g. no microphone
                // present (HRESULT 0x80070490, common on headless machines),
                // device disabled, in use, or an unsupported format. Whatever
                // the cause, leave the mic off instead of crashing the caller;
                // voice can't transmit until a device is available and the next
                // StartMic retries. Log the HRESULT so the cause is diagnosable.
                AudioLog.Write($"[Audio] Capture device unavailable (HRESULT 0x{ex.HResult:X8}); mic not started: {ex.Message}");
                _micStarted = false;
                _waveIn = null;
                return;
            }
        }

        // WasapiCapture.StopRecording() only signals the capture thread to
        // stop; it doesn't wait for it to exit.  If we call StartRecording()
        // before the thread has fully stopped, WasapiCapture throws
        // InvalidOperationException ("Previous recording still in progress").
        // Wait outside the lock so other threads aren't blocked, then
        // re-validate state before proceeding.
        if (_waveIn is WasapiCapture wasapiWait &&
            wasapiWait.CaptureState != NAudio.CoreAudioApi.CaptureState.Stopped)
        {
            var localCapture = wasapiWait;
            Monitor.Exit(_lock);
            try
            {
                const int maxWaitMs = 300;
                int waited = 0;
                while (localCapture.CaptureState != NAudio.CoreAudioApi.CaptureState.Stopped && waited < maxWaitMs)
                {
                    Thread.Sleep(10);
                    waited += 10;
                }
            }
            finally
            {
                Monitor.Enter(_lock);
            }

            // State may have changed while we were unlocked — re-validate.
            if (!_micStarted || _muted) return;

            if (_waveIn is WasapiCapture recheck &&
                recheck.CaptureState != NAudio.CoreAudioApi.CaptureState.Stopped)
            {
                AudioLog.Write($"[Audio] WASAPI capture still stopping after wait, skipping StartRecording");
                // Recording never started: clear _micStarted so the next
                // StartMic retries instead of no-opping against a dead mic.
                _micStarted = false;
                return;
            }
        }

        _waveIn.StartRecording();
        AudioLog.Write("[Audio] Mic started");
    }

    /// <summary>Stop mic capture and dispose encode pipeline. No-op if not started.</summary>
    public void StopMic()
    {
        bool wasSpeaking = false;
        uint capturedUserId = 0;
        lock (_lock)
        {
            (wasSpeaking, capturedUserId) = StopMicLocked();
        }
        if (wasSpeaking)
            UserStoppedSpeaking?.Invoke(capturedUserId);
    }

    /// <summary>
    /// Inner mic-stop logic. Caller must hold <see cref="_lock"/>.
    /// Returns (wasSpeaking, capturedUserId) so the caller can fire events outside the lock.
    /// </summary>
    private (bool wasSpeaking, uint capturedUserId) StopMicLocked()
    {
        if (!_micStarted) return (false, 0);

        _waveIn?.StopRecording();
        // Flush any partial Opus frame with the Mumble end-of-transmission
        // terminator bit set, matching upstream Mumble behaviour.
        try
        {
            _encodePipeline?.FlushFinal();
        }
        catch (Exception ex)
        {
            AudioLog.Write($"[Audio] FlushFinal failed: {ex.Message}");
        }
        _encodePipeline?.Dispose();
        _encodePipeline = null;
        _deviceResampler?.Dispose();
        _deviceResampler = null;
        _micStarted = false;
        uint capturedUserId = _localUserId;
        bool wasSpeaking = capturedUserId != 0 && _currentlySpeaking.Remove(capturedUserId);
        AudioLog.Write("[Audio] Mic stopped");
        return (wasSpeaking, capturedUserId);
    }

    // Reusable scratch buffers for WASAPI float→int16 conversion (avoid per-callback GC allocations).
    [ThreadStatic] private static float[]? _wasapiFloatScratch;
    [ThreadStatic] private static float[]? _wasapiMonoScratch;
    [ThreadStatic] private static byte[]? _wasapiInt16Scratch;
    [ThreadStatic] private static double[]? _resampleDoubleScratch;
    [ThreadStatic] private static bool _threadPriorityBoosted;

    private void OnMicData(object? sender, WaveInEventArgs e)
    {
        // Boost audio capture thread priority on first callback
        if (!_threadPriorityBoosted)
        {
            _threadPriorityBoosted = true;
            try { Thread.CurrentThread.Priority = ThreadPriority.Highest; }
            catch { }
        }

        byte[] processedBuffer = e.Buffer;
        int processedBytes = e.BytesRecorded;
        
        if (_waveIn is WasapiCapture wasapi && wasapi.WaveFormat.Encoding == WaveFormatEncoding.IeeeFloat)
        {
            var fmt = wasapi.WaveFormat;
            int channels = fmt.Channels;
            int capturedFloats = e.BytesRecorded / 4;

            // Ensure float scratch buffer is large enough.
            if (_wasapiFloatScratch == null || _wasapiFloatScratch.Length < capturedFloats)
                _wasapiFloatScratch = new float[capturedFloats];
            Buffer.BlockCopy(e.Buffer, 0, _wasapiFloatScratch, 0, e.BytesRecorded);

            // Downmix to mono if needed: average all channels per frame.
            int monoFrames = capturedFloats / channels;
            if (_wasapiMonoScratch == null || _wasapiMonoScratch.Length < monoFrames)
                _wasapiMonoScratch = new float[monoFrames];

            if (channels == 1)
            {
                Array.Copy(_wasapiFloatScratch, _wasapiMonoScratch, monoFrames);
            }
            else
            {
                for (int i = 0; i < monoFrames; i++)
                {
                    float sum = 0f;
                    for (int ch = 0; ch < channels; ch++)
                        sum += _wasapiFloatScratch[i * channels + ch];
                    _wasapiMonoScratch[i] = sum / channels;
                }
            }

            // Resample from device sample rate to 48kHz if needed.
            float[] monoAt48k;
            int srcRate = fmt.SampleRate;
            if (srcRate != 48000)
            {
                // Create or recreate r8brain resampler if device rate changed or buffer exceeds maxInLen
                if (_deviceResampler == null || _deviceSampleRate != srcRate || monoFrames > _deviceMaxInLen)
                {
                    _deviceResampler?.Dispose();
                    _deviceSampleRate = srcRate;
                    _deviceMaxInLen = monoFrames;
                    _deviceResampler = new R8BrainResampler(srcRate, 48000, monoFrames);
                }

                // Convert float→double for r8brain
                if (_resampleDoubleScratch == null || _resampleDoubleScratch.Length < monoFrames)
                    _resampleDoubleScratch = new double[monoFrames];
                for (int i = 0; i < monoFrames; i++)
                    _resampleDoubleScratch[i] = _wasapiMonoScratch[i];

                int outSamples = _deviceResampler.Process(_resampleDoubleScratch, out double[] resampledDouble);

                // Reuse mono scratch buffer for float conversion
                if (_wasapiMonoScratch == null || _wasapiMonoScratch.Length < outSamples)
                    _wasapiMonoScratch = new float[outSamples];
                for (int i = 0; i < outSamples; i++)
                    _wasapiMonoScratch[i] = (float)resampledDouble[i];

                monoAt48k = _wasapiMonoScratch;
                monoFrames = outSamples;
            }
            else
            {
                monoAt48k = _wasapiMonoScratch;
            }

            // Convert float samples to 16-bit PCM, reusing scratch buffer.
            int requiredInt16Bytes = monoFrames * 2;
            if (_wasapiInt16Scratch == null || _wasapiInt16Scratch.Length < requiredInt16Bytes)
                _wasapiInt16Scratch = new byte[requiredInt16Bytes];

            for (int i = 0; i < monoFrames; i++)
            {
                var sample = (short)Math.Clamp(monoAt48k[i] * 32768f, short.MinValue, short.MaxValue);
                int writeIndex = i * 2;
                _wasapiInt16Scratch[writeIndex]     = (byte)(sample & 0xFF);
                _wasapiInt16Scratch[writeIndex + 1] = (byte)((sample >> 8) & 0xFF);
            }
            processedBuffer = _wasapiInt16Scratch;
            processedBytes = requiredInt16Bytes;
        }

        if (_muted) return;
        if (_transmissionMode == TransmissionMode.PushToTalk && !_pttActive) return;

        // Capture-side WebRTC APM processor. Hold _processorLock for the duration
        // of Process() so SetNoiseSuppression cannot dispose the native APM handle
        // mid-call. Process() is fast (sub-ms for a 10–20 ms frame).
        lock (_processorLock)
        {
            if (_processor == null && !_processorCreateFailed)
            {
                _processor = CreateProcessor(_noiseSuppressionLevel);
                _processorCreateFailed = _processor == null;
            }
            if (_processor != null)
            {
                int needed = processedBytes + WebRtcApmProcessor.FrameBytes;
                if (_processorOutputScratch == null || _processorOutputScratch.Length < needed)
                    _processorOutputScratch = new byte[needed];

                try
                {
                    int written = _processor.Process(
                        new ReadOnlySpan<byte>(processedBuffer, 0, processedBytes),
                        _processorOutputScratch.AsSpan());

                    processedBuffer = _processorOutputScratch;
                    processedBytes = written;
                }
                catch (Exception ex)
                {
                    // Native APM error or unexpected internal failure. Drop this
                    // frame instead of crashing the capture callback.
                    AudioLog.Write($"[Audio] APM Process failed: {ex.Message}");
                    return;
                }

                if (processedBytes == 0) return;
            }
        }

        // Input volume is applied inside EncodePipeline (see SetInputVolume → _encodePipeline.SetVolume).

        // Voice Activity: per-frame gate. Continuous and PTT modes go through unchanged.
        if (_transmissionMode == TransmissionMode.VoiceActivity)
        {
            var gate = GetOrCreateVadGate();
            int offset = 0;
            int frameIndex = 0;
            long baseNowMs = Environment.TickCount64;
            if (_vadFrameScratch is null) _vadFrameScratch = new short[VadGate.FrameSamples];

            while (offset + (VadGate.FrameSamples * 2) <= processedBytes)
            {
                var frameSpan = new ReadOnlySpan<byte>(processedBuffer, offset, VadGate.FrameSamples * 2);
                for (int i = 0; i < VadGate.FrameSamples; i++)
                    _vadFrameScratch[i] = (short)(frameSpan[i * 2] | (frameSpan[i * 2 + 1] << 8));

                var decision = gate.Process(_vadFrameScratch, baseNowMs + frameIndex * 10);

                EncodePipeline? pipelineRef;
                bool fireStartedSpeaking = false;
                bool fireStoppedSpeaking = false;
                lock (_lock)
                {
                    pipelineRef = _encodePipeline;
                    switch (decision)
                    {
                        case GateDecision.OpenWithLookback open:
                            if (_currentlySpeaking.Add(_localUserId)) fireStartedSpeaking = true;
                            _lastLocalAudioMs = Environment.TickCount64;
                            foreach (var f in open.Frames)
                                pipelineRef?.SubmitPcm(MemoryMarshal.AsBytes(f.AsSpan()));
                            break;
                        case GateDecision.PassThrough pt:
                            _lastLocalAudioMs = Environment.TickCount64;
                            pipelineRef?.SubmitPcm(MemoryMarshal.AsBytes(pt.Frame.AsSpan()));
                            break;
                        case GateDecision.CloseWithTerminator:
                            pipelineRef?.EmitTerminator();
                            // Gate close is authoritative for VAD: clear local speaking
                            // state immediately so the indicator turns off without waiting
                            // for the polling timer (which would race with the next frame
                            // and produce flickering).
                            if (_currentlySpeaking.Remove(_localUserId)) fireStoppedSpeaking = true;
                            break;
                        case GateDecision.Stay:
                            break;
                    }
                }
                if (fireStartedSpeaking) UserStartedSpeaking?.Invoke(_localUserId);
                if (fireStoppedSpeaking) UserStoppedSpeaking?.Invoke(_localUserId);

                // Throttled meter publication (subscribed only when settings tab is open on VAD).
                if (Volatile.Read(ref _vadMeterSubscribers) > 0)
                    PublishVadMeterThrottled(gate.LastRms, gate.IsOpen);

                offset += VadGate.FrameSamples * 2;
                frameIndex++;
            }
            return; // VAD path handles SubmitPcm itself; skip the legacy continuous block below
        }

        // Continuous + PTT: snapshot the pipeline reference and update speaking state under lock.
        // This prevents a race where RecreateEncodePipelineLocked disposes _encodePipeline
        // while SubmitPcm is executing on the mic thread.
        EncodePipeline? pipeline;
        bool shouldBeSpeaking;
        bool shouldSubmitPcm;

        lock (_lock)
        {
            // Capture transmission mode and PTT state under lock for consistent decision-making
            var mode = _transmissionMode;
            var pttActive = _pttActive;

            // Determine if we should be considered "speaking" based on transmission mode
            shouldBeSpeaking = mode switch
            {
                TransmissionMode.Continuous => true,
                TransmissionMode.PushToTalk => pttActive,
                TransmissionMode.PushToTalkPlus => pttActive,
                _ => false
            };

            // For PTT+, only submit audio when PTT is active (software gate)
            shouldSubmitPcm = mode != TransmissionMode.PushToTalkPlus || pttActive;

            // Only trigger speaking events if we should be speaking based on transmission mode
            if (shouldBeSpeaking && _currentlySpeaking.Add(_localUserId))
            {
                UserStartedSpeaking?.Invoke(_localUserId);
            }
            _lastLocalAudioMs = Environment.TickCount64;
            pipeline = _encodePipeline;
        }

        // Software gate: for PTT+, send audio to the server only when PTT is active
        if (shouldSubmitPcm)
        {
            try
            {
                pipeline?.SubmitPcm(new ReadOnlySpan<byte>(processedBuffer, 0, processedBytes));
            }
            catch (Exception ex)
            {
                // The pipeline can be disposed by a concurrent settings change,
                // and the packet callback runs the network send. An unhandled
                // exception here kills the NAudio capture thread and silently
                // deadens the mic — drop the frame instead.
                AudioLog.Write($"[Audio] SubmitPcm failed, dropping frame: {ex.Message}");
            }
        }
        // else: encoded audio is ignored (the encoder keeps running)
    }


    private VadGate GetOrCreateVadGate()
    {
        lock (_vadLock)
        {
            if (_vadGate != null) return _vadGate;

            try
            {
                _vad = new WebRtcVad(VadAggressiveness.Aggressive);
            }
            catch (Exception ex)
            {
                AudioLog.Write($"[Audio] WebRtcVad init failed, using RMS-only fallback: {ex.Message}");
                _vad = new RmsOnlyVadFallback();
            }
            _vadGate = new VadGate(_vad, VadGateConfig.FromSensitivity(_vadSensitivity));
            return _vadGate;
        }
    }

    private void PublishVadMeterThrottled(double rms, bool isOpen)
    {
        long now = Environment.TickCount64;
        if (now - _vadMeterLastPostMs < 50) return;
        _vadMeterLastPostMs = now;
        VadMeterUpdated?.Invoke(rms, isOpen);
    }

    public void SetVadSensitivity(VadSensitivity level)
    {
        lock (_vadLock)
        {
            _vadSensitivity = level;
            _vadGate?.SetSensitivity(level);
        }
    }

    public void SetVadMeterSubscribed(bool subscribed)
    {
        if (subscribed)
            Interlocked.Increment(ref _vadMeterSubscribers);
        else
        {
            // CAS loop to clamp at 0 — duplicate unmounts or error paths could
            // otherwise drive the count negative and permanently disable the meter.
            int current;
            do { current = Volatile.Read(ref _vadMeterSubscribers); }
            while (current > 0 && Interlocked.CompareExchange(ref _vadMeterSubscribers, current - 1, current) != current);
        }
    }

    /// <summary>
    /// Feed an incoming voice packet for a user. Creates per-user JitterBuffer
    /// lazily and inserts the encoded packet for adaptive playout.
    /// Called from MumbleSharp process thread.
    /// </summary>
    public void FeedVoice(uint userId, byte[] opusData, long sequence)
    {
        if (_deafened) return;

        lock (_lock)
        {
            if (_localMutes.Contains(userId)) return;

            if (!_userLossTrackers.TryGetValue(userId, out var loss))
            {
                loss = new PerUserLoss();
                _userLossTrackers[userId] = loss;
            }
            if (sequence < loss.LastSequence)
            {
                loss.LastSequence = -1;
                loss.ReceivedUnits = 0;
                loss.LostUnits = 0;
            }
            if (loss.LastSequence >= 0 && sequence > loss.LastSequence)
            {
                long gap = sequence - loss.LastSequence - 2;
                if (gap > 50)
                {
                    AudioLog.Write($"[Loss] Large gap ({gap}), treating as new stream for user {userId}");
                    loss.LastSequence = -1;
                    loss.ReceivedUnits = 0;
                    loss.LostUnits = 0;
                }
                else if (gap > 0)
                {
                    loss.LostUnits += (int)gap;
                    _totalLost += (int)gap;
                }
            }
            loss.LastSequence = sequence;
            loss.ReceivedUnits += 2;
            _totalReceived += 2;

            if (!_jitterBuffers.TryGetValue(userId, out var jb))
            {
                // First packet from this user — create JitterBuffer + WaveOutEvent
                var decoder = new MumbleOpusDecoder(sampleRate: 48000, channels: 1);
                jb = new JitterBuffer(decoder);

                if (_userVolumes.TryGetValue(userId, out var vol))
                    jb.Volume = vol;
                else
                    jb.Volume = _outputVolume;

                _jitterBuffers[userId] = jb;

                var player = CreatePlayerFor(jb);
                player.Init(new JitterBufferWaveProvider(jb));
                player.Play();
                _players[userId] = player;

                AudioLog.Write($"[Audio] Created JitterBuffer for user {userId}");
            }

            var packet = new EncodedPacket(
                Sequence: sequence,
                Timestamp: sequence * 480, // Mumble sequence is in 10ms units
                Payload: opusData,
                ArrivalTimeMs: (long)Stopwatch.GetElapsedTime(_startTimestamp).TotalMilliseconds
            );

            // Diagnostic logging — first 50 packets + every 50th after (~1 second intervals)
            if (sequence < 50 || sequence % 50 == 0)
                AudioLog.Write($"[JB] user={userId} seq={sequence} ts={packet.Timestamp} bufCount={jb.GetStats().BufferLevel} payloadLen={opusData.Length}");

            jb.InsertPacket(packet);
        }

        // Report packet loss roughly every 50 packets (~1 second of audio)
        if (_totalReceived > 0 && _totalReceived % 50 == 0)
        {
            int total = _totalReceived + _totalLost;
            int loss = total > 0 ? (int)((double)_totalLost / total * 100) : 0;
            AudioLog.Write($"[Loss] reporting: lost={_totalLost}, received={_totalReceived}, total={total}, loss={loss}%");
            ReportLoss(loss);
        }
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
            if (_jitterBuffers.Remove(userId, out var jb))
                jb.Dispose();
            _userLossTrackers.Remove(userId);
            wasSpeaking = _currentlySpeaking.Remove(userId);
        }
        if (wasSpeaking)
            UserStoppedSpeaking?.Invoke(userId);
    }

    /// <summary>Set mute state. Stops/starts mic capture accordingly.</summary>
    public void SetMuted(bool muted)
    {
        _muted = muted;
        if (muted)
        {
            _pttSilenceTailTimer?.Dispose();
            _pttSilenceTailTimer = null;
            Interlocked.Increment(ref _pttSilenceTailGeneration);
            StopMic();
        }
        else
            StartMic();
    }

    /// <summary>Set deafen state. Stops all playback when deafened.</summary>
    public void SetDeafened(bool deafened)
    {
        _deafened = deafened;
        if (deafened)
        {
            lock (_lock)
            {
                foreach (var player in _players.Values)
                {
                    player.Stop();
                    player.Dispose();
                }
                foreach (var jb in _jitterBuffers.Values)
                    jb.Dispose();
                _players.Clear();
                _jitterBuffers.Clear();

                var wasSpeaking = _currentlySpeaking.ToList();
                _currentlySpeaking.Clear();

                foreach (var userId in wasSpeaking)
                    UserStoppedSpeaking?.Invoke(userId);
            }
        }
    }

    /// <summary>
    /// Sets the transmission mode and adjusts mic state accordingly.
    /// All input plumbing (PTT key detection, mouse hooks, shortcut polling) is owned
    /// by <see cref="Input.InputRouter"/>; this method no longer touches Win32.
    /// The <paramref name="hwnd"/> parameter is retained for caller compatibility
    /// and is ignored — pass <see cref="IntPtr.Zero"/>.
    /// </summary>
    public void SetTransmissionMode(TransmissionMode mode, string? key, IntPtr hwnd)
    {
        // Idempotency guard: identical reapply is a no-op.
        if (_transmissionConfigured
            && mode == _transmissionMode
            && key == _lastTransmissionKey)
        {
            return;
        }

        _pttActive = false;
        _transmissionMode = mode;

        // For PTT, start with mic off until key pressed
        if (mode == TransmissionMode.PushToTalk)
            StopMic();
        else if (mode == TransmissionMode.PushToTalkPlus)
            StartMic(); // Always-on: keep mic running
        else if (!_muted)
            StartMic();

        _lastTransmissionKey = key;
        _transmissionConfigured = true;
        TransmissionApplyCount++;
    }

    /// <summary>
    /// Public entry point for InputRouter to drive PTT state. Internal
    /// callers continue to use SetPttActive directly.
    /// </summary>
    public void SetPttActiveExternal(bool active) => SetPttActive(active);

    private void SetPttActive(bool active)
    {
        bool startMic = false;
        bool fireSpeakingEvent = false;
        bool fireSilentEvent = false;

        lock (_lock)
        {
            // Coalesce: If state hasn't changed, do nothing. Note there is
            // deliberately no press-debounce here: the coalesce already absorbs
            // repeated same-state events, so a debounce could only ever drop a
            // press-after-release — leaving the user holding a dead key while
            // the release's silence tail stops the mic under them. Rapid
            // press/release cycles don't stress WASAPI either way, because the
            // silence tail keeps the mic running between them.
            if (_pttActive == active)
                return;

            AudioLog.Write($"[Audio] SetPttActive: active={active}, muted={_muted}");
            _pttActive = active;

            if (active && !_muted && _transmissionMode != TransmissionMode.PushToTalkPlus)
            {
                // Cancel any pending silence tail - PTT was re-pressed before the tail completed
                _pttSilenceTailTimer?.Dispose();
                _pttSilenceTailTimer = null;
                Interlocked.Increment(ref _pttSilenceTailGeneration);
                AudioLog.Write("[Audio] Starting mic for PTT");
                startMic = true;
            }
            else if (active && !_muted && _transmissionMode == TransmissionMode.PushToTalkPlus)
            {
                // PTT+ mode: mic is already running, just cancel any pending silence tail
                _pttSilenceTailTimer?.Dispose();
                _pttSilenceTailTimer = null;
                Interlocked.Increment(ref _pttSilenceTailGeneration);
                AudioLog.Write("[Audio] PTT+ activated (mic already running)");
                
                // For PTT+, manually fire the speaking event since the mic never stops
                if (_currentlySpeaking.Add(_localUserId))
                {
                    fireSpeakingEvent = true;
                }
            }
            else if (!active)
            {
                AudioLog.Write("[Audio] PTT released - scheduling silence tail");
                // Gate live mic immediately (OnMicData checks _pttActive), then
                // fire the silence tail after the hold delay.
                _pttSilenceTailTimer?.Dispose();
                _pttSilenceTailTimer = null;
                
                // For PTT+, manually fire the silent event since the mic never stops
                // and there's no silence tail (the encoder stays warm)
                if (_transmissionMode == TransmissionMode.PushToTalkPlus)
                {
                    if (_currentlySpeaking.Remove(_localUserId))
                    {
                        fireSilentEvent = true;
                    }
                }
                else
                {
                    // For regular PTT, schedule the silence tail after the hold
                    // delay. Create the timer while still holding the lock so a
                    // re-press can never interleave between scheduling decision
                    // and timer assignment.
                    int generation = Interlocked.Increment(ref _pttSilenceTailGeneration);
                    _pttSilenceTailTimer = new System.Threading.Timer(
                        _ => SilenceTailElapsed(generation), null,
                        dueTime: _voiceHoldMs, period: Timeout.Infinite);
                }
            }
            // else: active but muted - do nothing
        }

        // Call StartMic outside the lock to avoid re-entrancy issues with
        // WASAPI's internal locking and wait logic.
        if (startMic)
            StartMic();

        // Fire speaking/silent events outside the lock
        if (fireSpeakingEvent)
        {
            AudioLog.Write($"[Audio] PTT+ speaking event fired for local user");
            UserStartedSpeaking?.Invoke(_localUserId);
        }
        if (fireSilentEvent)
        {
            AudioLog.Write($"[Audio] PTT+ silent event fired for local user");
            UserStoppedSpeaking?.Invoke(_localUserId);
        }

    }

    private void SilenceTailElapsed(int generation)
    {
        bool wasSpeaking;
        uint capturedUserId;
        lock (_lock)
        {
            // Re-check generation and PTT state under the same lock that
            // SetPttActive mutates them, so a press that lands between the
            // timer firing and this callback running cannot have its freshly
            // started mic stopped underneath it.
            if (Volatile.Read(ref _pttSilenceTailGeneration) != generation) return;
            if (_pttActive || _muted) return;
            (wasSpeaking, capturedUserId) = StopMicLocked();
        }
        if (wasSpeaking)
            UserStoppedSpeaking?.Invoke(capturedUserId);
    }

    private void CheckSpeakingState(object? state)
    {
        List<uint>? started = null;
        List<uint>? stopped = null;

        lock (_lock)
        {
            foreach (var (userId, jb) in _jitterBuffers)
            {
                bool speaking = jb.IsSpeaking;
                bool wasSpeaking = _currentlySpeaking.Contains(userId);

                if (speaking && !wasSpeaking)
                {
                    _currentlySpeaking.Add(userId);
                    (started ??= new()).Add(userId);
                }
                else if (!speaking && wasSpeaking)
                {
                    _currentlySpeaking.Remove(userId);
                    (stopped ??= new()).Add(userId);
                }
            }

            // Check local user: if no audio submitted recently, mark as stopped speaking.
            // VAD mode is NOT included here — its gate-close decision is authoritative
            // and clears _currentlySpeaking inline (see OnMicData → CloseWithTerminator).
            // Including VAD here previously caused indicator-flicker because the timer
            // races with the per-frame _lastLocalAudioMs update.
            if (_localUserId != 0 && _currentlySpeaking.Contains(_localUserId)
                && _transmissionMode == TransmissionMode.PushToTalk)
            {
                long elapsed = Environment.TickCount64 - _lastLocalAudioMs;
                if (elapsed > _voiceHoldMs)
                {
                    _currentlySpeaking.Remove(_localUserId);
                    (stopped ??= new()).Add(_localUserId);
                }
            }

            // Clean up users that were removed while preserving the local user
            if (_currentlySpeaking.Count > 0)
            {
                _currentlySpeaking.RemoveWhere(id => id != _localUserId && !_jitterBuffers.ContainsKey(id));
            }
        }

        if (started != null)
            foreach (var userId in started)
                UserStartedSpeaking?.Invoke(userId);

        if (stopped != null)
            foreach (var userId in stopped)
                UserStoppedSpeaking?.Invoke(userId);
    }

    public void Dispose()
    {
        _deviceResampler?.Dispose();
        _deviceResampler = null;
        lock (_processorLock)
        {
            _processor?.Dispose();
            _processor = null;
        }
        lock (_vadLock)
        {
            _vadGate = null;
            (_vad as IDisposable)?.Dispose();
            _vad = null;
        }
        _speakingTimer.Dispose();
        _pttSilenceTailTimer?.Dispose();
        _pttSilenceTailTimer = null;
        Interlocked.Increment(ref _pttSilenceTailGeneration);
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
            foreach (var jb in _jitterBuffers.Values)
                jb.Dispose();
            _players.Clear();
            _jitterBuffers.Clear();
            _userLossTrackers.Clear();
            _totalReceived = 0;
            _totalLost = 0;
            _smoothedLoss = -1;
        }
    }

    private IReadOnlyList<AudioDeviceOption> EnumerateAudioDevices(DataFlow flow)
    {
        var devices = new List<AudioDeviceOption>
        {
            new("default", "Default (System)")
        };

        try
        {
            using var enumerator = new MMDeviceEnumerator();
            foreach (var device in enumerator.EnumerateAudioEndPoints(flow, DeviceState.Active))
            {
                devices.Add(new AudioDeviceOption(device.ID, device.FriendlyName));
            }
        }
        catch (Exception ex)
        {
            AudioLog.Write($"[Audio] EnumerateAudioDevices({flow}) failed: {ex.Message}");
        }

        return devices;
    }

    private bool IsDeviceAvailable(string? deviceId, DataFlow flow)
    {
        if (string.IsNullOrWhiteSpace(deviceId) || deviceId == "default")
            return true;

        try
        {
            using var enumerator = new MMDeviceEnumerator();
            using var device = enumerator.GetDevice(deviceId);
            if (device.DataFlow != flow)
            {
                AudioLog.Write($"[Audio] Device mismatch ({flow}): {deviceId} is {device.DataFlow}");
                return false;
            }
            if (device.State != DeviceState.Active)
            {
                AudioLog.Write($"[Audio] Device not active ({flow}): {deviceId} ({device.State})");
                return false;
            }
            return true;
        }
        catch (Exception ex)
        {
            AudioLog.Write($"[Audio] Device unavailable ({flow}): {deviceId} ({ex.Message})");
            return false;
        }
    }

    private MMDevice ResolveCaptureDevice(MMDeviceEnumerator enumerator)
    {
        if (!string.IsNullOrWhiteSpace(_inputDeviceId) && _inputDeviceId != "default")
        {
            try
            {
                return enumerator.GetDevice(_inputDeviceId);
            }
            catch (Exception ex)
            {
                AudioLog.Write($"[Audio] Falling back to default capture device from '{_inputDeviceId}': {ex.Message}");
            }
        }

        return enumerator.GetDefaultAudioEndpoint(DataFlow.Capture, Role.Communications);
    }

    private IWavePlayer CreatePlayerFor(JitterBuffer jb)
    {
        if (_outputDeviceId != "default")
        {
            try
            {
                using var enumerator = new MMDeviceEnumerator();
                var device = enumerator.GetDevice(_outputDeviceId);
                return new WasapiOut(device, AudioClientShareMode.Shared, false, 80);
            }
            catch (Exception ex)
            {
                AudioLog.Write($"[Audio] Falling back to default output device from '{_outputDeviceId}': {ex.Message}");
            }
        }

        return new WaveOutEvent
        {
            DesiredLatency = 80,
            NumberOfBuffers = 4
        };
    }
}

/// <summary>
/// No-op VAD detector used when WebRtcVad native init fails.
/// Always returns true so that the VadGate's RMS threshold does all the gating work.
/// </summary>
internal sealed class RmsOnlyVadFallback : IVadDetector
{
    public VadAggressiveness Mode { get; set; }
    public bool IsSpeech(ReadOnlySpan<short> frame) => true; // gate RMS threshold does the work
}
