using System.Runtime.InteropServices;
using Brmble.Client.Services.AppConfig;

namespace Brmble.Client.Services.SpeechEnhancement;

public sealed class RnnoiseService : IDisposable
{
    public const int FrameSize = 480;

    private bool _enabled;
    private readonly IntPtr _state;
    private bool _disposed;

    [DllImport("renamenoise.dll", CallingConvention = CallingConvention.Cdecl, EntryPoint = "renamenoise_create")]
    private static extern IntPtr RnnoiseCreate(IntPtr ctx);

    [DllImport("renamenoise.dll", CallingConvention = CallingConvention.Cdecl, EntryPoint = "renamenoise_init")]
    private static extern int RnnoiseInit(IntPtr state);

    [DllImport("renamenoise.dll", CallingConvention = CallingConvention.Cdecl, EntryPoint = "renamenoise_process_frame")]
    private static extern float RnnoiseProcessFrame(IntPtr state, float[] input, float[] output);

    [DllImport("renamenoise.dll", CallingConvention = CallingConvention.Cdecl, EntryPoint = "renamenoise_destroy")]
    private static extern void RnnoiseDestroy(IntPtr state);

    public RnnoiseService(SpeechDenoiseMode mode)
    {
        _enabled = mode == SpeechDenoiseMode.Rnnoise;

        if (!_enabled)
            return;

        try
        {
            _state = RnnoiseCreate(IntPtr.Zero);
            if (_state == IntPtr.Zero)
            {
                Console.Error.WriteLine("RNNoise: Failed to create denoiser state. Disabling.");
                _enabled = false;
                return;
            }

            var initResult = RnnoiseInit(_state);
            if (initResult != 0)
            {
                Console.Error.WriteLine($"RNNoise: Init returned {initResult}. Disabling.");
                _enabled = false;
                return;
            }
        }
        catch (DllNotFoundException)
        {
            Console.Error.WriteLine("RNNoise: renamenoise.dll not found. Disabling noise suppression.");
            _enabled = false;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"RNNoise: Failed to initialize. Disabling. Details: {ex.Message}");
            _enabled = false;
        }
    }

    public bool IsEnabled => _enabled;

    public float[]? Process(float[] input)
    {
        if (_disposed)
            throw new ObjectDisposedException(nameof(RnnoiseService));

        if (!_enabled)
            throw new InvalidOperationException("RNNoise is not enabled. Create service with Rnnoise mode.");

        if (input.Length != FrameSize)
            throw new ArgumentException($"Input must be exactly {FrameSize} samples (10ms at 48kHz).", nameof(input));

        var output = new float[FrameSize];
        Array.Copy(input, output, FrameSize);
        var vad = RnnoiseProcessFrame(_state, output, output);

        return output;
    }

    public void Dispose()
    {
        if (_disposed)
            return;

        _disposed = true;

        if (_state != IntPtr.Zero)
        {
            RnnoiseDestroy(_state);
        }
    }
}
