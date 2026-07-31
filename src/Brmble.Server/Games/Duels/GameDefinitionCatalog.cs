namespace Brmble.Server.Games.Duels;

public sealed class GameDefinitionCatalog
{
    private readonly IReadOnlyDictionary<string, IDuelGameDefinition> _definitions;

    public GameDefinitionCatalog(IEnumerable<IDuelGameDefinition> definitions) =>
        _definitions = definitions.ToDictionary(x => x.GameType, StringComparer.OrdinalIgnoreCase);

    public DuelConfiguration Create(string gameType, IReadOnlyDictionary<string, object?>? options)
    {
        if (!_definitions.TryGetValue(gameType, out var definition))
            throw new InvalidGameConfigurationException($"Unknown game type '{gameType}'.");

        var normalized = definition.NormalizeOptions(options);
        return new DuelConfiguration(
            definition.GameType,
            definition.MatchFormat(normalized),
            definition.RulesetVersion,
            normalized,
            definition.RunnerKey);
    }
}

public sealed class InvalidGameConfigurationException : Exception
{
    public InvalidGameConfigurationException(string message) : base(message) { }
}
