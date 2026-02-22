using Microsoft.ML.OnnxRuntime;
using Microsoft.ML.OnnxRuntime.Tensors;

namespace Brmble.Client.Services.SpeechEnhancement;

/// <summary>
/// Wraps the GTCRN ONNX speech enhancement model.
/// The model operates in the STFT frequency domain and processes one frame at a time.
/// STFT parameters (n_fft=512, hop=256, window=hann_sqrt) are embedded in the model metadata.
/// Cache tensors are carried between frames for streaming/real-time use.
/// </summary>
public sealed class GtcrnModel : IDisposable
{
    private readonly InferenceSession _session;

    // STFT parameters from model metadata
    private const int NFft = 512;
    private const int HopLength = 256;
    private const int WindowLength = 512;
    private const int NumBins = NFft / 2 + 1; // 257

    // Hann-sqrt window (hann_sqrt = sqrt(hann) per sherpa-onnx convention)
    private readonly float[] _window;

    // Cache tensors (zero-initialized, carried between Process calls)
    private float[] _convCache;   // shape [2, 1, 16, 16, 33]
    private float[] _traCache;    // shape [2, 3, 1, 1, 16]
    private float[] _interCache;  // shape [2, 1, 33, 16]

    // Cache tensor shapes
    private static readonly int[] ConvCacheShape  = [2, 1, 16, 16, 33];
    private static readonly int[] TraCacheShape   = [2, 3, 1, 1, 16];
    private static readonly int[] InterCacheShape = [2, 1, 33, 16];

    private static int ShapeSize(int[] shape) => shape.Aggregate(1, (a, b) => a * b);

    // Overlap-add buffer for ISTFT reconstruction
    private readonly float[] _olaBuffer; // WindowLength samples
    private readonly float[] _olaWindow; // synthesis window for OLA

    public GtcrnModel(string modelPath)
    {
        if (!File.Exists(modelPath))
            throw new FileNotFoundException($"Model not found: {modelPath}");

        var sessionOptions = new SessionOptions();
        sessionOptions.GraphOptimizationLevel = GraphOptimizationLevel.ORT_ENABLE_ALL;
        _session = new InferenceSession(modelPath, sessionOptions);

        // Build hann_sqrt analysis window
        _window = BuildHannSqrtWindow(WindowLength);

        // Initialize caches to zero
        _convCache  = new float[ShapeSize(ConvCacheShape)];
        _traCache   = new float[ShapeSize(TraCacheShape)];
        _interCache = new float[ShapeSize(InterCacheShape)];

        // OLA synthesis buffer and window
        _olaBuffer = new float[WindowLength];
        _olaWindow = BuildHannSqrtWindow(WindowLength);
    }

    /// <summary>
    /// Process a block of 16kHz normalized float samples.
    /// Input and output are the same length.
    /// Internally processes HopLength=256 samples per model call with overlap-add.
    /// </summary>
    public float[] Process(float[] input16kHz)
    {
        if (input16kHz.Length == 0)
            return [];

        var output = new float[input16kHz.Length];
        int pos = 0;

        // Process in hops of HopLength
        // We need WindowLength samples to compute the first STFT frame.
        // For streaming real-time, we process one hop at a time assuming
        // the caller feeds exactly HopLength samples at a time, or we pad/buffer.
        // Here we process as many complete hops as available and return aligned output.
        while (pos + HopLength <= input16kHz.Length)
        {
            // Extract analysis frame: HopLength new samples, zero-padded on the left if first call
            // For simplicity, pad with zeros for the look-back (causal processing)
            var frame = new float[WindowLength];
            // look-back: samples before current position (zero for start)
            int lookBack = WindowLength - HopLength;
            for (int i = 0; i < lookBack; i++)
            {
                int srcIdx = pos - lookBack + i;
                frame[i] = srcIdx >= 0 ? input16kHz[srcIdx] : 0f;
            }
            // current hop
            Array.Copy(input16kHz, pos, frame, lookBack, HopLength);

            // Apply analysis window
            var windowed = new float[WindowLength];
            for (int i = 0; i < WindowLength; i++)
                windowed[i] = frame[i] * _window[i];

            // STFT: compute complex spectrum via DFT (real FFT)
            var (real, imag) = RealFFT(windowed);

            // Pack into model input tensor [1, 257, 1, 2]
            var mix = new float[1 * NumBins * 1 * 2];
            for (int k = 0; k < NumBins; k++)
            {
                mix[k * 2 + 0] = real[k];
                mix[k * 2 + 1] = imag[k];
            }

            // Run model
            var (enhReal, enhImag) = RunModel(mix);

            // ISTFT: inverse FFT from enhanced spectrum
            var enhSpecReal = new float[NFft];
            var enhSpecImag = new float[NFft];
            for (int k = 0; k < NumBins; k++)
            {
                enhSpecReal[k] = enhReal[k];
                enhSpecImag[k] = enhImag[k];
            }
            // Mirror for real IFFT
            for (int k = 1; k < NFft / 2; k++)
            {
                enhSpecReal[NFft - k] =  enhSpecReal[k];
                enhSpecImag[NFft - k] = -enhSpecImag[k];
            }

            var timeDomain = IFFT(enhSpecReal, enhSpecImag);

            // Apply synthesis window and overlap-add
            var synthFrame = new float[WindowLength];
            for (int i = 0; i < WindowLength; i++)
                synthFrame[i] = timeDomain[i] * _olaWindow[i];

            // Overlap-add: shift buffer by HopLength and add new frame
            // The output for this hop is the first HopLength samples of the OLA buffer
            for (int i = 0; i < HopLength; i++)
                output[pos + i] = _olaBuffer[i] + synthFrame[i];

            // Shift OLA buffer
            int remaining = WindowLength - HopLength;
            Array.Copy(_olaBuffer, HopLength, _olaBuffer, 0, remaining);
            Array.Clear(_olaBuffer, remaining, HopLength);

            // Accumulate tail of synthesis frame into OLA buffer
            for (int i = 0; i < remaining; i++)
                _olaBuffer[i] += synthFrame[HopLength + i];

            pos += HopLength;
        }

        // Copy any leftover input samples unmodified (partial hop at end)
        while (pos < input16kHz.Length)
        {
            output[pos] = input16kHz[pos];
            pos++;
        }

        return output;
    }

