using Brmble.Server.Data;

namespace Brmble.Server.Auth;

public record User(int Id, string CertHash, string DisplayName, string MatrixUserId);

public class UserRepository
{
    private readonly Database _db;

    public UserRepository(Database db)
    {
        _db = db;
    }

    // TODO: GetByCertHash(string certHash) → User?
    // TODO: Insert(string certHash, string displayName, string matrixUserId) → User
    // TODO: UpdateDisplayName(int id, string displayName)
}
