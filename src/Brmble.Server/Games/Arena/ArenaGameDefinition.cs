using Brmble.Server.Games.Continuous;
using Brmble.Server.Games.Duels;

namespace Brmble.Server.Games.Arena;

public sealed class ArenaGameDefinition : IDuelGameDefinition, IContinuousGameDefinition
{
    public string GameType => "arena-knockoff";
    public string RunnerKey => "continuous";
    public int RulesetVersion => ArenaRulesetV1.Version;
    public ContinuousTiming Timing { get; } = new(
        ArenaRulesetV1.TickRate, ArenaRulesetV1.SnapshotEveryTicks, ArenaRulesetV1.MaxCatchUpTicks,
        InterpolationMs: 100, MaxExtrapolationMs: 50, InputHeartbeatMs: 250, NeutralAfterMs: 750, ReconnectGraceMs: 5_000);
    public object PredictionConstants => ArenaRulesetV1.PredictionConstants;

    public string? ValidateConfiguration(DuelConfiguration configuration) =>
        configuration.GameType != GameType
        || configuration.Format != "bo3"
        || configuration.RulesetVersion != ArenaRulesetV1.Version
        || configuration.Options.Count != 0
            ? "Arena configuration is not canonical."
            : null;

    public IReadOnlyDictionary<string, object?> NormalizeOptions(
        IReadOnlyDictionary<string, object?>? options)
    {
        if (options is { Count: > 0 })
            throw new InvalidGameConfigurationException("Arena options are not supported.");

        return new Dictionary<string, object?>();
    }

    public string MatchFormat(IReadOnlyDictionary<string, object?> normalizedOptions) => "bo3";

    public IContinuousSimulation Create(DuelReservation reservation) => new ArenaSimulation(reservation);
}
