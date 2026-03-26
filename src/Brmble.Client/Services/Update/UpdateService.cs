using System.Text.Json;
using Velopack;
using Velopack.Sources;
using Brmble.Client.Bridge;

namespace Brmble.Client.Services.Update;

/// <summary>
/// Checks for application updates via GitHub Releases using Velopack.
/// Communicates update availability and progress to the frontend via NativeBridge.
/// </summary>
public class UpdateService : IService
{
    private const string RepoUrl = "https://github.com/brmble/brmble";
    private static readonly TimeSpan CheckInterval = TimeSpan.FromHours(4);

    private NativeBridge? _bridge;
    private UpdateManager? _updateManager;
    private UpdateInfo? _pendingUpdate;
    private System.Threading.Timer? _checkTimer;

    public string ServiceName => "app";

    public void Initialize(NativeBridge bridge)
    {
        _bridge = bridge;

        _updateManager = new UpdateManager(new GithubSource(RepoUrl, null, false));
        if (!_updateManager.IsInstalled)
        {
            // Not installed via Velopack (e.g. portable/dev mode) — skip updates
            _updateManager = null;
        }
    }

    public void RegisterHandlers(NativeBridge bridge)
    {
        bridge.RegisterHandler("app.applyUpdate", async _ =>
        {
            if (_pendingUpdate == null || _updateManager == null) return;
            _updateManager.ApplyUpdatesAndRestart(_pendingUpdate.TargetFullRelease);
        });

        bridge.RegisterHandler("app.dismissUpdate", _ =>
        {
            _pendingUpdate = null;
            return Task.CompletedTask;
        });

        bridge.RegisterHandler("app.checkForUpdate", async _ =>
        {
            await CheckForUpdatesAsync();
        });
    }

    /// <summary>
    /// Sends the current app version to the frontend.
    /// </summary>
    public void SendVersion()
    {
        if (_bridge == null) return;

        var version = _updateManager?.CurrentVersion?.ToString();
        _bridge.Send("app.version", new { version = version ?? "dev" });
    }

    /// <summary>
    /// Starts periodic update checks. Call after bridge is ready.
    /// </summary>
    public void StartPeriodicChecks()
    {
        if (_updateManager == null) return;

        // Check immediately on startup
        _ = CheckForUpdatesAsync();

        // Then check every 4 hours
        _checkTimer = new System.Threading.Timer(
            async _ => await CheckForUpdatesAsync(),
            null,
            CheckInterval,
            CheckInterval);
    }

    public void Dispose()
    {
        _checkTimer?.Dispose();
        _checkTimer = null;
    }

    private async Task CheckForUpdatesAsync()
    {
        if (_updateManager == null || _bridge == null) return;

        try
        {
            var updateInfo = await _updateManager.CheckForUpdatesAsync();
            if (updateInfo == null) return;

            // Download in background
            await _updateManager.DownloadUpdatesAsync(updateInfo, progress =>
            {
                _bridge.Send("app.updateProgress", new { progress });
                _bridge.NotifyUiThread();
            });

            _pendingUpdate = updateInfo;

            _bridge.Send("app.updateAvailable", new
            {
                version = updateInfo.TargetFullRelease.Version.ToString(),
            });
            _bridge.NotifyUiThread();
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[UpdateService] Check failed: {ex.Message}");
        }
    }
}
