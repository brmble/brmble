using System.Buffers.Binary;

namespace Brmble.Server.Games.Continuous;

public readonly record struct FixedVec(int X, int Y)
{
    public static FixedVec NormalizeQ15(int x, int y)
    {
        if (x == 0 && y == 0)
            return default;

        var length = IntegerSqrt(checked((long)x * x + (long)y * y));
        if (length <= 32_767)
            return new FixedVec(x, y);

        return new FixedVec(
            checked((int)(x * 32_767L / length)),
            checked((int)(y * 32_767L / length)));
    }

    public FixedVec Scale(int amount) => new(
        checked((int)(X * (long)amount / 32_767)),
        checked((int)(Y * (long)amount / 32_767)));

    public static int IntegerSqrt(long value)
    {
        if (value < 0)
            throw new ArgumentOutOfRangeException(nameof(value));

        ulong remainder = (ulong)value;
        ulong result = 0;
        ulong bit = 1UL << 62;

        while (bit > remainder)
            bit >>= 2;

        while (bit != 0)
        {
            if (remainder >= result + bit)
            {
                remainder -= result + bit;
                result = (result >> 1) + bit;
            }
            else
            {
                result >>= 1;
            }

            bit >>= 2;
        }

        return checked((int)result);
    }

    public static ulong Fnv1a64(ReadOnlySpan<byte> bytes)
    {
        const ulong offsetBasis = 14_695_981_039_346_656_037UL;
        const ulong prime = 1_099_511_628_211UL;
        var hash = offsetBasis;

        foreach (var value in bytes)
        {
            hash ^= value;
            hash = unchecked(hash * prime);
        }

        return hash;
    }
}

public static class FixedPointHash
{
    public static ulong OfFields(params int[] fields)
    {
        var bytes = new byte[checked(fields.Length * sizeof(int))];
        for (var index = 0; index < fields.Length; index++)
            BinaryPrimitives.WriteInt32LittleEndian(bytes.AsSpan(index * sizeof(int)), fields[index]);

        return FixedVec.Fnv1a64(bytes);
    }
}
