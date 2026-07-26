# Collaborative Paint — Doel- en productspecificatie

## 1. Status en herkomst van dit document

Dit document beschrijft het doel van de implementatie die is vastgelegd in het **Collaborative Paint Implementation Plan**. Het vertaalt de taken, interfaces, beperkingen, tests en verificatiestappen uit dat plan naar één samenhangende specificatie van de beoogde functionaliteit.

Deze specificatie introduceert geen aanvullende functionaliteit buiten het aangeleverde implementatieplan. Waar het plan geen productreden, gebruikersbehoefte of gedrag beschrijft, doet dit document daar geen aannames over. Het doel wordt daarom uitsluitend uitgelegd aan de hand van de expliciet beschreven gebruikersstroom, architectuur, beveiligingsregels, realtime-eigenschappen, levenscyclus en acceptatiecriteria.

Dit document is geen vervanging voor de technische uitvoeringstaken. Het beschrijft vooral:

- welke mogelijkheid na implementatie in Brmble beschikbaar moet zijn;
- welke gebruikers aan een tekening mogen deelnemen;
- hoe de bronafbeelding privé wordt gedeeld en gevalideerd;
- hoe realtime tekenbewerkingen betrouwbaar en in dezelfde volgorde worden verwerkt;
- welke partij gezaghebbend is over identiteit en sessiestatus;
- welke handelingen deelnemers en hosts mogen uitvoeren;
- hoe een voltooide tekening als PNG in de oorspronkelijke chat terechtkomt;
- welke beperkingen bewust bij deze eerste versie horen;
- wanneer de verticale functionaliteit als succesvol geïmplementeerd geldt.

---

## 2. Samenvatting van het hoofddoel

Het hoofddoel is om Brmble uit te breiden met een **kanaalgebonden realtime tekeneditor** waarin een host samen met expliciet geselecteerde deelnemers op één bronafbeelding kan tekenen.

Voor iedere tekensessie wordt precies één afzonderlijke, private en uitsluitend op uitnodiging toegankelijke Matrix-room aangemaakt. De bronafbeelding van de tekening wordt niet via de gewone kanaalchat gedeeld, maar door de host met diens eigen geauthenticeerde Matrix-client naar die private room geüpload. De server bewaart vervolgens de gevalideerde verwijzing naar dat specifieke Matrix-event bij de tekensessie. Uitgenodigde deelnemers halen exact die bronafbeelding uit dezelfde private room op met hun eigen geauthenticeerde Matrix-client.

Tijdens de sessie zien deelnemers dezelfde onveranderlijke bronafbeelding met daarboven een afzonderlijke annotatielaag. Voorlopige tekenbewegingen mogen tijdelijk en verliesgevoelig zijn om de interactie snel te laten aanvoelen. Definitief vastgelegde streken worden daarentegen door de server geordend, gevalideerd en nooit bewust overgeslagen. De server bewaakt de blijvende sessiestatus, de volgorde van streken, de versie van de sessie en de toegangsrechten.

Het blijvende eindresultaat van de samenwerking is een samengestelde PNG met de bronafbeelding en alle op dat moment definitief vastgelegde annotaties. Die PNG kan naar de oorspronkelijke kanaalchat worden opgeslagen. De actieve samenwerkingsstatus zelf is tijdelijk: de sessie leeft in het servergeheugen, verloopt na dertig minuten inactiviteit en gaat verloren wanneer de server opnieuw start.

---

## 3. Beoogde eindtoestand na implementatie

Na volledige implementatie moet de volgende verticale functionaliteit bestaan:

1. Een gebruiker die als host optreedt, kan vanuit de header van Brmble met de knop **Start paint-sessie** een nieuwe gezamenlijke tekensessie starten. De knop opent de setupflow voor het aan de huidige voice-channel gekoppelde kanaal.
2. De host selecteert welke momenteel aanwezige Brmble-gebruikers mogen deelnemen.
3. De server controleert dat de host en alle geselecteerde deelnemers in het gevraagde voice channel aanwezig zijn.
4. De server maakt voor die sessie precies één private Matrix-room aan.
5. Alleen de host en de expliciet geselecteerde deelnemers worden voor die Matrix-room uitgenodigd.
6. De server voegt uitgenodigde gebruikers niet automatisch aan de room toe.
7. De host treedt met de eigen geauthenticeerde Matrix-client toe tot de private room.
8. De host uploadt de bronafbeelding naar Matrix, plaatst die als een `m.image`-event in de private room en levert alleen het verkregen event-ID aan de paint-API.
9. De server verifieert dat het event daadwerkelijk bij de voor de sessie opgeslagen room hoort, dat het een afbeeldingsevent is en dat de mediagegevens aan de ondersteunde eisen voldoen.
10. Pas nadat de bron succesvol is gekoppeld, wordt de sessie actief voor deelname en tekenen.
11. De uitnodiging in de oorspronkelijke kanaalchat wordt pas geplaatst nadat de bron is gekoppeld.
12. Een geselecteerde deelnemer treedt met de eigen Matrix-client toe tot de private room, haalt de exacte bron op via het opgeslagen event-ID en meldt zich daarna aan bij de paint-sessie.
13. De server accepteert deelname alleen wanneer de gebruiker zowel in het juiste Brmble-kanaal als daadwerkelijk lid van de private Matrix-room is.
14. Actieve deelnemers kunnen met een pen of gum annotaties aanbrengen.
15. Alle definitieve streken krijgen een servergegenereerde identiteit en een serverbepaalde volgorde.
16. Alle clients kunnen na gemiste gebeurtenissen of een herverbinding opnieuw naar één consistente sessiestatus synchroniseren.
17. Een gebruiker kan uitsluitend de eigen meest recente nog actieve streek ongedaan maken.
18. Alleen de host kan het annotatiecanvas leegmaken of de sessie beëindigen.
19. Leegmaken verwijdert de huidige annotaties door een nieuwe generatie te beginnen, zonder de bronafbeelding te wijzigen.
20. Alleen de host kan het resultaat als PNG samenstellen uit de bronlaag en de definitief vastgelegde annotatielaag en dit naar de oorspronkelijke chat sturen.
21. Na beëindiging wordt de tijdelijke private Matrix-room opgeruimd; een opruimfout is zichtbaar, wordt gelogd en kan veilig opnieuw worden geprobeerd, ook na een serverrestart.
22. Een beëindigde, verlopen of niet-beschikbare sessie wordt als zodanig weergegeven in de uitnodigingskaart.
23. De complete verticale flow wordt afgedekt door server-, client-, frontend- en integratietests plus een handmatige controle met twee clients.

---

## 4. Functionele bedoeling van Collaborative Paint

### 4.1 Samen tekenen binnen de context van één kanaal

De tekensessie is gekoppeld aan één bestaand Brmble-kanaal. Die kanaalkoppeling bepaalt wie bij het starten geselecteerd kan worden, naar welk kanaal paint-events worden uitgezonden en in welke chat de uitnodiging en de uiteindelijke PNG verschijnen.

Het doel van deze kanaalbinding is niet dat ieder kanaallid automatisch aan de tekening mag deelnemen. Kanaallidmaatschap is een noodzakelijke voorwaarde, maar niet de enige. De sessie heeft daarnaast een eigen expliciete deelnemerslijst en een eigen private Matrix-room.

De creator wordt bij het aanmaken automatisch als eerste paint-deelnemer toegevoegd. Voor andere gebruikers geldt dat zij geselecteerd en voor de Matrix-room uitgenodigd moeten zijn, zelf tot die room moeten toetreden en vervolgens de normale paint-joinactie moeten uitvoeren.

### 4.2 Een expliciet afgebakende deelnemersgroep

De functionaliteit moet voorkomen dat een gezamenlijke tekening automatisch toegankelijk wordt voor iedere gebruiker in hetzelfde kanaal. Daarom wordt bij de start een beperkte deelnemersgroep vastgelegd:

- de host;
- de door de host geselecteerde gebruikers;
- geen andere gebruikers.

De Matrix-uitnodigingen moeten exact overeenkomen met deze groep. Een gebruiker die wel in hetzelfde voice channel aanwezig is maar niet voor de private Matrix-room is uitgenodigd, mag niet via de paint-joinroute aan de sessie deelnemen.

De deelnemersgrens wordt daarmee op twee niveaus gehandhaafd:

1. Brmble controleert de actuele kanaalcontext en paint-deelname;
2. Matrix controleert de toegang tot de private room waarin de bronafbeelding staat.

### 4.3 Een bronafbeelding die privé en exact identificeerbaar blijft

Iedere sessie begint met een bronafbeelding. Deze afbeelding moet binnen de speciaal aangemaakte private Matrix-room worden geplaatst. Het gewone chatkanaal is niet de bron voor het editorcanvas.

