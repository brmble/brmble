Hier is een uitgebreidere versie van het specplan, in dezelfde richting als jullie korte Operations Tab V2-spec. Ik heb vooral de punten Dealer Upgrades, negatieve effecten, product upgrades, bulk sales, cooldowns en gear verder uitgewerkt. De bestaande korte spec noemt al o.a. RNG dealer upgrades, bulk deals voor 10–30% street value, cooldowns en gear als kernsystemen.

# Neon-D — Operations Tab V2 Detailed Spec

## Doel van deze update

De nieuwe **Operations Tab** moet de mid/late game meer diepgang geven. Het systeem moet ervoor zorgen dat spelers niet alleen meer productie kopen, maar ook actief nadenken over distributie, risico, dealer builds, bulk verkoop en product specialisatie.

Belangrijk uitgangspunt:

* Dealer upgrades blijven RNG.
* Speler koopt een upgrade-roll.
* Er verschijnt een pop-up met 3 keuzes.
* Speler moet 1 van de 3 upgrades kiezen.
* De gekozen upgrade wordt permanent op die dealer toegepast.
* Upgrades kunnen positief, mixed of soms negatief zijn.

---

# 1. Dealer Upgrades

## Huidig probleem

Dealer upgrades zijn nu te simpel en te voorspelbaar. Een vaste `+15% margin` is sterk, maar voelt na een paar keer niet meer spannend. Ook is er weinig verschil tussen dealer builds.

## Nieuwe gewenste werking

Dealer upgrades worden uitgebreid naar meerdere types, waarbij de waarde van de upgrade random gerold wordt binnen een range.

Voorbeeld:

* Oude margin upgrade: altijd `+15% margin`
* Nieuwe margin upgrade: random `+5%` tot `+15% margin`
* Later via unlocks: random `+15%` tot `+25% margin`
* Later upgradebaar naar `+25%` tot `+35% margin`
* Later upgradebaar naar `+35%` tot `+45% margin`

Hierdoor kan een speler geluk of pech hebben, maar blijft elke upgrade-roll interessant.

## Basis upgrade types

### Volume Upgrade

Verhoogt hoeveel gram per seconde een dealer kan verkopen.

Voorbeeld:

* `+5%` tot `+15% volume`
* Later upgradebaar naar `+15%` tot `+25% volume`
* Later upgradebaar naar `+25%` tot `+35% volume`
* Later upgradebaar naar `+35%` tot `+45% volume`
* Later upgradebaar naar `+45%` tot `+55% volume`
* Later upgradebaar naar `+55%` tot `+65% volume`

Gebruik:

* Goed voor spelers met te veel stock.
* Goed voor producten met lage margin maar hoge productie.
* Synergie met bulk builds.

---

### Margin Upgrade

Verhoogt hoeveel geld een dealer verdient per verkocht product.

Voorbeeld:

* `+5%` tot `+15% margin`
* Later upgradebaar naar `+15%` tot `+25% margin`
* Later upgradebaar naar `+25%` tot `+35% margin`
* Later upgradebaar naar `+35%` tot `+45% margin`
* Later upgradebaar naar `+45%` tot `+55% margin`
* Later upgradebaar naar `+55%` tot `+65% margin`

Gebruik:

* Goed voor high-value producten.
* Minder nuttig als productie laag is.

---

### Risk Reduction Upgrade

Verlaagt de kans dat een dealer gearresteerd wordt of beperkt de risico-impact op deze dealer.

Voorbeeld:

* `-3%` tot `-8% arrest chance`
* Of: `-10% risk impact on this dealer`

Gebruik:

* Goed voor dealers die high-tier producten verkopen.
* Goed in combinatie met bulk sales.
* Past goed bij defensive dealer builds.

---

### Bulk Upgrade

Maakt een dealer beter in bulk verkoop of geeft kans op speciale bulk deal events.
Dit kost een dealer upgrate slot

Voorbeeld:

* Unlock the ability to sell bulk of a product, for only `10%` of street value. 
* Later upgradebaar naar `+15%` tot `+25%` Street value
* Later upgradebaar naar `+25%` tot `+35%` Street value



Gebruik:

* Goed om overflow stock op te lossen.
* Mag normale dealers niet vervangen als beste money-per-second optie.
* Bulk moet vooral een stock-management tool zijn.

---

### Side Hustle Upgrade

Laat een dealer ook een klein percentage van andere unlocked producten verkopen.

Voorbeeld:

* `+5%` tot `+10% side volume`
* Dealer verkoopt primair product, maar neemt daarnaast kleine hoeveelheden andere producten mee.

