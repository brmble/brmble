# Collaborative Paint — productspecificatie

## 1. Doel

Collaborative Paint is een tijdelijke, realtime tekensessie binnen Brmble. Een host start de sessie vanuit het huidige voice channel, deelt één bronafbeelding en werkt samen met andere gebruikers die zich op dat moment in hetzelfde channel bevinden en expliciet op **Join paint** drukken.

De sessie is kanaalgebonden, tijdelijk en server-authoritative. De blijvende uitkomst is alleen de expliciet opgeslagen PNG in de normale kanaalchat.

## 2. Kernregels

- Paint is scoped to the host's current voice channel.
- Current channel membership determines eligibility; participation still requires Join paint.
- The source is temporary Brmble session data, not a Matrix room event.
- Matrix receives the finished PNG only when the host explicitly saves to normal chat.
- Leaving the voice channel removes participation immediately; return requires another explicit join.
- End/expiry schedules temporary-data deletion; restart recovery and retryable cleanup prevent silent accumulation.

## 3. Gewenste eindtoestand

Na implementatie geldt het volgende gedrag:

1. De host start een paint-sessie vanuit het huidige voice channel.
2. De server accepteert de sessie alleen als de host op dat moment werkelijk in dat channel aanwezig is.
3. De host levert een geldige PNG-, JPEG- of WebP-bronafbeelding aan binnen de bestaande limieten.
4. De server valideert en bewaart die bron als tijdelijke sessiedata, los van normale chatberichten.
5. Iedere gebruiker die zich op dat moment in hetzelfde voice channel bevindt, mag via de uitnodigingskaart ontdekken dat er een actieve sessie is.
6. Kanaallidmaatschap maakt een gebruiker alleen eligible; daadwerkelijke deelname begint pas na een expliciete **Join paint**.
7. Een gebruiker die ná het starten het channel binnenkomt, kan de bestaande sessie zien, **Join paint** gebruiken en daarna de actuele bron en canvasstatus ontvangen.
8. Een gebruiker buiten het sessiekanaal kan de sessie niet joinen en kan de tijdelijke bronbytes of canvasstatus niet ophalen.
9. Tijdens de sessie blijft de bronafbeelding onveranderlijk; annotaties worden daarboven als aparte tijdelijke tekenlaag beheerd.
10. Alleen definitief gecommitte streken tellen mee voor gedeelde status en voor **Save to chat**.
11. Alleen de host kan clear, end en **Save to chat** uitvoeren.
12. **Save to chat** uploadt precies één samengestelde PNG naar de normale kanaalchat en laat die permanente chatafbeelding bestaan nadat de tijdelijke paintdata is opgeruimd.
13. Een beëindigde of verlopen sessie plant opruiming van tijdelijke data in; herstartdetectie en retrybare cleanup voorkomen stille ophoping van bronbestanden.

## 4. Kanaal- en deelnamemodel

### 4.1 Kanaalbinding

Een paint-sessie behoort altijd tot het voice channel waarin de host de sessie start. Die kanaalbinding bepaalt:

- wie de sessie in samenvatting mag zien;
- wie eligible is om te joinen;
- naar welke chat de uitnodiging en de opgeslagen PNG verwijzen.

De sessie hoort dus niet bij een losse Matrix paint-room en gebruikt geen aparte Matrix-ledenlijst als autorisatiebron.

### 4.2 Eligibility versus deelname

Eligibility en deelname zijn bewust twee verschillende toestanden:

- Een gebruiker is eligible zodra die momenteel in hetzelfde voice channel aanwezig is als de host-sessie.
- Een gebruiker is participant pas nadat **Join paint** succesvol is uitgevoerd.

Een gebruiker die eligible is maar nog niet heeft gejoined:

- mag de sessiekaart en summary zien;
- mag niet automatisch de editor openen;
- mag geen snapshot, bronbytes of mutaties ontvangen;
- mag niet tekenen, undoën of preview/commit versturen.

### 4.3 Late join

Een gebruiker die het voice channel pas betreedt nadat de sessie al actief is:

- ziet nog steeds de uitnodigingskaart in de kanaalchat;
- krijgt in de summary `canJoin = true` en `isParticipant = false`;
- kan alsnog expliciet joinen;
- ontvangt na join de huidige bronmetadata, bronbytes en actuele gecommitte canvasstatus.

### 4.4 Verlaten en terugkeren

Wanneer een participant het voice channel verlaat of de onderliggende voice-verbinding verliest:

- vervalt de actieve deelname direct;
- sluiten editor- en snapshottoegang opnieuw af;
- moet de gebruiker na terugkeer weer expliciet **Join paint** uitvoeren.

Terugkeer maakt een gebruiker dus opnieuw eligible, maar herstelt deelname niet impliciet.

## 5. Bronafbeelding en tijdelijke opslag

Iedere sessie begint met precies één gevalideerde bronafbeelding.

- Ondersteund: PNG, JPEG en WebP.
- Niet ondersteund: andere bestandsformaten.
- Limieten: maximaal 10 MiB en maximaal 4096 × 4096 pixels.

De server bewaart de bron als tijdelijke Brmble-sessiedata per sessie-ID. De bron:

- is niet afkomstig uit een Matrix paint-room;
- is niet gekoppeld aan een `sourceEventId`;
- is alleen leesbaar voor actuele participants;
- wordt verwijderd zodra cleanup de terminale sessie succesvol heeft afgehandeld.

## 6. Realtime canvasgedrag

### 6.1 Bronlaag en annotatielaag

De editor combineert:

