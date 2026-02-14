# Communication Platform — Tech Stack Overview

**Version 1.0 | February 2026**

---

## Project Vision

A modern, self-hosted communication platform built around Mumble's proven low-latency voice engine. The goal: a Discord-like experience with crystal-clear voice, persistent text chat, and gaming screen sharing — all running on your own infrastructure. No subscriptions, no telemetry, no vendor lock-in.

Every component is open source and permissively licensed (Apache 2.0, MIT, or BSD).

---

## Stack at a Glance

| Component | Technology | Role | License |
|-----------|-----------|------|---------|
| Voice Server | Mumble | Low-latency voice chat | BSD-3-Clause |
| Chat Server | Continuwuity (Matrix) | Persistent text messaging | Apache 2.0 |
| Screen Sharing | LiveKit SFU | WebRTC video streaming | Apache 2.0 |
| Backend API | ASP.NET Core + YARP | Auth, tokens, glue logic | MIT |
| Desktop Client | C# + WebView2 | Native app with web UI | Proprietary |

---

## Voice — Mumble

Mumble is the backbone of the platform. It provides the lowest-latency voice communication of any available solution, purpose-built for gaming.

**Why Mumble:**
- **Latency:** Sub-30ms voice transmission, significantly outperforming WebRTC-based alternatives
- **Protocol:** TCP+TLS for control (Protobuf), UDP with OCB2-AES128 encryption for voice
- **Codec:** Opus with automatic bitrate adaptation
- **Server RAM:** ~50 MB

**Client implementation (two libraries working together):**
- **MumbleSharp** — Control plane: TCP connection, authentication, user/channel state, text messages, server events. Also handles UDP transport (encryption, sending/receiving voice packets over the wire).
- **MumbleVoiceEngine** — Custom voice pipeline: Opus encode/decode, PCM buffering. Replaces MumbleSharp's built-in audio pipeline which has quality issues (unbounded encoding buffer causes progressive jitter, fixed 350ms decode buffer adds latency).
- **Audio I/O:** NAudio for capture and playback on Windows
- **Status:** ✅ UDP voice connection tested and working

---

## Persistent Chat — Matrix (Continuwuity)

Text chat uses the Matrix protocol with Continuwuity as the homeserver. Continuwuity is a Rust-based, single-binary Matrix server with an embedded RocksDB database — no PostgreSQL, no external dependencies.

**Server:**
- Single static binary, runs in Docker
- Embedded RocksDB (no external DB required)
- ~100–200 MB RAM
- Bundled inside the main application container, proxied through YARP

**Client integration:**
- **SDK:** matrix-js-sdk in the WebView2 frontend
- **Features:** Persistent history, room-based channels, message search, read receipts
- **Channel mapping:** Mumble channels map 1:1 to Matrix rooms

---

## Screen Sharing — LiveKit

LiveKit provides WebRTC-based screen sharing optimized for streaming gaming sessions to one or two viewers. The server acts as a Selective Forwarding Unit (SFU) — it routes video packets without transcoding.

**Configuration:**
- **Resolution:** 1080p60 (configurable up to 1440p60)
- **Codec:** VP9 preferred for quality, H264 for hardware acceleration, VP8 as fallback
- **Content hint:** Motion mode for gaming, detail mode for desktop/code sharing
- **Hardware encoding:** NVENC (Nvidia) or QuickSync (Intel) via Chromium's WebRTC stack in WebView2

**Server resource usage:**
- **CPU:** Minimal — SFU only forwards packets, no transcoding
- **RAM:** ~200–300 MB
- **Bandwidth:** 8–15 Mbps per viewer at 1080p60 full-motion gaming

**Client integration:**
- **Frontend SDK:** livekit-client (JavaScript) in WebView2
- **Backend SDK:** Livekit.Server.Sdk.Dotnet (NuGet) for JWT token generation and room management

---

## Backend API — ASP.NET Core

A thin ASP.NET Core backend serves as the single HTTP entry point. It hosts the application's own API and reverse-proxies Matrix traffic to Continuwuity using YARP.

**Responsibilities:**
- **Authentication:** Unified user management across Mumble, Matrix, and LiveKit
- **Token generation:** LiveKit JWT access tokens with per-room permissions
- **Reverse proxy:** YARP forwards `/_matrix/*` requests to Continuwuity on localhost
- **Channel sync:** Maps Mumble channels → Matrix rooms → LiveKit rooms

---

## Desktop Client — C# + WebView2

The native desktop application uses C# for system-level functionality and WebView2 (Chromium) for the user interface.

**C# layer:**
- MumbleSharp for control plane + UDP transport, MumbleVoiceEngine for voice pipeline
- NAudio for audio device capture/playback
- System integration: tray icon, notifications, audio device management

**WebView2 layer (React + Vite):**
- React frontend bundled with Vite
- matrix-js-sdk for real-time messaging and history
- livekit-client for publishing and viewing screen shares
- WebView2 PostWebMessage API for C# ↔ JS communication

---

## Deployment Architecture

The entire server-side stack runs on a single Linux machine with a 1 Gbps symmetrical connection. All services are containerized with Docker Compose.

| Container | Ports | RAM | Notes |
|-----------|-------|-----|-------|
| App (Backend + Matrix) | 8080 (HTTP) | ~400 MB | Single container |
| LiveKit SFU | 7880 + UDP range | ~200–300 MB | Host networking |
| Mumble Server | 64738 TCP/UDP | ~50 MB | Untouched |
| **Total** | | **< 1 GB** | |

---

## Licensing Summary

All server-side components use permissive open-source licenses with no copyleft obligations.

| Component | License | Commercial Use |
|-----------|---------|----------------|
| Mumble Server | BSD-3-Clause | ✅ |
| Continuwuity | Apache 2.0 | ✅ |
| LiveKit Server | Apache 2.0 | ✅ |
| LiveKit .NET SDK | Apache 2.0 | ✅ |
| matrix-js-sdk | Apache 2.0 | ✅ |
| MumbleSharp | MIT | ✅ |
| ASP.NET Core / YARP | MIT | ✅ |
