using System;
using System.IO;
using ProtoBuf;

namespace MumbleProto.UDP
{
    [ProtoContract]
    public class Audio
    {
        [ProtoMember(1, IsRequired = false, Name = "target")]
        public uint Target { get; set; }

        [ProtoMember(2, IsRequired = false, Name = "context")]
        public uint Context { get; set; }

        [ProtoMember(3, IsRequired = false, Name = "sender_session")]
        public uint SenderSession { get; set; }

        [ProtoMember(4, IsRequired = false, Name = "frame_number")]
        public ulong FrameNumber { get; set; }

        [ProtoMember(5, IsRequired = false, Name = "opus_data")]
        public byte[] OpusData { get; set; }

        [ProtoMember(6, IsRequired = false, Name = "positional_data")]
        public float[] PositionalData { get; set; }

        [ProtoMember(7, IsRequired = false, Name = "volume_adjustment")]
        public float VolumeAdjustment { get; set; }

        [ProtoMember(16, IsRequired = false, Name = "is_terminator")]
        public bool IsTerminator { get; set; }

        public static Audio ParseFrom(Stream stream)
        {
            return Serializer.Deserialize<Audio>(stream);
        }

        public static Audio ParseFrom(byte[] data)
        {
            using (var stream = new MemoryStream(data))
            {
                return Serializer.Deserialize<Audio>(stream);
            }
        }

        public void WriteTo(Stream stream)
        {
            Serializer.Serialize(stream, this);
        }

        public byte[] ToByteArray()
        {
            using (var stream = new MemoryStream())
            {
                Serializer.Serialize(stream, this);
                return stream.ToArray();
            }
        }
    }

    [ProtoContract]
    public class Ping
    {
        [ProtoMember(1, IsRequired = false, Name = "timestamp")]
        public ulong Timestamp { get; set; }

        [ProtoMember(2, IsRequired = false, Name = "request_extended_information")]
        public bool RequestExtendedInformation { get; set; }

        [ProtoMember(3, IsRequired = false, Name = "server_version_v2")]
        public ulong ServerVersionV2 { get; set; }

        [ProtoMember(4, IsRequired = false, Name = "user_count")]
        public uint UserCount { get; set; }

        [ProtoMember(5, IsRequired = false, Name = "max_user_count")]
        public uint MaxUserCount { get; set; }

        [ProtoMember(6, IsRequired = false, Name = "max_bandwidth_per_user")]
        public uint MaxBandwidthPerUser { get; set; }

        public static Ping ParseFrom(Stream stream)
        {
            return Serializer.Deserialize<Ping>(stream);
        }

        public static Ping ParseFrom(byte[] data)
        {
            using (var stream = new MemoryStream(data))
            {
                return Serializer.Deserialize<Ping>(stream);
            }
        }

        public void WriteTo(Stream stream)
        {
            Serializer.Serialize(stream, this);
        }

        public byte[] ToByteArray()
        {
            using (var stream = new MemoryStream())
            {
                Serializer.Serialize(stream, this);
                return stream.ToArray();
            }
        }
    }
}
