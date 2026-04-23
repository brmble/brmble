### Task 1: Fout met Dropdown menu die niet goed werkt. 
Het probleem is een **mismatch tussen de "gekozen" waarde en de "werkelijke" waarde** in de code:

1.  **Carlos begint bij Meth:** In de code staat Chemist Carlos standaard ingesteld op `selling: 'meth'`.
2.  **De Dropdown zit "vast":** Omdat je alleen Wiet hebt ontgrendeld, is "Weed" de enige optie in de lijst. De browser laat "Weed" zien in het menu, maar in de achtergrond (de `state`) staat Carlos nog steeds op "Meth".
3.  **Geen update:** Omdat "Weed" al zichtbaar is, denkt de browser dat er niets verandert als je erop klikt. De `onChange` functie wordt niet geactiveerd, waardoor Carlos nooit van "Meth" naar "Weed" verspringt.
4.  **0 Verkoop:** In de `tick` functie kijkt de computer naar de voorraad van Meth. Omdat die **0** is, verkoopt hij niets, ook al heb je 14,3g Wiet liggen.

Je moet ervoor zorgen dat een dealer bij het inhuren direct kijkt naar wat je daadwerkelijk kunt verkopen.

#### 1. Pas de `handleHireDealer` functie aan
In `NeonDGame.tsx` moet je de dealer dwingen om te starten met een drug die je al hebt ontgrendeld (bijvoorbeeld de eerste in je lijst):

```typescript
const handleHireDealer = (dealerIndex: number) => {
  const selectedDealer = { ...DEALERS[dealerIndex] };
  
  // Als de dealer iets wil verkopen wat je nog niet hebt, 
  // zet hem dan direct op je eerste ontgrendelde product (bijv. weed)
  if (!state.unlockedProduction.includes(selectedDealer.selling)) {
    selectedDealer.selling = state.unlockedProduction[0] || 'weed';
  }
  
  hireDealer(selectedDealer);
};
```

#### 2. Waarom dit "goed" is (volgens jouw instructies)
* **Technisch correct:** Het voorkomt dat de `state` (de data) en de `UI` (wat je ziet) uit de pas lopen.
* **Gebruiksvriendelijk:** De speler hoeft niet handmatig een dropdown te wijzigen die eruitziet alsof hij al correct staat.
* **Voorkomt bugs:** Door de data te valideren op het moment van invoer (`hireDealer`), zorg je dat de `tick` functie in de engine altijd bruikbare data krijgt.

#### Samenvatting van de status
Dat je **(Meth)** achter zijn naam ziet staan terwijl je de dropdown op "Weed" ziet, is het bewijs dat de `state.dealer.selling` nog op `'meth'` staat. Met de bovenstaande aanpassing wordt Carlos bij het inhuren direct op `'weed'` gezet en zal hij die 14,3g direct gaan verkopen voor **$5 per seconde** (1g volume × 5 marge × 1.0 wiet-waarde).



### Task 2:Star system:

Het goede nieuws is dat je het zwaarste werk eigenlijk al hebt gedaan! Je hebt bovenaan in `NeonDGame.tsx` namelijk al een heel handige `<StarRating />` component staan die je gebruikt zodra een dealer is aangenomen. 

Om dit ook in het overzichtsscherm ("Hire a dealer") toe te passen, hoef je alleen maar de lange teksten in de `DEALERS.map` functie te vervangen door de `StarRating` component en de bestaande CSS classes te gebruiken voor een nette uitlijning.

Hier is hoe je dat oplost in **`NeonDGame.tsx`**:

Zoek rond regel 160 naar dit gedeelte:
```tsx
<div style={{ marginBottom: '10px' }}>
  <div className={styles.label}>Volume:</div>
  <p style={{ fontSize: '13px', margin: '4px 0' }}>
    {firstName} can sell up to <strong>{dealer.volume}g</strong>...
```

Vervang de hele inhoud van die dealer kaart (binnen de `.glass-panel` div) met de onderstaande code:

