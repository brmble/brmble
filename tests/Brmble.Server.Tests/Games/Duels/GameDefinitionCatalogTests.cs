using Brmble.Server.Games.Duels;
using Brmble.Server.Games.Engines;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Games.Duels;

[TestClass]
public sealed class GameDefinitionCatalogTests
{
    [TestMethod]
    public void Create_RpsBestOfFive_ReturnsCanonicalConfiguration()
    {
        var catalog = new GameDefinitionCatalog([new DeathrollEngine(), new RpsEngine()]);

        var result = catalog.Create("rps", new Dictionary<string, object?> { ["bestOf"] = 5L });

        Assert.AreEqual("bo5", result.Format);
        Assert.AreEqual(1, result.RulesetVersion);
        Assert.AreEqual(5, result.Options["bestOf"]);
        Assert.IsInstanceOfType<int>(result.Options["bestOf"]);
    }

    [TestMethod]
    public void Create_InvalidRpsBestOf_ThrowsStableValidationError()
    {
        var catalog = new GameDefinitionCatalog([new RpsEngine()]);

        var ex = Assert.ThrowsException<InvalidGameConfigurationException>(() =>
            catalog.Create("rps", new Dictionary<string, object?> { ["bestOf"] = 9 }));

        Assert.AreEqual("RPS bestOf must be 3, 5, or 7.", ex.Message);
    }

    [TestMethod]
    public void Create_ContinuousDefinition_IsAdmittedWithoutIGameEngine()
    {
        IDuelGameDefinition arena = new FakeDefinition("arena-knockoff", "continuous", "bo3", 2);

        var result = new GameDefinitionCatalog([arena]).Create("ARENA-KNOCKOFF", null);

        Assert.AreEqual("continuous", result.RunnerKey);
        Assert.AreEqual(2, result.RulesetVersion);
    }

    private sealed record FakeDefinition(string GameType, string RunnerKey, string Format, int RulesetVersion)
        : IDuelGameDefinition
    {
        public IReadOnlyDictionary<string, object?> NormalizeOptions(IReadOnlyDictionary<string, object?>? options) =>
            new Dictionary<string, object?>();

        public string MatchFormat(IReadOnlyDictionary<string, object?> normalizedOptions) => Format;
    }
}