De bron wordt in twee stappen gekoppeld:

1. de host uploadt de afbeelding en verstuurt een `m.image`-event in de private room;
2. de host geeft het event-ID aan de server via de source-attachactie.

De server vertrouwt niet op door de frontend aangeleverde metadata zoals MIME-type, afmetingen of roomcontext. De server gebruikt het opgeslagen `matrixRoomId` en het aangeleverde `sourceEventId` om het betreffende Matrix-event zelf te controleren, de media via Matrix te downloaden, het werkelijke mediatype te herkennen en de afmetingen te decoderen.

Hierdoor verwijst de sessie naar één concrete, gevalideerde bron. De sessie heeft al een `MatrixRoomId` vanaf het moment van aanmaken, maar krijgt pas een `SourceEventId` nadat de host een geldige bron heeft gekoppeld.

### 4.4 Realtime samenwerking met een duidelijk onderscheid tussen tijdelijk en definitief

Het tekenproces kent twee soorten informatie:

- **previews:** tijdelijke informatie over een streek die nog wordt getekend;
- **commits:** definitieve streken die onderdeel zijn geworden van de gedeelde sessiestatus.

Previews zijn bedoeld om andere deelnemers snel visuele voortgang te laten zien. Ze mogen worden beperkt, samengevoegd of verwijderd wanneer een client of verbinding te traag is. Het plan stelt daarom een maximum van twintig preview-updates per seconde per auteur per sessie vast, overeenkomend met een frontend-throttle van 50 milliseconden.

Definitieve streken hebben een andere betekenis. Zodra een streek wordt gecommit, moet de server:

- de invoer valideren;
- een permanente stroke-ID toekennen;
- een servervolgnummer toekennen;
- de auteur vastleggen vanuit servergecontroleerde identiteit;
- de sessierevisie verhogen;
- de permanente gebeurtenis in de juiste kanaalcontext publiceren.

Definitieve gebeurtenissen mogen niet als optimalisatie worden weggegooid. Wanneer een client te traag is om een permanente gebeurtenis te ontvangen, wordt die socket gesloten zodat de client opnieuw kan verbinden en een actuele snapshot kan ophalen.

### 4.5 Eén gedeeld en herstelbaar beeld van de sessie

Alle actieve clients moeten uiteindelijk dezelfde definitieve status kunnen reconstrueren. Dit wordt bereikt met drie afzonderlijke ordeningsbegrippen:

- `sequence` bepaalt de servervolgorde van gecommitte streken;
- `revision` bepaalt de opeenvolging van alle blijvende sessiewijzigingen;
- `generation` scheidt annotaties van vóór en na een clearactie.

Een client accepteert permanente gebeurtenissen alleen als de revisies aaneengesloten zijn. Wanneer bijvoorbeeld revisie 4 is verwerkt en daarna direct revisie 6 binnenkomt, weet de client dat revisie 5 ontbreekt. De client moet dan onmiddellijk een nieuwe sessiesnapshot aanvragen in plaats van zelf te raden wat de ontbrekende wijziging was.

De snapshot is de volledige, door de server bepaalde herstelbasis. Deze bevat onder meer de sessie-identiteit, het kanaal, de Matrix-room, de bronverwijzing, de host, status, generatie, revisie, deelnemers, definitieve streken en vervaltijd.

### 4.6 Een voltooide tekening terugbrengen naar de gewone chat

De samenwerking vindt plaats in een tijdelijke paint-sessie en gebruikt een private Matrix-room voor de bron. Het bruikbare eindresultaat moet echter in de oorspronkelijke kanaalchat kunnen worden gedeeld.

Bij **Save to chat** worden uitsluitend definitief gecommitte streken meegenomen. Een nog zichtbare maar niet gecommitte preview mag dus geen onderdeel van het opgeslagen resultaat worden.

De frontend stelt de PNG samen door:

1. de onveranderlijke bronafbeelding op een offscreen canvas te tekenen;
2. de actuele annotatielaag daaroverheen te tekenen;
3. het samengestelde resultaat als PNG-bestand te produceren;
4. het bestand via de bestaande Matrix-uploadfunctionaliteit te uploaden;
5. het met de bestaande image-messagefunctie naar het oorspronkelijke kanaal te sturen.

Alleen de host ziet en kan de actie **Save to chat** uitvoeren. Dubbele saves moeten worden uitgeschakeld zolang een save bezig is of al is uitgevoerd volgens de daarvoor bedoelde UI-status. Een fout bij opslaan moet zichtbaar en opnieuw uitvoerbaar zijn.

---

## 5. Gebruikersrollen en bevoegdheden

### 5.1 Host

De host is de gebruiker die de sessie creëert. De server voegt deze gebruiker automatisch als eerste paint-deelnemer toe.

De host heeft de volgende specifieke verantwoordelijkheden en bevoegdheden:

- een kanaal en geselecteerde deelnemers laten valideren bij het aanmaken;
- de aangemaakte private Matrix-room met de eigen Matrix-client joinen;
- de bronafbeelding uploaden;
- het `m.image`-event versturen;
- het event-ID als sessiebron laten valideren en koppelen;
- tekenen met dezelfde ondersteunde tools als andere deelnemers;
- de eigen meest recente actieve streek ongedaan maken;
- als enige het canvas clearen;
- als enige de sessie beëindigen;
- het samengestelde resultaat naar de chat opslaan.

De host kan andere gebruikers niet via de server automatisch in de Matrix-room laten joinen. De roomservice nodigt alleen uit.

### 5.2 Geselecteerde deelnemer

Een geselecteerde deelnemer is een gebruiker die bij het aanmaken is meegenomen en daarom een Matrix-uitnodiging ontvangt.

Om daadwerkelijk aan de paint-sessie deel te nemen, moet deze gebruiker:

- nog steeds voldoen aan de actuele kanaalvoorwaarde;
- met de eigen geauthenticeerde Matrix-client de private room joinen;
- de exacte bronafbeelding ophalen aan de hand van het opgeslagen source-event;
- de paint-joinactie uitvoeren.

Een actieve deelnemer mag:

- previews versturen;
- definitieve streken committen;
- de eigen meest recente actieve streek ongedaan maken;
- de gedeelde actuele sessiestatus ontvangen.

Wanneer een geselecteerde deelnemer de actieve paint-sessie tijdelijk verlaat, behoudt die gebruiker de selectiestatus. Zolang de sessie actief is, kan de gebruiker opnieuw deelnemen door opnieuw aan de kanaal- en Matrix-roomvoorwaarden te voldoen en de joinactie opnieuw uit te voeren. Heeft die gebruiker intussen ook de private Matrix-room verlaten, dan verstuurt de server bij die nieuwe deelnamepoging opnieuw een Matrix-uitnodiging, mits de gebruiker nog in het juiste voice channel aanwezig is. De server laat de gebruiker nooit namens die gebruiker joinen; na de nieuwe uitnodiging accepteert de gebruiker deze met de eigen Matrix-client en herhaalt de joinactie.

Een gewone deelnemer mag niet:

- het volledige canvas clearen;
- de sessie beëindigen;
- een streek van een andere auteur ongedaan maken;
- de bronafbeelding met de gum wijzigen.

### 5.3 Kanaallid dat niet is geselecteerd

Een gebruiker kan in hetzelfde Brmble-kanaal aanwezig zijn zonder paint-deelnemer te zijn. Kanaallidmaatschap alleen verleent geen toegang tot de tekensessie.

Wanneer deze gebruiker niet is uitgenodigd voor de private Matrix-room, moet de paint-joinactie worden geweigerd. Ook preview-, commit- en undoacties vereisen actieve paint-deelname en mogen dus niet door een willekeurig kanaallid worden uitgevoerd.

### 5.4 Server

De server is gezaghebbend voor alle blijvende paint-status en alle veiligheidsbeslissingen. De server bepaalt of valideert onder meer:

- de Brmble-gebruikersidentiteit via de mTLS-certificaathash;
- de auteur van een streek;
- het actuele kanaallidmaatschap;
- de actieve paint-deelname;
- de host van de sessie;
- de Matrix-room die bij de sessie hoort;
- de Matrix-membershipstatus bij join;
- het source-event en de werkelijke bronmetadata;
- de permanente stroke-ID;
- de stroke-sequence;
- de sessierevisie;
- de generatie;
- de status en vervaltijd van de sessie;
- welke events naar welk kanaal worden uitgezonden.

De frontend mag deze gegevens doorgeven waar dat voor een verzoek nodig is, maar is niet de bron van waarheid voor de beveiligings- of auteurschapsbeslissing.

### 5.5 Geauthenticeerde Matrix-client van iedere gebruiker

De eigen Matrix-client van de host of deelnemer is verantwoordelijk voor handelingen die als die Matrix-gebruiker moeten plaatsvinden:

