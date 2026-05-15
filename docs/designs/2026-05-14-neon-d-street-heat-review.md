# Street Heat — Uitbreiding voor Brmble Empire (NeonD)

**Datum:** 14 mei 2026
**Status:** Concept — klaar voor review
**Auteur:** AI-assisted design, beoordeeld door het team

---

## 1. Aanleiding & Doel

Brmble Empire (codenaam NeonD) is een idle/incremental game waarin spelers een drugsimperium opbouwen: producten kweken, dealers inhuren en geld verdienen. De huidige versie is functioneel maar mist **spanning en variatie** — de speler kan simpelweg wachten tot het geld binnenkomt zonder ooit echt beslissingen te nemen of risico te lopen.

**Doel van dit ontwerp:** Drie nieuwe spelsystemen toevoegen die de speler dwingen om actieve keuzes te maken, risico af te wegen tegen beloning, en te reageren op een dynamische wereld. Het spel blijft een idle game, maar een die aandacht vraagt.

**Kernvraag:** Wat gebeurt er als je té succesvol wordt? En wie probeert je tegen te houden?

---

## 2. Overzicht — Drie Systemen in één

Het ontwerp bestaat uit drie lagen die op elkaar voortbouwen:

| Systeem | Wat het doet | Waarom |
|---|---|---|
| **Heat & Risk** | Dealers lopen hitte op naarmate ze meer verkopen. Te veel hitte = arrestatie. | Creëert spanning en kostenafweging. Succes is niet gratis. |
| **Rival Gangs & Territory** | Rivaliserende bendes controleren territorium per product. Jouw territorium bepaalt de verkoopprijs. Stuur dealers op missies om meer territory te veroveren. | Strategische laag: waar investeer je je dealers? |
| **Market Events** | Willekeurige gebeurtenissen die prijzen, hitte en territory beïnvloeden. | Variatie en verrassing. Geen twee speelsessies zijn hetzelfde. |

Deze drie systemen zijn bewust gekozen omdat ze elkaar versterken:
- Territory veroveren genereert hitte (koppeling laag 1 & 2)
- Market events kunnen hitte verhogen of territory beschadigen (koppeling laag 3 met 1 & 2)
- Samen zorgen ze dat de speler constant afwegingen maakt

---

## 3. Systeem 1: Heat & Risk

### Concept

Elke dealer in jouw dienst heeft een **hittemeter** (0-100%). Hoe meer een dealer verkoopt, hoe meer hitte hij oploopt. De snelheid waarmee hitte stijgt, hangt af van **wat** hij verkoopt:

- **Weed** is laag risico → hitte stijgt langzaam
- **Meth** is hoog risico → hitte stijgt snel
- **Galactic Core** (late game) is extreem risico → hitte stijgt razendsnel

### Wat gebeurt er bij hoge hitte?

- **0-50%:** Veilig (groene zone). Geen risico.
- **51-80%:** Risicovol (gele zone). Kans op politie-aandacht neemt toe.
- **81-100%:** Gevaarlijk (rode zone). Hoge kans op een raid.
- **100%:** Dealer gearresteerd. Stopt met verkopen tot je actie onderneemt.

### Speler acties

| Actie | Wat het doet | Kosten |
|---|---|---|
| **Protection kopen** | Reset hitte naar 0%. | **$10 per hitte-punt** (dus 80 hitte = $800) |
| **Bail betalen** | Bevrijdt gearresteerde dealer, reset hitte naar 50%. | **$500 + $1000 × aantal equipment slots** |
| **Dealer ontslaan** | Verliest dealer permanent (incl. equipment). | Gratis, maar je verliest investering |

### Waarom dit systeem?

- Voorkomt dat spelers "gelijk voor eeuwig" door blijven klikken
- Maakt de afweging: *investeer ik in protection of accepteer ik het risico?*
- Lage-risico producten (Weed) zijn veiliger maar minder lucratief; hoge-risico producten (Meth) verdienen meer maar geven meer hitte
- Arrestatie voelt als een natuurlijke setback, niet als een straf

---

## 4. Systeem 2: Rival Gangs & Territory

### Concept

Elk product heeft een **territory percentage** dat aangeeft hoeveel van de markt jij controleert. De rest wordt gecontroleerd door rivaliserende bendes:

- **The Cartel** — agressief, valt vaak aan
- **Eastside Crew** — stabiel, reageert op veroveringen
- **Purple Syndicate** — onvoorspelbaar

### Hoe territory werkt

Jouw territory-percentage bepaalt direct de verkoopprijs:

- **0% territory** → product verkoopt voor **50% van de basisprijs**
- **50% territory** → **100% van de basisprijs**
- **100% territory** → **150% van de basisprijs**

Dit betekent: als je geen territory hebt in Meth, is het nauwelijks de moeite waard om te produceren. Wil je maximale winst? Dan moet je territory veroveren.

### Territory veroveren — Missies

Spelers kunnen een dealer op **missie** sturen om territory te veroveren in een specifiek product:

