# Branch Analyse: `codex/Companio-visable`

**Geanalyseerd:** 2026-05-13  
**Basis:** `main`  
**Totale wijzigingen:** +1951 / -50 regels over 23 bestanden  
**8 commits** — van `feat(server): persist companion selection on users` tot `fix: address PR review feedback`

---

## ⚠️ Kritieke Wijzigingen & Risico's

**Geen breaking changes gevonden.** Alle verwijzingen naar `SessionMapping` zijn bijgewerkt. Het record heeft een nieuw 4e parameter `CompanionId` gekregen — alle call-sites in deze branch zijn correct aangepast.

---

## 🟢 Samenvatting voor Niet-Programmeurs

- **Functionele Wijziging:** Elke gebruiker kan nu een vaste "companion" (persoonlijke avatar/mascotte) kiezen uit 6 opties (bee, engineer, floppy, patch, pip, retro). Deze keuze wordt opgeslagen op de server, gesynchroniseerd via de voice-verbinding, en getoond in de overlay.
- **Zakelijke Impact:** Gebruikers kunnen hun companion persistent instellen — ook na herstart blijft de keuze behouden. Andere gebruikers zien de companion in de overlay.
- **Risiconiveau:** Laag — alle wijzigingen zijn additief (nieuwe kolom, nieuw endpoint, nieuwe velden).

---

## 💻 Technische Bestandswijzigingen (Deep-Dive)

### `src/Brmble.Server/Data/Database.cs`
- **Wijziging:** Nieuwe migratie voor kolom `companion_id` in `users`-tabel (+6 regels)
- **Technische Details:**
  - Idempotente ALTER TABLE — alleen uitgevoerd als kolom nog niet bestaat
  - Default waarde: `'bee'`
- **Impact:** Database schema uitgebreid zonder bestaande data te beïnvloeden
- **Reden:** Companion-keuze moet persistent zijn over server-restarts

### `src/Brmble.Server/Auth/UserRepository.cs`
- **Wijziging:** Nieuwe `ValidCompanionIds` lookup set, `TryNormalizeCompanionId`, `GetCompanionId`, `SetCompanionId` (+43 regels)
- **Technische Details:**
  - `ValidCompanionIds`: `["bee", "engineer", "floppy", "patch", "pip", "retro"]`
  - `TryNormalizeCompanionId`: Trim + lowercase normalisatie, Try-pattern met fallback naar `"bee"`
  - `GetCompanionId`: SQL `SELECT companion_id FROM users`, fallback via `NormalizeCompanionId`
  - `SetCompanionId`: `UPDATE users SET companion_id = @CompanionId`
- **Impact:** Elke user kan nu een companion opslaan en opvragen via de database
- **Reden:** Server-side persistentie van companion-keuze

### `src/Brmble.Server/Auth/AuthEndpoints.cs`
- **Wijziging:** Nieuw `POST /auth/companion` endpoint (+57 regels) en `companionId` toegevoegd aan sessie-snapshots
- **Technische Details:**
  - Authenticeert via client-certificaat (`certHashExtractor`)
  - Parseert JSON-body met `JsonDocument`, vangt lege/niet-JSON bodies via try/catch
  - Normaliseert `companionId` via `TryNormalizeCompanionId` — bij ongeldig: `400 BadRequest`
  - Slaat op in DB via `userRepository.SetCompanionId`
  - Broadcast `companionChanged` naar kanaal via `eventBus.BroadcastToChannelAsync` (alleen als user een sessie en kanaal heeft)
  - Logger: `LogInformation("Companion updated: ...")`
- **Impact:** Client kan companion instellen en andere gebruikers in het kanaal ontvangen direct een update
- **Reden:** Extern API endpoint voor C# client om companion te synchroniseren