- toetreden tot de private room;
- voor de host: uploaden van de bron en versturen van het `m.image`-event;
- voor deelnemers: ophalen van het opgeslagen room-event en de bijbehorende media.

Het doel hiervan is dat de server deelnemers niet stilzwijgend of namens hen laat toetreden. De roomtoegang blijft gekoppeld aan de eigen Matrix-identiteit en de normale invite/joinstroom.

---

## 6. Volledige sessielevenscyclus

### 6.1 Voorbereiding en deelnemersselectie

De gebruikersstroom begint in `PaintSessionSetupModal`. De host selecteert uit de momenteel aanwezige Brmble-gebruikers welke personen mogen worden uitgenodigd. De modal roept de createactie aan met het `channelId` en de geselecteerde huidige Mumble-sessie-ID's als `participantSessionIds`.

De flow wordt geopend vanuit een nieuwe knop **Start paint-sessie** in de header van Brmble. De knop is beschikbaar binnen de context van een actief voice channel; de setupmodal gebruikt dat channel als huidige context en laat de host vervolgens deelnemers en bronafbeelding kiezen.

De createactie mag alleen slagen wanneer de server de host en iedere geselecteerde Mumble-sessie in het gevraagde voice channel aantreft. De server vertaalt die tijdelijke sessie-ID's onmiddellijk naar persistente Brmble- en Matrix-identiteiten voor de invitee-lijst.

### 6.2 Aanmaken van sessie en private Matrix-room

De server maakt eerst de private Matrix-room aan. De room gebruikt:

- `preset: "private_chat"`;
- een invite-lijst met exact de host en geselecteerde deelnemers;
- `m.room.join_rules` met `join_rule: "invite"`;
- `m.room.history_visibility` met `history_visibility: "invited"`.

De server gebruikt geen helper die gebruikers automatisch joint. Wanneer roomcreatie of uitnodigen mislukt, moet de setupflow dit expliciet als fout tonen.

Na succesvolle roomcreatie bewaart de server het room-ID in de sessie en retourneert de createactie minimaal het sessie-ID en Matrix-room-ID. Op dit moment is de sessie nog in afwachting van een geldige bronafbeelding.

### 6.3 Host joint en plaatst de bron

De host gebruikt `matrix-js-sdk` via de eigen geauthenticeerde Matrix-client om de nieuwe room te joinen. De client wacht tot de room is gesynchroniseerd, uploadt daarna het gekozen bronbestand, verstuurt een `m.image`-event naar de private room en verkrijgt het event-ID.

Daarna stuurt de client uitsluitend het `sourceEventId` naar de paint-sourceactie. Het plan schrijft dus niet voor dat de frontend zelf vertrouwde source-afmetingen, MIME-informatie of een willekeurig room-ID mag vastleggen.

### 6.4 Server valideert en activeert de bron

`MatrixPaintSourceResolver` controleert dat:

- het event zich in de bij de sessie opgeslagen `MatrixRoomId` bevindt;
- het event van het type `m.image` is;
- de bijbehorende media via Matrix kan worden opgehaald;
- het werkelijke bestandstype wordt herkend;
- het type PNG, JPEG of WebP is;
- het geen GIF of SVG is;
- de afbeeldingsafmetingen maximaal 4096 bij 4096 zijn.

Daarnaast mag de bron niet groter zijn dan de door de gekoppelde Matrix-homeserver geadverteerde `m.upload.size`. De client leest deze waarde uit `GET /_matrix/media/v3/config` vóór het uploaden. Matrix definieert geen vaste, algemene bytegrens: de waarde is per homeserver configureerbaar; ontbreekt deze of is hij `null`, dan is de limiet onbekend en mag de client geen vaste Matrix-limiet suggereren. Een tussenliggende proxy kan bovendien een lagere limiet afdwingen. De server bewaart na validatie de feitelijke grootte in bytes in de `PaintSource`.

Na succesvolle validatie bewaart de manager de gevalideerde `PaintSource`, waaronder de room, eventreferentie, MXC-URL, MIME-type, afmetingen en grootte. De source-attachactie retourneert de actieve snapshot.

Vóór deze bronkoppeling moeten join-, preview- en strokeacties worden geweigerd. Hierdoor kan geen actieve tekensessie ontstaan zonder een servergevalideerde bron.

### 6.5 Publiceren van de kanaaluitnodiging

De chatuitnodiging wordt pas verstuurd na `paint.sourceAttached`. Daarmee verwijst de uitnodiging alleen naar een sessie waarvan de bron bestaat en is gevalideerd.

De uitnodiging gebruikt een Matrix `m.room.message` met:

- `msgtype: 'com.brmble.paint.session'`;
- de body `'<name> started a collaborative drawing. Open Brmble to join.'`;
- metadata `com.brmble.paint` met `sessionId`, `matrixRoomId`, `sourceEventId` en `expiresAt`.

`useMatrixClient` moet deze metadata herkennen. `PaintSessionCard` toont vervolgens de juiste status en, wanneer van toepassing, de actie **Join drawing**.

### 6.6 Deelnemer joint de private room en paint-sessie

Een uitgenodigde deelnemer accepteert of volgt de Matrix-uitnodiging met de eigen client en joint de opgeslagen room. De deelnemer haalt vervolgens exact het opgeslagen source-event en de media op.

Daarna wordt de paint-joinendpoint aangeroepen. De server zet de Brmble-identiteit om naar de bijbehorende Matrix-identiteit en controleert via Matrix dat de membershipstatus voor de opgeslagen room daadwerkelijk `join` is.

Wanneer de gebruiker niet aan de kanaalvoorwaarde voldoet, wordt deelname geweigerd. Is een oorspronkelijk geselecteerde gebruiker niet gejoint doordat die de private room eerder heeft verlaten, dan verstuurt de server opnieuw een uitnodiging en retourneert hij dat de Matrix-room eerst opnieuw moet worden gejoint. De server laat de gebruiker niet automatisch joinen. Een niet-geselecteerde gebruiker wordt geweigerd en ontvangt geen uitnodiging. Een geslaagde join wordt als blijvende sessiewijziging behandeld en verhoogt de revisie.

### 6.7 Tekenen en previews

Bij pointer-down genereert de frontend één UUID als `correlationId`. Diezelfde correlatie blijft gekoppeld aan alle previews en aan de uiteindelijke commit van die ene streek.

Pointercoördinaten worden omgerekend naar genormaliseerde punten in het bereik `[0,1]`. Alleen eindige punten binnen dat bereik mogen worden verstuurd. Een definitieve streek mag maximaal 2.000 punten bevatten.

Tijdens het bewegen worden previews maximaal eens per 50 milliseconden verstuurd. De server of eventbus mag oudere preview-informatie voor dezelfde `(sessionId, authorUserId)` vervangen of samenvoegen.

Bij pointer-up wordt één definitieve streek gecommit. De server maakt de uiteindelijke stroke-ID en bepaalt de volgorde. Wanneer het commit-event terugkomt met dezelfde `correlationId`, verwijdert de frontend uitsluitend de bijbehorende lokale preview en vervangt die door de serverstroke.

### 6.8 Undo

Undo is auteursgebonden. Een gebruiker kan alleen de eigen laatste nog actieve streek verwijderen. De laatste actieve streek van een andere auteur mag hierdoor niet worden beïnvloed.

Undo is een blijvende statuswijziging. De server verhoogt de revisie en publiceert het verwijderingsevent met voldoende informatie om iedere client dezelfde streek te laten verwijderen.

### 6.9 Clear

Clear is uitsluitend beschikbaar voor de host. Een clearactie verwijdert de actieve annotatiestatus als geheel door de `generation` te verhogen.

Streken en previews uit een oudere generatie mogen na clear niet opnieuw zichtbaar worden. Een client die bijvoorbeeld een vertraagde preview uit generatie 1 ontvangt nadat generatie 2 actief is geworden, negeert die preview.

Clear verandert de bronafbeelding niet. De bronlaag blijft onveranderd en de nieuwe annotatiegeneratie begint bovenop dezelfde bron.

### 6.10 Save to chat

Alleen de host kan **Save to chat** aanroepen. Save gebruikt alleen de op dat moment definitief gecommitte streken. De bron en annotaties worden in de juiste laagvolgorde gecombineerd. Het resultaat wordt als PNG geüpload en met de bestaande image-messagefunctie in de oorspronkelijke Matrix-chat geplaatst die aan het voice channel is gekoppeld.

De UI moet voorkomen dat dezelfde savehandeling onbedoeld gelijktijdig of herhaald wordt uitgevoerd. Een mislukte upload of verzending moet opnieuw geprobeerd kunnen worden.

### 6.11 End en opruimen van de paint-room

