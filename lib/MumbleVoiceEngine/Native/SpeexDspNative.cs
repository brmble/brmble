using System;
using System.Runtime.InteropServices;

namespace MumbleVoiceEngine.Native
{
    [StructLayout(LayoutKind.Sequential)]
    public struct JitterBufferPacket
    {
        public IntPtr Data;        // char* — pointer to packet data
        public uint Len;           // packet length in bytes
        public uint Timestamp;     // timestamp in sample units
        public uint Span;          // duration in sample units
        public ushort Sequence;    // RTP sequence number (0 if unused)
        public uint UserData;      // user-defined, ignored by jitter buffer
    }

    public static class SpeexDspNative
    {
        private const string LibName = "speexdsp";

        // Return codes
        public const int JITTER_BUFFER_OK = 0;
        public const int JITTER_BUFFER_MISSING = 1;
        public const int JITTER_BUFFER_INCOMPLETE = 2;

        // CTL codes
        public const int JITTER_BUFFER_SET_MARGIN = 0;
        public const int JITTER_BUFFER_GET_MARGIN = 1;
        public const int JITTER_BUFFER_SET_DELAY_STEP = 6;
        public const int JITTER_BUFFER_SET_CONCEALMENT_SIZE = 8;
        public const int JITTER_BUFFER_SET_MAX_LATE_RATE = 10;
        public const int JITTER_BUFFER_SET_LATE_COST = 12;

        [DllImport(LibName, CallingConvention = CallingConvention.Cdecl)]
        public static extern IntPtr jitter_buffer_init(int step_size);

        [DllImport(LibName, CallingConvention = CallingConvention.Cdecl)]
        public static extern void jitter_buffer_destroy(IntPtr jb);

        [DllImport(LibName, CallingConvention = CallingConvention.Cdecl)]
        public static extern void jitter_buffer_reset(IntPtr jb);

        [DllImport(LibName, CallingConvention = CallingConvention.Cdecl)]
        public static extern void jitter_buffer_put(IntPtr jb, ref JitterBufferPacket packet);

        [DllImport(LibName, CallingConvention = CallingConvention.Cdecl)]
        public static extern int jitter_buffer_get(IntPtr jb, ref JitterBufferPacket packet, int desired_span, out int start_offset);

        [DllImport(LibName, CallingConvention = CallingConvention.Cdecl)]
        public static extern void jitter_buffer_tick(IntPtr jb);

        [DllImport(LibName, CallingConvention = CallingConvention.Cdecl)]
        public static extern int jitter_buffer_ctl(IntPtr jb, int request, ref int value);

        [DllImport(LibName, CallingConvention = CallingConvention.Cdecl)]
        public static extern int jitter_buffer_get_pointer_timestamp(IntPtr jb);

        [DllImport(LibName, CallingConvention = CallingConvention.Cdecl)]
        public static extern int jitter_buffer_update_delay(IntPtr jb, ref JitterBufferPacket packet, out int start_offset);
    }
}
