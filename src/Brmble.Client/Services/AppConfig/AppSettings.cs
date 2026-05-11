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
    bool NotificationsEnabled = true
);

public record OverlaySettings(
    bool OverlayEnabled = false,
    string Mode = "minimal",
    string Position = "bottom-right",
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

public record AppSettings(
    AudioSettings Audio,
    ShortcutsSettings Shortcuts,
    MessagesSettings Messages,
    OverlaySettings Overlay,
    NoiseSuppressionSettings? NoiseSuppression = null,
    bool AutoConnectEnabled = false,
    string? AutoConnectServerId = null,
    bool ReconnectEnabled = true,
    bool RememberLastChannel = true,
    AppearanceSettings? Appearance = null
)
{
    public NoiseSuppressionSettings NoiseSuppression { get; init; } = NoiseSuppression ?? new NoiseSuppressionSettings();
    public AppearanceSettings Appearance { get; init; } = Appearance ?? new AppearanceSettings();

    public static AppSettings Default => new(
        new AudioSettings(),
        new ShortcutsSettings(),
        new MessagesSettings(),
        new OverlaySettings()
    );
}

public record WindowState(int X, int Y, int Width, int Height, bool IsMaximized);
