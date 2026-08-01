namespace Brmble.Client.Services.Voice.Projection;

/// <summary>
/// What one <c>Apply</c> changed. Rows in <see cref="Changed"/> are always complete — every
/// field present — so a consumer replaces by session id and never merges field-by-field.
/// </summary>
/// <param name="IsReset">
/// The caller should replace its whole list rather than patch it. Set by a Mumble reset and by
/// a snapshot that changed membership.
/// </param>
/// <param name="NeedsSnapshot">
/// The store detected a gap or a restart and cannot proceed from incremental events. The caller
/// should request a snapshot. Nothing in the projection was changed by the event that set this.
/// </param>
internal sealed record ChangeSet(
    IReadOnlyList<UserProjection> Changed,
    IReadOnlyList<uint> Removed,
    bool IsReset = false,
    bool NeedsSnapshot = false)
{
    public static readonly ChangeSet Empty = new([], []);

    public bool IsEmpty => Changed.Count == 0 && Removed.Count == 0 && !IsReset && !NeedsSnapshot;
}