1. Kies een dealer die idle is (niet gearresteerd, niet al op missie)
2. Kies welk product/territory je wilt aanvallen
3. Betaal **$1.000** missiekosten
4. Dealer is **30 seconden weg** — verkoopt gedurende die tijd niets
5. Na 30 seconden: territory stijgt met **8-12%** (willekeurig)

**Afweging:** Een dealer op missie verdient geen geld. Hoe lang kun je het missen?

### Rival aanvallen

Rivalen vallen willekeurig jouw territory aan (gemiddeld elke 30-90 seconden):
- Een rival kiest een willekeurig product dat jíj hebt unlocked
- Je verliest **5-15% territory** in dat product
- Dit gebeurt op de achtergrond; de speler ziet het in het territory overzicht

**Strategische diepgang:** Spelers kunnen hun territorium actief verdedigen door een **Truce** market event af te wachten (zie systeem 3), of door simpelweg te accepteren dat territory fluctueert en continu bij te sturen.

### Waarom dit systeem?

- Geeft de speler een **actieve doelstelling** (territory veroveren) naast het passieve wachten op geld
- Maakt de keuze: *welk product focus ik me op?* Resources zijn beperkt (3 dealers max)
- Rivalen zorgen dat het spel **levendig** blijft — je territory staat nooit stil
- Missies geven dealers **identiteit** en karakter

---

## 5. Systeem 3: Market Events

### Concept

Willekeurig, terwijl je speelt, gebeurt er iets onverwachts. Deze **market events** duren 15-60 seconden en veranderen tijdelijk de spelregels.

### Event types

| Event | Effect | Duur | Frequentie |
|---|---|---|---|
| **Festival 🎉** | Alle prijzen +50%. Grote kans om veel te verdienen. | 15s | Zeldzaam |
| **Market Crash 📉** | Alle prijzen -40%. Minder inkomen. | 30s | Zeldzaam |
| **Police Crackdown 🚔** | Hitte-opbouw is 2x zo snel, protection kost 2x zoveel. | 20s | Regelmatig |
| **Heat Wave 🔥** | Een specifiek product heeft 3x vraag (3x prijs). | 15s | Regelmatig |
| **Rival Attack 💀** | Directe territory loss (instant, geen timer). | — | Regelmatig |
| **Truce 🤝** | Geen rival aanvallen gedurende 60s. Tijd om veilig territory te veroveren. | 60s | Zeldzaam |

### Hoe events spawnen

- Gemiddeld **elke 45 seconden** kan een nieuw event starten (cooldown)
- Daarbinnen is er een kleine kans per seconde dat een event echt start
- Slechts **één event tegelijk** actief
- Events worden duidelijk getoond aan de speler (banner bovenaan)
- Na afloop verdwijnt de banner en keren alle effecten terug naar normaal

### Speler reactie

De bedoeling is dat de speler **reageert** op events:
- Bij een **Festival**: ideale tijd om veel te verkopen (maar let op je hitte)
- Bij een **Crackdown**: even gas terug, investeer in protection
- Bij een **Heat Wave**: schakel dealers om naar het gevraagde product
- Bij een **Truce**: stuur al je dealers op missie zonder angst voor tegenaanvallen

### Waarom dit systeem?

- Voorkomt dat het spel een "set & forget" automatiseringsspel wordt
- Geeft **pieken en dalen** — spannende momenten afgewisseld met rustige periodes
- Beloont **oplettendheid**: een speler die reageert op events verdient meer dan iemand die wegloopt
- Maakt elke speelsessie uniek

---

## 6. Hoe de drie systemen samenwerken

De systemen zijn ontworpen als **communicerende vaten** — ze beïnvloeden elkaar:

```
Territory veroveren (missie)
    → genereert hitte (meer verkoop = meer hitte)
    → hitte kan leiden tot arrestatie
    → arrestatie kost geld (bail) of verlies van dealer

Market events
    → beïnvloeden prijzen (Festival = goed moment om te verkopen)
    → beïnvloeden hitte (Crackdown = oppassen)
    → beïnvloeden territory (Rival Attack = verlies)
    → creëren kansen (Truce = veilig veroveren)

Rivalen vallen aan
    → verlies territory
    → moet op missie om terug te winnen
    → missie kost tijd én verkoopcapaciteit
```

**Voorbeeld speelverloop:**
1. Speler heeft 3 dealers actief op Meth (hoge winst, hoog risico)
2. Market event: **Police Crackdown** — hitte stijgt dubbel zo snel
3. Speler ziet hitte oplopen naar 80% en besluit protection te kopen voor dealer 1
4. Ondertussen valt **The Cartel** aan — verliest 12% Meth territory
5. Speler stuurt dealer 2 op missie om territory terug te winnen (30s geen inkomsten)
6. Net voor de missie begint: **Truce** event — speler heeft 60s veilig de tijd
7. Na 30s keert dealer 2 terug met +10% territory. Speler stuurt dealer 3 óók op missie
8. Truce loopt af. Het spel gaat door. De speler heeft actief staan spelen.

