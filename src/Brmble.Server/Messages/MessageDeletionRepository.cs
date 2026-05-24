using Brmble.Server.Data;
using Dapper;

namespace Brmble.Server.Messages;

public sealed record MessageRedactionAuditRecord(
    string RoomId,
    string EventId,
    string RedactionEventId,
    string DeletedByMatrixUserId,
    string Reason,
    string PlaceholderText,
    string ActorType,
    DateTimeOffset DeletedAt);

public sealed class MessageDeletionRepository
{
    private readonly Database _database;

    public MessageDeletionRepository(Database database)
    {
        _database = database;
    }

    public async Task SaveAsync(MessageRedactionAuditRecord record, CancellationToken cancellationToken = default)
    {
        using var conn = _database.CreateConnection();
        const string sql =
            """
            INSERT INTO message_redactions (
                room_id,
                event_id,
                redaction_event_id,
                deleted_by_matrix_user_id,
                reason,
                placeholder_text,
                actor_type,
                deleted_at
            ) VALUES (
                @RoomId,
                @EventId,
                @RedactionEventId,
                @DeletedByMatrixUserId,
                @Reason,
                @PlaceholderText,
                @ActorType,
                @DeletedAt
            );
            """;
        await conn.ExecuteAsync(new CommandDefinition(sql, record, cancellationToken: cancellationToken));
    }
}
