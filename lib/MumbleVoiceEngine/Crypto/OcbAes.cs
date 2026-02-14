using System;
using System.Security.Cryptography;

namespace MumbleVoiceEngine.Crypto
{
    /// <summary>
    /// OCB2-AES128 authenticated encryption, matching Mumble's CryptStateOCB2.
    /// Uses S2/S3 (doubling/tripling in GF(2^128)) — NOT the OCB1 gray-code L-table.
    /// Reference: https://github.com/mumble-voip/mumble/blob/master/src/crypto/CryptStateOCB2.cpp
    /// </summary>
    public class OcbAes
    {
        public const int BLOCK_SIZE = 16;
        public const int TAG_LENGTH = BLOCK_SIZE;

        byte[] delta = new byte[BLOCK_SIZE];
        byte[] checksum = new byte[BLOCK_SIZE];
        byte[] tmp = new byte[BLOCK_SIZE];
        byte[] pad = new byte[BLOCK_SIZE];

        RijndaelManaged aes;

        public void Initialise(byte[] key)
        {
            aes = new RijndaelManaged
            {
                BlockSize = BLOCK_SIZE * 8,
                Key = key,
                Mode = CipherMode.ECB,
                Padding = PaddingMode.None
            };
        }

        /// <summary>
        /// S2: doubling in GF(2^128). block = 2 * block.
        /// Operates on 16-byte block as big-endian 128-bit value.
        /// Reduction polynomial: x^128 + x^7 + x^2 + x + 1 (0x87).
        /// </summary>
        static void S2(byte[] block)
        {
            byte carry = (byte)(block[0] >> 7);
            for (int i = 0; i < BLOCK_SIZE - 1; i++)
                block[i] = (byte)((block[i] << 1) | (block[i + 1] >> 7));
            block[BLOCK_SIZE - 1] = (byte)((block[BLOCK_SIZE - 1] << 1) ^ (carry * 0x87));
        }

        /// <summary>
        /// S3: tripling in GF(2^128). block = 3 * block = (2 * block) XOR block.
        /// </summary>
        static void S3(byte[] block)
        {
            byte carry = (byte)(block[0] >> 7);
            for (int i = 0; i < BLOCK_SIZE - 1; i++)
                block[i] ^= (byte)((block[i] << 1) | (block[i + 1] >> 7));
            block[BLOCK_SIZE - 1] ^= (byte)((block[BLOCK_SIZE - 1] << 1) ^ (carry * 0x87));
        }

        static void Xor(byte[] dst, byte[] a, byte[] b, int bPos = 0)
        {
            for (int i = 0; i < BLOCK_SIZE; i++)
                dst[i] = (byte)(a[i] ^ b[bPos + i]);
        }

        static void XorInto(byte[] dst, int dstPos, byte[] a, byte[] b)
        {
            for (int i = 0; i < BLOCK_SIZE; i++)
                dst[dstPos + i] = (byte)(a[i] ^ b[i]);
        }

