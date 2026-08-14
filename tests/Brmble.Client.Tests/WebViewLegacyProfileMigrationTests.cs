using Brmble.Client;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests;

[TestClass]
public sealed class WebViewLegacyProfileMigrationTests
{
    private readonly List<string> _temporaryDirectories = [];

    [TestCleanup]
    public void Cleanup()
    {
        foreach (var directory in _temporaryDirectories)
        {
            try { Directory.Delete(directory, recursive: true); } catch { }
        }
    }

    [TestMethod]
    public void DoesNothingWhenStableProfileAlreadyExists()
    {
        var root = CreateTemporaryDirectory();
        var stable = Path.Combine(root, "stable");
        var legacy = Path.Combine(root, "legacy");
        Directory.CreateDirectory(stable);
        Directory.CreateDirectory(legacy);
        File.WriteAllText(Path.Combine(legacy, "legacy-marker"), "legacy");

        var migrated = WebViewLegacyProfileMigration.TryMigrate(stable, [legacy]);

        Assert.IsTrue(migrated);
        Assert.IsFalse(File.Exists(Path.Combine(stable, "legacy-marker")));
    }

    [TestMethod]
    public void CopiesOnlyFromAnExistingKnownLegacyProfile()
    {
        var root = CreateTemporaryDirectory();
        var stable = Path.Combine(root, "stable");
        var legacy = Path.Combine(root, "legacy");
        Directory.CreateDirectory(legacy);
        File.WriteAllText(Path.Combine(legacy, "legacy-marker"), "legacy");

        var migrated = WebViewLegacyProfileMigration.TryMigrate(stable, [legacy]);

        Assert.IsTrue(migrated);
        Assert.AreEqual("legacy", File.ReadAllText(Path.Combine(stable, "legacy-marker")));
        Assert.IsTrue(File.Exists(Path.Combine(legacy, "legacy-marker")));
    }

    [TestMethod]
    public void DoesNotDeleteLegacyProfileWhenCopyFails()
    {
        var root = CreateTemporaryDirectory();
        var stable = Path.Combine(root, "stable");
        var legacy = Path.Combine(root, "legacy");
        Directory.CreateDirectory(legacy);
        File.WriteAllText(Path.Combine(legacy, "legacy-marker"), "legacy");
        File.WriteAllText(stable, "not a directory");

        var migrated = WebViewLegacyProfileMigration.TryMigrate(stable, [legacy]);

        Assert.IsFalse(migrated);
        Assert.IsTrue(File.Exists(Path.Combine(legacy, "legacy-marker")));
    }

    [TestMethod]
    public void MissingLegacyProfilesAreAQuietNoOp()
    {
        var root = CreateTemporaryDirectory();
        var stable = Path.Combine(root, "stable");

        var migrated = WebViewLegacyProfileMigration.TryMigrate(
            stable,
            [Path.Combine(root, "missing")]);

        Assert.IsTrue(migrated);
        Assert.IsFalse(Directory.Exists(stable));
    }

    private string CreateTemporaryDirectory()
    {
        var directory = Path.Combine(Path.GetTempPath(), "brmble-webview-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        _temporaryDirectories.Add(directory);
        return directory;
    }
}
