namespace Brmble.Client.Services.Idle;

/// <summary>
/// Pure rotation helper for the staggered UserStats poll. Picks which slice of
/// the (sorted-by-arrival) session array to poll on this tick, given the
/// previous offset. Extracted from <c>MumbleAdapter</c> so the rotation logic
/// can be unit-tested without a live Mumble connection.
/// </summary>
public static class PollBatchPlanner
{
    public readonly struct Batch
    {
        public Batch(int[] indicesToPoll, int newOffset)
        {
            IndicesToPoll = indicesToPoll;
            NewOffset = newOffset;
        }

        /// <summary>Indices into the original session array to poll this tick.</summary>
        public int[] IndicesToPoll { get; }

        /// <summary>The offset to remember for the next tick.</summary>
        public int NewOffset { get; }
    }

    /// <summary>
    /// Plans the next poll batch.
    /// </summary>
    /// <param name="offset">Offset stored from the previous tick (any value; will be modulo'd).</param>
    /// <param name="sessionCount">Number of currently-known sessions.</param>
    /// <param name="batchSize">Maximum number of sessions to include this tick.</param>
    public static Batch Plan(int offset, int sessionCount, int batchSize)
    {
        if (sessionCount <= 0 || batchSize <= 0)
            return new Batch(System.Array.Empty<int>(), 0);

        int start = ((offset % sessionCount) + sessionCount) % sessionCount; // safe even if offset is negative
        int count = System.Math.Min(batchSize, sessionCount);
        var indices = new int[count];
        for (int i = 0; i < count; i++)
        {
            indices[i] = (start + i) % sessionCount;
        }
        int newOffset = (start + count) % sessionCount;
        return new Batch(indices, newOffset);
    }
}
