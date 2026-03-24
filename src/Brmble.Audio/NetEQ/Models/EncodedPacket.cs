namespace Brmble.Audio.NetEQ.Models;

/// <summary>
/// An encoded Opus packet received from the network, not yet decoded.
/// Timestamp is in 10ms units at 48kHz, derived from Mumble sequence: Sequence × 480.
/// </summary>
public record EncodedPacket(
    long Sequence,
    long Timestamp,
    byte[] Payload,
    long ArrivalTimeMs
);
