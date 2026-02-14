namespace MumbleVoiceEngine.Protocol;

public static class VoicePacketBuilder
{
    /// <summary>
    /// Build a Mumble Opus voice packet ready for encryption and sending.
    /// </summary>
    public static byte[] Build(byte[] opusData, long sequenceNumber, int target = 0)
    {
        byte typeTarget = (byte)((4 << 5) | (target & 0x1F)); // type=4 (Opus)
        byte[] sequence = Varint.Encode((ulong)sequenceNumber);
        byte[] size = Varint.Encode((ulong)opusData.Length);

        byte[] packet = new byte[1 + sequence.Length + size.Length + opusData.Length];
        packet[0] = typeTarget;
        Array.Copy(sequence, 0, packet, 1, sequence.Length);
        Array.Copy(size, 0, packet, 1 + sequence.Length, size.Length);
        Array.Copy(opusData, 0, packet, 1 + sequence.Length + size.Length, opusData.Length);

        return packet;
    }
}
