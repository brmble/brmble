namespace MumbleVoiceEngine.Protocol;

public readonly struct ParsedVoicePacket
{
    public readonly int Codec;       // SpeechCodecs enum value (4 = Opus)
    public readonly int Target;      // SpeechTarget enum value
    public readonly uint Session;    // User session ID
    public readonly long Sequence;   // Packet sequence number
    public readonly byte[] OpusData; // Raw Opus encoded frame

    public ParsedVoicePacket(int codec, int target, uint session, long sequence, byte[] opusData)
    {
        Codec = codec;
        Target = target;
        Session = session;
        Sequence = sequence;
        OpusData = opusData;
    }
}

public static class VoicePacketParser
{
    /// <summary>
    /// Parse a decrypted Mumble voice packet. Returns null for pings or invalid packets.
    /// </summary>
    public static ParsedVoicePacket? Parse(byte[] packet)
    {
        if (packet == null || packet.Length < 2)
            return null;

        int type = (packet[0] >> 5) & 0x7;
        int target = packet[0] & 0x1F;

        // Type 1 = UDP ping, not a voice packet
        if (type == 1)
            return null;

        using var reader = new PacketReader(new MemoryStream(packet, 1, packet.Length - 1));

        uint session = (uint)reader.ReadVarInt64();
        long sequence = reader.ReadVarInt64();

        // Only Opus supported (type 4)
        if (type != 4)
            return null;

        int size = (int)reader.ReadVarInt64();
        size &= 0x1FFF; // Mask to 13 bits

        if (size == 0)
            return null;

        byte[] data = reader.ReadBytes(size);
        if (data == null)
            return null;

        return new ParsedVoicePacket(type, target, session, sequence, data);
    }
}
