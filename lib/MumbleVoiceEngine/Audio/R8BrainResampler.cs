using System;
using System.Runtime.InteropServices;
using MumbleVoiceEngine.Native;

namespace MumbleVoiceEngine.Audio;

public sealed class R8BrainResampler : IDisposable
{
    private IntPtr _handle;
    private readonly int _maxInLen;

    public R8BrainResampler(double srcRate, double dstRate, int maxInLen,
        double transitionBand = 2.0)
    {
        _maxInLen = maxInLen;
        _handle = R8BrainNative.r8b_create(
            srcRate, dstRate, maxInLen, transitionBand,
            R8BrainResolution.R24Bit);
        if (_handle == IntPtr.Zero)
            throw new InvalidOperationException("Failed to create r8brain resampler");
    }

    public int Process(double[] input, out double[] output)
        => Process(input, input.Length, out output);

    /// <summary>
    /// Resample the first <paramref name="inputLength"/> samples of
    /// <paramref name="input"/>. The backing array may be larger than the
    /// actual sample count (callers reuse growing scratch buffers).
    /// </summary>
    public int Process(double[] input, int inputLength, out double[] output)
    {
        if (_handle == IntPtr.Zero)
            throw new ObjectDisposedException(nameof(R8BrainResampler));

        if (inputLength < 0)
            throw new ArgumentException(
                $"Input length {inputLength} is negative", nameof(inputLength));
        if (inputLength > _maxInLen)
            throw new ArgumentException(
                $"Input length {inputLength} exceeds maxInLen {_maxInLen} configured at construction",
                nameof(inputLength));
        if (inputLength > input.Length)
            throw new ArgumentException(
                $"Input length {inputLength} exceeds array length {input.Length}",
                nameof(inputLength));

        var pinned = GCHandle.Alloc(input, GCHandleType.Pinned);
        try
        {
            int outSamples = R8BrainNative.r8b_process(
                _handle, pinned.AddrOfPinnedObject(), inputLength, out IntPtr outPtr);

            if (outSamples > 0 && outPtr != IntPtr.Zero)
            {
                output = new double[outSamples];
                Marshal.Copy(outPtr, output, 0, outSamples);
            }
            else
            {
                output = Array.Empty<double>();
            }

            return outSamples;
        }
        finally
        {
            pinned.Free();
        }
    }

    public void Clear()
    {
        if (_handle == IntPtr.Zero)
            throw new ObjectDisposedException(nameof(R8BrainResampler));
        R8BrainNative.r8b_clear(_handle);
    }

    public void Dispose()
    {
        if (_handle != IntPtr.Zero)
        {
            R8BrainNative.r8b_delete(_handle);
            _handle = IntPtr.Zero;
        }
    }
}
