using System.Threading;
using Brmble.Audio.Native;

namespace Brmble.Audio;

/// <summary>
/// libfvad-backed implementation of <see cref="IVadDetector"/>.
/// Operates on 480-sample frames at 48 kHz mono int16.
/// Hot-swap of <see cref="Mode"/> is thread-safe; underlying handle access is serialised by an internal lock.
/// </summary>
public sealed class WebRtcVad : IVadDetector, IDisposable
{
    public const int FrameSamples = 480;
    public const int SampleRate = 48000;

    private readonly object _lock = new();
    private IntPtr _handle;
    private VadAggressiveness _mode;
    private bool _disposed;

    public WebRtcVad(VadAggressiveness mode = VadAggressiveness.Aggressive)
    {
        _handle = LibFvadNative.fvad_new();
        if (_handle == IntPtr.Zero) throw new InvalidOperationException("fvad_new failed (out of memory)");

        if (LibFvadNative.fvad_set_sample_rate(_handle, SampleRate) != 0)
        {
            LibFvadNative.fvad_free(_handle);
            _handle = IntPtr.Zero;
            throw new InvalidOperationException($"fvad_set_sample_rate({SampleRate}) failed");
        }

        Mode = mode;
    }

    public VadAggressiveness Mode
    {
        get => _mode;
        set
        {
            lock (_lock)
            {
                if (_disposed) throw new ObjectDisposedException(nameof(WebRtcVad));
                if (LibFvadNative.fvad_set_mode(_handle, (int)value) != 0)
                    throw new ArgumentOutOfRangeException(nameof(value), value, "fvad_set_mode rejected the value");
                _mode = value;
            }
        }
    }

    public bool IsSpeech(ReadOnlySpan<short> frame)
    {
        if (frame.Length != FrameSamples)
            throw new ArgumentException($"Frame must be {FrameSamples} samples", nameof(frame));

        lock (_lock)
        {
            if (_disposed) throw new ObjectDisposedException(nameof(WebRtcVad));
            unsafe
            {
                fixed (short* p = frame)
                {
                    int rc = LibFvadNative.fvad_process(_handle, p, (UIntPtr)FrameSamples);
                    return rc == 1; // -1 (error) and 0 (silence) both treated as non-speech
                }
            }
        }
    }

    public void Dispose()
    {
        lock (_lock)
        {
            if (_disposed) return;
            _disposed = true;
            if (_handle != IntPtr.Zero)
            {
                LibFvadNative.fvad_free(_handle);
                _handle = IntPtr.Zero;
            }
        }
    }
}
