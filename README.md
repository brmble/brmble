# Brmble

Self-hosted gaming communication. Voice over Mumble, persistent chat over Matrix, screen sharing over LiveKit — wrapped in a single desktop client (Windows only).

The client is a native desktop app with a modern web-based UI inside, including theming and a familiar chat-app layout.

## Screenshots

_Coming soon._

## Mumble compatibility

Brmble is built on top of Mumble, not as a replacement. The voice server is an unmodified Mumble server. That means:

- **Standard Mumble clients work without changes.** Anyone with the official Mumble client (or any third-party Mumble client) can connect to the same server and talk to Brmble users in the same channels.
- **Mixed use is the intended setup.** A server with the Brmble container running alongside Mumble can host both kinds of clients at the same time. Brmble clients get voice + persistent chat + screen sharing; standard Mumble clients get voice only. Everyone shares the same channels and can hear each other.
- **No fork, no patched server.** Brmble does not modify the Mumble protocol or the Mumble server. The chat and screen-sharing features live in a separate Brmble container that sits next to Mumble. If you turn the Brmble container off, your server is back to plain Mumble.

The only requirement for cross-client interop is that the Brmble container has to be reachable for clients that want chat and screen sharing. Standard Mumble clients ignore it.

## Architecture

```
                    ┌──────────────────────────────┐
                    │  Brmble Server (1 container) │
                    │  ┌────────────┐              │
                    │  │ ASP.NET    │  HTTP :8080  │── client API + /_matrix proxy
                    │  ├────────────┤              │
                    │  │ Continuwuity (Matrix)     │── persistent chat
                    │  ├────────────┤              │
                    │  │ LiveKit SFU │  :7881 +UDP │── screen sharing
                    │  └────────────┘              │
                    └─────────────┬────────────────┘
                                  │ ICE :6502 (optional, for user mapping)
                                  ▼
                    ┌──────────────────────────────┐
                    │  Mumble Server (separate)    │── voice (TCP/UDP :64738)
                    └──────────────────────────────┘
```

The Brmble server bundles ASP.NET Core, Continuwuity (Matrix homeserver) and LiveKit into one image. Mumble runs separately — Brmble does not replace it.

## Install the client

Download the latest release from <https://github.com/brmble/brmble/releases/latest>:

- `Brmble-win-Setup.exe` — installer, auto-updates from GitHub releases.
- `Brmble-win-Portable.zip` — standalone, no install, no auto-update.

Windows 10/11 only. The client embeds WebView2 (installed automatically by the setup if missing).

On first launch the client generates a self-signed X.509 certificate that becomes your identity across voice, chat and screen sharing. **Back it up via Settings → Export Certificate.** If the certificate is lost, you become a new user with empty chat history, even if you reuse the same Mumble username.

## Install the server

You need two containers: one for Mumble, one for Brmble. The Brmble container speaks HTTPS directly on port `8080` with a built-in self-signed certificate; the Brmble client trusts it without any extra setup. No browser ever talks to it directly — only the Brmble client does.

### 1. Mumble server

The official image works as-is, but a few settings matter for the Brmble integration:

```yaml
services:
  mumble:
    image: mumblevoip/mumble-server:latest
    restart: unless-stopped
    ports:
      - "64738:64738"
      - "64738:64738/udp"
    volumes:
      - mumble-data:/data
    environment:
      # Required for Brmble integration
      MUMBLE_CONFIG_ALLOWHTML: "true"
      MUMBLE_CONFIG_ICE: "tcp -h 0.0.0.0 -p 6502"
      MUMBLE_CONFIG_WELCOMETEXT: |
        <br/>Welcome to my server.<br/>
        <!--brmble:{"apiUrl":"https://chat.example.com:8080"}-->

      # Recommended (lets Brmble post images, long messages and embeds)
      MUMBLE_CONFIG_IMAGEMESSAGELENGTH: "0"
      MUMBLE_CONFIG_TEXTMESSAGELENGTH: "0"
      MUMBLE_ACCEPT_UNKNOWN_SETTINGS: "true"

volumes:
  mumble-data:
```

Key points:

- **`allowhtml=true`** — required. The Brmble client embeds an HTML comment in the welcome text that points the client to the Brmble server (see below). Mumble strips HTML comments unless HTML is allowed.
- **`MUMBLE_CONFIG_WELCOMETEXT`** — must include an HTML comment of the form `<!--brmble:{"apiUrl":"https://<host>:<port>"}-->`, e.g. `https://chat.example.com:8080` or `https://203.0.113.10:8080`. This is how a Brmble client discovers the matching Brmble server when a user connects to your Mumble server. Plain Mumble clients ignore the comment.
- **`MUMBLE_CONFIG_ICE`** — exposes Mumble's ICE control plane on TCP `6502` so the Brmble server can map Mumble sessions to Matrix users. Bind it to a private network (or the docker-compose internal network) — never expose it to the public internet. Set an ICE secret on Mumble and pass the same value to Brmble via `Ice__Secret` if you need authentication.
- `IMAGEMESSAGELENGTH` and `TEXTMESSAGELENGTH` default to small values; `0` means unlimited and is required for embeds, link previews and longer messages.