Alleen de host kan de sessie beëindigen. Na een geslaagde beëindiging start de server de opruiming van de tijdelijke private Matrix-room. De room wordt via de daarvoor bevoegde Matrix-beheerfunctionaliteit verwijderd; alleen de client uit de room laten vertrekken geldt niet als verwijderen. Als de Matrix-homeserver geen verwijdering toestaat of de opruiming faalt, wordt dit als een afzonderlijke fout gelogd, blijft de sessie beëindigd en is een idempotente retry mogelijk. De uitnodigingskaart toont in alle gevallen dat de sessie niet meer actief is.

Voor iedere room waarvan opruiming nog niet is bevestigd, bewaart de server duurzaam minimaal het room-ID, de opruimstatus, de laatste fout en de benodigde retrygegevens. Deze beperkte cleanupregistratie is geen duurzame paint-sessie en bevat geen strokes, deelnemersstatus, revisie of broninhoud. Daardoor kan een opruimactie na een serverrestart opnieuw worden uitgevoerd.

End is een blijvende statuswijziging en verhoogt de revisie. De sessiekaart moet de beëindigde toestand kunnen tonen.

### 6.12 Expiry

Een actieve sessie verloopt na dertig minuten inactiviteit. De server voert iedere minuut een expiratiesweep uit. Expiry verandert de status naar `Expired`, verhoogt de revisie en publiceert `paint.expired` in het sessiekanaal. Ook na expiry wordt de tijdelijke private Matrix-room volgens hetzelfde gelogde en idempotente opruimproces aangeboden.

### 6.13 Serverrestart

De sessiestatus wordt alleen in het servergeheugen bijgehouden. Bij een serverrestart gaat de actieve sessie verloren. Het plan vraagt niet om herstel van een actieve paint-sessie na een restart.

De Matrix-uitnodiging en eventueel eerder opgeslagen PNG-resultaat kunnen wel buiten deze in-memory status bestaan, maar de server reconstrueert daaruit geen actieve sessie. Voor rooms met een nog openstaande opruimactie blijft uitsluitend de beperkte cleanupregistratie duurzaam bewaard, zodat de cleanup na de restart opnieuw kan worden uitgevoerd.

---

## 7. Gezaghebbend statusmodel

### 7.1 Paint-sessie

De sessie is de serverbeheerde eenheid die alle context van één gezamenlijke tekening bijeenhoudt. De snapshot bevat volgens het contract onder andere:

- `SessionId`;
- `ChannelId`;
- `MatrixRoomId`;
- optioneel `SourceEventId` zolang de bron nog niet is gekoppeld;
- optioneel de MXC-URL en bronafmetingen;
- `HostUserId`;
- `Status`;
- `Generation`;
- `Revision`;
- de deelnemers;
- de definitieve streken;
- `ExpiresAt`.

### 7.2 Status

De sessiestatus ondersteunt minimaal:

- `PendingSource`;
- `Active`;
- `Ended`;
- `Expired`.

De chatkaart moet actieve, beëindigde, verlopen en niet-beschikbare presentatietoestanden kunnen weergeven.

### 7.3 Revision

`revision` is een monotoon oplopend servernummer voor iedere blijvende wijziging. Volgens het plan wordt de revisie verhoogd bij:

- create;
- join;
- leave;
- commit;
- undo;
- clear;
- end;
- expiry.

Iedere snapshot en ieder permanent event bevat de revisie. De revisie maakt het mogelijk om ontbrekende blijvende gebeurtenissen betrouwbaar te herkennen.

### 7.4 Generation

`generation` identificeert de huidige annotatiegeneratie. Een host-clear verhoogt dit nummer. Iedere stroke- en previewgebeurtenis bevat de generatie.

Het doel is te voorkomen dat oude streken of vertraagde previews na een clear opnieuw in de nieuwe lege toestand terechtkomen.

### 7.5 Sequence

Iedere definitieve streek krijgt een door de server bepaalde `sequence`. Clients sorteren gecommitte streken op deze servervolgorde. De clientvolgorde waarin netwerkberichten aankomen is dus niet beslissend voor de uiteindelijke tekenvolgorde.

### 7.6 Stroke-ID en correlation-ID

Een `PaintStroke` heeft twee verschillende identiteitswaarden met verschillende doelen:

- `id`: de permanente, door de server gemaakte stroke-identiteit;
- `correlationId`: een opaque, door de client gemaakte koppeling tussen tijdelijke preview en definitieve commit.

De client mag het `correlationId` gebruiken om precies de bijbehorende preview te vervangen. Het mag niet als permanente serveridentiteit worden behandeld.

### 7.7 AuthorUserId

Het auteurschap van een definitieve streek wordt vanuit de geauthenticeerde servercontext bepaald. De frontend is niet de gezaghebbende bron voor `authorUserId`. Deze eigenschap ondersteunt onder meer de regel dat undo alleen op de eigen laatste actieve streek mag werken.

---

## 8. Privacy-, toegangs- en veiligheidsdoelen

### 8.1 Precies één private room per sessie

Iedere paint-sessie krijgt exact één private, invite-only Matrix-room. Het opgeslagen `matrixRoomId` bepaalt de enige roomcontext waarin de bron voor die sessie geldig kan zijn.

### 8.2 Alleen expliciete uitnodigingen

De invite-lijst bestaat exact uit de host en geselecteerde deelnemers. De roomservice mag geen bredere kanaalgroep uitnodigen en mag gebruikers niet automatisch laten toetreden.

### 8.3 Dubbele toegangscontrole

Voor actieve paint-handelingen gelden meerdere gelijktijdige voorwaarden:

- de gebruiker heeft een geldige, door de server afgeleide Brmble-identiteit;
- de gebruiker is op dat moment lid van het bijbehorende kanaal;
- de gebruiker is actieve deelnemer van de paint-sessie;
- voor paint-join is gecontroleerd dat de Matrix-gebruiker de opgeslagen private room werkelijk heeft gejoint;
- de bron is al gevalideerd en gekoppeld.

De creator vormt alleen voor de initiële paint-deelname een uitzondering doordat deze automatisch wordt toegevoegd. De host moet nog steeds met de eigen Matrix-client tot de room toetreden om de bron te plaatsen.

### 8.4 Geen vertrouwen in frontendmetadata

De server leidt identiteit, auteurschap, kanaallidmaatschap, bronmetadata en Matrix-roomcontext af uit servergecontroleerde gegevens. Dit voorkomt dat een client zichzelf als een andere auteur presenteert, een bron uit een andere room koppelt of onjuiste mediagegevens als geldig laat behandelen.

### 8.5 Bronvalidatie

Ondersteunde bronformaten zijn uitsluitend:

- PNG;
- JPEG;
- WebP.

Niet ondersteund zijn expliciet:

- GIF;
- SVG.

De maximale dimensie is 4096 × 4096 pixels. De resolver moet het MIME-type herkennen op basis van de gedownloade media en de afmetingen decoderen, in plaats van alleen eventvelden van de frontend te vertrouwen.

De maximale bestandsgrootte is niet als vaste Brmble-waarde gedefinieerd. Vóór een upload vraagt de client de Matrix media-configuratie op via `GET /_matrix/media/v3/config` en gebruikt `m.upload.size` (in bytes) wanneer die beschikbaar is. Ontbreekt de waarde of is deze `null`, dan is de limiet onbekend. Het voorbeeld uit de Matrix-specificatie (`50000000` bytes) is uitsluitend illustratief en geen gegarandeerde limiet. De UI toont de feitelijke homeserverlimiet wanneer bekend en behandelt een Matrix-`413` als uploadweigering; een proxy kan een lagere limiet hebben.

### 8.6 De bron is niet uitwisbaar met de editorgum

De gum werkt uitsluitend op de annotatielaag. De oorspronkelijke bronpixels worden niet gewijzigd. Dit is zowel een productregel als een renderingregel.

---

## 9. Realtime transport en herstelgedrag

### 9.1 Geserialiseerde verzending per socket

Per WebSocket wordt één single-reader queue gebruikt. Berichten voor dezelfde socket worden geserialiseerd verzonden, zodat twee broadcasts niet gelijktijdig via dezelfde socketwriter schrijven.

### 9.2 Begrensde wachtrij

Iedere socketqueue heeft capaciteit 128. Deze grens voorkomt een onbeperkt groeiende achterstand bij een trage client.

### 9.3 Previewcoalescing

Previewberichten mogen in de wachtrij worden samengevoegd per `(sessionId, authorUserId)`. Oudere tussenstanden van dezelfde lopende streek hoeven niet allemaal te worden afgeleverd wanneer een nieuwere preview beschikbaar is.

### 9.4 Prioriteit voor permanente gebeurtenissen

