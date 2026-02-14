using System;
using System.Collections.Generic;

namespace MumbleVoiceEngine.Protocol
{
    public static class Varint
    {
        public static byte[] Encode(UInt64 value)
        {
            UInt64 i = value;
            List<byte> byteList = new List<byte>();

            if (
                    ((i & 0x8000000000000000L) != 0) &&
                    (~i < 0x100000000L)
                )
            {
                // Signed number.
                i = ~i;
                if (i <= 0x3)
                {
                    // Shortcase for -1 to -4
                    byteList.Add((byte)(0xFC | i));
                    return byteList.ToArray();
                }
                else
                {
                    byteList.Add(0xF8);
                }
            }
            if (i < 0x80)
            {
                // Need top bit clear
                byteList.Add((byte)i);
            }
            else if (i < 0x4000)
            {
                // Need top two bits clear
                byteList.Add((byte)((i >> 8) | 0x80));
                byteList.Add((byte)(i & 0xFF));
            }
            else if (i < 0x200000)
            {
                // Need top three bits clear
                byteList.Add((byte)((i >> 16) | 0xC0));
                byteList.Add((byte)((i >> 8) & 0xFF));
                byteList.Add((byte)(i & 0xFF));
            }
            else if (i < 0x10000000)
            {
                // Need top four bits clear
                byteList.Add((byte)((i >> 24) | 0xE0));
                byteList.Add((byte)((i >> 16) & 0xFF));
                byteList.Add((byte)((i >> 8) & 0xFF));
                byteList.Add((byte)(i & 0xFF));
            }
            else if (i < 0x100000000L)
            {
                // It's a full 32-bit integer.
                byteList.Add(0xF0);
                byteList.Add((byte)((i >> 24) & 0xFF));
                byteList.Add((byte)((i >> 16) & 0xFF));
                byteList.Add((byte)((i >> 8) & 0xFF));
                byteList.Add((byte)(i & 0xFF));
            }
            else
            {
                // It's a 64-bit value.
                byteList.Add(0xF4);
                byteList.Add((byte)((i >> 56) & 0xFF));
                byteList.Add((byte)((i >> 48) & 0xFF));
                byteList.Add((byte)((i >> 40) & 0xFF));
                byteList.Add((byte)((i >> 32) & 0xFF));
                byteList.Add((byte)((i >> 24) & 0xFF));
                byteList.Add((byte)((i >> 16) & 0xFF));
                byteList.Add((byte)((i >> 8) & 0xFF));
                byteList.Add((byte)(i & 0xFF));
            }
            return byteList.ToArray();
        }
    }
}