### `src/Brmble.Server/Events/SessionMappingService.cs`
- **Wijziging:** `SessionMapping` record uitgebreid met `CompanionId`, nieuwe `TryUpdateCompanionId` methode (+15 regels)
- **Technische Details:**
  - `record SessionMapping(string MatrixUserId, string MumbleName, long UserId, string CompanionId, bool IsBrmbleClient = false)`
  - `TryUpdateCompanionId` gebruikt `existing with { CompanionId = companionId }` (immutable record update)
  - Interface `ISessionMappingService` uitgebreid met `TryUpdateCompanionId(int sessionId, string companionId)`
- **Impact:** Companion wordt meegegeven in alle session-mapping operaties (connect, userJoined, snapshot)
- **Reden:** Centrale mapping moet companion kennen voor overlay-display

### `src/Brmble.Server/Events/SessionMappingHandler.cs`
- **Wijziging:** Leest `companionId` uit `UserRepository.GetCompanionId` bij user connect en geeft door aan mapping (+2 regels)
- **Impact:** Bij Mumble-connect wordt de companion direct meegestuurd in de broadcast naar alle clients
- **Reden:** Nieuwe gebruikers moeten direct met de juiste companion in de overlay verschijnen

### `src/Brmble.Server/WebSockets/BrmbleWebSocketHandler.cs`
- **Wijziging:** `companionId` toegevoegd aan WebSocket sessionMappingSnapshot (+4 regels)
- **Impact:** Nieuw-verbonden clients ontvangen direct alle companions van bestaande gebruikers

### `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`
- **Wijziging:** Uitgebreide parsing van `companionId` in session mappings, user lists, joins (+155 regels)
- **Nieuwe methoden:**
  - `SyncCompanionAsync(string companionId)` — HTTP POST naar `/auth/companion` via BcTLS, parset JSON response, fallback error handling
  - `GetSelfCompanionOrDefault()` — leest companion uit `_sessionMappings[LocalUser.Id]` met fallback `"bee"`
  - `UpdateSelfCompanionMapping(string companionId)` — lokale mapping update
- **Nieuwe bridge handler:** `voice.setCompanion` — roept `SyncCompanionAsync` aan, merged requestId in response
- **Nieuwe WebSocket case:** `companionChanged` — update lokale mapping + bridge emit `voice.companionChanged`
- **SessionMappingEntry:** Nieuw veld `string CompanionId` in record
- **ParseSessionMappings:** Parse `companionId` uit JSON met fallback `"bee"`
- **User lists/joins:** `companionId` toegevoegd aan `voice.connected`, `voice.userJoined`, `voice.sessionMappingSnapshot`, `voice.userMappingUpdated`
- **Impact:** De C# client fungeert als proxy tussen frontend en server voor companion-sync
- **Reden:** WebView2 bridge kan geen directe HTTP-calls doen; de C# client handelt dit af

### `src/Brmble.Web/src/App.tsx`
- **Wijziging:** Nieuwe refs, handlers, en useEffect voor companion-sync (+79 regels)
- **Nieuwe refs:**
  - `pendingCompanionRef` — slaat pending request op `{ requestId, next, previous }`
  - `companionRequestIdRef` — monotoon oplopende request ID
- **Nieuwe event handlers:**
  - `onVoiceCompanionChanged` — update `companionId` op user in React state
  - `onVoiceSetCompanionResponse` — succes: clear pending; falen: clear pending + toon error
  - `handleLiveCompanionChange` — stuurt `voice.setCompanion` met requestId
- **Reconciliatie bij connect:** Als `selfUser.companionId !== overlaySettings.myCompanion`, stuur `setCompanion` om te synchroniseren
- **Overlay snapshot:** `companionId` per user i.p.v. alleen `myCompanion` voor self
- **Event lifecycle:** correct registered in mount, correct `off` in cleanup
- **Impact:** Frontend is volledig geïntegreerd met het companion-sync systeem

### `src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx`
- **Wijziging:** Nieuwe optionele `onLiveCompanionChange` prop, aangeroepen bij overlay companion-wijziging (+4 regels)
- **Technische Details:**
  - Vergelijkt `overlay.myCompanion !== previousCompanion`
  - Roept `onLiveCompanionChange?.(nextCompanion, previousCompanion)` aan
