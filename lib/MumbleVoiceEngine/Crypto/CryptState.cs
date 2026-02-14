using System;
using System.Threading;

namespace MumbleVoiceEngine.Crypto
{
    public class CryptState
    {
        readonly ReaderWriterLockSlim _aesLock = new ReaderWriterLockSlim(LockRecursionPolicy.SupportsRecursion);
        OcbAes _aes;

        byte[] _serverNonce;

        public byte[] ServerNonce
        {
            get
            {
                try
                {
                    _aesLock.EnterReadLock();
                    return (byte[])_serverNonce.Clone();
                }
                finally
                {
                    _aesLock.ExitReadLock();
                }
            }
            set
            {
                try
                {
                    _aesLock.EnterWriteLock();
                    _serverNonce = value;
                }
                finally
                {
                    _aesLock.ExitWriteLock();
                }
            }
        }

        byte[] _clientNonce;
        public byte[] ClientNonce
        {
            get
            {
                try
                {
                    _aesLock.EnterReadLock();
                    return _clientNonce;
                }
                finally
                {
                    _aesLock.ExitReadLock();
                }
            }
            private set
            {
                try
                {
                    _aesLock.EnterWriteLock();
                    _clientNonce = value;
                }
                finally
                {
                    _aesLock.ExitWriteLock();
                }
            }
        }

        readonly byte[] _decryptHistory = new byte[256];

        public int Good { get; private set; }
        public int Late { get; private set; }
        public int Lost { get; private set; }

        public bool Initialized => _aes != null;

        public void SetKeys(byte[] key, byte[] clientNonce, byte[] serverNonce)
        {
            try
            {
                _aesLock.EnterWriteLock();

                _aes = new OcbAes();
                _aes.Initialise(key);

                ServerNonce = serverNonce;
                ClientNonce = clientNonce;
            }
            finally
            {
                _aesLock.ExitWriteLock();
            }
        }

        public byte[] Decrypt(byte[] source, int length)
        {
            try
            {
                _aesLock.EnterWriteLock();

                if (length < 4)
                    return null;

                int plainLength = length - 4;

                byte[] saveiv = new byte[OcbAes.BLOCK_SIZE];
                byte ivbyte = source[0];
                bool restore = false;

                int lost = 0;
                int late = 0;

                Array.ConstrainedCopy(_serverNonce, 0, saveiv, 0, OcbAes.BLOCK_SIZE);

                if (((_serverNonce[0] + 1) & 0xFF) == ivbyte)
                {
                    // In order as expected.
                    if (ivbyte > _serverNonce[0])
                    {
                        _serverNonce[0] = ivbyte;
                    }
                    else if (ivbyte < _serverNonce[0])
                    {
                        _serverNonce[0] = ivbyte;
                        for (int i = 1; i < OcbAes.BLOCK_SIZE; i++)
                            if ((++_serverNonce[i]) != 0)
                                break;
                    }
                    else
                    {
                        return null;
                    }
                }
                else
                {
                    int diff = ivbyte - _serverNonce[0];
                    if (diff > 128)
                        diff -= 256;
                    else if (diff < -128)
                        diff += 256;

                    if ((ivbyte < _serverNonce[0]) && (diff > -30) && (diff < 0))
                    {
                        late = 1;
                        lost = -1;
                        _serverNonce[0] = ivbyte;
                        restore = true;
                    }
                    else if ((ivbyte > _serverNonce[0]) && (diff > -30) && (diff < 0))
                    {
                        late = 1;
                        lost = -1;
                        _serverNonce[0] = ivbyte;
                        for (int i = 1; i < OcbAes.BLOCK_SIZE; i++)
                            if ((_serverNonce[i]--) != 0)
                                break;
                        restore = true;
                    }
                    else if ((ivbyte > _serverNonce[0]) && (diff > 0))
                    {
                        lost = ivbyte - _serverNonce[0] - 1;
                        _serverNonce[0] = ivbyte;
                    }
                    else if ((ivbyte < _serverNonce[0]) && (diff > 0))
                    {
                        lost = 256 - _serverNonce[0] + ivbyte - 1;
                        _serverNonce[0] = ivbyte;
                        for (int i = 1; i < OcbAes.BLOCK_SIZE; i++)
                            if ((++_serverNonce[i]) != 0)
                                break;
                    }
                    else
                    {
                        return null;
                    }

                    if (_decryptHistory[_serverNonce[0]] == _serverNonce[1])
                    {
                        Array.ConstrainedCopy(saveiv, 0, _serverNonce, 0, OcbAes.BLOCK_SIZE);
                        return null;
                    }
                }

                // Decrypt and get computed tag
                byte[] computedTag = new byte[OcbAes.BLOCK_SIZE];
                byte[] dst = _aes.Decrypt(source, 4, plainLength, _serverNonce, 0, computedTag, 0);

                // Verify 3-byte truncated tag against packet header
                if (computedTag[0] != source[1] || computedTag[1] != source[2] || computedTag[2] != source[3])
                {
                    Array.ConstrainedCopy(saveiv, 0, _serverNonce, 0, OcbAes.BLOCK_SIZE);
                    return null;
                }

                _decryptHistory[_serverNonce[0]] = _serverNonce[1];

                if (restore)
                    Array.ConstrainedCopy(saveiv, 0, _serverNonce, 0, OcbAes.BLOCK_SIZE);

                Good++;
                Late += late;
                Lost += lost;

                return dst;
            }
            finally
            {
                _aesLock.ExitWriteLock();
            }
        }

        public byte[] Encrypt(byte[] source, int length)
        {
            try
            {
                _aesLock.EnterWriteLock();

                // Increment client nonce (128-bit little-endian counter)
                for (int i = 0; i < OcbAes.BLOCK_SIZE; i++)
                    if ((++_clientNonce[i]) != 0)
                        break;

                byte[] tag = new byte[OcbAes.BLOCK_SIZE];
                byte[] ciphertext = _aes.Encrypt(source, 0, length, _clientNonce, 0, tag, 0);

                // Build packet: [nonce_lsb, tag[0], tag[1], tag[2], ciphertext...]
                byte[] packet = new byte[length + 4];
                packet[0] = _clientNonce[0];
                packet[1] = tag[0];
                packet[2] = tag[1];
                packet[3] = tag[2];
                Buffer.BlockCopy(ciphertext, 0, packet, 4, length);

                return packet;
            }
            finally
            {
                _aesLock.ExitWriteLock();
            }
        }
    }
}
