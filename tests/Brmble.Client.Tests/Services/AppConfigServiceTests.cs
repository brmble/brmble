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
}
