# Brmble - Authentication System Engineering Specification

## Overview

This document describes the authentication architecture for Brmble, a self-hosted gaming communication platform that unifies Mumble (voice), Matrix/Continuwuity (persistent chat), and LiveKit (screen sharing) under a single identity rooted in X.509 client certificates. The design prioritizes zero-friction UX, full compatibility with standard Mumble clients, and clean separation of concerns between services.

## Core Principle

**The client certificate is the identity.** A self-signed X.509 certificate generated on first launch is the root of trust. Mumble handles its own certificate-based authentication natively. The ASP.NET backend observes Mumble protocol events to maintain an independent identity mapping that drives Matrix and LiveKit access.

**If the certificate is lost, the identity is lost.** A new certificate always means a new user, even if the same username is reused.

---

## 1. Certificate Lifecycle

### 1.1 Generation

On first launch, Brmble presents a certificate wizard (matching the standard Mumble client behavior):

1. **Welcome screen** explaining that the certificate is the user's identity across voice, chat, and screen sharing
2. **Choice:** Generate a new certificate or import an existing one (.pfx / .p12)
3. **Warning (prominent):** "Your certificate is your identity. If you lose this certificate, you will start over as a new user with no chat history. Back up your certificate now or export it later from Settings."
4. **Certificate generation** (if not importing):
   - Type: Self-signed X.509 v3
   - Key: RSA 2048-bit or ECDSA P-256 (match what Mumble clients typically generate)
   - Lifetime: No expiry (or very long, e.g. 100 years), consistent with Mumble conventions
5. **Prompt to export/back up** the certificate immediately, with an option to skip

Storage: PKCS#12 (.pfx) file in the apps local data directory (e.g. %AppData%/Brmble/identity.pfx)

The wizard should closely follow the standard Mumble certificate wizard UX so users familiar with Mumble feel at home, but with stronger emphasis on the consequences of certificate loss since in Brmble the certificate also governs chat history and screen sharing identity, not just voice.

### 1.2 Persistence and Backup

- The .pfx file must survive application updates
- Provide a prominent **Export Certificate** option in Settings so users can back up at any time
- The certificate wizard (section 1.1) handles the initial backup prompt, but consider periodic reminders for users who skipped the initial export

### 1.3 Loss Policy

If the certificate is lost (e.g. Windows reinstall without backup), the user is a new user. A new certificate always creates a new identity with a new Matrix account and empty chat history, even if the user reuses the same Mumble username after an admin frees it up.

---

## 2. Mumble Authentication

### 2.1 How Mumble Handles Auth Natively

Mumble uses a TLS control channel (TCP). During the TLS handshake, the client presents its certificate. The server extracts a SHA-1 hash of the certificate and uses it as the user identity.

Connection sequence:

1. TCP connection established
2. TLS handshake - client presents certificate, server extracts cert hash
3. Client sends Version protobuf message
4. Client sends Authenticate message (username, optional password, codec info)
5. Server responds with either Reject or proceeds to sync (CryptSetup, ChannelState, UserState, ServerSync)

The Authenticate message (from Mumble.proto):

```protobuf
message Authenticate {
    optional string username = 1;
    optional string password = 2;   // NOT USED in cert-only auth
    repeated string tokens = 3;     // ACL access tokens
    repeated int32 celt_versions = 4;
    optional bool opus = 5 [default = false];
    optional int32 client_type = 6 [default = 0]; // 0 = REGULAR, 1 = BOT
}
```

In our architecture, password is always empty. Authentication is purely certificate-based.

### 2.2 Registration

Registration binds a cert hash to a username in the Mumble server database. This happens through the standard Mumble protocol.

**To register a connected user (admin action):**

- Send a UserState message with the target users session and user_id = 0
- Server interprets this as "register this user" and binds their cert hash + username to a new permanent user_id
- Server broadcasts an updated UserState to all clients with the assigned user_id

**To unregister a user (admin action):**

- Client sends an empty UserList message to query all registered users
- Server responds with full UserList
- Client sends back a UserList with the target user omitted
- Server diffs and removes the missing user

Relevant protobuf messages:

```protobuf
message UserState {
    optional uint32 session = 1;     // Session ID (transient, per-connection)
    optional uint32 actor = 2;       // Who initiated the change
    optional string name = 3;        // Username
    optional uint32 user_id = 4;     // Registered user ID (present if registered)
    optional uint32 channel_id = 5;
    // ... other fields ...
    optional string hash = 15;       // Certificate SHA-1 hash
    // ... other fields ...
}

message UserList {
    message User {
        required uint32 user_id = 1;
        optional string name = 2;
        optional string last_seen = 3;
        optional uint32 last_channel = 4;
    }
    repeated User users = 1;
}
```