* Later upgradebaar naar `+15%` tot `+25% side volume`
* Later upgradebaar naar `+25%` tot `+35% side volume`
* Later upgradebaar naar `+35%` tot `+45% side volume`


Gebruik:

* Goed tegen kleine stock leftovers.
* Maakt dealers flexibeler.
* Moet capped worden zodat primary sales belangrijk blijven.

---

### All-Arounder Upgrade

Kleine bonus op meerdere stats.

Voorbeeld:

* `+3%` tot `+8% volume`
* `+3%` tot `+8% margin`
* eventueel `-2% arrest chance`

Gebruik:

* Veilige keuze.
* Niet de hoogste piek, maar altijd bruikbaar.
* Goede optie voor casual spelers.

---

## Dealer upgrade rarity

Elke upgrade-roll toont 3 opties. Elke optie krijgt een rarity.

Voorstel:

| Rarity   | Kans | Effect                         |
| -------- | ---: | ------------------------------ |
| Common   |  65% | Kleine pure bonus              |
| Uncommon |  25% | Sterkere bonus of mixed effect |
| Rare     |   8% | Grote bonus, vaak met risico   |
| Jackpot  |   2% | Zeer sterke of unieke upgrade  |

Voorbeeld roll:

* Common: `Street Runners — +8% volume`
* Uncommon: `Clean Route — -6% arrest chance`
* Rare: `Aggressive Expansion — +22% volume, +5% arrest chance`
* Jackpot: `Black Market Network — unlocks bulk deal events for this dealer`

---

## Dealer upgrade unlocks via Operations Tab

In de nieuwe tab moet de speler meta-upgrades kunnen kopen die de kwaliteit van dealer upgrades verbeteren.

Voorbeelden:

### Better Volume Training

* Unlock 1: volume upgrades rollen `+5%` tot `+15%`
* Unlock 2: volume upgrades rollen `+10%` tot `+20%`
* Unlock 3: volume upgrades rollen `+15%` tot `+25%`

### Better Margin Training

* Unlock 1: margin upgrades rollen `+5%` tot `+15%`
* Unlock 2: margin upgrades rollen `+10%` tot `+20%`
* Unlock 3: margin upgrades rollen `+15%` tot `+25%`

### Safer Operations

* Risk reduction upgrades komen vaker voor.
* Arrest chance reduction wordt sterker.
* Risk penalties worden iets lager.

### Bulk Network

* Bulk deal upgrades worden toegevoegd aan de dealer upgrade pool.
* Hogere kans op bulk deal events.
* Betere bulk sale percentages.

---

## Dealer equipment slots

Huidige max is `3/3`. Dit moet uitbreidbaar worden per dealer.

Nieuwe flow:

* Elke dealer start met 3 equipment slots.
* Via Operations Tab kan speler extra slots unlocken.
* Max wordt uiteindelijk 5 slots per dealer.
* Extra slots zijn duur en vooral mid/late game.

Voorstel:

| Slot | Status     |    Unlock cost |
| ---: | ---------- | -------------: |
|    1 | standaard  |           free |
|    2 | standaard  |           free |
|    3 | standaard  |           free |
|    4 | unlockbaar |  mid-game cost |
|    5 | unlockbaar | late-game cost |

Belangrijk: extra slots moeten per dealer gelden, niet globaal voor alle dealers. Zo kan de speler kiezen welke dealer een “main dealer” wordt.

---

# 2. Negative Upgrades

## Doel

Negatieve upgrades voegen risk/reward toe. Niet elke upgrade moet puur beter zijn. Sommige upgrades mogen sterk zijn, maar een nadeel hebben.

Belangrijk: negatieve upgrades moeten zelden “alleen slecht” zijn. Ze werken het beste als mixed upgrades: hoge bonus, maar met trade-off.

## Kans op negatieve of mixed upgrades

Voorstel:

| Upgrade type            |   Kans |
| ----------------------- | -----: |
| Pure positive           |    75% |
| Mixed positive/negative |    20% |
| Pure negative trap      | 5% max |

Pure negatieve upgrades moeten heel zeldzaam zijn, anders voelt het systeem oneerlijk.

## Voorbeelden van mixed upgrades

### Reckless Crew

* `+25% volume`
* `+5% arrest chance`

Goed als je snel stock kwijt wilt, slecht als arrest risk al hoog is.

---

### Flashy Lifestyle

* `+20% margin`
* `+8% arrest chance`

Sterke money upgrade, maar verhoogt operationeel risico.

---

### Dirty Packaging

* `+15% volume`
* `-5% product sell value`

Meer verkopen, maar tegen slechtere prijs.

---

### Loose Lips

* `+10% margin`
* `+8% arrest chance while selling high-tier products`

Goed in early/mid game, gevaarlijk in late game.

---

