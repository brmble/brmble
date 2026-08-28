using Brmble.Server.Games.Continuous;
using Brmble.Server.Games.Duels;

namespace Brmble.Server.Games.Arena;

public sealed class ArenaGameDefinition : IDuelGameDefinition, IContinuousGameDefinition
{
    public string GameType => "arena-knockoff";
    public string RunnerKey => "continuous";
    public int RulesetVersion => ArenaRulesetV1.Version;
    public object PredictionConstants => ArenaRulesetV1.PredictionConstants;

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