        public byte[] Encrypt(byte[] pt, int ptPos, int ptLen, byte[] nonce, int noncePos, byte[] tag, int tagPos)
        {
            if (aes == null)
                throw new InvalidOperationException("AES key not initialized");

            byte[] ct = new byte[ptLen];
            int ctPos = 0;

            // Initialize: delta = E_K(nonce)
            Array.Copy(nonce, noncePos, delta, 0, BLOCK_SIZE);
            Array.Clear(checksum, 0, BLOCK_SIZE);

            using (var encryptor = aes.CreateEncryptor())
            {
                encryptor.TransformBlock(delta, 0, BLOCK_SIZE, delta, 0);

                // Process full blocks
                while (ptLen > BLOCK_SIZE)
                {
                    S2(delta);
                    Xor(tmp, delta, pt, ptPos);                              // tmp = delta XOR plaintext
                    encryptor.TransformBlock(tmp, 0, BLOCK_SIZE, tmp, 0);    // tmp = E_K(tmp)
                    XorInto(ct, ctPos, delta, tmp);                          // ct = delta XOR tmp

                    // Update checksum
                    for (int i = 0; i < BLOCK_SIZE; i++)
                        checksum[i] ^= pt[ptPos + i];

                    ptLen -= BLOCK_SIZE;
                    ptPos += BLOCK_SIZE;
                    ctPos += BLOCK_SIZE;
                }

                // Process last (partial or full) block
                S2(delta);
                Array.Clear(tmp, 0, BLOCK_SIZE);
                tmp[BLOCK_SIZE - 1] = (byte)(ptLen * 8); // bit-length of last block
                Xor(tmp, tmp, delta);
                encryptor.TransformBlock(tmp, 0, BLOCK_SIZE, pad, 0);        // pad = E_K(len || delta)

                // Build tmp = [plaintext | pad_tail] per OCB2 spec
                Array.Clear(tmp, 0, BLOCK_SIZE);
                Array.Copy(pt, ptPos, tmp, 0, ptLen);
                Array.Copy(pad, ptLen, tmp, ptLen, BLOCK_SIZE - ptLen); // pad tail into checksum
                for (int i = 0; i < BLOCK_SIZE; i++)
                    checksum[i] ^= tmp[i];
                // Ciphertext = plaintext XOR pad (only ptLen bytes)
                Xor(tmp, pad, tmp);
                Array.Copy(tmp, 0, ct, ctPos, ptLen);

                // Calculate tag: E_K(S3(delta) XOR checksum)
                S3(delta);
                Xor(tmp, delta, checksum);
                encryptor.TransformBlock(tmp, 0, BLOCK_SIZE, tmp, 0);
                Array.Copy(tmp, 0, tag, tagPos, TAG_LENGTH);

                return ct;
            }
        }

        public byte[] Decrypt(byte[] ct, int ctPos, int ctLen, byte[] nonce, int noncePos, byte[] tag, int tagPos)
        {
            if (aes == null)
                throw new InvalidOperationException("AES key not initialized");

            byte[] pt = new byte[ctLen];
            int ptPos = 0;

            // Initialize: delta = E_K(nonce)
            Array.Copy(nonce, noncePos, delta, 0, BLOCK_SIZE);
            Array.Clear(checksum, 0, BLOCK_SIZE);

            using (var encryptor = aes.CreateEncryptor())
            using (var decryptor = aes.CreateDecryptor())
            {
                encryptor.TransformBlock(delta, 0, BLOCK_SIZE, delta, 0);

                // Process full blocks
                while (ctLen > BLOCK_SIZE)
                {
                    S2(delta);
                    Xor(tmp, delta, ct, ctPos);                              // tmp = delta XOR ciphertext
                    decryptor.TransformBlock(tmp, 0, BLOCK_SIZE, tmp, 0);    // tmp = D_K(tmp)
                    XorInto(pt, ptPos, delta, tmp);                          // pt = delta XOR tmp

                    // Update checksum from plaintext
                    for (int i = 0; i < BLOCK_SIZE; i++)
                        checksum[i] ^= pt[ptPos + i];

                    ctLen -= BLOCK_SIZE;
                    ctPos += BLOCK_SIZE;
                    ptPos += BLOCK_SIZE;
                }

                // Process last (partial or full) block
                S2(delta);
                Array.Clear(tmp, 0, BLOCK_SIZE);
                tmp[BLOCK_SIZE - 1] = (byte)(ctLen * 8); // bit-length of last block
                Xor(tmp, tmp, delta);
                encryptor.TransformBlock(tmp, 0, BLOCK_SIZE, pad, 0);        // pad = E_K(len || delta)

                // XOR ciphertext with pad to get plaintext, update checksum
                Array.Clear(tmp, 0, BLOCK_SIZE);
                Array.Copy(ct, ctPos, tmp, 0, ctLen);
                Xor(tmp, tmp, pad);
                for (int i = 0; i < BLOCK_SIZE; i++)
                    checksum[i] ^= tmp[i];
                Array.Copy(tmp, 0, pt, ptPos, ctLen);

                // Calculate tag: E_K(S3(delta) XOR checksum)
                S3(delta);
                Xor(tmp, delta, checksum);
                encryptor.TransformBlock(tmp, 0, BLOCK_SIZE, tmp, 0);
                Array.Copy(tmp, 0, tag, tagPos, TAG_LENGTH);

                return pt;
            }
        }
    }
}
