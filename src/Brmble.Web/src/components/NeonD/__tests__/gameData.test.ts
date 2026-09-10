import { describe, expect, it } from 'vitest';
import {
  CAPTAIN_LEVEL_THRESHOLDS,
  createBaseGameState,
  EQUIPMENT_CATALOG,
  MUSCLE_CATALOG,
  PRODUCT_CATALOG,
} from '../constants';

describe('Neon-D reference catalog', () => {
  it('uses the exact 16-product sequence and values', () => {
    expect(PRODUCT_CATALOG.map((p) => [
      p.id, p.name, p.researchCost, p.streetValue, p.producer.name,
      p.producer.baseCost, p.producer.growth, p.producer.baseRate,
    ])).toEqual([
      ['weed', 'Weed', 0, 4.2, 'Cannabis Plant', 15, 1.12, 0.20],
      ['mushrooms', 'Magic Mushrooms', 2_000, 6, 'Mushroom Farm', 150, 1.15, 0.30],
      ['meth', 'Meth', 7_000, 10, 'Meth Cook', 1_000, 1.20, 0.50],
      ['speed', 'Speed', 20_000, 15, 'Base Chef', 2_500, 1.21, 0.40],
      ['acid', 'Acid', 40_000, 20, 'Lab Technician', 5_000, 1.22, 0.50],
      ['crack', 'Crack', 75_000, 30, 'Crack Den', 10_000, 1.23, 0.50],
      ['pcp', 'PCP', 90_000, 40, 'Chemical Lab', 20_000, 1.24, 0.40],
      ['heroin', 'Heroin', 120_000, 50, 'Opium Farm', 30_000, 1.25, 0.50],
      ['mdma', 'MDMA', 180_000, 60, 'Chemistry Professor', 40_000, 1.26, 0.40],
      ['cocaine', 'Cocaine', 250_000, 70, 'Drug Mule', 50_000, 1.27, 0.25],
      ['nuke', 'Nuke', 5_500_000, 240, 'Robot Criminal', 700_000, 1.28, 0.16],
      ['cyberCrank', 'Cyber Crank', 15_000_000, 666.67, 'Blackhat Hivemind', 2_500_000, 1.29, 0.08],
      ['ephemerol', 'Ephemerol', 95_000_000, 3_400, 'Secret Facility', 5_000_000, 1.30, 0.04],
      ['sloMo', 'Slo-mo', 465_000_000, 11_250, 'Chem-tech', 12_000_000, 1.31, 0.02],
      ['drencrom', 'Drencrom', 1_200_000_000, 63_250, 'Droog Squad', 35_000_000, 1.31, 0.015],
      ['melange', 'Melange', 4_840_000_000, 270_000, 'Sandworm', 75_000_000, 1.32, 0.01],
    ]);
  });

  it('uses the exact product production-upgrade ladder', () => {
    expect(PRODUCT_CATALOG.flatMap((product) => product.upgrades.map((upgrade) => [
      product.id, upgrade.name, upgrade.baseCost, upgrade.productionBonus,
    ]))).toEqual([
      ['weed', 'Fertilizer', 500, 0.30], ['weed', 'Hydroponics', 6_500, 0.50],
      ['mushrooms', 'Auto Hygrometer', 5_000, 0.50], ['mushrooms', 'Irrigation System', 25_000, 0.50],
      ['meth', 'Recreational Vehicle', 40_000, 0.50], ['meth', 'Underground Lab', 130_000, 0.50],
      ['speed', 'Corrupt Chemist', 75_000, 0.60], ['speed', 'Criminal Pharmacy', 190_000, 0.50],
      ['acid', 'College Education', 80_000, 0.50], ['acid', 'Digital Distillation', 120_000, 0.50],
      ['crack', 'Gang Protection', 145_000, 0.50], ['crack', 'Police Payoff', 280_000, 0.45],
      ['pcp', 'Haber Process Research', 190_000, 0.50], ['pcp', 'Mass Spectrometer', 550_000, 0.70],
      ['heroin', 'Polytunnel Complex', 210_000, 0.50], ['heroin', 'Cropdusting', 750_000, 0.50],
      ['mdma', 'PhD Students', 250_000, 0.60], ['mdma', 'Research Facility', 1_000_000, 0.40],
      ['cocaine', 'Plastic Surgery Disguise', 350_000, 0.30], ['cocaine', 'Cartel Deal', 1_500_000, 0.80], ['cocaine', 'DEA Mole', 2_500_000, 0.50],
      ['nuke', 'Cult Leader Cain', 14_500_000, 0.60], ['nuke', 'Deprogrammed Robocop', 28_000_000, 0.50],
      ['cyberCrank', 'Neural Net Research', 45_000_000, 0.50], ['cyberCrank', 'Global Botnet', 75_000_000, 0.45],
      ['ephemerol', 'Human Test Subjects', 120_000_000, 0.60], ['ephemerol', 'ConSec Scanner', 275_000_000, 0.75],
      ['sloMo', 'Peachtree Block', 575_000_000, 1.00], ['drencrom', 'The Ludovico Technique', 575_000_000, 1.00],
      ['melange', 'Guild Navigator', 2_575_000_000, 0.30], ['melange', "Muad'Dib", 7_900_000_000, 0.50],
    ]);
  });

  it('uses the exact starting state', () => {
    const state = createBaseGameState(1234);
    expect(state.cash).toBe(100);
    expect(state.runEarnings).toBe(0);
    expect(state.respect).toBe(0);
    expect(state.unlockedProducts).toEqual(['weed']);
    expect(state.activeDealers).toEqual([null]);
    expect(state.production.weed.producersOwned).toBe(0);
    expect(state.production.weed.stock).toBe(0);
    expect(state.lastTickAt).toBe(1234);
    expect(state.schemaVersion).toBe(6);
    expect(state.lastBulkSellAt).toBe(0);
    expect(state.bulkUnlockedProductIds).toEqual([]);
    expect(state.zones).toEqual([]);
    expect(state.dealerTransfers).toEqual([]);
    expect(state.pendingAmsterdamCaptainSelection).toBe(false);
  });

  it('locks reference equipment, Muscle, and Captain thresholds', () => {
    expect(EQUIPMENT_CATALOG.map((x) => [x.name, x.baseCost])).toEqual([
      ['Baseball Bat', 150], ['Bicycle', 600], ['iPhone 6 Plus', 900], ['Glock 17', 5_000],
      ['Superbike', 25_000], ['Personal Assistant', 85_000], ['Armed Gang', 150_000],
      ['Ferrari 458 Italia', 575_000], ['Personal Helicopter', 1_890_000],
      ['Luxury Speedboat', 5_460_000], ['Personal Army', 21_630_000],
    ]);
    expect(MUSCLE_CATALOG.map((x) => [x.name, x.baseCost, x.respectPerSecond, x.growth])).toEqual([
      ['Hood Rat', 80, 1, 1.20], ['Young Thug', 1_000, 5, 1.25], ['Hired Goon', 12_000, 75, 1.27],
      ['Crooked Cop', 130_000, 500, 1.28], ['Bought Judge', 1_500_000, 2_000, 1.30],
      ['Corrupt Senator', 4_500_000, 7_500, 1.31], ['Puppet World Leader', 33_700_000, 45_000, 1.32],
      ['Hunter Killer Submarine', 7_500_100_800, 150_000, 1.33],
      ['Nimitz-class Aircraft Carrier', 45_500_700_000, 350_000, 1.34],
      ['Orbital Ion Cannon', 9_345_500_700_000, 7_490_000, 1.35],
    ]);
    expect(CAPTAIN_LEVEL_THRESHOLDS).toEqual([
      500_000, 950_000, 1_810_000, 3_430_000, 6_520_000,
      12_380_000, 23_520_000, 44_690_000, 84_920_000, 161_340_000,
      306_546_000, 582_437_000, 1_106_630_000, 2_102_597_000,
      3_994_934_000, 7_590_375_000, 14_421_712_000, 27_401_253_000,
      52_062_381_000, 98_918_524_000, 187_945_196_000, 357_095_872_000,
      678_482_157_000, 1_289_116_098_000, 2_449_320_586_000, 4_653_709_113_000,
      8_842_047_315_000, 16_799_889_899_000,
    ]);
  });
});
