using System;
using System.Runtime.InteropServices;
using Brmble.Client.Services.AppConfig;

namespace Brmble.Client.Services.SpeechEnhancement;

public sealed class SpeexDspService : IDisposable
{
    private const string DllName = "speexdsp";
    public const int FrameSize = 480;
    public const int SampleRate = 48000;

    private const int SPEEX_PREPROCESS_SET_DENOISE = 0;
    private const int SPEEX_PREPROCESS_GET_DENOISE = 1;
    private const int SPEEX_PREPROCESS_SET_AGC = 2;
    private const int SPEEX_PREPROCESS_GET_AGC = 3;
    private const int SPEEX_PREPROCESS_SET_AGC_LEVEL = 4;
    private const int SPEEX_PREPROCESS_GET_AGC_LEVEL = 5;

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    private static extern IntPtr speex_preprocess_state_init(int frame_size, int sampling_rate);

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    private static extern void speex_preprocess_state_destroy(IntPtr st);

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    private static extern int speex_preprocess(IntPtr st, float[] input, float[] output);

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    private static extern int speex_preprocess_ctl(IntPtr st, int request, IntPtr ptr);

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

    private IntPtr _preprocessState = IntPtr.Zero;
    private IntPtr _echoState = IntPtr.Zero;
    private bool _disposed;

    private bool _echoEnabled;
    private bool _agcEnabled;
    private bool _denoiseEnabled;

    public SpeexDspService()
    {
        bool preprocessOk = false;
        bool echoOk = false;

        try
        {
            _preprocessState = speex_preprocess_state_init(FrameSize, SampleRate);
            if (_preprocessState == IntPtr.Zero)
            {
                Console.Error.WriteLine("[SpeexDSP] Failed to initialize preprocessor");
            }
            else
            {
                preprocessOk = true;
            }

            _echoState = speex_echo_state_init(FrameSize, SampleRate * 2);
            if (_echoState == IntPtr.Zero)
            {
                Console.Error.WriteLine("[SpeexDSP] Failed to initialize echo canceller");
            }
            else
            {
                echoOk = true;
            }

            if (preprocessOk || echoOk)
            {
                Console.WriteLine($"[SpeexDSP] Initialized (preprocess: {(preprocessOk ? "ok" : "failed")}, echo: {(echoOk ? "ok" : "failed")})");
            }
            else
            {
                Console.Error.WriteLine("[SpeexDSP] Failed to initialize — disabled");
            }
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
        if (_preprocessState == IntPtr.Zero) return;
        _agcEnabled = true;
        
        try
        {
            var enable = 1;
            var enablePtr = Marshal.AllocHGlobal(4);
            Marshal.WriteInt32(enablePtr, 0, enable);
            speex_preprocess_ctl(_preprocessState, SPEEX_PREPROCESS_SET_AGC, enablePtr);
            Marshal.FreeHGlobal(enablePtr);

            var level = 8000f;
            var levelPtr = Marshal.AllocHGlobal(4);
            Marshal.WriteInt32(levelPtr, 0, BitConverter.SingleToInt32Bits(level));
            speex_preprocess_ctl(_preprocessState, SPEEX_PREPROCESS_SET_AGC_LEVEL, levelPtr);
            Marshal.FreeHGlobal(levelPtr);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[SpeexDSP] AGC config failed: {ex.Message}");
        }
        
        Console.WriteLine("[SpeexDSP] AGC enabled");
    }

    public void DisableAGC()
    {
        if (_preprocessState == IntPtr.Zero) return;
        _agcEnabled = false;

        try
        {
            var enable = 0;
            var enablePtr = Marshal.AllocHGlobal(4);
            Marshal.WriteInt32(enablePtr, 0, enable);
            speex_preprocess_ctl(_preprocessState, SPEEX_PREPROCESS_SET_AGC, enablePtr);
            Marshal.FreeHGlobal(enablePtr);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[SpeexDSP] AGC disable failed: {ex.Message}");
        }
    }

    public void EnableDenoise()
    {
        if (_preprocessState == IntPtr.Zero) return;
        _denoiseEnabled = true;
        
        try
        {
            var enable = 1;
            var enablePtr = Marshal.AllocHGlobal(4);
            Marshal.WriteInt32(enablePtr, 0, enable);
            speex_preprocess_ctl(_preprocessState, SPEEX_PREPROCESS_SET_DENOISE, enablePtr);
            Marshal.FreeHGlobal(enablePtr);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[SpeexDSP] Denoise config failed: {ex.Message}");
        }
        
        Console.WriteLine("[SpeexDSP] Denoise enabled");
    }

    public void DisableDenoise()
    {
        if (_preprocessState == IntPtr.Zero) return;
        _denoiseEnabled = false;

        try
        {
            var enable = 0;
            var enablePtr = Marshal.AllocHGlobal(4);
            Marshal.WriteInt32(enablePtr, 0, enable);
            speex_preprocess_ctl(_preprocessState, SPEEX_PREPROCESS_SET_DENOISE, enablePtr);
            Marshal.FreeHGlobal(enablePtr);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[SpeexDSP] Denoise disable failed: {ex.Message}");
        }
    }

    public void ProcessDenoise(Span<float> buffer)
    {
        if (!_denoiseEnabled || _preprocessState == IntPtr.Zero || buffer.Length < FrameSize) return;

        for (int i = 0; i + FrameSize <= buffer.Length; i += FrameSize)
        {
            var input = buffer.Slice(i, FrameSize);
            var tempInput = new float[FrameSize];
            var tempOutput = new float[FrameSize];
            input.CopyTo(tempInput.AsSpan());
            speex_preprocess(_preprocessState, tempInput, tempOutput);
            tempOutput.AsSpan().CopyTo(input);
        }
    }

    public void ProcessAGC(Span<float> buffer)
    {
        if (!_agcEnabled || _preprocessState == IntPtr.Zero || buffer.Length < FrameSize) return;

        for (int i = 0; i + FrameSize <= buffer.Length; i += FrameSize)
        {
            var input = buffer.Slice(i, FrameSize);
            var tempInput = new float[FrameSize];
            var tempOutput = new float[FrameSize];
            input.CopyTo(tempInput.AsSpan());
            speex_preprocess(_preprocessState, tempInput, tempOutput);
            tempOutput.AsSpan().CopyTo(input);
        }
    }

    public void ProcessAEC(Span<float> captured, Span<float> playback)
    {
        if (!_echoEnabled || _echoState == IntPtr.Zero || captured.Length < FrameSize || playback.Length < FrameSize) return;

        for (int i = 0; i + FrameSize <= captured.Length && i + FrameSize <= playback.Length; i += FrameSize)
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

        if (_preprocessState != IntPtr.Zero)
        {
            speex_preprocess_state_destroy(_preprocessState);
            _preprocessState = IntPtr.Zero;
        }

        Console.WriteLine("[SpeexDSP] Disposed");
    }
}
