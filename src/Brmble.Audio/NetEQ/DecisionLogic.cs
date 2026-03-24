using Brmble.Audio.NetEQ.Models;

namespace Brmble.Audio.NetEQ;

/// <summary>
/// Per-tick playout decision state machine.
/// Decides whether to play normally, accelerate, decelerate, expand (PLC), or merge.
/// </summary>
public class DecisionLogic
{
    private const int AccelerateThreshold = 2;
    private const int DecelerateThreshold = 2;

    public PlayoutDecision Decide(
        bool packetAvailable,
        int bufferLevel,
        int targetLevel,
        PlayoutDecision previousDecision)
    {
        if (!packetAvailable)
            return PlayoutDecision.Expand;

        if (previousDecision == PlayoutDecision.Expand)
            return PlayoutDecision.Merge;

        if (bufferLevel > targetLevel + AccelerateThreshold)
            return PlayoutDecision.Accelerate;

        if (bufferLevel < targetLevel - DecelerateThreshold)
            return PlayoutDecision.Decelerate;

        return PlayoutDecision.Normal;
    }
}