### Underpaid Runners

* `+20% volume`
* `+10% upkeep cost`
* Kans op tijdelijke downtime bij overbelasting.

---

## UI-regel voor negatieve upgrades

De speler moet duidelijk zien dat een upgrade een trade-off heeft.

Voorbeeld UI:

**Reckless Crew**
`+25% volume`
`+5% arrest risk`
Label: **High Risk**

Gebruik kleuren:

* Groen voor positieve effecten.
* Rood/oranje voor negatieve effecten.
* Paars/goud voor rare/jackpot effects.

---

# 3. Product Upgrades

## Doel

Elk product moet eigen upgrades krijgen. Hierdoor kunnen spelers producten specialiseren in plaats van alleen lineair productie te kopen.

De korte spec noemt product upgrade types zoals Purity, Branding, Automation, Packaging, Concealment en Distribution.  Deze worden hieronder concreter gemaakt.

---

## Product upgrade categorieën

### Purity

Verhoogt street value / sell price van een product.

Voorbeeld:

* `+5% street price`
* Later: `+10% street price`
* High-tier purity upgrades kunnen ook arrest risk verhogen.

Gebruik:

* Goed voor margin builds.
* Sterk op dure producten.
* Moet relatief duur zijn.

---

### Branding

Verhoogt vraag naar een product en maakt dealers effectiever bij dit product.

Voorbeeld:

* `+5% dealer margin when selling this product`
* `+5% bulk deal value for this product`

Gebruik:

* Goed voor producten die je veel verkoopt.
* Geeft reden om dealer aan product te koppelen.

---

### Automation

Verhoogt productie/yield.

Voorbeeld:

* `+10% production rate`
* Of: `+0.05g/s yield per level`

Gebruik:

* Goed als dealers meer kunnen verkopen dan je produceert.
* Kan late game helpen om oude producten relevant te houden.

---

### Packaging

Verbetert bulk sales en verlaagt kleine verliezen.

Voorbeeld:

* `+5% max bulk amount`
* `+3% bulk sale value`
* `-5% stock waste/event loss`

Gebruik:

* Goed voor overflow stock.
* Goed in combinatie met Bulk Market.

---

### Concealment

Verlaagt arrest risk en operationele risico-impact voor dit product.

Voorbeeld:

* `-5% arrest chance when selling this product`
* `-10% risk impact from bulk sales of this product`

Gebruik:

* Vooral belangrijk voor high-risk producten.
* Defensive upgrade pad.

---

### Distribution

Verhoogt dealer volume specifiek voor dit product.

Voorbeeld:

* `+10% dealer volume when selling this product`
* `+5% side hustle effectiveness for this product`

Gebruik:

* Goed voor producten met veel stock.
* Maakt product-specifieke dealer builds mogelijk.

---

## Product upgrade structuur

Elk product krijgt een kleine upgrade tree.

Voorstel per product:

* 3 levels Purity
* 3 levels Automation
* 3 levels Concealment
* 2 levels Packaging
* 2 levels Branding
* 2 levels Distribution

Niet alles hoeft meteen in MVP. Voor MVP is genoeg:

* Purity
* Automation
* Concealment
* Distribution

---



# 5. Bulk Deal Cooldown

## Doel

Bulk sales moeten krachtig voelen, maar niet spammable zijn.

De korte spec geeft als richting: small 5 min, medium 15 min, large 30 min, massive 1 uur.

## Nieuwe cooldown regels

Elke bulk deal start een cooldown op de Bulk Market.

Tijdens cooldown:

* Geen nieuwe bulk deal spawns.
* UI toont remaining cooldown.
* Gear of upgrades kunnen cooldown verlagen.



# 6. Economy / nieuwe prijzen

De short spec bevat een nieuwe prijzentabel voor de eerste 13 tiers, met nieuwe research costs, base costs, cost multipliers, yield per level en street prices.

## Gewenste aanpassing

De huidige economy constants moeten worden vervangen door de nieuwe values uit het research model.

Belangrijk:

* Product unlock/research cost moet uit de nieuwe tabel komen.
* Producer base cost / `c0` moet uit de nieuwe tabel komen.
* Cost multiplier moet uit de nieuwe tabel komen.
* Yield per level moet uit de nieuwe tabel komen.
* Street price per gram moet uit de nieuwe tabel komen.
* Tests moeten worden aangepast op deze nieuwe waardes.

## MVP-regel

Als de nieuwe tabel voorlopig alleen T1–T13 volledig specificeert:

* T1–T13 vervangen met nieuwe research-paper values.
* T14–T18 tijdelijk laten staan of apart balancen.
* Geen mix van oude en nieuwe values zonder duidelijke TODO.

---

