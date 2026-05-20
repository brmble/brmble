namespace Brmble.Server.Mumble;

public static class AclMapper
{
    public static AclChannelSnapshotDto FromIce(
        int channelId,
        MumbleServer.Server_GetACLResult result,
        DateTimeOffset fetchedAt,
        bool stale,
        string? warning)
    {
        return new AclChannelSnapshotDto(
            ChannelId: channelId,
            InheritAcls: result.inherit,
            Groups: result.groups.Select(ToDto).ToArray(),
            Acls: result.acls.Select(ToDto).ToArray(),
            FetchedAt: fetchedAt,
            Stale: stale,
            Warning: warning);
    }

    public static (MumbleServer.ACL[] Acls, MumbleServer.Group[] Groups, bool Inherit) ToIce(AclUpdateRequest request)
    {
        var acls = request.Acls
            .Where(rule => !rule.Inherited)
            .Select(ToIce)
            .ToArray();

        var groups = request.Groups
            .Where(group => !group.Inherited)
            .Select(ToIce)
            .ToArray();

        return (acls, groups, request.InheritAcls);
    }

    private static AclRuleDto ToDto(MumbleServer.ACL acl)
    {
        return new AclRuleDto(
            ApplyHere: acl.applyHere,
            ApplySubs: acl.applySubs,
            Inherited: acl.inherited,
            UserId: acl.userid >= 0 ? acl.userid : null,
            Group: acl.userid >= 0 ? null : acl.group,
            Allow: acl.allow,
            Deny: acl.deny);
    }

    private static AclGroupDto ToDto(MumbleServer.Group group)
    {
        return new AclGroupDto(
            Name: group.name,
            Inherited: group.inherited,
            Inherit: group.inherit,
            Inheritable: group.inheritable,
            Add: group.add,
            Remove: group.remove,
            Members: group.members);
    }

    private static MumbleServer.ACL ToIce(AclRuleDto rule)
    {
        var usesUser = rule.UserId is not null;
        return new MumbleServer.ACL(
            rule.ApplyHere,
            rule.ApplySubs,
            inherited: false,
            userid: usesUser ? rule.UserId!.Value : -1,
            group: usesUser ? "" : rule.Group ?? "",
            allow: rule.Allow,
            deny: rule.Deny);
    }

    private static MumbleServer.Group ToIce(AclGroupDto group)
    {
        return new MumbleServer.Group(
            group.Name,
            inherited: false,
            inherit: group.Inherit,
            inheritable: group.Inheritable,
            add: group.Add.ToArray(),
            remove: group.Remove.ToArray(),
            members: Array.Empty<int>());
    }
}
