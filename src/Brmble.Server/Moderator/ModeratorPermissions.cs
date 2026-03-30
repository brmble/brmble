namespace Brmble.Server.Moderator;

[Flags]
public enum ModeratorPermission
{
    None = 0,
    Kick = 0x001,
    DenyEnter = 0x002,
    RenameChannel = 0x004,
    SetPassword = 0x008,
    EditDesc = 0x010,
}