Wanneer een permanente gebeurtenis moet worden ingevoegd en de queue vol is, worden eerst previews verwijderd. Blijft de queue daarna vol, dan wordt de langzame socket gesloten met `PolicyViolation` en uit de eventbus verwijderd.

Het doel is niet om de definitieve gebeurtenis stil te laten verdwijnen. De client herstelt door opnieuw te verbinden en een actuele snapshot op te halen.

### 9.5 Kanaalgerichte broadcasts

Paint-events worden alleen naar het kanaal van de sessie gepubliceerd. Het plan noemt de volgende eventtypen:

- `paint.created`;
- `paint.sourceAttached`;
- `paint.joined`;
- `paint.participantJoined`;
- `paint.participantLeft`;
- `paint.strokePreview`;
- `paint.strokeCommitted`;
- `paint.strokeRemoved`;
- `paint.canvasCleared`;
- `paint.ended`;
- `paint.expired`.

Alle permanente events bevatten `revision`. Stroke- en previewevents bevatten `generation`.

### 9.6 Reconnect en snapshot

Een opnieuw verbonden client haalt een snapshot op. Ook zonder socketonderbreking vraagt de client een snapshot zodra een revision gap wordt gedetecteerd.

De snapshot is daarmee het herstelmechanisme voor:

- gemiste permanente events;
- een bewust gesloten trage socket;
- tijdelijke netwerkonderbreking;
- opnieuw openen van een actieve sessie zolang die nog in servergeheugen bestaat.

Het plan vraagt niet om offline bewerken of het later samenvoegen van offline wijzigingen.

---

## 10. Teken- en renderingsemantiek

### 10.1 Genormaliseerde coördinaten

Punten worden over het netwerk verstuurd als genormaliseerde `[x, y]`-waarden tussen 0 en 1. Hierdoor vertegenwoordigt een punt een relatieve positie binnen het canvas in plaats van een vaste schermpixel.

De server accepteert alleen eindige waarden binnen dit bereik. Een definitieve streek bevat maximaal 2.000 punten.

### 10.2 Gescheiden canvassen

De renderer gebruikt twee inhoudelijke lagen:

1. een immutable source canvas voor de bronafbeelding;
2. een transparant annotation canvas voor pen- en gumstreken.

De bron wordt niet bij iedere gumactie destructief aangepast. Alle bewerkbare inhoud bevindt zich op de annotatielaag.

### 10.3 Pen

Penstreken worden met ronde joins en ronde caps getekend. Genormaliseerde punten worden bij het renderen naar de actuele canvasafmetingen geschaald.

Een streek met één punt wordt als een stip gerenderd, zodat ook een klik zonder langere pointerbeweging zichtbaar kan zijn.

### 10.4 Gum

De gum gebruikt `destination-out` uitsluitend op de annotation context. Daarna wordt de composite operation teruggezet naar `source-over`.

De source context mag niet met `destination-out` worden bewerkt. Hierdoor verwijdert de gum alleen eerder getekende annotaties.

### 10.5 Deterministische reconstructie

Clients dedupliceren definitieve streken op server-ID en sorteren ze op server-sequence. Streken en previews uit oudere generaties worden genegeerd.

Het zichtbare definitieve annotatiebeeld moet daardoor opnieuw kunnen worden opgebouwd uit de snapshot en geordende serverstreken, onafhankelijk van lokale previewgeschiedenis.

### 10.6 Export

Voor export wordt de bron eerst op een offscreen canvas getekend en daarna de annotatielaag. De bronmedia wordt als Blob opgehaald en via een object-URL beschikbaar gemaakt voor rendering en export.

De export bevat alleen de bron plus definitief gecommitte streken. Tijdelijke previews worden niet meegenomen.

---

## 11. Ondersteunde editorfuncties

De eerste versie ondersteunt exact de in het plan vastgelegde gereedschappen en keuzes.

### 11.1 Gereedschappen

- Pen
- Gum

### 11.2 Kleuren

De toegestane kleuren zijn exact:

- `#ffffff`
- `#111827`
- `#ef4444`
- `#f59e0b`
- `#22c55e`
- `#4ec9ff`

De API en frontend gebruiken deze codes in kleine letters. De server normaliseert aangeleverde hexadecimale kleurcodes eerst naar kleine letters en vergelijkt daarna met deze vaste lijst; `#EF4444` is dus geldig maar wordt als `#ef4444` opgeslagen en teruggegeven.

### 11.3 Lijndiktes

De toegestane breedtes zijn exact:

- `3`
- `6`
- `12`

### 11.4 Pendruk

`pressure` in `PaintPoint` is optioneel. Als een client de waarde meestuurt, wordt deze als een eindige waarde binnen `[0,1]` opgeslagen, maar zij heeft in versie 1 geen effect op de rendering. De lijndikte wordt uitsluitend bepaald door de gekozen vaste breedte `3`, `6` of `12`.

### 11.5 Sessiebesturing in de editor

De editor toont volgens het plan:

- deelnemers;
- pen/gumkeuze;
- kleurenpalet;
- lijndiktes;
- **Close**;
- **Save to chat**;
- **Undo** voor de eigen laatste actieve streek;
- **Clear** uitsluitend voor de host;
- **End** uitsluitend voor de host.

Pointer capture en redraw via animation frames ondersteunen de tekeninteractie.

---

## 12. API- en bridgebedoeling

De API en NativeBridge vormen samen het verticale transport tussen webfrontend, native client en server.

### 12.1 Sessieroutes

Alle routes vereisen de bestaande mTLS-authenticatie. De server leidt de caller en het auteurschap af uit die authenticatie; een client verstuurt daarom nooit `authorUserId` of `hostUserId`. `{id}` is altijd een UUID van een bestaande sessie. JSON gebruikt `camelCase`; tijden zijn ISO-8601-UTC. Een succesvolle mutatie retourneert minimaal de actuele `revision`. Behalve preview-resultaten zijn wijzigingen blijvend binnen de actieve sessie en idempotentie wordt waar hieronder vereist op de aangegeven sleutel toegepast.

De compacte voorbeelden gebruiken deze gedeelde vormen:

```json
// PaintPoint; pressure is optioneel en heeft geen renderingeffect
{ "x": 0.42, "y": 0.77, "pressure": 0.5 }

// PaintStroke (serverwaarden zijn id, sequence en authorUserId)
{ "id": "stroke-uuid", "correlationId": "client-uuid", "authorUserId": "user-uuid", "sequence": 12,
  "generation": 1, "tool": "pen", "color": "#ef4444", "width": 6,
  "points": [{ "x": 0.42, "y": 0.77, "pressure": 0.5 }] }

// PaintSessionSnapshot (velden die nog geen bron hebben zijn null)
{ "sessionId": "session-uuid", "channelId": "channel-uuid", "matrixRoomId": "!room:example.org",
  "source": { "eventId": "$event", "mxcUrl": "mxc://example.org/media", "mimeType": "image/png",
              "width": 1920, "height": 1080, "sizeBytes": 1048576 },
  "hostUserId": "user-uuid", "status": "active", "generation": 1, "revision": 12,
  "participants": [{ "userId": "user-uuid", "active": true }], "strokes": [],
  "expiresAt": "2026-07-24T12:00:00Z" }
```

Een fout heeft steeds de vorm `{ "code": "...", "message": "...", "requestId": "..." }`. De gebruikte HTTP-statussen zijn: `400` voor een ongeldige payload, `401` zonder geldige authenticatie, `403` zonder recht, `404` voor een onbekende sessie, `409` voor een ongeldige sessiestatus of revisie/generatieconflict, `413` voor een te groot bronbestand, `429` voor rate limits en `502` voor een Matrix-afhankelijkheidsfout. `500` is gereserveerd voor onverwachte serverfouten.

#### `POST /paint/sessions`

