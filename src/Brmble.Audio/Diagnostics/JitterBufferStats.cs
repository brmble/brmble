namespace Brmble.Audio.Diagnostics;

public class JitterBufferStats
{
    public int BufferLevel { get; set; }
    public int TargetLevel { get; set; }
    public long TotalFrames { get; set; }
    public long NormalFrames { get; set; }
    public long ExpandFrames { get; set; }
    public long AccelerateFrames { get; set; }
    public long DecelerateFrames { get; set; }
    public long LatePackets { get; set; }
    public long DuplicatePackets { get; set; }

    public JitterBufferStats Snapshot()
    {
        return new JitterBufferStats
        {
            BufferLevel = BufferLevel,
            TargetLevel = TargetLevel,
            TotalFrames = TotalFrames,
            NormalFrames = NormalFrames,
            ExpandFrames = ExpandFrames,
            AccelerateFrames = AccelerateFrames,
            DecelerateFrames = DecelerateFrames,
            LatePackets = LatePackets,
            DuplicatePackets = DuplicatePackets,
        };
    }
}
