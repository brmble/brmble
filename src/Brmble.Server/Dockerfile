# syntax=docker/dockerfile:1

ARG LIVEKIT_VERSION=v1.9.11
ARG CONTINUWUITY_VERSION=v0.4.6

# ── Stage 1: Download third-party binaries ────────────────────────────────────
FROM debian:bookworm-slim AS downloader

ARG LIVEKIT_VERSION
ARG CONTINUWUITY_VERSION

RUN apt-get update && apt-get install -y --no-install-recommends curl tar ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# LiveKit server
RUN LKVER="${LIVEKIT_VERSION#v}" && \
    curl -fsSL "https://github.com/livekit/livekit/releases/download/${LIVEKIT_VERSION}/livekit_${LKVER}_linux_amd64.tar.gz" \
    | tar -xz -C /usr/local/bin livekit-server && \
    chmod +x /usr/local/bin/livekit-server

# Continuwuity (conduwuit) — static musl binary (filename is version-independent)
RUN curl -fsSL -o /usr/local/bin/continuwuity \
    "https://github.com/girlbossceo/conduwuit/releases/download/${CONTINUWUITY_VERSION}/static-x86_64-unknown-linux-musl" && \
    chmod +x /usr/local/bin/continuwuity

# ── Stage 2: Build Brmble.Server ─────────────────────────────────────────────
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY Directory.Build.props .
COPY src/Brmble.Server/ src/Brmble.Server/

RUN dotnet publish src/Brmble.Server/Brmble.Server.csproj \
    -c Release \
    -r linux-x64 \
    --no-self-contained \
    -o /app/publish

# ── Stage 3: Runtime image ────────────────────────────────────────────────────
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends supervisor curl jq \
    && rm -rf /var/lib/apt/lists/*

# Brmble.Server
COPY --from=build /app/publish /app

# Third-party binaries
COPY --from=downloader /usr/local/bin/livekit-server /usr/local/bin/
COPY --from=downloader /usr/local/bin/continuwuity /usr/local/bin/

# Config files
COPY src/Brmble.Server/docker/supervisord.conf /etc/supervisord.conf
COPY src/Brmble.Server/docker/livekit.yaml /etc/livekit/livekit.yaml
COPY src/Brmble.Server/docker/entrypoint.sh /entrypoint.sh
COPY src/Brmble.Server/docker/register-appservice.sh /register-appservice.sh
COPY src/Brmble.Server/docker/wait-for-appservice.sh /wait-for-appservice.sh
RUN chmod +x /entrypoint.sh /register-appservice.sh /wait-for-appservice.sh

# Data volume (SQLite + Continuwuity RocksDB)
VOLUME /data

# Single public port — everything goes through YARP
EXPOSE 8080

# LiveKit RTC ports (direct, not proxied)
EXPOSE 7881
EXPOSE 50100-50200/udp

WORKDIR /app
ENTRYPOINT ["/entrypoint.sh"]
