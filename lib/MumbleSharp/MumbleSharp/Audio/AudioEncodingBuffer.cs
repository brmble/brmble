using MumbleSharp.Audio.Codecs;
using System;
using System.Collections.Concurrent;
using System.Linq;

namespace MumbleSharp.Audio
{
    public class AudioEncodingBuffer
    {
        private readonly BlockingCollection<TargettedSpeech> _unencodedBuffer = new BlockingCollection<TargettedSpeech>(new ConcurrentQueue<TargettedSpeech>());

        private readonly CodecSet _codecs;
        private readonly ushort _frameSize;

        private SpeechTarget _target;
        private uint _targetId;
        private readonly DynamicCircularBuffer _pcmBuffer = new DynamicCircularBuffer();

        private TargettedSpeech? _unencodedItem;

        /// <summary>
        /// Initializes a new instance of the <see cref="AudioEncodingBuffer"/> class.
        /// </summary>
        /// <param name="sampleRate">The sample rate in Hertz (samples per second).</param>
        /// <param name="sampleBits">The sample bit depth.</param>
        /// <param name="sampleChannels">The sample channels (1 for mono, 2 for stereo).</param>
        /// <param name="frameSize">Size of the frame in samples.</param>
        public AudioEncodingBuffer(int sampleRate = Constants.DEFAULT_AUDIO_SAMPLE_RATE, byte sampleBits = Constants.DEFAULT_AUDIO_SAMPLE_BITS, byte sampleChannels = Constants.DEFAULT_AUDIO_SAMPLE_CHANNELS, ushort frameSize = Constants.DEFAULT_AUDIO_FRAME_SIZE)
        {
            _codecs = new CodecSet(sampleRate, sampleBits, sampleChannels, frameSize);
            _frameSize = frameSize;
        }

        /// <summary>
        /// Add some raw PCM data to the buffer to send
        /// </summary>
        /// <param name="pcm"></param>
        /// <param name="target"></param>
        /// <param name="targetId"></param>
        public void Add(ArraySegment<byte> pcm, SpeechTarget target, uint targetId)
        {
            _unencodedBuffer.Add(new TargettedSpeech(pcm, target, targetId));
        }

        public void Stop()
        {
            _unencodedBuffer.Add(new TargettedSpeech(stop: true));
        }

        public EncodedTargettedSpeech? Encode(SpeechCodecs codec)
        {
            //Get the codec
            var codecInstance = _codecs.GetCodec(codec);

            //Use consistent frame size (960 samples = 20ms) matching Mumble clients
            var frameBytes = _frameSize * sizeof(ushort);

            bool stopped = false;

            //If we have an unencoded item stored here it's because a previous iteration pulled from the queue and discovered it could not process this packet (different target)
            if (_unencodedItem.HasValue && TryAddToEncodingBuffer(_unencodedItem.Value, out stopped))
            {
                _unencodedItem = null;
            }

            if (stopped)
            {
                //remove stop packet
                TargettedSpeech item;
                _unencodedBuffer.TryTake(out item, TimeSpan.FromMilliseconds(1));
                _unencodedItem = null;
            }

            //Accumulate bytes for one frame
            while (_pcmBuffer.Count < frameBytes && !stopped)
            {
                TargettedSpeech item;
                if (!_unencodedBuffer.TryTake(out item, TimeSpan.FromMilliseconds(1)))
                    break;

                //Add this packet to the encoding buffer, or stop accumulating bytes
                if (!TryAddToEncodingBuffer(item, out stopped))
                {
                    _unencodedItem = item;
                    break;
                }
            }

            //Nothing to encode, early exit
            if (_pcmBuffer.Count == 0)
                return null;

            if (_pcmBuffer.Count < frameBytes && !stopped)
                return null; // Not enough data for a full frame yet

            if (stopped && _pcmBuffer.Count < frameBytes)
            {
                // Pad remaining data with silence to fill a frame
                byte[] b = new byte[frameBytes];
                _pcmBuffer.Read(new ArraySegment<byte>(b));

                return new EncodedTargettedSpeech(
                    codecInstance.Encode(new ArraySegment<byte>(b, 0, frameBytes)),
                    _target,
                    _targetId);
            }
            else
            {
                // Encode exactly one frame
                byte[] b = new byte[frameBytes];
                _pcmBuffer.Read(new ArraySegment<byte>(b));

                return new EncodedTargettedSpeech(
                    codecInstance.Encode(new ArraySegment<byte>(b, 0, frameBytes)),
                    _target,
                    _targetId);
            }
        }

        private bool TryAddToEncodingBuffer(TargettedSpeech t, out bool stopped)
        {
            if (t.IsStop)
            {
                stopped = true;
                return false;
            }
            stopped = false;

            if (!(_pcmBuffer.Count == 0 || (_target == t.Target && _targetId == t.TargetId)))
                return false;

            _pcmBuffer.Write(t.Pcm);

            _target = t.Target;
            _targetId = t.TargetId;

            return true;
        }

        public struct EncodedTargettedSpeech
        {
            public readonly byte[] EncodedPcm;
            public readonly SpeechTarget Target;
            public readonly uint TargetId;

            public EncodedTargettedSpeech(byte[] encodedPcm, SpeechTarget target, uint targetId)
            {
                TargetId = targetId;
                Target = target;
                EncodedPcm = encodedPcm;
            }
        }

        /// <summary>
        /// PCM data targetted at a specific person
        /// </summary>
        private struct TargettedSpeech
        {
            public readonly ArraySegment<byte> Pcm;
            public readonly SpeechTarget Target;
            public readonly uint TargetId;

            public readonly bool IsStop;

            public TargettedSpeech(ArraySegment<byte> pcm, SpeechTarget target, uint targetId)
            {
                TargetId = targetId;
                Target = target;
                Pcm = pcm;

                IsStop = false;
            }

            public TargettedSpeech(bool stop = true)
            {
                IsStop = stop;

                Pcm = default(ArraySegment<byte>);
                Target = SpeechTarget.Normal;
                TargetId = 0;
            }
        }
    }
}