### 2.3 Rejection on Auth Failure

When a user connects with a username that is registered to a different cert hash, the server sends:

```protobuf
message Reject {
    enum RejectType {
        None = 0;
        WrongVersion = 1;
        InvalidUsername = 2;
        WrongUserPW = 3;      // This is the one for cert mismatch
        WrongServerPW = 4;
        UsernameInUse = 5;
        ServerFull = 6;
        NoCertificate = 7;
        AuthenticatorFail = 8;
        NoNewConnections = 9;
    }
    optional RejectType type = 1;
    optional string reason = 2;
}
```

WrongUserPW (type 3) is sent when the cert hash does not match the registered user. The client should display a clear error message explaining that the username is tied to a different certificate and the user needs to either restore their old certificate or choose a new username.

### 2.4 Compatibility

All registration and admin operations use standard Mumble protocol messages. This means:

- A standard Mumble client admin can register/unregister users, and our system sees it
- Our custom client admin can register/unregister users, and standard Mumble clients see it
- **Full cross-compatibility is maintained**

---

## 3. Backend Identity Mapping

### 3.1 The Backend Role

The ASP.NET Core backend observes Mumble protocol events and maintains its own identity table to drive Matrix and LiveKit access.

### 3.2 Data Model

The backend maintains its own user table:

```sql
CREATE TABLE users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    cert_hash       TEXT NOT NULL UNIQUE,
    display_name    TEXT NOT NULL,
    matrix_user_id  TEXT NOT NULL UNIQUE,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

| Column | Description |
|---|---|
| id | Backend-generated auto-incrementing ID, used as the Matrix user identifier |
| cert_hash | SHA-1 certificate hash as received from Mumble UserState.hash (field 15) |
| display_name | The users Mumble username at time of registration |
| matrix_user_id | The Matrix account ID, derived as @id:server_domain |
| created_at | Timestamp of identity creation |

Key design decisions:

- **cert_hash is the natural key.** It is globally unique and tied to a single certificate
- **Matrix user IDs are based on id, not username.** This prevents a re-registered user from accessing a previous identity's DMs. E.g. @42:yourserver, never @pieterhenk:yourserver
- **Display name is cosmetic.** Shown in Brmble UI via the display name field, not the account ID
- **Mumble user_id is not used.** We do not depend on whether Mumble recycles IDs after unregistration

### 3.3 Event-Driven Sync via MumbleSharp

The C# host maintains a persistent MumbleSharp connection and observes UserState messages.

On every UserState received (during initial sync and on user connect):

```
IF UserState contains both hash (field 15) AND user_id (field 4):
    Look up hash in backend users table
    IF not found:
        -> New registered user. Create backend user record.
        -> Provision Matrix account: @new_id:server_domain
        -> Store mapping
    IF found but display_name differs:
        -> User renamed in Mumble. Update display_name.
        -> Update Matrix display name.
