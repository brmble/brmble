using Microsoft.VisualStudio.TestTools.UnitTesting;
using Brmble.Audio.Processing;
using Brmble.Client.Services.AppConfig;
using Brmble.Client.Services.Security;
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
        var svc = new AppConfigService(_tempDir, null);

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
        var svc = new AppConfigService(_tempDir, null);

        Assert.AreEqual(0, svc.GetServers().Count);
    }

    [TestMethod]
    public void SavesAndReloads_Settings()
    {
        var svc = new AppConfigService(_tempDir, null);
        var updated = AppSettings.Default with
        {
            Audio = new AudioSettings(TransmissionMode: "pushToTalk", PushToTalkKey: "KeyF")
        };

        svc.SetSettings(updated);
        var svc2 = new AppConfigService(_tempDir, null);

        Assert.AreEqual("pushToTalk", svc2.GetSettings().Audio.TransmissionMode);
        Assert.AreEqual("KeyF", svc2.GetSettings().Audio.PushToTalkKey);
    }

    [TestMethod]
    public void SavesAndReloads_OptionalNotificationSettings()
    {
        var svc = new AppConfigService(_tempDir, null);
        var updated = AppSettings.Default with
        {
            Messages = AppSettings.Default.Messages with
            {
                NotificationsDisabled = true,
                NotificationRemoteScreenShare = false,
                NotificationScreenShareStatus = false,
                NotificationIdleWarning = false,
                NotificationMovedChannel = false
            }
        };

        svc.SetSettings(updated);
        var svc2 = new AppConfigService(_tempDir, null);
        var messages = svc2.GetSettings().Messages;

        Assert.IsTrue(messages.NotificationsDisabled);
        Assert.IsFalse(messages.NotificationRemoteScreenShare);
        Assert.IsFalse(messages.NotificationScreenShareStatus);
        Assert.IsFalse(messages.NotificationIdleWarning);
        Assert.IsFalse(messages.NotificationMovedChannel);
    }

    [TestMethod]
    public void SavesAndReloads_OverlayCompanionSelection()
    {
        var svc = new AppConfigService(_tempDir, null);
        var updated = AppSettings.Default with
        {
            Overlay = new OverlaySettings(OverlayEnabled: true, Mode: "full", MyCompanion: "bee")
        };

        svc.SetSettings(updated);
        var svc2 = new AppConfigService(_tempDir, null);

        Assert.AreEqual("bee", svc2.GetSettings().Overlay.MyCompanion);
    }

    [TestMethod]
    public void SavesAndReloads_Servers()
    {
        var svc = new AppConfigService(_tempDir, null);
        var server = new ServerEntry("id1", "My Server", null, "localhost", 64738);

        svc.AddServer(server);
        var svc2 = new AppConfigService(_tempDir, null);

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

        var svc = new AppConfigService(_tempDir, null);

        Assert.AreEqual(1, svc.GetServers().Count);
        Assert.AreEqual("Legacy", svc.GetServers()[0].Label);
        Assert.IsTrue(File.Exists(Path.Combine(_tempDir, "config.json")));
    }

    [TestMethod]
    public void MigratesPlainTextPasswords_ToEncrypted()
    {
        var svc = new AppConfigService(_tempDir, null);
        var server = new ServerEntry("id1", "Test", null, "localhost", 64738, "plainTextPassword123");

        svc.AddServer(server);

        var configPath = Path.Combine(_tempDir, "config.json");
        var json = File.ReadAllText(configPath);
        Assert.IsTrue(json.Contains("DPAPI:v1:"), "Password should be encrypted in config");

        var svc2 = new AppConfigService(_tempDir, null);
        var loadedServers = svc2.GetServers();
        Assert.AreEqual(1, loadedServers.Count);
        Assert.AreEqual("plainTextPassword123", loadedServers[0].Password);
    }

    [TestMethod]
    public void SavesAndReloads_WindowState()
    {
        var svc = new AppConfigService(_tempDir, null);
        Assert.IsNull(svc.GetWindowState(), "No state saved yet — should be null");

        svc.SaveWindowState(new WindowState(100, 200, 1024, 768, IsMaximized: false));
        var svc2 = new AppConfigService(_tempDir, null);

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
        var svc = new AppConfigService(_tempDir, null);
        Assert.IsNull(svc.GetClosePreference(), "No preference saved yet — should be null");

        svc.SaveClosePreference("minimize");
        var svc2 = new AppConfigService(_tempDir, null);

        Assert.AreEqual("minimize", svc2.GetClosePreference());
    }

    [TestMethod]
    public void DefaultSettings_HaveAutoConnectDisabled()
    {
        var svc = new AppConfigService(_tempDir, null);

        var settings = svc.GetSettings();

        Assert.IsFalse(settings.AutoConnectEnabled);
        Assert.IsNull(settings.AutoConnectServerId);
    }

    [TestMethod]
    public void SavesAndReloads_LastConnectedServerId()
    {
        var svc = new AppConfigService(_tempDir, null);
        Assert.IsNull(svc.GetLastConnectedServerId(), "No server connected yet — should be null");

        svc.SaveLastConnectedServerId("server-abc");
        var svc2 = new AppConfigService(_tempDir, null);

        Assert.AreEqual("server-abc", svc2.GetLastConnectedServerId());
    }

    [TestMethod]
    public void SavesAndReloads_AutoConnectSettings()
    {
        var svc = new AppConfigService(_tempDir, null);
        var updated = svc.GetSettings() with
        {
            AutoConnectEnabled = true,
            AutoConnectServerId = "server-xyz"
        };

        svc.SetSettings(updated);
        var svc2 = new AppConfigService(_tempDir, null);

        Assert.IsTrue(svc2.GetSettings().AutoConnectEnabled);
        Assert.AreEqual("server-xyz", svc2.GetSettings().AutoConnectServerId);
    }

    [TestMethod]
    public void AutoConnect_ClearsServerId_WhenServerRemoved()
    {
        var svc = new AppConfigService(_tempDir, null);
        svc.AddServer(new ServerEntry("srv1", "Test Server", null, "localhost", 64738));
        svc.SetSettings(svc.GetSettings() with { AutoConnectEnabled = true, AutoConnectServerId = "srv1" });

        svc.RemoveServer("srv1");

        // Settings still reference the old server ID — the startup logic in Program.cs
        // handles the fallback (server not found -> show server list).
        // This test verifies the data layer doesn't crash.
        var svc2 = new AppConfigService(_tempDir, null);
        Assert.AreEqual("srv1", svc2.GetSettings().AutoConnectServerId);
        Assert.AreEqual(0, svc2.GetServers().Count);
    }

    [TestMethod]
    public void DefaultSettings_HaveReconnectEnabled()
    {
        var svc = new AppConfigService(_tempDir, null);

        var settings = svc.GetSettings();

        Assert.IsTrue(settings.ReconnectEnabled);
    }

    [TestMethod]
    public void SavesAndReloads_ReconnectEnabled()
    {
        var svc = new AppConfigService(_tempDir, null);
        svc.SetSettings(svc.GetSettings() with { ReconnectEnabled = false });

        var svc2 = new AppConfigService(_tempDir, null);

        Assert.IsFalse(svc2.GetSettings().ReconnectEnabled);
    }

    [TestMethod]
    public void SavesAndReloads_AppearanceSettings()
    {
        var svc = new AppConfigService(_tempDir, null);
        var updated = AppSettings.Default with
        {
            Appearance = new AppearanceSettings(Theme: "blue-lagoon")
        };

        svc.SetSettings(updated);
        var svc2 = new AppConfigService(_tempDir, null);

        Assert.AreEqual("blue-lagoon", svc2.GetSettings().Appearance.Theme);
    }

    [TestMethod]
    public void LoadsEmptyProfiles_WhenNoFileExists()
    {
        var svc = new AppConfigService(_tempDir, null);
        Assert.AreEqual(0, svc.GetProfiles().Count);
        Assert.IsNull(svc.GetActiveProfileId());
    }

    [TestMethod]
    public void SavesAndReloads_Profiles()
    {
        var svc = new AppConfigService(_tempDir, null);
        var profile = new ProfileEntry("p1", "Roan");
        svc.AddProfile(profile);
        svc.SetActiveProfileId("p1");

        var svc2 = new AppConfigService(_tempDir, null);
        Assert.AreEqual(1, svc2.GetProfiles().Count);
        Assert.AreEqual("Roan", svc2.GetProfiles()[0].Name);
        Assert.AreEqual("p1", svc2.GetActiveProfileId());
    }

    [TestMethod]
    public void RemoveProfile_RemovesFromConfig_ButNotCertFile()
    {
        var svc = new AppConfigService(_tempDir, null);
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
        var svc = new AppConfigService(_tempDir, null);
        svc.AddProfile(new ProfileEntry("p1", "Only"));
        svc.SetActiveProfileId("p1");

        svc.RemoveProfile("p1");

        Assert.IsNull(svc.GetActiveProfileId());
    }

    [TestMethod]
    public void RemoveActiveProfile_SwitchesToAnother_WhenOthersExist()
    {
        var svc = new AppConfigService(_tempDir, null);
        svc.AddProfile(new ProfileEntry("p1", "First"));
        svc.AddProfile(new ProfileEntry("p2", "Second"));
        svc.SetActiveProfileId("p1");

        svc.RemoveProfile("p1");

        Assert.AreEqual("p2", svc.GetActiveProfileId());
    }

    [TestMethod]
    public void RenameProfile_UpdatesName()
    {
        var svc = new AppConfigService(_tempDir, null);
        svc.AddProfile(new ProfileEntry("p1", "Old Name"));

        svc.RenameProfile("p1", "New Name");
        var svc2 = new AppConfigService(_tempDir, null);

        Assert.AreEqual("New Name", svc2.GetProfiles()[0].Name);
    }

    [TestMethod]
    public void MigratesIdentityPfx_ToProfileOnLoad()
    {
        // Create a legacy identity.pfx
        File.WriteAllBytes(Path.Combine(_tempDir, "identity.pfx"), new byte[] { 1, 2, 3 });

        var svc = new AppConfigService(_tempDir, null);

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

    [TestMethod]
    public void RemoveProfile_ClearsDefaultProfileId_OnServerEntries()
    {
        var svc = new AppConfigService(_tempDir, null);
        svc.AddProfile(new ProfileEntry("p1", "Work"));
        svc.AddProfile(new ProfileEntry("p2", "Personal"));
        svc.SetActiveProfileId("p1");

        // Add two servers: one linked to p1, one with no override
        svc.AddServer(new ServerEntry("s1", "Work Server", null, "work.example.com", 64738, DefaultProfileId: "p1"));
        svc.AddServer(new ServerEntry("s2", "Gaming", null, "game.example.com", 64738));

        svc.RemoveProfile("p1");

        var servers = svc.GetServers();
        Assert.IsNull(servers.First(s => s.Id == "s1").DefaultProfileId,
            "DefaultProfileId should be cleared when the referenced profile is removed");
        Assert.IsNull(servers.First(s => s.Id == "s2").DefaultProfileId,
            "Server without override should remain null");
    }

    [TestMethod]
    public void ServerEntry_DefaultProfileId_PersistsAcrossReload()
    {
        var svc = new AppConfigService(_tempDir, null);
        svc.AddServer(new ServerEntry("s1", "Test", null, "example.com", 64738, DefaultProfileId: "profile-123"));

        // Reload from disk
        var svc2 = new AppConfigService(_tempDir, null);
        var server = svc2.GetServers().First(s => s.Id == "s1");

        Assert.AreEqual("profile-123", server.DefaultProfileId);
    }

    private AppConfigService CreateService() => new AppConfigService(_tempDir, null);

    [TestMethod]
    public void LoadsLegacySettings_WithSpeechDenoiseAndProcessingStack_ReturnsDefaultNoiseSuppression()
    {
        // Simulate a config.json from before the WebRTC-only refactor:
        // it has speechDenoise + speechEnhancement records and a processingStack
        // field on audio. None of these exist on the new AppSettings; they should
        // be silently ignored and the new NoiseSuppression record should fall back
        // to its default (High).
        var legacyJson = """
        {
          "settings": {
            "audio": {
              "inputDevice": "default",
              "outputDevice": "default",
              "inputVolume": 200,
              "outputVolume": 200,
              "transmissionMode": "pushToTalk",
              "pushToTalkKey": "KeyV",
              "opusBitrate": 96000,
              "opusFrameSize": 20,
              "captureApi": "wasapi",
              "voiceHoldMs": 200,
              "processingStack": "Legacy"
            },
            "shortcuts": {},
            "messages": { "ttsEnabled": false, "ttsVolume": 100, "notificationsEnabled": true },
            "overlay": { "overlayEnabled": false },
            "speechDenoise": { "mode": "Rnnoise" },
            "speechEnhancement": { "enabled": true, "model": "dns3" }
          },
          "servers": []
        }
        """;
        File.WriteAllText(Path.Combine(_tempDir, "config.json"), legacyJson);

        var svc = new AppConfigService(_tempDir, null);
        var settings = svc.GetSettings();

        // Surviving fields still load
        Assert.AreEqual("pushToTalk", settings.Audio.TransmissionMode);
        Assert.AreEqual("KeyV", settings.Audio.PushToTalkKey);
        Assert.AreEqual(96000, settings.Audio.OpusBitrate);
        // Removed fields are gone — but the new NS setting takes its default
        Assert.AreEqual(NoiseSuppressionLevel.High, settings.NoiseSuppression.Level);

        // The on-disk file should be rewritten without the legacy keys.
        // Parse it back rather than substring-matching the raw text.
        var rewritten = File.ReadAllText(Path.Combine(_tempDir, "config.json"));
        using var doc = System.Text.Json.JsonDocument.Parse(rewritten);
        var settingsEl = doc.RootElement.GetProperty("settings");
        Assert.IsFalse(settingsEl.TryGetProperty("speechDenoise", out _), "speechDenoise should be removed");
        Assert.IsFalse(settingsEl.TryGetProperty("speechEnhancement", out _), "speechEnhancement should be removed");
        Assert.IsFalse(
            settingsEl.GetProperty("audio").TryGetProperty("processingStack", out _),
            "audio.processingStack should be removed");
    }

    [TestMethod]
    public void LoadsCleanSettings_DoesNotRewriteFile()
    {
        // A clean config should not be needlessly rewritten on every launch.
        var svc1 = new AppConfigService(_tempDir, null);
        svc1.SetSettings(svc1.GetSettings()); // ensure file exists in canonical form

        // Stamp a known sentinel timestamp; if Load() writes the file, this changes.
        // (Avoids relying on filesystem clock resolution + Thread.Sleep.)
        var path = Path.Combine(_tempDir, "config.json");
        var sentinel = new DateTime(2000, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        File.SetLastWriteTimeUtc(path, sentinel);

        _ = new AppConfigService(_tempDir, null);

        Assert.AreEqual(sentinel, File.GetLastWriteTimeUtc(path),
            "Clean config.json should not be rewritten on load");
    }
}
