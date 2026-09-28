using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Games.Continuous;

/// <summary>
/// The continuous coordinator, endpoint and contracts are game-agnostic: nothing under
/// Games/Continuous may name the arena. A second continuous game trips over every
/// such leak, so the boundary is pinned by reading the source.
/// </summary>
[TestClass]
public class ContinuousBoundaryTests
{
    [TestMethod]
    public void NothingUnderGamesContinuousNamesTheArena()
    {
        var root = FindRepositoryRoot();
        var folder = Path.Combine(root, "src", "Brmble.Server", "Games", "Continuous");
        Assert.IsTrue(Directory.Exists(folder), $"expected {folder}");

        var leaks = Directory.GetFiles(folder, "*.cs", SearchOption.AllDirectories)
            .SelectMany(file => File.ReadLines(file)
                .Select((line, index) => (file, line, number: index + 1))
                .Where(x => x.line.Contains("Arena", StringComparison.Ordinal)))
            .Select(x => $"{Path.GetRelativePath(root, x.file)}:{x.number}: {x.line.Trim()}")
            .ToArray();

        Assert.AreEqual(0, leaks.Length,
            "Games/Continuous must not name the arena:\n" + string.Join('\n', leaks));
    }

    private static string FindRepositoryRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "Brmble.sln"))
               && !Directory.Exists(Path.Combine(directory.FullName, "src", "Brmble.Server")))
            directory = directory.Parent;
        Assert.IsNotNull(directory, "could not find the repository root above the test binaries");
        return directory.FullName;
    }
}
