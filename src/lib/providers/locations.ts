/** ISO 3166-1 numeric codes for the countries Rankora supports (see src/lib/locales.ts). */
const ISO_NUMERIC: Record<string, number> = {
  US: 840,
  GB: 826,
  CA: 124,
  AU: 36,
  IN: 356,
  BD: 50,
  DE: 276,
  FR: 250,
  ES: 724,
  IT: 380,
  NL: 528,
  BR: 76,
  MX: 484,
  JP: 392,
  SG: 702,
  AE: 784,
  ZA: 710,
  NZ: 554,
  IE: 372,
  SE: 752,
};

export function isoNumeric(countryCode: string): number | null {
  return ISO_NUMERIC[countryCode.toUpperCase()] ?? null;
}
