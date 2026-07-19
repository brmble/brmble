using Brmble.Audio.Processing;

namespace Brmble.Client.Services.AppConfig;

public record AudioSettings(
    string InputDevice = "default",
    string OutputDevice = "default",
    int InputVolume = 250,
    int OutputVolume = 250,
    string TransmissionMode = "voiceActivity",
    string? PushToTalkKey = null,
    int OpusBitrate = 72000,
    int OpusFrameSize = 20,
    string CaptureApi = "wasapi",
    int VoiceHoldMs = 200,
    string VadSensitivity = "balanced"
);

public record ShortcutsSettings(
    string? ToggleMuteKey = null,
    string? ToggleMuteDeafenKey = null,
    string? ToggleLeaveVoiceKey = null,
    string? ToggleDMScreenKey = null,
    string? ToggleScreenShareKey = null,
    string? ToggleGameKey = null
);

public record MessagesSettings(
    bool TtsEnabled = false,
    int TtsVolume = 100,
    string TtsVoice = "",
    bool NotificationsEnabled = true,
    bool NotificationsDisabled = false,
    bool NotificationRemoteScreenShare = true,
    bool NotificationScreenShareStatus = true,
    bool NotificationIdleWarning = true,
    bool NotificationMovedChannel = true
);

public record OverlaySettings(
    bool OverlayEnabled = false,
    string Mode = "minimal",
    string Position = "bottom-right",
    string MyCompanion = "floppy",
    bool ShowChannelMessages = true,
    bool ShowDirectMessages = true,
    bool ShowJoinLeaveEvents = true,
    bool ShowModerationEvents = true,
    bool ShowActiveSpeakers = true
);

public record NoiseSuppressionSettings(
    NoiseSuppressionLevel Level = NoiseSuppressionLevel.High
);

public record AppearanceSettings(
    string Theme = "classic"
);

public record ScreenShareSettings(
    bool CaptureAudio = true,
    string Resolution = "1080p",
    int Fps = 30,
    bool SystemAudio = false,
    string ViewerMode = "in-app",
    string PreferredCaptureSource = "window",
    string ContentType = "motion"
);

public record AppSettings(
    AudioSettings? Audio = null,
    ShortcutsSettings? Shortcuts = null,
    MessagesSettings? Messages = null,
    OverlaySettings? Overlay = null,
    NoiseSuppressionSettings? NoiseSuppression = null,
    bool AutoConnectEnabled = false,
    string? AutoConnectServerId = null,
    bool ReconnectEnabled = true,
    bool RememberLastChannel = true,
    AppearanceSettings? Appearance = null,
    ScreenShareSettings? ScreenShare = null
)
{
    // JSON from the frontend (settings.set) or an older config.json may omit
    // entire sections or carry explicit nulls; never expose a null section.
    public AudioSettings Audio { get; init; } = Audio ?? new AudioSettings();
    public ShortcutsSettings Shortcuts { get; init; } = Shortcuts ?? new ShortcutsSettings();
    public MessagesSettings Messages { get; init; } = Messages ?? new MessagesSettings();
    public OverlaySettings Overlay { get; init; } = Overlay ?? new OverlaySettings();

    public NoiseSuppressionSettings NoiseSuppression { get; init; } = NoiseSuppression ?? new NoiseSuppressionSettings();
    public AppearanceSettings Appearance { get; init; } = Appearance ?? new AppearanceSettings();
    public ScreenShareSettings ScreenShare { get; init; } = ScreenShare ?? new ScreenShareSettings();

    public static AppSettings Default => new(
        new AudioSettings(),
        new ShortcutsSettings(),
        new MessagesSettings(),
        new OverlaySettings()
    );
}

public record WindowState(int X, int Y, int Width, int Height, bool IsMaximized);
