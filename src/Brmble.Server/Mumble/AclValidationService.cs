namespace Brmble.Server.Mumble;

public sealed class AclValidationService
{
    // Mumble's Listen ACL bit is not exposed by the generated MumbleServer constants.
    private const int PermissionListen = 0x800;

    private const int KnownPermissionMask =
        MumbleServer.PermissionWrite.value |
        MumbleServer.PermissionTraverse.value |
        MumbleServer.PermissionEnter.value |
        MumbleServer.PermissionSpeak.value |
        MumbleServer.PermissionWhisper.value |
        MumbleServer.PermissionTextMessage.value |
        MumbleServer.PermissionMakeChannel.value |
        MumbleServer.PermissionLinkChannel.value |
        MumbleServer.PermissionMove.value |
        MumbleServer.PermissionKick.value |
        MumbleServer.PermissionBan.value |
        MumbleServer.PermissionRegister.value |
        MumbleServer.PermissionRegisterSelf.value |
        MumbleServer.PermissionMakeTempChannel.value |
        PermissionListen |
        MumbleServer.PermissionMuteDeafen.value |
        MumbleServer.ResetUserContent.value;

    public (bool Valid, string? Error) ValidateUpdate(AclUpdateRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.ExpectedSnapshotHash))
        {
            return (false, "Expected snapshot hash is required.");
        }

        foreach (var group in request.Groups)
        {
            if (group.Inherited)
            {
                return (false, "Inherited groups cannot be submitted as local edits.");
            }

            if (string.IsNullOrWhiteSpace(group.Name))
            {
                return (false, "Group name cannot be empty.");
            }
        }

        foreach (var rule in request.Acls)
        {
            if (rule.Inherited)
            {
                return (false, "Inherited ACL rules cannot be submitted as local edits.");
            }

            if (rule.UserId is null && string.IsNullOrWhiteSpace(rule.Group))
            {
                return (false, "ACL rule must target a user id or selector.");
            }

            if (rule.UserId is not null && !string.IsNullOrWhiteSpace(rule.Group))
            {
                return (false, "ACL rule cannot target both a user id and selector.");
            }

            if (((rule.Allow | rule.Deny) & ~KnownPermissionMask) != 0)
            {
                return (false, "ACL rule contains unknown permission bits.");
            }
        }

        return (true, null);
    }
}
