namespace Brmble.Server.Games;

public interface IRandomSource
{
    /// <summary>Uniform integer in [1, maxInclusive].</summary>
    int Roll(int maxInclusive);
}
