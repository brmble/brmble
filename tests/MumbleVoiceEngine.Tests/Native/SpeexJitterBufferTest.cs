using Microsoft.VisualStudio.TestTools.UnitTesting;
using MumbleVoiceEngine.Native;
using System;
using System.Runtime.InteropServices;

namespace MumbleVoiceEngine.Tests.Native
{
    [TestClass]
    public class SpeexJitterBufferTest
    {
        [TestMethod]
        public void Init_Destroy_DoesNotCrash()
        {
            IntPtr jb = SpeexDspNative.jitter_buffer_init(960); // 20ms at 48kHz
            Assert.AreNotEqual(IntPtr.Zero, jb);
            SpeexDspNative.jitter_buffer_destroy(jb);
        }

        [TestMethod]
        public void Put_Get_RoundTrip()
        {
            IntPtr jb = SpeexDspNative.jitter_buffer_init(960);
            try
            {
                // Put a packet
                byte[] data = new byte[] { 1, 2, 3, 4, 5 };
                var pin = GCHandle.Alloc(data, GCHandleType.Pinned);
                var putPacket = new JitterBufferPacket
                {
                    Data = pin.AddrOfPinnedObject(),
                    Len = (uint)data.Length,
                    Timestamp = 0,
                    Span = 960,
                    Sequence = 0
                };
                SpeexDspNative.jitter_buffer_put(jb, ref putPacket);
                pin.Free();

                // Get it back
                byte[] outData = new byte[4096];
                var outPin = GCHandle.Alloc(outData, GCHandleType.Pinned);
                var getPacket = new JitterBufferPacket
                {
                    Data = outPin.AddrOfPinnedObject(),
                    Len = (uint)outData.Length
                };
                int result = SpeexDspNative.jitter_buffer_get(jb, ref getPacket, 960, out int startOffset);
                outPin.Free();

                Assert.AreEqual(SpeexDspNative.JITTER_BUFFER_OK, result);
                Assert.AreEqual((uint)data.Length, getPacket.Len);
            }
            finally
            {
                SpeexDspNative.jitter_buffer_destroy(jb);
            }
        }

        [TestMethod]
        public void Reset_DoesNotCrash()
        {
            IntPtr jb = SpeexDspNative.jitter_buffer_init(960);
            try
            {
                SpeexDspNative.jitter_buffer_reset(jb);
            }
            finally
            {
                SpeexDspNative.jitter_buffer_destroy(jb);
            }
        }

        [TestMethod]
        public void Ctl_SetMargin_Works()
        {
            IntPtr jb = SpeexDspNative.jitter_buffer_init(960);
            try
            {
                int margin = 10;
                SpeexDspNative.jitter_buffer_ctl(jb, SpeexDspNative.JITTER_BUFFER_SET_MARGIN, ref margin);

                int getMargin = 0;
                SpeexDspNative.jitter_buffer_ctl(jb, SpeexDspNative.JITTER_BUFFER_GET_MARGIN, ref getMargin);
                Assert.AreEqual(10, getMargin);
            }
            finally
            {
                SpeexDspNative.jitter_buffer_destroy(jb);
            }
        }
    }
}
