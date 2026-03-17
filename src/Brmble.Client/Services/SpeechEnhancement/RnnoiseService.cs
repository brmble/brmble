using System.Buffers;
using System.Runtime.InteropServices;
using Brmble.Client.Services.AppConfig;

namespace Brmble.Client.Services.SpeechEnhancement;

public sealed class RnnoiseService : IDisposable
{
    private const string DllName = "renamenoise";
    public const int FrameSize = 480;

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    private static extern IntPtr rnnoise_create(IntPtr model);

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    private static extern void rnnoise_destroy(IntPtr st);

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    private static extern float rnnoise_process_frame(IntPtr st, float[] output, float[] input);

    private IntPtr _state = IntPtr.Zero;
    private bool _disposed;
    private float[]? _inputBuffer;
    private float[]? _outputBuffer;

    public bool IsEnabled { get; private set; }

    public RnnoiseService(SpeechDenoiseMode mode)
    {
        if (mode != SpeechDenoiseMode.Rnnoise)
        {
            IsEnabled = false;
            return;
        }

        try
        {
            _state = rnnoise_create(IntPtr.Zero);
            IsEnabled = _state != IntPtr.Zero;
            if (!IsEnabled)
                Console.Error.WriteLine("[RNNoise] rnnoise_create returned null — disabled.");
        }
        catch (DllNotFoundException ex)
        {
            Console.Error.WriteLine($"[RNNoise] renamenoise.dll not found — disabled. Details: {ex.Message}");
            IsEnabled = false;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[RNNoise] Failed to initialize — disabled. Details: {ex.Message}");
            IsEnabled = false;
        }
    }

    public void ProcessFrame(float[] buffer, int offset = 0)
    {
        if (!IsEnabled || _state == IntPtr.Zero || buffer.Length - offset < FrameSize)
            return;

        _inputBuffer ??= new float[FrameSize];
        _outputBuffer ??= new float[FrameSize];

        Array.Copy(buffer, offset, _inputBuffer, 0, FrameSize);
        rnnoise_process_frame(_state, _outputBuffer, _inputBuffer);
        Array.Copy(_outputBuffer, 0, buffer, offset, FrameSize);
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        if (_state != IntPtr.Zero)
        {
            rnnoise_destroy(_state);
            _state = IntPtr.Zero;
        }
        _inputBuffer = null;
        _outputBuffer = null;
    }
}
