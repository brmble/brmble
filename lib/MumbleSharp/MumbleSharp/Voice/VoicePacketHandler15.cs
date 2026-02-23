using System;
using System.IO;
using MumbleSharp.Audio;
using MumbleSharp.Audio.Codecs;
using UDPPing = MumbleProto.UDP.Ping;
using UDPAudio = MumbleProto.UDP.Audio;

namespace MumbleSharp
{
    public class VoicePacketHandler15
    {
        private readonly MumbleConnection _connection;

        public VoicePacketHandler15(MumbleConnection connection)
        {
            _connection = connection;
        }

        public void ProcessUDPPacket(byte[] packet, int length)
        {
            if (length == 0 || packet == null || packet.Length == 0)
                return;

            try
            {
                using (var stream = new MemoryStream(packet, 0, length))
                {
                    var ping = UDPPing.ParseFrom(stream);
                    if (ping.Timestamp > 0)
                    {
                        ProcessPing(ping);
                        return;
                    }
                }
            }
            catch
            {
            }

            try
            {
                using (var stream = new MemoryStream(packet, 0, length))
                {
                    var audio = UDPAudio.ParseFrom(stream);
                    ProcessAudio(audio);
                }
            }
            catch
            {
            }
        }

        private void ProcessPing(UDPPing ping)
        {
            var timestampBytes = BitConverter.GetBytes(ping.Timestamp);
            _connection.Protocol.UdpPing(timestampBytes);
        }

        private void ProcessAudio(UDPAudio audio)
        {
            if (audio.OpusData == null || audio.OpusData.Length == 0)
                return;

            var session = audio.SenderSession;
            var sequence = (long)audio.FrameNumber;

            var codec = _connection.Protocol.GetCodec(session, SpeechCodecs.Opus);
            if (codec == null)
                return;

            var target = audio.Target > 0 ? (SpeechTarget)audio.Target : SpeechTarget.Normal;

            _connection.Protocol.EncodedVoice(audio.OpusData, session, sequence, codec, target);
        }
    }
}
