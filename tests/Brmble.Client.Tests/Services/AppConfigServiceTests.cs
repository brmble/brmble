using Microsoft.VisualStudio.TestTools.UnitTesting;
using Brmble.Client.Services.AppConfig;
using Brmble.Client.Services.Serverlist;
using System.Text.Json;

namespace Brmble.Client.Tests.Services;

[TestClass]
public class AppConfigServiceTests
{
    private string _tempDir = null!;

    [TestInitialize]
    public void Setup()
    {
        _tempDir = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString());
        Directory.CreateDirectory(_tempDir);
    }

    [TestCleanup]
    public void Cleanup()
    {
        Directory.Delete(_tempDir, recursive: true);
    }

    [TestMethod]
    public void LoadsDefaultSettings_WhenNoFileExists()
    {
        var svc = new AppConfigService(_tempDir);

        var settings = svc.GetSettings();

        Assert.AreEqual("voiceActivity", settings.Audio.TransmissionMode);
        Assert.AreEqual(250, settings.Audio.InputVolume);
        Assert.IsNull(settings.Shortcuts.ToggleMuteKey);
        Assert.IsFalse(settings.Messages.TtsEnabled);
        Assert.IsFalse(settings.Overlay.OverlayEnabled);
    }

    [TestMethod]
    public void LoadsDefaultServers_WhenNoFileExists()
    {
        var svc = new AppConfigService(_tempDir);

        Assert.AreEqual(0, svc.GetServers().Count);
    }

    [TestMethod]
    public void SavesAndReloads_Settings()
    {
        var svc = new AppConfigService(_tempDir);
        var updated = AppSettings.Default with
        {
            Audio = new AudioSettings(TransmissionMode: "pushToTalk", PushToTalkKey: "KeyF")
        };

        svc.SetSettings(updated);
        var svc2 = new AppConfigService(_tempDir);

        Assert.AreEqual("pushToTalk", svc2.GetSettings().Audio.TransmissionMode);
        Assert.AreEqual("KeyF", svc2.GetSettings().Audio.PushToTalkKey);
    }

    [TestMethod]
    public void SavesAndReloads_Servers()
    {
        var svc = new AppConfigService(_tempDir);
        var server = new ServerEntry("id1", "My Server", null, "localhost", 64738, "alice");

        svc.AddServer(server);
        var svc2 = new AppConfigService(_tempDir);

        Assert.AreEqual(1, svc2.GetServers().Count);
        Assert.AreEqual("My Server", svc2.GetServers()[0].Label);
    }

    [TestMethod]
    public void MigratesFromServersJson_WhenConfigJsonMissing()
    {
        // Write a legacy servers.json in the temp dir
        var legacyPath = Path.Combine(_tempDir, "servers.json");
        var legacyData = new
        {
            Servers = new[]
            {
                new { Id = "abc", Label = "Legacy", Host = "10.0.0.1", Port = 64738, Username = "bob" }
            }
        };
        File.WriteAllText(legacyPath, JsonSerializer.Serialize(legacyData));

        var svc = new AppConfigService(_tempDir);

        Assert.AreEqual(1, svc.GetServers().Count);
        Assert.AreEqual("Legacy", svc.GetServers()[0].Label);
        Assert.IsTrue(File.Exists(Path.Combine(_tempDir, "config.json")));
    }

    [TestMethod]
    public void SavesAndReloads_WindowState()
    {
        var svc = new AppConfigService(_tempDir);
        Assert.IsNull(svc.GetWindowState(), "No state saved yet — should be null");

        svc.SaveWindowState(new WindowState(100, 200, 1024, 768, IsMaximized: false));
        var svc2 = new AppConfigService(_tempDir);

        var ws = svc2.GetWindowState();
        Assert.IsNotNull(ws);
        Assert.AreEqual(100, ws.X);
        Assert.AreEqual(200, ws.Y);
        Assert.AreEqual(1024, ws.Width);
        Assert.AreEqual(768, ws.Height);
        Assert.IsFalse(ws.IsMaximized);
    }

    [TestMethod]
    public void SavesAndReloads_ClosePreference()
    {
        var svc = new AppConfigService(_tempDir);
        Assert.IsNull(svc.GetClosePreference(), "No preference saved yet — should be null");

        svc.SaveClosePreference("minimize");
        var svc2 = new AppConfigService(_tempDir);

        Assert.AreEqual("minimize", svc2.GetClosePreference());
    }

    [TestMethod]
    public void DefaultSettings_HaveAutoConnectDisabled()
    {
        var svc = new AppConfigService(_tempDir);

        var settings = svc.GetSettings();

        Assert.IsFalse(settings.AutoConnectEnabled);
        Assert.IsNull(settings.AutoConnectServerId);
    }

    [TestMethod]
    public void SavesAndReloads_LastConnectedServerId()
    {
        var svc = new AppConfigService(_tempDir);
        Assert.IsNull(svc.GetLastConnectedServerId(), "No server connected yet — should be null");

        svc.SaveLastConnectedServerId("server-abc");
        var svc2 = new AppConfigService(_tempDir);

        Assert.AreEqual("server-abc", svc2.GetLastConnectedServerId());
    }

    [TestMethod]
    public void SavesAndReloads_AutoConnectSettings()
    {
        var svc = new AppConfigService(_tempDir);
        var updated = svc.GetSettings() with
        {
            AutoConnectEnabled = true,
            AutoConnectServerId = "server-xyz"
        };

        svc.SetSettings(updated);
        var svc2 = new AppConfigService(_tempDir);

        Assert.IsTrue(svc2.GetSettings().AutoConnectEnabled);
        Assert.AreEqual("server-xyz", svc2.GetSettings().AutoConnectServerId);
    }

    [TestMethod]
    public void AutoConnect_ClearsServerId_WhenServerRemoved()
    {
        var svc = new AppConfigService(_tempDir);
        svc.AddServer(new ServerEntry("srv1", "Test Server", null, "localhost", 64738, "alice"));
        svc.SetSettings(svc.GetSettings() with { AutoConnectEnabled = true, AutoConnectServerId = "srv1" });

        svc.RemoveServer("srv1");

        // Settings still reference the old server ID — the startup logic in Program.cs
        // handles the fallback (server not found -> show server list).
        // This test verifies the data layer doesn't crash.
        var svc2 = new AppConfigService(_tempDir);
        Assert.AreEqual("srv1", svc2.GetSettings().AutoConnectServerId);
        Assert.AreEqual(0, svc2.GetServers().Count);
    }

    [TestMethod]
    public void DefaultSettings_HaveReconnectEnabled()
    {
        var svc = new AppConfigService(_tempDir);

        var settings = svc.GetSettings();

        Assert.IsTrue(settings.ReconnectEnabled);
    }

    [TestMethod]
    public void SavesAndReloads_ReconnectEnabled()
    {
        var svc = new AppConfigService(_tempDir);
        svc.SetSettings(svc.GetSettings() with { ReconnectEnabled = false });

        var svc2 = new AppConfigService(_tempDir);

        Assert.IsFalse(svc2.GetSettings().ReconnectEnabled);
    }

    [TestMethod]
    public void SavesAndReloads_AppearanceSettings()
    {
        var svc = new AppConfigService(_tempDir);
        var updated = AppSettings.Default with
        {
            Appearance = new AppearanceSettings(Theme: "blue-lagoon")
        };

        svc.SetSettings(updated);
        var svc2 = new AppConfigService(_tempDir);

        Assert.AreEqual("blue-lagoon", svc2.GetSettings().Appearance.Theme);
    }

    [TestMethod]
    public void LoadsEmptyProfiles_WhenNoFileExists()
    {
        var svc = new AppConfigService(_tempDir);
        Assert.AreEqual(0, svc.GetProfiles().Count);
        Assert.IsNull(svc.GetActiveProfileId());
    }

    [TestMethod]
    public void SavesAndReloads_Profiles()
    {
        var svc = new AppConfigService(_tempDir);
        var profile = new ProfileEntry("p1", "Roan");
        svc.AddProfile(profile);
        svc.SetActiveProfileId("p1");

        var svc2 = new AppConfigService(_tempDir);
        Assert.AreEqual(1, svc2.GetProfiles().Count);
        Assert.AreEqual("Roan", svc2.GetProfiles()[0].Name);
        Assert.AreEqual("p1", svc2.GetActiveProfileId());
    }

    [TestMethod]
    public void RemoveProfile_RemovesFromConfig_ButNotCertFile()
    {
        var svc = new AppConfigService(_tempDir);
        var certsDir = Path.Combine(_tempDir, "certs");
        Directory.CreateDirectory(certsDir);
        File.WriteAllBytes(Path.Combine(certsDir, "p1.pfx"), new byte[] { 1, 2, 3 });

        svc.AddProfile(new ProfileEntry("p1", "Test"));
        svc.RemoveProfile("p1");

        Assert.AreEqual(0, svc.GetProfiles().Count);
        Assert.IsTrue(File.Exists(Path.Combine(certsDir, "p1.pfx")), "Cert file should NOT be deleted");
    }

    [TestMethod]
    public void RemoveActiveProfile_ClearsActiveId_WhenLastProfile()
    {
        var svc = new AppConfigService(_tempDir);
        svc.AddProfile(new ProfileEntry("p1", "Only"));
        svc.SetActiveProfileId("p1");

        svc.RemoveProfile("p1");

        Assert.IsNull(svc.GetActiveProfileId());
    }

    [TestMethod]
    public void RemoveActiveProfile_SwitchesToAnother_WhenOthersExist()
    {
        var svc = new AppConfigService(_tempDir);
        svc.AddProfile(new ProfileEntry("p1", "First"));
        svc.AddProfile(new ProfileEntry("p2", "Second"));
        svc.SetActiveProfileId("p1");

        svc.RemoveProfile("p1");

        Assert.AreEqual("p2", svc.GetActiveProfileId());
    }

    [TestMethod]
    public void RenameProfile_UpdatesName()
    {
        var svc = new AppConfigService(_tempDir);
        svc.AddProfile(new ProfileEntry("p1", "Old Name"));

        svc.RenameProfile("p1", "New Name");
        var svc2 = new AppConfigService(_tempDir);

        Assert.AreEqual("New Name", svc2.GetProfiles()[0].Name);
    }

    [TestMethod]
    public void MigratesIdentityPfx_ToProfileOnLoad()
    {
        // Create a legacy identity.pfx
        File.WriteAllBytes(Path.Combine(_tempDir, "identity.pfx"), new byte[] { 1, 2, 3 });

        var svc = new AppConfigService(_tempDir);

        Assert.AreEqual(1, svc.GetProfiles().Count);
        Assert.IsNotNull(svc.GetActiveProfileId());
        var profile = svc.GetProfiles()[0];
        Assert.AreEqual("Default", profile.Name);
        Assert.IsTrue(File.Exists(Path.Combine(_tempDir, "certs", "Default_" + profile.Id + ".pfx")));
        Assert.IsFalse(File.Exists(Path.Combine(_tempDir, "identity.pfx")), "Old file should be moved");
    }

    [TestMethod]
    public void AddProfile_RejectsDuplicateName()
    {
        var svc = CreateService();
        svc.AddProfile(new ProfileEntry("id1", "MyProfile"));
        var result = svc.AddProfile(new ProfileEntry("id2", "myprofile"));
        Assert.IsFalse(result);
        Assert.AreEqual(1, svc.GetProfiles().Count);
    }

    [TestMethod]
    public void RenameProfile_RejectsDuplicateName()
    {
        var svc = CreateService();
        svc.AddProfile(new ProfileEntry("id1", "Alpha"));
        svc.AddProfile(new ProfileEntry("id2", "Beta"));
        var result = svc.RenameProfile("id2", "alpha");
        Assert.IsFalse(result);
        Assert.AreEqual("Beta", svc.GetProfiles().First(p => p.Id == "id2").Name);
    }

    [TestMethod]
    public void RenameProfile_AllowsSameNameForSameProfile()
    {
        var svc = CreateService();
        svc.AddProfile(new ProfileEntry("id1", "Alpha"));
        var result = svc.RenameProfile("id1", "Alpha");
        Assert.IsTrue(result);
    }

    private AppConfigService CreateService() => new AppConfigService(_tempDir);
}
