namespace MumbleVoiceEngine.Protocol;

public static class VoicePacketBuilder
{
    // Mumble Opus size varint: bit 13 signals the last frame of a voice transmission.
    private const ulong TerminatorBit = 0x2000;

    /// <summary>
    /// Build a Mumble Opus voice packet ready for encryption and sending.
    /// When <paramref name="terminator"/> is true, the size field is OR'd with
    /// 0x2000 to mark this as the final frame of the current transmission.
    /// </summary>
    public static byte[] Build(byte[] opusData, long sequenceNumber, int target = 0, bool terminator = false)
    {
        byte typeTarget = (byte)((4 << 5) | (target & 0x1F)); // type=4 (Opus)
        byte[] sequence = Varint.Encode((ulong)sequenceNumber);
        ulong sizeField = (ulong)opusData.Length;
        if (terminator)
            sizeField |= TerminatorBit;
        byte[] size = Varint.Encode(sizeField);

        byte[] packet = new byte[1 + sequence.Length + size.Length + opusData.Length];
        packet[0] = typeTarget;
        Array.Copy(sequence, 0, packet, 1, sequence.Length);
        Array.Copy(size, 0, packet, 1 + sequence.Length, size.Length);
        Array.Copy(opusData, 0, packet, 1 + sequence.Length + size.Length, opusData.Length);

        return packet;
    }
}
