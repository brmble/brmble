namespace Brmble.Audio.NetEQ.Models;

/// <summary>
/// An encoded Opus packet received from the network, not yet decoded.
/// Timestamp is derived from Mumble sequence: Sequence × 960.
/// </summary>
public record EncodedPacket(
    long Sequence,
    long Timestamp,
    byte[] Payload,
    long ArrivalTimeMs
);
