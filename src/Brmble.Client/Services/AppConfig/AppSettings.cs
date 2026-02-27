namespace Brmble.Client.Services.AppConfig;

public record AudioSettings(
    string InputDevice = "default",
    string OutputDevice = "default",
    int InputVolume = 250,
    int MaxAmplification = 100,
    int OutputVolume = 250,
    string TransmissionMode = "voiceActivity",
    string? PushToTalkKey = null
);

public record ShortcutsSettings(
    string? ToggleMuteKey = null,
    string? ToggleMuteDeafenKey = null,
    string? ToggleLeaveVoiceKey = null,
    string? ToggleDMScreenKey = null
);

public record MessagesSettings(
    bool TtsEnabled = false,
    int TtsVolume = 100,
    bool NotificationsEnabled = true
);

public record OverlaySettings(
    bool OverlayEnabled = false
);

public record SpeechEnhancementSettings(
    bool Enabled = false,
    string Model = "dns3"
);

public record AppearanceSettings(
    string Theme = "classic"
);

public record AppSettings(
    AudioSettings Audio,
    ShortcutsSettings Shortcuts,
    MessagesSettings Messages,
    OverlaySettings Overlay,
    SpeechEnhancementSettings? SpeechEnhancement = null,
    bool AutoConnectEnabled = false,
    string? AutoConnectServerId = null,
    bool ReconnectEnabled = true,
    AppearanceSettings? Appearance = null
)
{
    public SpeechEnhancementSettings SpeechEnhancement { get; init; } = SpeechEnhancement ?? new SpeechEnhancementSettings();
    public AppearanceSettings Appearance { get; init; } = Appearance ?? new AppearanceSettings();

    public static AppSettings Default => new(
        new AudioSettings(),
        new ShortcutsSettings(),
        new MessagesSettings(),
        new OverlaySettings()
    );
}

public record WindowState(int X, int Y, int Width, int Height, bool IsMaximized);
