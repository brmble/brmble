namespace Brmble.Server.Mumble;

public sealed record AclChannelSnapshotDto(
    int ChannelId,
    bool InheritAcls,
    IReadOnlyList<AclGroupDto> Groups,
    IReadOnlyList<AclRuleDto> Acls,
    DateTimeOffset FetchedAt,
    bool Stale,
    string? Warning,
    string SnapshotHash = "");

public sealed record AclGroupDto(
    string Name,
    bool Inherited,
    bool Inherit,
    bool Inheritable,
    IReadOnlyList<int> Add,
    IReadOnlyList<int> Remove,
    IReadOnlyList<int> Members);

public sealed record AclRuleDto(
    bool ApplyHere,
    bool ApplySubs,
    bool Inherited,
    int? UserId,
    string? Group,
    int Allow,
    int Deny);

public sealed record AclUpdateRequest(
    bool InheritAcls,
    IReadOnlyList<AclGroupDto> Groups,
    IReadOnlyList<AclRuleDto> Acls,
    string? ExpectedSnapshotHash = null);

public sealed record AclGroupMemberRequest(int Session, string Group);

public sealed record AclWriteResult(
    bool Success,
    AclChannelSnapshotDto? Snapshot,
    string? Warning,
    string? Error);