- **Impact:** Companion-wijziging in settings wordt direct gesynchroniseerd naar server
- **Reden:** Voorkomt dat gebruiker een companion kiest die niet gesynchroniseerd wordt

### Plannen & Ontwerp (`plans/`)
- **2 documenten:** `2026-05-13-companion-visibility.md` (+768 regels) en `2026-05-12-companion-visibility-design.md` (+473 regels)
- Uitgebreide ontwerpbeslissingen, implementatiedetails, en teststrategie
- **Bedoeling onduidelijk op basis van de beschikbare code-diff.** De plannen zijn niet weergegeven in de diff; alleen de bestandsnamen en grootte zijn zichtbaar.

---

### Tests (8 bestanden, ~300 regels nieuw)

**Nieuwe testbestanden:**

| Testbestand | Wat wordt getest |
|---|---|
| `AuthEndpointsCompanionTests.cs` | POST /auth/companion — persist in DB, broadcast via EventBus |
| `MumbleAdapterBridgeTests.cs` | WebSocket `companionChanged` → bridge emit `voice.companionChanged` |

**Nieuwe testmethoden in bestaande bestanden:**

| Test | Wat wordt getest |
|---|---|
| `UserRepositoryTests.GetCompanionId_ReturnsBee_WhenColumnValueIsNullOrUnknown` | Fallback naar `"bee"` bij NULL/ongeldige waarde |
| `UserRepositoryTests.SetCompanionId_PersistsLowercaseValue` | Set + Get round-trip |
| `SessionMappingHandlerTests.OnUserConnected_BroadcastsCompanionId` | CompanionId in broadcast payload |
| `SessionMappingServiceTests.TryUpdateCompanionId_UpdatesExistingMapping` | `TryUpdateCompanionId` update bevestigd |
| `AuthTokenTests.PostAuthToken_SessionMappings_IncludeCompanionId` | CompanionId in `/auth/token` response |
| `MumbleAdapterParseTests.ParseSessionMappings_WithCompanionId_RoundTrips` | JSON parsing met companionId |
| 3 frontend tests in `App.screenShareStart.test.ts` | Remote companion lookup, reconcile na connect, revert bij falen |

**Bestaande tests bijgewerkt:**
- `BrmbleEventBusTests`, `SessionMappingHandlerTests`, `SessionMappingServiceTests`, `AuthTokenTests`, `LiveKitEndpointsTests`, `MumbleServerCallbackTests` — alle `SessionMapping` constructors voorzien van `companionId` ("bee")

---

## ⚠️ Gevonden Probleem

### Bug: `onVoiceSetCompanionResponse` revert ontbreekt

**Bestand:** `src/Brmble.Web/src/App.tsx:1930-1939`

De handler voor `voice.setCompanionResponse` met `success: false` toont alleen een error maar **draait de companion-keuze niet terug**. De test `'reverts local overlay companion when voice.setCompanionResponse fails'` verwacht dat localStorage wordt teruggezet naar `"bee"`, maar de implementatie doet dit niet.

**Huidige code (App.tsx ~1935):**
```typescript
pendingCompanionRef.current = null;
setConnectionError(d?.error ?? 'Failed to sync companion');
notifQueue.register('companion-sync-error', 'error');
```

**Wat ontbreekt:** De settings en localStorage moeten worden teruggezet naar `pending.previous` wanneer de sync faalt. Zonder deze revert blijft de UI een companion tonen die de server niet heeft geaccepteerd.

**Voorgestelde fix:**
```typescript
// Bij falen: revert de instelling terug naar de vorige waarde
if (pending.previous) {
  const currentSettingsJson = localStorage.getItem(SETTINGS_STORAGE_KEY);
  if (currentSettingsJson) {
    try {
      const currentSettings = JSON.parse(currentSettingsJson);
      currentSettings.overlay = { ...currentSettings.overlay, myCompanion: pending.previous };
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(currentSettings));
    } catch {}
  }
  bridge.send('settings.set', { settings: /* reverted settings */ });
}
```