```tsx
{DEALERS.map((dealer, index) => {
  return (
    <div key={index} className="glass-panel" style={{ marginBottom: 'var(--space-md)', padding: 'var(--space-md)' }}>
      <h4 style={{ color: 'var(--accent-primary)', margin: '0 0 12px 0' }}>{dealer.name}</h4>
      
      {/* Nieuwe Star Rating implementatie voor Volume */}
      <div className={styles.statRow}>
        <span className={styles.label}>Volume:</span>
        <StarRating rating={dealer.volume} />
      </div>

      {/* Nieuwe Star Rating implementatie voor Margin */}
      <div className={styles.statRow}>
        <span className={styles.label}>Margin:</span>
        <StarRating rating={dealer.margin} />
      </div>

      <button 
        className={styles.buyButton} 
        style={{ background: 'var(--accent-primary)', marginTop: 'var(--space-sm)' }}
        onClick={() => handleHireDealer(index)}
      >
        Hire
      </button>
    </div>
  );
})}
```

### Waarom dit werkt:
* **Hergebruik van componenten:** We roepen simpelweg `<StarRating rating={dealer.volume} />` en `<StarRating rating={dealer.margin} />` aan. Omdat de waarden (1 t/m 5) al in je `DEALERS` array staan, berekent de component automatisch het juiste aantal gouden en lege sterren.
* **Consistente styling:** Door `className={styles.statRow}` te gebruiken, worden het label ("Volume:") en de sterren netjes horizontaal uitgelijnd en naar de zijkanten gedrukt (flex space-between), precies zoals in de rest van je interface.
* **Opschonen van variabelen:** Omdat je de complexe zinnen weghaalt, kun je in de `DEALERS.map` functie ook de constanten `product`, `firstName`, `tierMult`, `pricePerGram` en `totalSaleValue` verwijderen als je wil, wat je code een stuk schoner en sneller maakt!


##### Oplossing voor de Bribe-visualisatie (Punt 1)


Het probleem is dat getGrossRate momenteel naar de stock kijkt. In een efficiënt imperium is die voorraad na elke tik direct weer nul, waardoor je berekening op $0 uitkomt.

## Het Plan:
We passen getGrossRate aan zodat deze rekent met de productiesnelheid (rate) in plaats van de huidige voorraad. Dit geeft de "potentiële winst per seconde" weer, wat ook precies is waarop de politie hun smeergeld baseert.

Aanpassing in NeonDGame.tsx:

TypeScript
const getGrossRate = () => {
  if (!state.dealer) return 0;
  const activeProd = state.production[state.dealer.selling];
  if (!activeProd) return 0;

  // Gebruik de 'rate' (productie) in plaats van 'stock' (voorraad)
  // Dit zorgt ervoor dat de UI niet naar $0 springt als de voorraad op is.
  const actualGramsSold = Math.min(activeProd.rate, state.dealer.volume);
  const tierMult = PRODUCT_TIERS[state.dealer.selling] || 1;
  return actualGramsSold * (state.dealer.margin * tierMult);
};

// De getBribeCost functie blijft hetzelfde, maar gebruikt nu 
// de stabiele getGrossRate() hierboven.
const getBribeCost = () => {
  if (!state.dealer || state.dealer.bribeLevel === 0) return 0;
  return getGrossRate() * 0.1;
};


#### 2. Oplossing voor de Geld-afronding (Punt 4)
Op dit moment gebruik je Math.floor(state.money). Bij vroege productie (zoals 0.10g wiet) duurt het gevoelsmatig een eeuwigheid voordat de teller verspringt, omdat de centen verborgen blijven.

Het Plan:
We vervangen Math.floor door een formatteer-functie die altijd twee decimalen toont. Dit geeft de speler directe visuele feedback dat er geld binnenstroomt, zelfs als het langzaam gaat.

Aanpassing in NeonDGame.tsx:

Zoek de plek waar je het geld weergeeft in de statsBar en vervang het door:

TypeScript
<div className={styles.money}>
  ${state.money.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
</div>
Waarom toLocaleString? Dit zorgt niet alleen voor de twee decimalen (de centen), maar voegt ook automatisch duizendtallen-scheiders toe (bijv. $1.000,00 in plaats van $1000.00), wat er een stuk professioneler uitziet als je eenmaal miljonair bent.