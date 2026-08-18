/**
 * Reference lists for countries and ports.
 *
 * Kept as plain constants rather than a backend table: ISO codes do not
 * change, nobody needs to edit them, and a settings screen for them would be
 * one more thing to maintain. The backend stores only the chosen code.
 *
 * Names are in Dutch because this is our internal tool; what the customer
 * sees is translated elsewhere.
 */
export interface IsoCountry {
  code: string;
  name: string;
}

/** Europe plus the sourcing and export countries this trade actually touches. */
export const ISO_COUNTRIES: IsoCountry[] = [
  { code: 'BE', name: 'België' },
  { code: 'NL', name: 'Nederland' },
  { code: 'DE', name: 'Duitsland' },
  { code: 'FR', name: 'Frankrijk' },
  { code: 'LU', name: 'Luxemburg' },
  { code: 'GB', name: 'Verenigd Koninkrijk' },
  { code: 'IE', name: 'Ierland' },
  { code: 'ES', name: 'Spanje' },
  { code: 'PT', name: 'Portugal' },
  { code: 'IT', name: 'Italië' },
  { code: 'AT', name: 'Oostenrijk' },
  { code: 'CH', name: 'Zwitserland' },
  { code: 'DK', name: 'Denemarken' },
  { code: 'SE', name: 'Zweden' },
  { code: 'NO', name: 'Noorwegen' },
  { code: 'FI', name: 'Finland' },
  { code: 'PL', name: 'Polen' },
  { code: 'CZ', name: 'Tsjechië' },
  { code: 'SK', name: 'Slovakije' },
  { code: 'HU', name: 'Hongarije' },
  { code: 'RO', name: 'Roemenië' },
  { code: 'BG', name: 'Bulgarije' },
  { code: 'GR', name: 'Griekenland' },
  { code: 'HR', name: 'Kroatië' },
  { code: 'SI', name: 'Slovenië' },
  { code: 'EE', name: 'Estland' },
  { code: 'LV', name: 'Letland' },
  { code: 'LT', name: 'Litouwen' },
  { code: 'CY', name: 'Cyprus' },
  { code: 'MT', name: 'Malta' },
  { code: 'TR', name: 'Turkije' },
  { code: 'UA', name: 'Oekraïne' },
  { code: 'RS', name: 'Servië' },
  { code: 'CN', name: 'China' },
  { code: 'HK', name: 'Hongkong' },
  { code: 'VN', name: 'Vietnam' },
  { code: 'TH', name: 'Thailand' },
  { code: 'IN', name: 'India' },
  { code: 'ID', name: 'Indonesië' },
  { code: 'MY', name: 'Maleisië' },
  { code: 'KR', name: 'Zuid-Korea' },
  { code: 'JP', name: 'Japan' },
  { code: 'AE', name: 'Verenigde Arabische Emiraten' },
  { code: 'US', name: 'Verenigde Staten' },
  { code: 'CA', name: 'Canada' },
  { code: 'EC', name: 'Ecuador' },
  { code: 'CO', name: 'Colombia' },
  { code: 'KE', name: 'Kenia' },
  { code: 'ET', name: 'Ethiopië' },
  { code: 'MA', name: 'Marokko' },
  { code: 'EG', name: 'Egypte' },
  { code: 'ZA', name: 'Zuid-Afrika' },
];

/** Dutch name for an ISO code; falls back to the code itself. */
export function countryName(code: string | null | undefined): string {
  if (!code) return '';
  return ISO_COUNTRIES.find((country) => country.code === code)?.name ?? code;
}

/**
 * Ports of arrival we realistically book containers to.
 *
 * A fixed list instead of free text: "Rotterdam", "rotterdam" and "R'dam"
 * would otherwise become three different ports in the data.
 */
export const DESTINATION_PORTS = [
  'Rotterdam',
  'Amsterdam',
  'Antwerpen',
  'Zeebrugge',
  'Hamburg',
  'Bremerhaven',
  'Le Havre',
] as const;

/**
 * Container types as the API names them, with human labels.
 *
 * The select previously used shipping codes ("40HQ") while the API speaks
 * enum names ("FORTY_HQ") - no option ever matched, so the dropdown sat
 * empty. One list, keyed by what the API actually sends.
 */
export const CONTAINER_TYPES = [
  { value: 'TWENTY_GP', label: "20' Standard — 28 m³" },
  { value: 'FORTY_GP', label: "40' Standard — 58 m³" },
  { value: 'FORTY_HQ', label: "40' High Cube — 68 m³" },
  { value: 'LCL', label: 'Groepage (LCL)' },
] as const;

/** Label for a container enum name; falls back to the raw value. */
export function containerLabel(value: string | null | undefined): string {
  if (!value) return '';
  return CONTAINER_TYPES.find((type) => type.value === value)?.label ?? value;
}

/**
 * Standard product colours, stored in Dutch.
 *
 * These names translate automatically on quotes and catalogues through the
 * backend dictionary. A colour typed outside this list stays possible, but
 * then translation runs through the CSV file like any other product text.
 */
export const STANDARD_COLOURS = [
  'Rood', 'Roze', 'Fuchsia', 'Bordeaux', 'Wit', 'Ivoor', 'Champagne',
  'Geel', 'Oranje', 'Groen', 'Blauw', 'Paars', 'Lila',
  'Zwart', 'Grijs', 'Zilver', 'Goud', 'Gemengd',
] as const;

/**
 * Standard payment terms, stored in Dutch.
 *
 * These translate automatically on quotes through the backend dictionary;
 * a term typed outside this list stays possible and passes through as-is.
 */
export const STANDARD_PAYMENT_TERMS = [
  'Vooruitbetaling',
  '50% voorschot / 50% bij levering',
  'Bij levering',
  '14 dagen netto',
  '30 dagen netto',
  '60 dagen netto',
] as const;
