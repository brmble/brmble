using Brmble.Audio.Processing;

namespace Brmble.Tools.ApmBench;

public record Args(string Input, string Output, NoiseSuppressionLevel NoiseSuppression, bool Metrics)
{
    public static Args Parse(string[] argv)
    {
        string? input = null, output = null, nsStr = null;
        bool metrics = false;

        for (int i = 0; i < argv.Length; i++)
        {
            switch (argv[i])
            {
                case "--in":
                    if (i + 1 >= argv.Length) throw new ArgumentException("--in requires a value");
                    input = argv[++i];
                    break;
                case "--out":
                    if (i + 1 >= argv.Length) throw new ArgumentException("--out requires a value");
                    output = argv[++i];
                    break;
                case "--ns":
                    if (i + 1 >= argv.Length) throw new ArgumentException("--ns requires a value");
                    nsStr = argv[++i];
                    break;
                case "--metrics":
                    metrics = true;
                    break;
                default:
                    throw new ArgumentException($"unknown flag: {argv[i]}");
            }
        }

        if (input == null || output == null || nsStr == null)
            throw new ArgumentException("required: --in <wav> --out <wav> --ns <off|low|moderate|high|veryhigh>");

        NoiseSuppressionLevel level = nsStr.ToLowerInvariant() switch
        {
            "off" => NoiseSuppressionLevel.Off,
            "low" => NoiseSuppressionLevel.Low,
            "moderate" => NoiseSuppressionLevel.Moderate,
            "high" => NoiseSuppressionLevel.High,
            "veryhigh" or "very-high" => NoiseSuppressionLevel.VeryHigh,
            _ => throw new ArgumentException($"unknown ns level: {nsStr}"),
        };

        return new Args(input, output, level, metrics);
    }
}
