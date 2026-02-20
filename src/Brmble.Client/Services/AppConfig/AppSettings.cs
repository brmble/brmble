namespace Brmble.Client.Services.AppConfig;

public record AudioSettings(
    string InputDevice = "default",
    string OutputDevice = "default",
    int InputVolume = 100,
    int OutputVolume = 100,
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

public record AppSettings(
    AudioSettings Audio,
    ShortcutsSettings Shortcuts,
    MessagesSettings Messages,
    OverlaySettings Overlay
)
{
    public static AppSettings Default => new(
        new AudioSettings(),
        new ShortcutsSettings(),
        new MessagesSettings(),
        new OverlaySettings()
    );
}
