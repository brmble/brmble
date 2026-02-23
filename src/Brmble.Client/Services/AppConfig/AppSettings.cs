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
    string? ToggleDeafenKey = null,
    string? ToggleMuteDeafenKey = null
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

public record AppSettings(
    AudioSettings Audio,
    ShortcutsSettings Shortcuts,
    MessagesSettings Messages,
    OverlaySettings Overlay,
    SpeechEnhancementSettings? SpeechEnhancement = null,
    bool AutoConnectEnabled = false,
    string? AutoConnectServerId = null
)
{
    public SpeechEnhancementSettings SpeechEnhancement { get; init; } = SpeechEnhancement ?? new SpeechEnhancementSettings();

    public static AppSettings Default => new(
        new AudioSettings(),
        new ShortcutsSettings(),
        new MessagesSettings(),
        new OverlaySettings()
    );
}

public record WindowState(int X, int Y, int Width, int Height, bool IsMaximized);
