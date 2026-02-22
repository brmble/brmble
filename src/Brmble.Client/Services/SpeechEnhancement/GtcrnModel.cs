using Microsoft.ML.OnnxRuntime;
using Microsoft.ML.OnnxRuntime.Tensors;

namespace Brmble.Client.Services.SpeechEnhancement;

/// <summary>
/// Wraps the GTCRN ONNX speech enhancement model.
/// The model operates in the STFT frequency domain and processes one frame at a time.
/// STFT parameters (n_fft=512, hop=256, window=hann_sqrt) are embedded in the model metadata.
/// Cache tensors are carried between frames for streaming/real-time use.
/// </summary>
/// <remarks>
/// Thread-safety: This class is not thread-safe. Each <see cref="GtcrnModel"/> instance is intended
/// to be used from a single thread (for example, the audio callback thread). If an instance is
/// accessed from multiple threads, callers must provide external synchronization.
/// </remarks>
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

    // Persistent input queue: accumulates samples across Process() calls so we
    // always drain in exact HopLength=256 increments — no raw samples ever spliced in.
    private readonly Queue<float> _inputQueue = new();

    // Analysis history: the last (WindowLength - HopLength) = 256 samples, used as
    // the look-back window for the next frame's STFT. Carried across Process() calls.
    private readonly float[] _analysisHistory; // length = WindowLength - HopLength

    // Output queue: collects enhanced samples; flushed back to caller in batches.
    private readonly Queue<float> _outputQueue = new();

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

        // Analysis look-back history (zeros = silence before first call)
        _analysisHistory = new float[WindowLength - HopLength];
    }

    /// <summary>
    /// Process a block of 16kHz normalized float samples.
    /// Internally accumulates samples across calls and processes in exact HopLength=256
    /// increments so no raw (unenhanced) samples are ever spliced into the output.
    /// Returns exactly as many enhanced samples as were consumed from the input queue
    /// (same length as input — there is one HopLength of latency on the very first call,
    /// after which output and input stay aligned).
    /// </summary>
    public float[] Process(float[] input16kHz)
    {
        if (input16kHz.Length == 0)
            return [];

        // Enqueue all new samples
        foreach (var s in input16kHz)
            _inputQueue.Enqueue(s);

        // Drain the input queue in HopLength=256 increments
        while (_inputQueue.Count >= HopLength)
        {
            // Dequeue exactly one hop
            var hop = new float[HopLength];
            for (int i = 0; i < HopLength; i++)
                hop[i] = _inputQueue.Dequeue();

            // Build analysis frame: [history (256 samples) | hop (256 samples)]
            var frame = new float[WindowLength];
            Array.Copy(_analysisHistory, 0, frame, 0, _analysisHistory.Length);
            Array.Copy(hop, 0, frame, _analysisHistory.Length, HopLength);

            // Slide history forward: new history = last 256 samples of the frame = the hop
            Array.Copy(hop, 0, _analysisHistory, 0, _analysisHistory.Length);

            // Apply analysis window
            var windowed = new float[WindowLength];
            for (int i = 0; i < WindowLength; i++)
                windowed[i] = frame[i] * _window[i];

            // STFT
            var (real, imag) = RealFFT(windowed);

            // Pack into model input [1, 257, 1, 2]
            var mix = new float[1 * NumBins * 1 * 2];
            for (int k = 0; k < NumBins; k++)
            {
                mix[k * 2 + 0] = real[k];
                mix[k * 2 + 1] = imag[k];
            }

            // Run model
            var (enhReal, enhImag) = RunModel(mix);

            // ISTFT: mirror spectrum and inverse FFT
            var enhSpecReal = new float[NFft];
            var enhSpecImag = new float[NFft];
            for (int k = 0; k < NumBins; k++)
            {
                enhSpecReal[k] = enhReal[k];
                enhSpecImag[k] = enhImag[k];
            }
            for (int k = 1; k < NFft / 2; k++)
            {
                enhSpecReal[NFft - k] =  enhSpecReal[k];
                enhSpecImag[NFft - k] = -enhSpecImag[k];
            }

            var timeDomain = IFFT(enhSpecReal, enhSpecImag);

            // Apply synthesis window
            var synthFrame = new float[WindowLength];
            for (int i = 0; i < WindowLength; i++)
                synthFrame[i] = timeDomain[i] * _olaWindow[i];

            // Overlap-add: output = front of OLA buffer + front of synthesis frame
            int overlap = WindowLength - HopLength;
            for (int i = 0; i < HopLength; i++)
                _outputQueue.Enqueue(_olaBuffer[i] + synthFrame[i]);

            // Shift OLA buffer and accumulate tail
            Array.Copy(_olaBuffer, HopLength, _olaBuffer, 0, overlap);
            Array.Clear(_olaBuffer, overlap, HopLength);
            for (int i = 0; i < overlap; i++)
                _olaBuffer[i] += synthFrame[HopLength + i];
        }

        // Return exactly input16kHz.Length samples from the output queue.
        // On the very first call the queue may have fewer than input.Length samples
        // (one hop of latency); pad with silence. After warmup it stays aligned.
        var output = new float[input16kHz.Length];
        for (int i = 0; i < output.Length; i++)
        {
            if (_outputQueue.Count > 0)
                output[i] = _outputQueue.Dequeue();
            // else: silence (zero) for the initial latency period
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