```

UserState messages are broadcast by the server for every connected user during the login sync phase and whenever a user state changes. This gives the backend a real-time, complete view of all connected users and their cert hashes without ever touching Mumble internal storage.

---

## 4. Token Issuance for Matrix and LiveKit

### 4.1 Matrix (Continuwuity)

When a user needs a Matrix access token:

1. C# host establishes the Mumble connection (cert verified by Mumble server)
2. C# host calls the ASP.NET backend API: "I am cert hash X, give me a Matrix token"
3. Backend verifies the cert hash corresponds to an active Mumble session (either via mutual TLS or by checking against the live UserState data from MumbleSharp)
4. Backend uses the Continuwuity admin API to issue an access token for the corresponding Matrix account (@id:server_domain)
5. Returns the token to the C# host
6. C# host passes the token to the React frontend for use with the Matrix JS SDK

First-time provisioning:

- Backend uses Continuwuity admin API with shared secret registration to create the Matrix user account
- Sets the display name to match the Mumble username

### 4.2 LiveKit

LiveKit uses JWT tokens for authentication:

1. C# host requests a LiveKit token from the backend (same auth as above)
2. Backend generates a JWT using the livekit-server-sdk NuGet package containing:
   - User identity (cert hash or backend user ID)
   - Display name
   - Room grants (permissions for screen share, publish, subscribe)
3. Returns the JWT to the C# host
4. C# host passes it to the React frontend for use with LiveKit React components

---

## 5. Certificate Loss

### 5.1 Policy

A new certificate always means a new user. Even if an admin unregisters the old Mumble username and the user re-registers with the same name, the backend sees a new cert hash and creates a new user record with a new Matrix account. The old chat history stays with the old (now inaccessible) identity.

If a user loses their certificate, they must:

1. Choose a new username, or have an admin free up their old one via UserList
2. Get registered by an admin
3. They will have a fresh Matrix account with no history

### 5.2 Client UX for Cert Mismatch

When the client receives a Reject(WrongUserPW) response from the Mumble server:

1. Display a clear error: "This username is registered to a different certificate. If you lost your certificate, you will need to register as a new user with a different username, or ask an admin to free up your old name."
2. Prompt the user to enter a different username
3. Reconnect with the new username
4. Normal registration flow proceeds once an admin registers them

An admin can unregister the old username/cert binding via UserList, which frees up the name. The user can then reconnect with their old username and get registered with their new certificate. They will still be a new user with a fresh Matrix account and no chat history.

### 5.3 Why This Works

- Identity is always derived from the cert hash, so the system stays simple and consistent
- No special recovery flows to build or maintain
- Prevents impersonation (someone claiming to be a user who "lost their cert")
- On a small gaming server, losing chat history is a minor inconvenience

---

## 6. Architecture Diagram

```
                        +------------------------------+
                        |       Mumble Server           |
                        |    (mumble-server/Docker)     |
                        |                               |
                        |  - Native cert-based auth     |
                        |  - Registration via protocol  |
                        |  - No modifications needed    |
                        +-----+------------------------+
                              | TCP/TLS
                              | (users)
                              |
              +---------------+
              |
    +---------v----------+                    +------------------------+
    |   Brmble Client     |                    |   ASP.NET Backend    |
    |   (C# Host +        |<--- REST/WS ----->|                      |
    |    WebView2/React)  |                    |  - Identity table    |
    |                      |                    |  - Matrix token      |
    |  - MumbleSharp fork  |                    |    issuance          |
    |  - Cert management   |                    |  - LiveKit JWT       |
    |  - Reject intercept  |                    |    generation        |
    |  - Admin UI          |                    |    generation        |
    +---------+------------+                    +--+----------+-------+
              |                                    |          |
              |                         +----------v+   +-----v------+
              |                         | Continuwuity|   |  LiveKit   |
              |                         |  (Matrix)   |   |   SFU     |
              |                         +-------------+   +----------+
              |
    +---------v----------+
    |  Standard Mumble    |
    |  Client (optional)  |
    |                     |
    |  Full admin compat  |
    +---------------------+
```

---

## 7. Docker Compose Topology

All services run in a single docker-compose.yml on one Linux server:

| Container | Ports | Notes |
|---|---|---|
| mumble-server | Configured TCP+UDP port | Stock image, no modifications |
| backend | Internal only (or 443 for client API) | ASP.NET Core, connects to Mumble via MumbleSharp |
| continuwuity | Internal only (8448 for federation if needed) | Matrix server, admin API accessible to backend |
| livekit | 7880, 7881, UDP range | SFU for screen sharing |

The backend and mumble-server containers communicate over the Docker network. No Ice, no gRPC, no shared volumes needed for authentication purposes.

---

## 8. Security Considerations

- **Self-signed certs are sufficient.** Mumble model does not require CA-signed certificates. The cert hash is the identity, not the trust chain.
- **Mutual TLS for backend API.** Consider having the C# host present its Mumble certificate when calling the backend API. This gives the backend cryptographic proof of the caller identity without needing a separate auth mechanism.
- **Matrix tokens are short-lived.** Issue access tokens with reasonable expiry and refresh them via the backend.
- **LiveKit JWTs are scoped.** Include only the necessary room grants and set short expiry.
- **No passwords anywhere.** The password field in Authenticate is never used. Consider configuring mumble-server to not require a server password either, since access control is handled by your infrastructure.
- **New cert = new user.** A new certificate always creates a fresh identity regardless of username reuse, which naturally prevents impersonation.

---

## 9. MumbleSharp Fork Requirements

The forked MumbleSharp library (updated to 1.5.x protocol) must expose or support:

| Capability | Used For |
|---|---|
| Send/receive UserState | Observing cert hashes, triggering registration |
| Access UserState.hash (field 15) | Cert hash for identity mapping |
| Access UserState.user_id (field 4) | Detecting registered vs unregistered users |
| Send/receive UserList | Admin: unregistering users |
| Send UserState with user_id = 0 | Admin: registering a connected user |
| Receive Reject messages with type | Intercepting auth failures for client error UX |

If any of these are not currently exposed in the fork, they need to be added. All are standard Mumble protocol messages defined in Mumble.proto.
