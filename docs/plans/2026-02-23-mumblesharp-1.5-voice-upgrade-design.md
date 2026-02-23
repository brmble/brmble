# MumbleSharp 1.5.x Voice Protocol Upgrade Design

**Goal:** Upgrade MumbleSharp to support Mumble 1.5.x voice protocol (both send and receive) while maintaining backward compatibility with older servers.

## Background

Mumble 1.5.x introduced a breaking change to UDP voice packets:
- **Pre-1.5:** Custom binary format (1-byte header + varint session/sequence + opus data)
- **1.5+:** Protobuf format via MumbleUDP.proto (Audio and Ping messages)

## Architecture

### Version Detection
- On connection, server sends `Version` message
- Mumble 1.5 servers use new version format (`version_v2` = uint64)
- Negotiate capability based on version (or explicit capability flag if added later)

### Packet Parsing Strategy

```
MumbleConnection
├── UDPSocket (receives encrypted packets)
├── Decrypts packet
├── Check packet type (type byte or Protobuf)
├── If Protobuf (1.5+) → NewVoicePacketHandler
│   ├── Parse Audio/ping Protobuf
│   ├── Extract session, frame_number, opus_data
│   └── Pass to existing codec
└── If Binary (legacy) → OldVoicePacketHandler
    ├── Parse binary header
    ├── Extract session, sequence, opus data
    └── Pass to existing codec
```

### Components to Modify

1. **MumbleConnection.cs** - Add version tracking and packet routing
2. **New: VoicePacketHandler15.cs** - Protobuf voice packet handling
3. **Existing: UdpPacketReader** - Keep for legacy parsing
4. **Codecs** - No changes needed (Opus encoder/decoder works)

### Backward Compatibility

- Default to legacy parser
- Switch to 1.5 parser only when server version >= 1.5.0
- Both send and receive must handle version detection

## New Protobuf Message (MumbleUDP.proto)

```protobuf
message Audio {
    oneof Header {
        uint32 target = 1;      // Client→Server: audio target
        uint32 context = 2;      // Server→Client: 0=normal, 1=shout, 2=whisper, 3=listener
    };
    uint32 sender_session = 3;
    uint64 frame_number = 4;
    bytes opus_data = 5;
    repeated float positional_data = 6;
    float volume_adjustment = 7;
    bool is_terminator = 16;
}

message Ping {
    uint64 timestamp = 1;
    bool request_extended_information = 2;
    uint64 server_version_v2 = 3;
    uint32 user_count = 4;
    uint32 max_user_count = 5;
    uint32 max_bandwidth_per_user = 6;
}
```

## Implementation Tasks

1. Add MumbleUDP.proto to project
2. Generate C# from proto (protobuf-net)
3. Add server version tracking in MumbleConnection
4. Create VoicePacketHandler15 with Protobuf parsing
5. Route packets based on version
6. Test with 1.5.x server
7. Test backward compatibility with older servers

## Testing

1. Connect to Mumble 1.5.x server - verify voice receive
2. Transmit voice to server - verify send works
3. Connect to Mumble 1.2.x/1.4.x server - verify legacy still works
4. Test TCP tunnel path with 1.5.x server

## Future Considerations (Reminder)

- [ ] Review CryptState for 1.5.x nonce handling changes
- [ ] Review TCP tunnel implementation for 1.5.x compatibility
- [ ] Add listener proxy support (listening_channel_add/remove)
- [ ] Add recording flag support

## Reference

- MumbleUDP.proto: https://raw.githubusercontent.com/mumble-voip/mumble/master/src/MumbleUDP.proto
- Protocol change PR: https://github.com/mumble-voip/mumble/pull/5594
