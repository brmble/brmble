namespace MumbleVoiceEngine;

using MumbleVoiceEngine.Crypto;
using MumbleVoiceEngine.Pipeline;
using MumbleVoiceEngine.Protocol;
using NAudio.Wave;
using System.Collections.Concurrent;

/// <summary>
/// Public API for the Mumble voice engine. Ties together crypto, encode/decode
/// pipelines, and per-user audio management.
/// </summary>
public class VoiceEngine : IDisposable
{
    private CryptState? _cryptState;
    private EncodePipeline? _encodePipeline;
    private readonly ConcurrentDictionary<uint, UserAudioPipeline> _users = new();

    public bool IsCryptoReady => _cryptState?.Initialized ?? false;

    /// <summary>
    /// Fired when an encrypted voice packet is ready to send via UDP.
    /// Parameters: (byte[] data, int length)
    /// </summary>
    public event Action<byte[], int>? OnEncryptedPacketReady;

    /// <summary>
    /// Initialize crypto from server's CryptSetup message.
    /// </summary>
    public void SetCryptKey(byte[] key, byte[] clientNonce, byte[] serverNonce)
    {
        _cryptState = new CryptState();
        _cryptState.SetKeys(key, clientNonce, serverNonce);

        _encodePipeline = new EncodePipeline(
            sampleRate: 48000,
            channels: 1,
            bitrate: 72000,
            onPacketReady: OnVoicePacketEncoded
        );
    }

    private void OnVoicePacketEncoded(ReadOnlyMemory<byte> voicePacket)
    {
        if (_cryptState == null || !_cryptState.Initialized)
            return;

        byte[] encrypted = _cryptState.Encrypt(voicePacket.ToArray(), voicePacket.Length);
        if (encrypted != null)
            OnEncryptedPacketReady?.Invoke(encrypted, encrypted.Length);
    }

    /// <summary>
    /// Feed raw encrypted UDP packet from the network.
    /// Decrypts, parses, and routes to the appropriate user's decode pipeline.
    /// </summary>
    public void ReceiveEncryptedPacket(byte[] data, int length)
    {
        if (_cryptState == null)
            return;

        byte[]? plaintext = _cryptState.Decrypt(data, length);
        if (plaintext == null)
            return;

        var parsed = VoicePacketParser.Parse(plaintext);
        if (parsed == null)
            return;

        var p = parsed.Value;
        var pipeline = _users.GetOrAdd(p.Session, _ => new UserAudioPipeline());
        pipeline.FeedEncodedPacket(p.OpusData, p.Sequence);
    }

    /// <summary>
    /// Get audio output for a specific user. Wire to WaveOut/WASAPI for playback.
    /// </summary>
    public IWaveProvider? GetUserAudio(uint sessionId)
    {
        return _users.TryGetValue(sessionId, out var pipeline) ? pipeline : null;
    }

    /// <summary>
    /// Remove a user's audio pipeline when they disconnect.
    /// </summary>
    public void RemoveUser(uint sessionId)
    {
        if (_users.TryRemove(sessionId, out var pipeline))
            pipeline.Dispose();
    }

    /// <summary>
    /// Submit raw PCM from microphone. Encodes and encrypts automatically.
    /// </summary>
    public void SubmitMicAudio(ReadOnlySpan<byte> pcm)
    {
        _encodePipeline?.SubmitPcm(pcm);
    }

    public void Dispose()
    {
        _encodePipeline?.Dispose();
        foreach (var pipeline in _users.Values)
            pipeline.Dispose();
        _users.Clear();
    }
}
