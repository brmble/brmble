using System.Security.Cryptography;

namespace Brmble.Server.Games;

public sealed class CryptoRandomSource : IRandomSource
{
    public int Roll(int maxInclusive)
    {
        if (maxInclusive < 1) throw new ArgumentOutOfRangeException(nameof(maxInclusive));
        return RandomNumberGenerator.GetInt32(1, maxInclusive + 1);
    }
}