    private (float[] real, float[] imag) RunModel(float[] mix)
    {
        // Input tensors
        var mixTensor        = new DenseTensor<float>(mix,         new[] { 1, NumBins, 1, 2 });
        var convCacheTensor  = new DenseTensor<float>(_convCache,  ConvCacheShape);
        var traCacheTensor   = new DenseTensor<float>(_traCache,   TraCacheShape);
        var interCacheTensor = new DenseTensor<float>(_interCache, InterCacheShape);

        var inputs = new List<NamedOnnxValue>
        {
            NamedOnnxValue.CreateFromTensor("mix",         mixTensor),
            NamedOnnxValue.CreateFromTensor("conv_cache",  convCacheTensor),
            NamedOnnxValue.CreateFromTensor("tra_cache",   traCacheTensor),
            NamedOnnxValue.CreateFromTensor("inter_cache", interCacheTensor),
        };

        using var results = _session.Run(inputs);
        var resultList = results.ToList();

        // enh: [1, 257, 1, 2]
        var enhTensor = resultList[0].AsTensor<float>().ToArray();

        // Update caches from outputs
        _convCache  = resultList[1].AsTensor<float>().ToArray();
        _traCache   = resultList[2].AsTensor<float>().ToArray();
        _interCache = resultList[3].AsTensor<float>().ToArray();

        var enhReal = new float[NumBins];
        var enhImag = new float[NumBins];
        for (int k = 0; k < NumBins; k++)
        {
            enhReal[k] = enhTensor[k * 2 + 0];
            enhImag[k] = enhTensor[k * 2 + 1];
        }

        return (enhReal, enhImag);
    }

    /// <summary>Real FFT via Cooley-Tukey. Returns first N/2+1 bins.</summary>
    private static (float[] real, float[] imag) RealFFT(float[] x)
    {
        int n = x.Length; // must be power of 2
        var re = new float[n];
        var im = new float[n];
        Array.Copy(x, re, n);

        FFTInPlace(re, im, n);

        // Return only positive frequencies (0..N/2)
        var outRe = new float[n / 2 + 1];
        var outIm = new float[n / 2 + 1];
        Array.Copy(re, outRe, n / 2 + 1);
        Array.Copy(im, outIm, n / 2 + 1);
        return (outRe, outIm);
    }

    /// <summary>Inverse FFT. Input is full-spectrum (mirrored). Returns real part.</summary>
    private static float[] IFFT(float[] re, float[] im)
    {
        int n = re.Length;
        var reC = (float[])re.Clone();
        var imC = (float[])im.Clone();

        // Conjugate → forward FFT → conjugate → scale
        for (int i = 0; i < n; i++) imC[i] = -imC[i];
        FFTInPlace(reC, imC, n);
        for (int i = 0; i < n; i++) reC[i] /= n;
        return reC;
    }

    /// <summary>In-place Cooley-Tukey FFT (power-of-2 DIF).</summary>
    private static void FFTInPlace(float[] re, float[] im, int n)
    {
        // Bit-reversal permutation
        int j = 0;
        for (int i = 1; i < n; i++)
        {
            int bit = n >> 1;
            for (; (j & bit) != 0; bit >>= 1)
                j ^= bit;
            j ^= bit;
            if (i < j)
            {
                (re[i], re[j]) = (re[j], re[i]);
                (im[i], im[j]) = (im[j], im[i]);
            }
        }

        // FFT butterfly
        for (int len = 2; len <= n; len <<= 1)
        {
            double ang = -2 * Math.PI / len;
            float wRe = (float)Math.Cos(ang);
            float wIm = (float)Math.Sin(ang);

            for (int i = 0; i < n; i += len)
            {
                float curRe = 1f, curIm = 0f;
                for (int k = 0; k < len / 2; k++)
                {
                    int u = i + k;
                    int v = i + k + len / 2;
                    float tRe = curRe * re[v] - curIm * im[v];
                    float tIm = curRe * im[v] + curIm * re[v];
                    re[v] = re[u] - tRe;
                    im[v] = im[u] - tIm;
                    re[u] += tRe;
                    im[u] += tIm;
                    float nextRe = curRe * wRe - curIm * wIm;
                    curIm = curRe * wIm + curIm * wRe;
                    curRe = nextRe;
                }
            }
        }
    }

    /// <summary>
    /// Builds a hann_sqrt window using the PERIODIC form: sqrt(0.5 * (1 - cos(2*pi*n/N))).
    /// The periodic (not symmetric) form is required for STFT so that the COLA (Constant
    /// Overlap-Add) condition holds at 50% overlap: w[n]^2 + w[n+N/2]^2 = 1 for all n.
    /// Using (N-1) in the denominator (symmetric form) breaks COLA and causes amplitude
    /// ripple and jitter in the reconstructed audio.
    /// </summary>
    private static float[] BuildHannSqrtWindow(int length)
    {
        var w = new float[length];
        for (int i = 0; i < length; i++)
        {
            double hann = 0.5 * (1.0 - Math.Cos(2.0 * Math.PI * i / length));
            w[i] = (float)Math.Sqrt(hann);
        }
        return w;
    }

    public void Dispose() => _session.Dispose();
}