Dit soort **emergente verhalen** is precies wat het huidige Brmble Empire mist.

---

## 7. Wat de speler ziet (UI, beschrijvend)

De bestaande layout blijft grotendeels intact. Alleen toevoegingen:

### Event Banner (bovenaan, onder de header)
Een opvallende balk in kleur die het actieve event toont. Bijvoorbeeld:
- Groene balk: "🎉 Festival! Alle prijzen +50% — nog 12 sec"
- Rode balk: "🚔 Police Crackdown! Hitte 2x — nog 8 sec"
- Blauwe balk: "🤝 Truce! 43 sec zonder rival aanvallen"
De balk verdwijnt vanzelf als het event afloopt.

### Hittebalk (in elke dealer kaart)
Elke dealer heeft een horizontale balk die de hitte weergeeft (0-100%):
- **Groen** (0-50%): veilig
- **Geel** (51-80%): voorzichtig
- **Rood** (81-100%): gevaarlijk
- Naast de balk: de tekst "Hitte: 65%" en een knop "Protect ($650)"

Als een dealer gearresteerd is, vervangt een rode banner de kaart:
"🚔 GEARRESTEERD — Bail betalen ($2.500) of Ontslaan"

Als een dealer op missie is:
"Op Missie — Nog 18 sec"

### Territory Overzicht (nieuw paneel in de rechterkolom)
Onder of boven de dealerlijst staat een compact overzicht per product:
- "Weed — ████░░░░ 40% gecontroleerd" (groen balkje voor speler, rood voor rivalen)
- "Meth — ████████ 80% gecontroleerd"
Het paneel toont alleen producten die de speler heeft unlocked.

### Missie-knop (in dealer kaart)
Bij elke idle dealer: een knop "Stuur op Missie" met een dropdown om het doelproduct te kiezen. Uitgeschakeld als de dealer op missie of gearresteerd is.

---

## 8. Balans & Ontwerpfilosofie

### Uitgangspunten

1. **Het blijft een idle game.** Een speler moet kunnen wegwandelen en progressie maken. De systemen zijn bedoeld om *extra* diepgang te bieden voor actieve spelers, niet om idle spelers te straffen. Zelfs met 100% hitte wordt een dealer niet direct gearresteerd — je krijgt tijd om te reageren.

2. **Risico = beloning.** De cijfers zijn zo gekozen dat risicovolle strategieën (veel Meth verkopen) meer opleveren dan veilige strategieën, maar ook meer aandacht vragen. Een speler die alleen Weed verkoopt hoeft nauwelijks protection te kopen maar verdient ook minder.

3. **Verlies voelt eerlijk.** Arrestatie kost geld, niet progressie. De productie gaat door, je inventory blijft intact. Alleen de dealer staat even stil. Dit voelt als een setback, niet als een reset.

4. **Variatie zonder complexiteit.** Drie systemen klinkt veel, maar elk systeem heeft precies één knop/actie: Protection kopen, Missie sturen, Event bekijken. De complexiteit zit in de interactie tussen de systemen, niet in de bediening.

### Balans getallen (indicatief)

| Scenario | Hitte per minuut | Tijd tot arrestatie | Protection kosten/min |
|---|---|---|---|
| 1 dealer, 4g/s Weed | ~2.4/min | ~41 minuten | ~$24/min |
| 1 dealer, 4g/s Meth | ~14.4/min | ~7 minuten | ~$144/min |
| 3 dealers, 4g/s Meth (late game) | ~43.2/min | ~2.3 minuten | ~$432/min |

Late-game spelers moeten dus continu investeren in protection of hun dealers rouleren. Dit creëert een **resource drain** die voorkomt dat geld oneindig groeit.

---

## 9. Implementatie volgorde

De systemen worden in deze volgorde gebouwd:

1. **Types en constanten** — de data modellen (geen gameplay)
2. **Heat systeem** — hitte, arrestatie, protection, bail
3. **Market events** — random events, effecten op prijs/hitte
4. **Rival gangs & territory** — missies, territory, rival aanvallen
5. **UI componenten** — heat bar, territory panel, event banner
6. **Integratie** — alles samenvoegen in het bestaande spel

---

## 10. Open vragen voor review

1. Zijn de **kostenbalans** (protection $10/heat, bail $500 + equipment) realistisch?
2. **Drie rival gangs** — is dat genoeg, of moeten het er meer/minder zijn?
3. **Missieduur 30 seconden** — is dat lang genoeg om een afweging te voelen maar kort genoeg om niet frustrerend te zijn?
4. **Event frequentie** — elke 45 seconden een nieuw event. Is dat te veel of te weinig?
5. Moeten gearresteerde dealers een **tijdslimiet** hebben (automatisch vrij na X minuten) of alleen via bail?
6. Zijn er **ontbrekende event types** die het spel leuker zouden maken?