### 2. Brmble server

```yaml
services:
  brmble:
    image: ghcr.io/brmble/brmble-server:latest
    restart: unless-stopped
    ports:
      - "8080:8080"                   # HTTPS (self-signed)
      - "7881:7881"                   # LiveKit RTC TCP
      - "50100-50200:50100-50200/udp" # LiveKit RTC UDP
    volumes:
      - brmble-data:/data
    environment:
      # Required
      MATRIX_SERVER_NAME: chat.example.com
      MATRIX_APPSERVICE_TOKEN: ${MATRIX_APPSERVICE_TOKEN}

      # Optional — connect to your Mumble server's ICE endpoint
      Ice__Host: mumble
      Ice__Port: "6502"
      Ice__Secret: ""

      # Optional — force LiveKit to advertise a specific public IP
      # LIVEKIT_NODE_IP: "203.0.113.10"

volumes:
  brmble-data:
```

Required environment:

| Variable | Description |
|---|---|
| `MATRIX_SERVER_NAME` | Public Matrix domain. Should match the host clients reach (e.g. `chat.example.com`). Matrix user IDs become `@<id>:<MATRIX_SERVER_NAME>`. Cannot be changed after first start without resetting `/data`. |
| `MATRIX_APPSERVICE_TOKEN` | Shared secret between the bundled Matrix homeserver and the Brmble backend. Generate with `openssl rand -hex 32`. Keep stable across restarts. |

Optional environment:

| Variable | Default | Description |
|---|---|---|
| `Ice__Host` / `Ice__Port` / `Ice__Secret` | `mumble-server` / `6502` / *(empty)* | Mumble ICE endpoint. Without this, Mumble↔Matrix user mapping is disabled. |
| `LIVEKIT_NODE_IP` | *(auto)* | Pin LiveKit's advertised IP. Useful for local/LAN setups; leave unset on public servers and LiveKit will auto-detect. |
| `MATRIX_ADMIN_USER` / `MATRIX_ADMIN_PASSWORD` | `brmble-admin` / *(generated)* | Override the auto-created Matrix admin. Generated password is stored in `/data/admin-password`. |
| `MATRIX_ALLOW_REGISTRATION` | `false` | Set to `true` to allow open Matrix registration after first-run setup. Brmble does not need this — clients register themselves via the appservice. |
| `CONDUWUIT_STARTUP_TIMEOUT` | `60` | Seconds to wait for the Matrix homeserver on first boot. |

Ports:

- `8080/tcp` — single HTTPS entry point, served with a built-in self-signed certificate. The Brmble client accepts the self-signed cert directly. Map it to a different host port if `8080` is already in use.
- `7881/tcp` and `50100-50200/udp` — LiveKit RTC. Expose these directly. UDP is what actually carries WebRTC media; TCP `7881` is fallback only.

The first start runs ~30 seconds while the bundled Matrix homeserver initialises and registers the appservice. State after first start lives entirely in the `brmble-data` volume.

## Connecting the client

1. Open the Brmble client and add a server.
2. Enter the Mumble host (e.g. `mumble.example.com:64738`) and a username.
3. On connect, the client reads Mumble's welcome text, pulls the `apiUrl` out of the `<!--brmble:{...}-->` marker, and starts talking to the Brmble server for chat and screen sharing.

A user connecting with a standard Mumble client skips all of the above and gets voice only. They share channels with Brmble users normally — the two client types coexist on the same server without any extra configuration.

## Updating

- **Client**: auto-updates from GitHub releases on installer builds; portable builds need to be replaced manually.
- **Server**: pull a newer image and recreate the container. The `/data` volume migrates automatically.
  ```bash
  docker compose pull brmble && docker compose up -d brmble
  ```

## Building from source

Requirements: .NET 10 SDK, Node 20+, Docker.

```bash
# Server image
docker build -t brmble-server:dev -f src/Brmble.Server/Dockerfile .

# Client (Windows)
cd src/Brmble.Web && npm install && npm run build
dotnet publish src/Brmble.Client/Brmble.Client.csproj -c Release -r win-x64 --self-contained -o publish
```

For day-to-day development, see [`CLAUDE.md`](CLAUDE.md) (running the client with hot reload, Docker setup, build commands).

## Repository layout

```
src/Brmble.Server/   ASP.NET backend, Dockerfile, Matrix/LiveKit glue
src/Brmble.Client/   Win32 + WebView2 desktop client
src/Brmble.Web/      React + Vite frontend (rendered inside the client)
lib/MumbleSharp/     Mumble protocol library (vendored)
docker-local/        docker-compose for local dev (Mumble + Brmble)
docs/                Architecture notes, specs, integration guides
```

Relevant docs:

- [`docs/tech-stack.md`](docs/tech-stack.md) — component overview and licensing
- [`docs/auth-specification.md`](docs/auth-specification.md) — certificate-based identity model
- [`docs/mumble-integration-guide.md`](docs/mumble-integration-guide.md) — how the client talks to Mumble