- een onveranderlijke bronlaag;
- een tijdelijke annotatielaag met pen- en gumstreken.

De gum werkt alleen op annotaties en wijzigt de bronlaag niet destructief.

### 6.2 Preview versus commit

Paint kent twee soorten tekeninformatie:

- previews: tijdelijk, verliesgevoelig en bedoeld voor directe visuele feedback;
- commits: definitieve servergeaccepteerde streken.

Previews mogen worden gethrottled of genegeerd. Committed strokes mogen niet stilzwijgend verdwijnen.

### 6.3 Revision, generation en ordering

De server blijft gezaghebbend voor blijvende sessiestatus.

- `revision` verhoogt bij iedere blijvende sessiewijziging.
- `generation` verhoogt wanneer de host clear uitvoert.
- committed strokes hebben serverbepaalde identiteit en volgorde.

Clients gebruiken snapshots als herstelbasis wanneer revisies ontbreken of wanneer opnieuw moet worden gesynchroniseerd.

## 7. Acties en bevoegdheden

### 7.1 Host

De host kan:

- een sessie starten in het huidige voice channel;
- de geldige bron aanleveren;
- zelf joinen (de host is direct participant bij creatie);
- tekenen, undoën en previews sturen;
- clear uitvoeren;
- de sessie beëindigen;
- de samengestelde PNG expliciet naar de normale chat opslaan.

### 7.2 Participant

Een participant kan:

- na expliciete join de editor openen;
- previews sturen;
- definitieve streken committen;
- alleen de eigen meest recente actieve streek undoën;
- bron, snapshot en permanente canvaswijzigingen ontvangen zolang de gebruiker participant blijft.

### 7.3 Niet-participant of buitenstaander

Een gebruiker buiten het sessiekanaal, of een gebruiker die nog niet expliciet is gejoined, kan geen:

- bronbytes ophalen;
- volledige snapshot ophalen;
- stroke/preview/undo/clear/end-mutaties uitvoeren.

## 8. Clear, end, expiry en cleanup

### 8.1 Clear

Alleen de host kan clear uitvoeren. Clear:

- verhoogt `generation`;
- verwijdert zichtbare annotaties uit eerdere generaties;
- laat de bronafbeelding intact.

### 8.2 End

Alleen de host kan een actieve sessie beëindigen. End:

- zet de sessie atomair naar terminale status;
- publiceert de terminale sessiestatus;
- plant tijdelijke cleanup in;
- maakt de bron direct niet meer beschikbaar via de sessie-endpoints.

### 8.3 Expiry

Een inactieve sessie verloopt automatisch na de vastgelegde timeout. Expiry volgt dezelfde cleanupregels als een expliciete end.

### 8.4 Cleanup en herstel na herstart

Cleanup verwijdert tijdelijke sessiedata pas wanneer de sessiedirectory werkelijk verdwenen is. Belangrijke regels:

- cleanup van één sessie mag nooit bytes van een andere sessie wijzigen of verwijderen;
- cleanup-fouten blijven retrybaar;
- terminale cleanup-fouten blijven operator-zichtbaar;
- logging en persistentie bevatten alleen sessie-identiteit en fouttype, geen afbeeldingsbytes of credentials;
- een serverherstart moet achtergelaten orphan-sessiedata kunnen vinden en opruimen, ook als de oude in-memory sessiestatus verloren is gegaan;
- historische `paint_room_cleanup` data blijft alleen als legacy schema-/auditspoor bestaan en stuurt geen productiegedrag meer aan.

## 9. Save to chat

**Save to chat** is de enige grens waarop tijdelijke paintdata permanent wordt.

Bij een succesvolle save:

1. de client rendert de onveranderlijke bronlaag;
2. daaroverheen komen alleen de definitief gecommitte annotaties;
3. het resultaat wordt als één PNG samengesteld;
4. precies die PNG wordt naar de normale kanaalchat geüpload en gepost;
5. daarna mag de sessie eindigen en mag tijdelijke cleanup plaatsvinden.

Belangrijke garanties:

- ongecommitte previews horen nooit in de opgeslagen PNG;
- de opgeslagen chatafbeelding blijft beschikbaar nadat tijdelijke paintdata is verwijderd;
- normale chatopslag is onafhankelijk van tijdelijke cleanup.

## 10. Verwachte fouten en afwijzingen

- Ongeldige of te grote bronbestanden worden geweigerd.
- Gebruikers buiten het sessiekanaal krijgen geen toegang tot bron, snapshot of mutaties.
- Gebruikers die niet expliciet hebben gejoined krijgen geen participant-toegang.
- Een sessie in terminale status accepteert geen actieve bron- of mutatieacties meer.
- Cleanup mag pas als geslaagd gelden wanneer de tijdelijke data echt weg is, niet alleen wanneer een deleteverzoek is gestart.

## 11. Niet-doelen

Deze versie heeft niet als doel om:

- actieve paint-sessies duurzaam over serverrestarts heen voort te zetten;
- offline tekenen of offline mergegedrag te ondersteunen;
- algemene lagen-, shapes- of tekstfuncties toe te voegen;
- alle kanaalleden automatisch participant te maken;
- tijdelijke paintbrondata via aparte Matrix paint-rooms of bron-events te beheren.

## 12. Verificatieverwijzing

De bijbehorende automatische en handmatige controles staan in [Paint-verification.md](Paint-verification.md). De follow-up voor ambigu einde na een succesvolle save blijft vastgelegd in [Paint-follow-up-ambiguous-end-recovery.md](Paint-follow-up-ambiguous-end-recovery.md).
