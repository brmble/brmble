using Brmble.Server.Data;
using Brmble.Server.Games;

namespace Brmble.Server.Tests.Games;

internal static class GameTestHelpers
{
    public static GameRepository NewRepo()
    {
        var path = Path.Combine(Path.GetTempPath(), $"brmble-test-{Guid.NewGuid():N}.db");
        var db = new Database($"Data Source={path}");
        db.Initialize();
        return new GameRepository(db);
    }

    public static (GameRepository repo, Database db) NewRepoWithDb()
    {
        var path = Path.Combine(Path.GetTempPath(), $"brmble-test-{Guid.NewGuid():N}.db");
        var db = new Database($"Data Source={path}");
        db.Initialize();
        return (new GameRepository(db), db);
    }
}
