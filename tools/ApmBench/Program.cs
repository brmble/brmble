using System.IO;
using Brmble.Audio.Processing;
using NAudio.Wave;

namespace Brmble.Tools.ApmBench;

public static class Program
{
    public static int Main(string[] argv)
    {
        Args args;
        try { args = Args.Parse(argv); }
        catch (ArgumentException ex) { Console.Error.WriteLine(ex.Message); return 2; }

        byte[] inputPcm;
        WaveFormat inputFormat;
        using (var reader = new WaveFileReader(args.Input))
        {
            if (reader.WaveFormat.SampleRate != 48000 ||
                reader.WaveFormat.Channels != 1 ||
                reader.WaveFormat.BitsPerSample != 16 ||
                reader.WaveFormat.Encoding != WaveFormatEncoding.Pcm)
            {
                Console.Error.WriteLine(
                    $"input must be 48 kHz mono 16-bit PCM; got " +
                    $"{reader.WaveFormat.SampleRate} Hz {reader.WaveFormat.Channels} ch " +
                    $"{reader.WaveFormat.BitsPerSample}-bit {reader.WaveFormat.Encoding}");
                return 3;
            }
            inputFormat = reader.WaveFormat;
            using var ms = new MemoryStream();
            reader.CopyTo(ms);
            inputPcm = ms.ToArray();
        }

        using var processor = new WebRtcApmProcessor(args.NoiseSuppression);

        byte[] outputPcm = new byte[inputPcm.Length + WebRtcApmProcessor.FrameBytes];
        int written = processor.Process(inputPcm, outputPcm);

        using (var writer = new WaveFileWriter(args.Output, inputFormat))
        {
            writer.Write(outputPcm, 0, written);
        }

        if (args.Metrics)
        {
            var inStats = Metrics.Measure(inputPcm);
            var outStats = Metrics.Measure(outputPcm.AsSpan(0, written));
            Console.WriteLine($"Input:    {inStats.RmsDbfs,6:F1} dBFS RMS   {inStats.PeakDbfs,6:F1} dBFS peak   {inStats.ClippedSamples} clipped samples");
            Console.WriteLine($"Output:   {outStats.RmsDbfs,6:F1} dBFS RMS   {outStats.PeakDbfs,6:F1} dBFS peak   {outStats.ClippedSamples} clipped samples");
            string rmsDelta = (outStats.RmsDbfs - inStats.RmsDbfs).ToString("+0.0;-0.0;0.0");
            string peakDelta = (outStats.PeakDbfs - inStats.PeakDbfs).ToString("+0.0;-0.0;0.0");
            Console.WriteLine($"Delta:    {rmsDelta,6} dB RMS      {peakDelta,6} dB peak");
            double ms = inStats.SampleCount / 48.0;
            Console.WriteLine($"Frames:   {inStats.SampleCount / 480} ({ms:F0} ms)  NS: {args.NoiseSuppression}");
        }
        return 0;
    }
}
