using Brmble.Audio.Processing;

namespace Brmble.Tools.ApmBench;

public record Args(string Input, string Output, ProcessingStack Stack, bool Metrics)
{
    public static Args Parse(string[] argv)
    {
        string? input = null, output = null, stackStr = null;
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
                case "--stack":
                    if (i + 1 >= argv.Length) throw new ArgumentException("--stack requires a value");
                    stackStr = argv[++i];
                    break;
                case "--metrics":
                    metrics = true;
                    break;
                default:
                    throw new ArgumentException($"unknown flag: {argv[i]}");
            }
        }

        if (input == null || output == null || stackStr == null)
            throw new ArgumentException("required: --in <wav> --out <wav> --stack <none|legacy|apm>");

        ProcessingStack stack = stackStr.ToLowerInvariant() switch
        {
            "none" => ProcessingStack.None,
            "legacy" => ProcessingStack.Legacy,
            "apm" or "webrtcapm" => ProcessingStack.WebRtcApm,
            _ => throw new ArgumentException($"unknown stack: {stackStr}"),
        };

        return new Args(input, output, stack, metrics);
    }
}
