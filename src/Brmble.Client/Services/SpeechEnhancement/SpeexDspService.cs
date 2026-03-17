using System;
using System.Runtime.InteropServices;
using Brmble.Client.Services.AppConfig;

namespace Brmble.Client.Services.SpeechEnhancement;

public sealed class SpeexDspService : IDisposable
{
    private const string DllName = "speexdsp";
    public const int FrameSize = 480;
    public const int SampleRate = 48000;

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    private static extern IntPtr speex_echo_state_init(int frame_size, int filter_length);

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    private static extern void speex_echo_state_destroy(IntPtr st);

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    private static extern void speex_echo_cancellation(IntPtr st, float[] echo_frame, float[] captured, float[] output);

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    private static extern void speex_echo_state_reset(IntPtr st);

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    private static extern int speex_echo_ctl(IntPtr st, int request, IntPtr ptr);

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    private static extern IntPtr speex_agc_init();

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    private static extern void speex_agc_destroy(IntPtr st);

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    private static extern void speex_agc_process(IntPtr st, float[] input, float[] output, int length);

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    private static extern int speex_agc_ctl(IntPtr st, int request, IntPtr ptr);

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    private static extern IntPtr speex_denoise_init();

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    private static extern void speex_denoise_destroy(IntPtr st);

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    private static extern void speex_denoise_process(IntPtr st, float[] input, float[] output, int length);

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    private static extern int speex_denoise_ctl(IntPtr st, int request, IntPtr ptr);

    private IntPtr _echoState = IntPtr.Zero;
    private IntPtr _agcState = IntPtr.Zero;
    private IntPtr _denoiseState = IntPtr.Zero;
    private bool _disposed;

    private bool _echoEnabled;
    private bool _agcEnabled;
    private bool _denoiseEnabled;

    private readonly float[] _echoFrame = new float[FrameSize];
    private readonly float[] _outputFrame = new float[FrameSize];

    public SpeexDspService()
    {
        try
        {
            _echoState = speex_echo_state_init(FrameSize, SampleRate * 2);
            if (_echoState == IntPtr.Zero)
            {
                Console.Error.WriteLine("[SpeexDSP] Failed to initialize echo canceller");
            }

            _agcState = speex_agc_init();
            if (_agcState == IntPtr.Zero)
            {
                Console.Error.WriteLine("[SpeexDSP] Failed to initialize AGC");
            }

            _denoiseState = speex_denoise_init();
            if (_denoiseState == IntPtr.Zero)
            {
                Console.Error.WriteLine("[SpeexDSP] Failed to initialize denoiser");
            }

            if (_agcState != IntPtr.Zero)
            {
                var level = (int)(1.0f * 32768.0f);
                speex_agc_ctl(_agcState, 0, (IntPtr)level);
            }

            Console.WriteLine("[SpeexDSP] Initialized successfully");
        }
        catch (DllNotFoundException ex)
        {
            Console.Error.WriteLine($"[SpeexDSP] speexdsp.dll not found — disabled. Details: {ex.Message}");
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[SpeexDSP] Failed to initialize — disabled. Details: {ex.Message}");
        }
    }

    public void ConfigureAEC(EchoCancellationMode mode)
    {
        if (_echoState == IntPtr.Zero) return;

        _echoEnabled = mode != EchoCancellationMode.Disabled;
        Console.WriteLine($"[SpeexDSP] AEC configured: {mode}");
    }

    public void EnableAGC()
    {
        if (_agcState == IntPtr.Zero) return;
        _agcEnabled = true;
        Console.WriteLine("[SpeexDSP] AGC enabled");
    }

    public void DisableAGC()
    {
        _agcEnabled = false;
    }

    public void EnableDenoise()
    {
        if (_denoiseState == IntPtr.Zero) return;
        _denoiseEnabled = true;
        Console.WriteLine("[SpeexDSP] Denoise enabled");
    }

    public void DisableDenoise()
    {
        _denoiseEnabled = false;
    }

    public void ProcessDenoise(Span<float> buffer)
    {
        if (!_denoiseEnabled || _denoiseState == IntPtr.Zero || buffer.Length < FrameSize) return;

        for (int i = 0; i < buffer.Length - FrameSize; i += FrameSize)
        {
            var input = buffer.Slice(i, FrameSize);
            var tempInput = new float[FrameSize];
            var tempOutput = new float[FrameSize];
            input.CopyTo(tempInput.AsSpan());
            speex_denoise_process(_denoiseState, tempInput, tempOutput, FrameSize);
            tempOutput.AsSpan().CopyTo(input);
        }
    }

    public void ProcessAGC(Span<float> buffer)
    {
        if (!_agcEnabled || _agcState == IntPtr.Zero || buffer.Length < FrameSize) return;

        for (int i = 0; i < buffer.Length - FrameSize; i += FrameSize)
        {
            var input = buffer.Slice(i, FrameSize);
            var tempInput = new float[FrameSize];
            var tempOutput = new float[FrameSize];
            input.CopyTo(tempInput.AsSpan());
            speex_agc_process(_agcState, tempInput, tempOutput, FrameSize);
            tempOutput.AsSpan().CopyTo(input);
        }
    }

    public void ProcessAEC(Span<float> captured, Span<float> playback)
    {
        if (!_echoEnabled || _echoState == IntPtr.Zero || captured.Length < FrameSize || playback.Length < FrameSize) return;

        for (int i = 0; i < captured.Length - FrameSize && i < playback.Length - FrameSize; i += FrameSize)
        {
            var capturedFrame = captured.Slice(i, FrameSize);
            var playbackFrame = playback.Slice(i, FrameSize);
            var tempCaptured = new float[FrameSize];
            var tempPlayback = new float[FrameSize];
            var tempOutput = new float[FrameSize];
            capturedFrame.CopyTo(tempCaptured.AsSpan());
            playbackFrame.CopyTo(tempPlayback.AsSpan());
            speex_echo_cancellation(_echoState, tempPlayback, tempCaptured, tempOutput);
            tempOutput.AsSpan().CopyTo(capturedFrame);
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;

        if (_echoState != IntPtr.Zero)
        {
            speex_echo_state_destroy(_echoState);
            _echoState = IntPtr.Zero;
        }

        if (_agcState != IntPtr.Zero)
        {
            speex_agc_destroy(_agcState);
            _agcState = IntPtr.Zero;
        }

        if (_denoiseState != IntPtr.Zero)
        {
            speex_denoise_destroy(_denoiseState);
            _denoiseState = IntPtr.Zero;
        }

        Console.WriteLine("[SpeexDSP] Disposed");
    }
}