**Verplicht request:** `channelId` en `participantSessionIds` (unieke array van actuele Mumble-sessie-ID's; mag leeg zijn). **Optioneel:** geen. De caller wordt altijd als host en actieve deelnemer toegevoegd, ook als die niet in de array staat. Geselecteerde sessie-ID's worden alleen gebruikt om invitees te bepalen. Voorbeeld:

```json
{ "channelId": 5, "participantSessionIds": [102, 103] }
```

**Response `201`:** `{ "sessionId": "...", "matrixRoomId": "..." }`. Fouten: `400 INVALID_REQUEST`, `403 CHANNEL_MEMBERSHIP_REQUIRED`, `409 SESSION_CREATE_CONFLICT`, `502 MATRIX_ROOM_CREATE_FAILED` of `MATRIX_INVITE_FAILED`. Validatie: host en alle geselecteerde sessies zijn op het moment van aanmaken aanwezig in het voice channel; duplicaten worden samengevoegd en onbekende of kanaalvreemde sessies zijn niet toegestaan; de invite-lijst bevat precies host plus de opgeloste invitees.

#### `POST /paint/sessions/{id}/source`

**Verplicht request:** `sourceEventId` (niet-lege Matrix-event-ID). **Optioneel:** geen. Voorbeeld: `{ "sourceEventId": "$source-event:example.org" }`.

**Response `200`:** `{ "snapshot": { "…": "PaintSessionSnapshot met gevalideerde source en status active" } }`. Fouten: `400 INVALID_REQUEST` of `UNSUPPORTED_IMAGE`, `403 HOST_REQUIRED`, `404 SOURCE_EVENT_NOT_FOUND`, `409 SOURCE_ALREADY_ATTACHED` of `SESSION_NOT_PENDING_SOURCE`, `413 SOURCE_TOO_LARGE`, `502 MATRIX_MEDIA_DOWNLOAD_FAILED`. Validatie: alleen de host; event bevindt zich in de opgeslagen paint-room en is `m.image`; werkelijk herkend type is PNG/JPEG/WebP; geen GIF/SVG; maximaal 4096 × 4096 pixels; grootte valt binnen de bekende `m.upload.size` van de homeserver.

#### `GET /paint/sessions/{id}`

**Request:** geen body of queryparameters. **Response `200`:** `{ "snapshot": { "…": "PaintSessionSnapshot" } }`. Fouten: `403 CHANNEL_MEMBERSHIP_REQUIRED`, `404 SESSION_NOT_FOUND`, `409 SESSION_UNAVAILABLE`. Validatie: caller hoort bij het gekoppelde voice channel; de volledige strokes- en deelnemerslijst wordt alleen teruggegeven aan host of geselecteerde deelnemer die toegang heeft tot de paint-room. Een beëindigde of verlopen sessie retourneert de status zolang die nog in geheugen beschikbaar is.

#### `POST /paint/sessions/{id}/join`

**Request:** geen body. **Response `200`:** `{ "snapshot": { "…": "PaintSessionSnapshot" }, "joined": true }`. Heeft een oorspronkelijk geselecteerde gebruiker de private Matrix-room verlaten, dan retourneert de eerste nieuwe deelnamepoging `202` met `{ "reinvited": true }` en stuurt de server opnieuw een Matrix-uitnodiging; de gebruiker moet de room daarna met de eigen client joinen en deze endpoint opnieuw aanroepen. Fouten: `403 NOT_SELECTED`, `CHANNEL_MEMBERSHIP_REQUIRED` of `MATRIX_ROOM_JOIN_REQUIRED`; `409 SESSION_NOT_ACTIVE`; `502 MATRIX_MEMBERSHIP_LOOKUP_FAILED` of `MATRIX_REINVITE_FAILED`. Validatie: caller is de host of oorspronkelijk geselecteerd, is in het voice channel aanwezig en heeft daadwerkelijk Matrix-membership `join` in de opgeslagen private room. De handeling is idempotent: een reeds actieve deelnemer krijgt `200` zonder dubbele participant. Na een eerdere `leave` mag dezelfde geselecteerde gebruiker hiermee opnieuw actief worden.

#### `POST /paint/sessions/{id}/leave`

**Request:** geen body. **Response `200`:** `{ "revision": 13, "left": true }`. Fouten: `403 PARTICIPANT_REQUIRED`; `409 SESSION_NOT_ACTIVE`. Validatie: de caller is actieve deelnemer. Leave maakt uitsluitend de actieve paint-deelname inactief, verwijdert de gebruiker niet uit de oorspronkelijke selectielijst en verlaat de Matrix-room niet namens de gebruiker. De actie is idempotent voor een reeds verlaten geselecteerde deelnemer.

#### `POST /paint/sessions/{id}/stroke`

**Verplicht request:** `correlationId` (UUID), `generation` (niet-negatief geheel getal), `tool` (`pen` of `eraser`), `width` (toegestane vaste breedte) en `points` (minimaal één `PaintPoint`). **Verplicht bij `pen`:** `color` (één van de zes vaste kleuren). **Optioneel bij `eraser`:** `color` wordt genegeerd. Voorbeeld:

```json
{ "correlationId": "client-uuid", "generation": 1, "tool": "pen", "color": "#ef4444", "width": 6,
  "points": [{ "x": 0.1, "y": 0.2, "pressure": 0.5 }, { "x": 0.2, "y": 0.3, "pressure": 0.6 }] }
```

**Response `201`:** `{ "stroke": { "…": "PaintStroke" }, "revision": 13 }`. Fouten: `400 INVALID_STROKE`, `403 PARTICIPANT_REQUIRED`, `409 STALE_GENERATION` of `SESSION_NOT_ACTIVE`, `429 STROKE_RATE_LIMITED`. Validatie: caller is actieve deelnemer; coördinaten en, indien aanwezig, pressure zijn eindige waarden binnen `[0,1]`; points, tool, kleur en breedte volgen de editorbeperking; kleuren worden naar kleine letters genormaliseerd; generation is actueel; pressure verandert de rendering niet; dezelfde `correlationId` van dezelfde caller is idempotent en retourneert de eerder gemaakte commit.

#### `POST /paint/sessions/{id}/preview`

**Verplicht request:** `correlationId`, `generation`, `tool`, `width` en `points`; `color` is verplicht voor `pen` en optioneel voor `eraser`. De veldvormen en validatie zijn gelijk aan stroke, maar de payload is tijdelijk. **Response `202`:** `{ "accepted": true }`. Fouten: `400 INVALID_PREVIEW`, `403 PARTICIPANT_REQUIRED`, `409 STALE_GENERATION` of `SESSION_NOT_ACTIVE`, `429 PREVIEW_RATE_LIMITED`. Previews zijn maximaal 20 per seconde per auteur per sessie; een overbodige preview mag worden samengevoegd of genegeerd zonder de definitieve sessiestatus te wijzigen.

#### `POST /paint/sessions/{id}/undo`

**Request:** geen body. **Response `200`:** `{ "undoneStrokeId": "stroke-uuid", "revision": 14 }`. Fouten: `403 PARTICIPANT_REQUIRED`, `404 NO_ACTIVE_OWN_STROKE`, `409 SESSION_NOT_ACTIVE`. Validatie: alleen actieve deelnemers; uitsluitend de meest recente nog actieve streek van de caller wordt verwijderd. Een client kan geen stroke-ID of andere auteur opgeven.

#### `POST /paint/sessions/{id}/clear`

**Request:** geen body. **Response `200`:** `{ "generation": 2, "revision": 15 }`. Fouten: `403 HOST_REQUIRED`, `409 SESSION_NOT_ACTIVE`. Validatie: alleen de host; verhoogt generation exact één keer en maakt alle annotaties uit eerdere generaties onzichtbaar; de source blijft intact.

#### `POST /paint/sessions/{id}/end`

**Request:** geen body. **Response `202`:** `{ "status": "ended", "revision": 16, "matrixRoomCleanup": "pending" }`. Fouten: `403 HOST_REQUIRED`, `409 SESSION_ALREADY_ENDED` of `SESSION_EXPIRED`. Validatie: alleen de host kan een actieve sessie beëindigen. De sessiestatus wordt eerst atomair beëindigd; daarna probeert de server de tijdelijke private Matrix-room te verwijderen. Een latere opruimfout verandert de status niet en wordt gelogd met een retry-pad.

### 12.2 NativeBridge

`PaintService` gebruikt dezelfde mTLS-transportbenadering als `GameService`. Bridgeverzoeken en `paint.response` worden met `requestId` gecorreleerd.

`MumbleAdapter` stuurt alle `paint.*` WebSocket-events door naar de weblaag naast de bestaande `game.*`-events.

Het doel is dat de webfrontend de paintfunctionaliteit via de bestaande native/clienttransportstructuur kan gebruiken zonder de serveridentiteitscontrole naar de frontend te verplaatsen.

---

## 13. Frontendstatus en reconciliatie

## Follow-up access model

- `participantSessionIds` in the create request are current Mumble session
  identifiers used only for selection. The server resolves them immediately to
  persistent authenticated user identities.
- Invitees are allowed to request participation. They are not participants and
  cannot fetch a full snapshot, receive canvas events, open the editor, or draw.
- `GET /paint/sessions/{id}/summary` returns only session status, channel, host,
  `canJoin`, and `isParticipant`. It never returns the Matrix Paint room, source,
  participants, strokes, previews, revision, or generation.
- `GET /paint/sessions/{id}` is participant-only and reports the authenticated
  requester's `currentUserId` and `isHost`.
- A participant is bound to the Mumble connection on which `POST /join`
  succeeded. Disconnecting or leaving the session channel removes that binding.
  Reconnect and channel re-entry require another explicit `POST /join`.
- Presence, connection, channel-entry, invitation, and snapshot paths can remove
  stale participation but cannot add or restore participation.
- Canvas events are routed only to active participants on their current
  connection. Invitation summaries and terminal card status are the only Paint
  state visible before join.
- The invitation card uses `Join paint` to change participation and `Open paint`
  to change the workspace. Neither action implies the other.
- An open editor occupies the upper vertical workspace pane. The connected
  channel `ChatPanel` remains mounted in the lower pane with its history,
  live events, composer, and draft state intact.

### 13.1 `usePaintSession(sessionId)`

De hook is verantwoordelijk voor het bijeenbrengen van snapshotdata, permanente events en optimistische previews.

De hook moet:

- alle paint-events volgen;
- gecommitte streken op server-ID dedupliceren;
- streken op sequence sorteren;
- previews aan commits koppelen via `correlationId`;
- alleen de overeenkomende preview verwijderen;
- oudere generaties negeren;
- permanente revisies op aaneengesloten volgorde controleren;
- bij een revision gap direct een snapshot aanvragen.

### 13.2 Optimistische previews zonder gezagsverlies

Een lokale of ontvangen preview mag snel zichtbaar zijn, maar is geen definitieve sessiestatus. De definitieve serverstroke vervangt de preview zodra de commit wordt ontvangen.

De client maakt dus een onderscheid tussen:

- wat voorlopig wordt getoond om realtime feedback te geven;
- wat de server blijvend heeft geaccepteerd.

### 13.3 Uitnodigingskaart

De chatlaag herkent paint-sessionmetadata en toont een `PaintSessionCard`. De kaart ondersteunt minimaal:

- actieve sessie;
- beëindigde sessie;
- verlopen sessie;
- niet-beschikbare sessie.

Bij een actieve en toegankelijke sessie is de joinactie zichtbaar.

---

## 14. Bewuste beperkingen van deze versie

### 14.1 Tijdelijkheid van actieve sessies

Actieve sessies worden niet duurzaam opgeslagen. Ze verlopen na dertig minuten inactiviteit en verdwijnen bij een serverrestart.

### 14.2 Beperkte persistentie

Volgens het plan worden alleen de volgende uitkomsten buiten de in-memory paintstatus behouden:

- de Matrix-uitnodiging / chatmetadata;
- de geëxporteerde PNG wanneer die naar chat wordt opgeslagen.
- minimale cleanupregistraties voor private Matrix-rooms waarvan opruiming nog niet is bevestigd.

Het geordende strokeregister, deelnemersstatus, revisie en generatie worden niet als duurzame sessie opgeslagen. De cleanupregistratie bevat uitsluitend gegevens die nodig zijn om room-opruiming later opnieuw te proberen en herstelt geen actieve sessie.

### 14.3 Geen offline werkwijze

De versie ondersteunt geen offline tekenen, offline eventbuffer of samenvoeging van wijzigingen die buiten een actieve serververbinding zijn gemaakt.

### 14.4 Geen uitgebreide tekenfuncties

De volgende onderdelen worden expliciet uitgesteld:

- shapes;
- text;
- layers als gebruikersfunctie;
- cursors;
- host transfer;
- starten via het contextmenu van een bestaande afbeelding.

De technische scheiding tussen source- en annotationcanvas is wel onderdeel van deze versie, maar een algemene gebruikersinterface voor meerdere bewerkbare lagen is dat niet.

### 14.5 Beperkte gereedschapskeuze

Alleen de vastgelegde pen, gum, zes kleuren en drie breedtes worden ondersteund. Het plan bevat geen vrije kleurkiezer, aangepaste diktes of extra brushtypen.

### 14.6 Alleen Windows

Brmble en Collaborative Paint worden in versie 1 uitsluitend voor Windows ondersteund. Mobiele clients, macOS, Linux, web-only gebruik en platformspecifieke alternatieven vallen buiten de scope.

---

## 15. Fout- en herstelverwachtingen

### 15.1 Roomcreatie of uitnodigen mislukt

De setupmodal moet een expliciete fout tonen. De gebruikersstroom mag niet doorgaan alsof er een geldige private room bestaat.

### 15.2 Ongeldige bron

De source-attachactie wordt geweigerd wanneer de bron:

- niet uit de sessieroom komt;
- geen `m.image`-event is;
- niet kan worden gedownload of gedecodeerd;
- GIF of SVG is;
- een niet-ondersteund type heeft;
- groter is dan 4096 × 4096.

De sessie wordt niet als actieve tekencontext gebruikt zolang geen geldige bron is gekoppeld.

### 15.3 Onvoldoende toegangsrechten

Acties worden geweigerd wanneer de gebruiker niet aan de vereiste kanaal-, deelnemer- of Matrix-roomvoorwaarden voldoet. De planvoorbeelden verwachten hierbij onder meer een `Forbidden`-antwoord voor een gebruiker buiten het sessiekanaal, een kanaallid dat nog geen paint-deelnemer is en een gebruiker die niet tot de private room is toegetreden.

### 15.4 Revision gap

De client vraagt onmiddellijk een volledige snapshot. De client probeert de ontbrekende verandering niet af te leiden.

### 15.5 Vertraagd event uit oude generatie

Het event wordt genegeerd. Dit voorkomt herstel van annotaties die door een clearactie ongeldig zijn geworden.

### 15.6 Volle socketqueue

Previews worden eerst verwijderd of samengevoegd. Als een permanent event daarna nog niet kan worden ingevoegd, wordt de trage socket gesloten. Reconnect plus snapshot is het herstelpad.

### 15.7 Save mislukt

De fout moet opnieuw uitvoerbaar zijn. Het plan vraagt om retryable failures en het voorkomen van dubbele saves.

### 15.8 Logging en observatie

De server logt gestructureerd met minimaal `requestId`, `sessionId` (indien bekend), actor- of caller-ID, eventtype, uitkomst en foutcode. Gevoelige media-inhoud, toegangstokens en volledige afbeeldingsbytes worden niet gelogd.

Minimaal de volgende gebeurtenissen en fouten worden vastgelegd:

- sessiecreatie, source-attach, join, leave, rejoin, clear, end, expiry en room-opruiming;
- mislukte bron- en resultaatuploads, inclusief Matrix-HTTP-status of Matrix-foutcode;
- geweigerde joins en andere autorisatieweigeringen, met de reden maar zonder geheime gegevens;
- Matrix-fouten bij roomcreatie, uitnodiging, membershipcontrole, media-download, verzending en verwijderen;
- verbroken sockets, backpressure-sluitingen, reconnects en gedetecteerde revision gaps;
- verlopen, beëindigde en na serverrestart niet meer beschikbare sessies.

Een fout bij het verwijderen van de private room wordt afzonderlijk gelogd en voorzien van een correleerbare retry-status. Logging ondersteunt diagnose en audit, maar introduceert geen aanvullende analyticsdoelen.

---

## 16. Kwaliteits- en verificatiedoelen

De implementatie wordt testgedreven per verticale laag opgebouwd. Iedere taak begint met falende tests, implementeert vervolgens het gedrag en eindigt met een groene testuitvoering en een gerichte commit.

### 16.1 Contractkwaliteit

De servercontracten moeten het verschil tussen permanente stroke-identiteit en previewcorrelatie afdwingen. De snapshot- en strokemodellen moeten de benodigde revision-, generation-, sequence-, source- en participantsgegevens bevatten.

### 16.2 Sessiemanagerkwaliteit

Tests moeten bevestigen dat:

- socketwrites niet overlappen;
- undo alleen de laatste actieve streek van de auteur verwijdert;
- permanente gebeurtenissen niet worden opgeofferd aan een volle previewqueue;
- de server stroke-ID's en sequences toekent;
- revisies bij blijvende wijzigingen verhogen;
- clear host-only is en de generatie verhoogt;
- sessies na de vastgelegde inactiviteitsduur verlopen.

### 16.3 Autorisatie- en integratiekwaliteit

Endpointtests moeten onder meer bevestigen dat:

- een gebruiker buiten het sessiekanaal niet kan tekenen;
- een kanaallid zonder actieve paint-deelname niet kan tekenen;
- een gebruiker zonder geldige Matrix-roommembership niet kan joinen;
- ongeldige of te grote bronnen worden geweigerd;
- precies de host en geselecteerde deelnemers worden uitgenodigd;
- geen auto-joinhelper wordt gebruikt;
- bridgecommando's naar de juiste paint-endpoints worden gestuurd.

### 16.4 Frontendconsistentie

Frontendtests moeten bevestigen dat:

- pointercoördinaten correct worden genormaliseerd;
- een preview met de overeenkomende commit wordt vervangen;
- een revision gap een snapshotrequest veroorzaakt;
- de gum de bronlaag niet aanpast;
- een pointeractie één genormaliseerde commit oplevert;
- de uitnodigingskaart een joinactie kan tonen;
- de sessie wordt gecreëerd voordat de host de bron in de private room uploadt en koppelt;
- een oude-generationpreview na clear wordt genegeerd.

### 16.5 Volledige verticale verificatie

De complete automatische verificatie bestaat uit:

- `dotnet test Brmble.slnx`;
- `npm run test`;
- `npm run build`.

Daarna volgt een handmatige controle met twee clients waarin minimaal wordt bevestigd dat:

1. alleen de geselecteerde Matrix-accounts een uitnodiging ontvangen;
2. de host de bron in de private room plaatst;
3. room- en event-ID in de snapshot terechtkomen;
4. een uitgenodigde deelnemer met de eigen Matrix-client de bron kan ophalen en kan joinen;
5. een niet-uitgenodigde gebruiker in hetzelfde voice channel wordt geweigerd;
6. twee clients gelijktijdig kunnen tekenen;
7. een client kan reconnecten en opnieuw synchroniseren;
8. een gebruiker de eigen streek kan undoën;
9. alleen de host kan clearen;
10. het opgeslagen chatresultaat de bron en gecommitte streken bevat;
11. de vastgelegde limieten en restartbeperking in het designrapport worden vermeld.

---

## 17. Relatie tussen de implementatietaken en het productdoel

### Taak 1 — Serverprotocol vastleggen

Deze taak definieert de taal waarmee alle lagen over dezelfde sessie spreken. Zonder vaste contracten voor punt, streek, deelnemer, bron, status, snapshot, sequence, generation en revision kan geen consistente realtime samenwerking bestaan.

Het expliciete onderscheid tussen server-`id` en client-`correlationId` ondersteunt het doel om snelle previews te combineren met servergezag over definitieve inhoud.

### Taak 2 — WebSockettransport en sessies betrouwbaar maken

Deze taak realiseert het servergezag en het herstelbare realtime gedrag. De sessiemanager bewaakt lifecycle, autorisatie op sessieniveau, validatie, ordening, undo, clear en expiry. De aangepaste eventbus voorkomt gelijktijdige socketwrites en beschermt permanente gebeurtenissen tegen previewdruk.

### Taak 3 — Geauthenticeerde API, Matrix-integratie en native bridge

Deze taak verbindt Brmble-identiteit, kanaallidmaatschap, Matrix-roomtoegang, bronvalidatie en het frontendtransport. Hier wordt afgedwongen dat de private room werkelijk invite-only is, dat gebruikers zelf joinen en dat de bron uit de juiste room komt.

### Taak 4 — Canvasprimitieven en realtime frontendstatus

Deze taak zorgt dat alle clients dezelfde bron en definitieve strokes deterministisch renderen, terwijl previews direct kunnen verschijnen. Revision gaps, serversequences, generations en correlations worden hier vertaald naar correct lokaal gedrag.

### Taak 5 — Editor, uitnodiging en Matrix-export

Deze taak maakt de volledige gebruikersstroom zichtbaar en bedienbaar: deelnemers kiezen, sessie aanmaken, bron plaatsen, uitnodiging tonen, tekenen, undo/clear/end uitvoeren en het resultaat naar chat opslaan.

### Taak 6 — Verticale slice verifiëren

Deze taak bewijst dat de afzonderlijke lagen samen één werkende lifecycle vormen. De test controleert de eventvolgorde van create tot end, regressies rond revision en generation, de volledige geautomatiseerde suite en de echte interactie tussen twee clients.

---

## 18. Definitie van succes

De implementatie bereikt het in dit document beschreven doel wanneer de volgende uitspraak volledig waar is:

> Binnen een Brmble-kanaal kan een host een tijdelijke gezamenlijke tekensessie starten met expliciet geselecteerde deelnemers; de server creëert daarvoor precies één private invite-only Matrix-room, de host plaatst en koppelt daar een gevalideerde bronafbeelding, alleen geautoriseerde en werkelijk gejoinde deelnemers kunnen de sessie gebruiken, alle definitieve annotaties worden servergeordend en via revisions herstelbaar gesynchroniseerd, de bron blijft door de gum onaangetast, host- en deelnemersrechten worden afgedwongen, en het definitieve samengestelde PNG-resultaat kan naar de oorspronkelijke chat worden opgeslagen.

Succes betekent daarnaast dat de implementatie de afgesproken beperkingen niet stilzwijgend overschrijdt. De sessie blijft tijdelijk, de ondersteunde media en tools blijven begrensd, previews mogen verliesgevoelig zijn maar permanente gebeurtenissen niet, en uitgestelde fase-2-functionaliteit wordt niet als onderdeel van deze verticale slice behandeld.

---

## 19. Expliciete niet-doelen

Deze implementatie heeft volgens het plan niet als doel om:

- actieve sessies duurzaam over een serverrestart heen te bewaren;
- offline tekenen te ondersteunen;
- offline wijzigingen later samen te voegen;
- vormen toe te voegen;
- tekstobjecten toe te voegen;
- een algemene lageneditor te leveren;
- live cursors van deelnemers weer te geven;
- het hostschap tijdens een sessie over te dragen;
- een sessie via het contextmenu van een bestaande chat-afbeelding te starten;
- GIF- of SVG-bronnen te ondersteunen;
- de bronafbeelding destructief met de gum te bewerken;
- willekeurige kleuren, breedtes of aanvullende tools toe te voegen;
- alle kanaalleden automatisch toegang tot de tekening te geven;
- Matrix-gebruikers namens hen automatisch in de private room te laten joinen;
- mobiele, macOS-, Linux- of web-only clients te ondersteunen;
- uitgebreide toegankelijkheidseisen of een formele toegankelijkheidsaudit voor versie 1 te leveren;
- aanvullende prestatielimieten vast te leggen voor het aantal deelnemers, strokes of gelijktijdige sessies.

---

## 20. Terminologie

| Term | Betekenis binnen deze specificatie |
| --- | --- |
| Paint-sessie | De tijdelijke, serverbeheerde samenwerkingscontext voor één tekening. |
| Host | De creator van de sessie en de enige gebruiker die clear en end mag uitvoeren. |
| Participant | Een actieve paint-deelnemer die aan de kanaal- en Matrix-roomvoorwaarden voldoet. |
| Private Matrix-room | De ene invite-only room die specifiek voor de sessie wordt aangemaakt en de bron bevat. |
| Source | De gevalideerde PNG-, JPEG- of WebP-afbeelding onder de annotaties. |
| Source event | Het concrete `m.image`-event in de sessieroom waarnaar `sourceEventId` verwijst. |
| Preview | Tijdelijke, verliesgevoelige tekeninformatie tijdens pointerbeweging. |
| Commit | Een door de server geaccepteerde definitieve streek. |
| Stroke ID | De permanente, door de server gemaakte identiteit van een gecommitte streek. |
| Correlation ID | De clientgemaakte koppeling tussen één previewstroom en de uiteindelijke commit. |
| Sequence | De servervolgorde van definitieve streken. |
| Revision | De monotoon oplopende versie van alle blijvende sessiewijzigingen. |
| Generation | De annotatiegeneratie die na iedere host-clear wordt verhoogd. |
| Snapshot | De volledige actuele, gezaghebbende sessiestatus voor initiële synchronisatie of herstel. |
| Annotation layer | De transparante, bewerkbare laag waarop pen- en gumstreken worden gerenderd. |
| Source layer | De onveranderlijke canvaslaag waarop de bronafbeelding wordt gerenderd. |
| Save to chat | Het samenstellen en versturen van een PNG met bron plus definitieve annotaties. |

---

## 21. Afbakening van deze specificatie

Het aangeleverde implementatieplan beschrijft het functionele en technische doel van de Collaborative Paint-verticale slice, maar geeft geen afzonderlijke commerciële motivatie, gebruikersonderzoek, prestatie-SLA, toegankelijkheidseisen, visueel ontwerp buiten de genoemde componenten, analyticsdoelen of bredere productstrategie. Deze onderwerpen zijn daarom niet aangevuld in dit document. Uitgebreide toegankelijkheid, een formele audit en aanvullende schaalbaarheidsgrenzen (maximum deelnemers, strokes of gelijktijdige sessies) zijn expliciet geen doel van versie 1; de al gespecificeerde previewlimiet blijft wel gelden.

Ook zijn geen aanvullende sessierollen, moderatieregels, opslagmodellen, exportformaten of editorfuncties verondersteld. Wanneer toekomstige beslissingen een van deze onderwerpen toevoegen, behoren die tot een aparte uitbreiding van de specificatie en niet tot een impliciete interpretatie van het huidige implementatieplan.
# Verification

The Task 7 vertical tests cover the server lifecycle and browser flow. Manual two-client, Matrix invitation, reconnect, and cleanup checks are recorded in [Paint-verification.md](Paint-verification.md).
