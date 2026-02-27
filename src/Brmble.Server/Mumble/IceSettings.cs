namespace Brmble.Server.Mumble;

public class IceSettings
{
    public string Host { get; init; } = "mumble-server";
    public int Port { get; init; } = 6502;
    public string Secret { get; init; } = string.Empty;
    public string? CallbackHost { get; init; }
}
