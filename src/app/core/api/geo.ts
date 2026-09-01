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

export interface PortOption {
  /** Stable value exchanged with the API. */
  value: string;
  /** Friendly name shown in the native mobile picker. */
  label: string;
}

/** Sentinel used by a port picker to reveal its free-text alternative. */
export const OTHER_PORT_VALUE = '__OTHER_PORT__';

/**
 * Main Chinese container ports used for our sourcing lanes.
 *
 * The API deliberately keeps the short city name. The terminal/port-system
 * name in the label helps a buyer pick the right option without changing
 * existing freight routes such as `Ningbo -> Rotterdam`.
 */
export const CHINESE_DEPARTURE_PORTS: readonly PortOption[] = [
  { value: 'Ningbo', label: 'Ningbo — Ningbo-Zhoushan' },
  { value: 'Shanghai', label: 'Shanghai' },
  { value: 'Shenzhen', label: 'Shenzhen — Yantian' },
  { value: 'Guangzhou', label: 'Guangzhou — Nansha' },
  { value: 'Qingdao', label: 'Qingdao' },
  { value: 'Tianjin', label: 'Tianjin — Xingang' },
  { value: 'Xiamen', label: 'Xiamen' },
];

/** Frequent European destination ports; every other port stays possible. */
export const DESTINATION_PORTS: readonly PortOption[] = [
  { value: 'Rotterdam', label: 'Rotterdam' },
  { value: 'Amsterdam', label: 'Amsterdam' },
  { value: 'Antwerpen', label: 'Antwerpen' },
  { value: 'Zeebrugge', label: 'Zeebrugge' },
  { value: 'Hamburg', label: 'Hamburg' },
  { value: 'Bremerhaven', label: 'Bremerhaven' },
  { value: 'Felixstowe', label: 'Felixstowe' },
  { value: 'Le Havre', label: 'Le Havre' },
];

/**
 * Container types as the API names them, with human labels.
 *
 * The select previously used shipping codes ("40HQ") while the API speaks
 * enum names ("FORTY_HQ") - no option ever matched, so the dropdown sat
 * empty. One list, keyed by what the API actually sends.
 */
export const PURCHASE_CONTAINER_TYPES = [
  { value: 'TWENTY_GP', shortLabel: '20 ft', label: "20' Standard — 28 m³",
    capacityCbm: 28, note: 'Compacte zending' },
  { value: 'FORTY_GP', shortLabel: '40 ft', label: "40' Standard — 58 m³",
    capacityCbm: 58, note: 'Standaardhoogte' },
  { value: 'FORTY_HQ', shortLabel: '40 ft HQ', label: "40' High Cube — 68 m³",
    capacityCbm: 68, note: 'Meeste laadruimte' },
] as const;

export type PurchaseContainerType = typeof PURCHASE_CONTAINER_TYPES[number]['value'];
export const DEFAULT_PURCHASE_CONTAINER_TYPE: PurchaseContainerType = 'FORTY_HQ';

export const CONTAINER_TYPES = [
  ...PURCHASE_CONTAINER_TYPES,
  { value: 'LCL', shortLabel: 'LCL', label: 'Groepage (LCL)', capacityCbm: 0,
    note: 'Deelzending' },
] as const;

/** Label for a container enum name; falls back to the raw value. */
export function containerLabel(value: string | null | undefined): string {
  if (!value) return '';
  return CONTAINER_TYPES.find((type) => type.value === value)?.label ?? value;
}

/**
 * Uses the server's CBM result, with a rolling-deploy fallback for responses
 * from the previous backend version that did not expose the count yet.
 */
export function containerCountForFill(fill: {
  capacityCbm: number;
  usedCbm: number;
  minimumContainerCount?: number | null;
}): number {
  const supplied = fill.minimumContainerCount;
  if (typeof supplied === 'number' && Number.isInteger(supplied) && supplied >= 0 &&
      (fill.usedCbm <= 0 || supplied > 0)) {
    return supplied;
  }
  if (!Number.isFinite(fill.capacityCbm) || fill.capacityCbm <= 0 ||
      !Number.isFinite(fill.usedCbm) || fill.usedCbm <= 0) return 0;
  return Math.ceil(fill.usedCbm / fill.capacityCbm);
}

/**
 * Standard product colours, stored in Dutch.
 *
 * These names translate automatically on quotes and catalogues through the
 * backend dictionary. A colour typed outside this list stays possible, but
 * then translation runs through the catalogue workbook like any other product text.
 */
export const STANDARD_COLOURS = [
  'Rood', 'Roze', 'Fuchsia', 'Bordeaux', 'Wit', 'Ivoor', 'Champagne',
  'Geel', 'Oranje', 'Groen', 'Blauw', 'Paars', 'Lila',
  'Zwart', 'Grijs', 'Zilver', 'Goud', 'Gemengd',
] as const;

/**
 * Default swatch per standard colour - mirrors the backend's
 * ColourSwatches so the sample shows the moment a colour is picked. The
 * backend fills the same default on every write; this is feedback, not
 * the source of truth.
 */
export const COLOUR_SWATCHES: Record<string, string> = {
  Rood: '#A91F32', Roze: '#E59BB4', Fuchsia: '#C2187A', Bordeaux: '#6B1A2B',
  Wit: '#F4F1EC', Ivoor: '#F1E9D6', Champagne: '#E8D6B3', Geel: '#F2C94C',
  Oranje: '#EF8A2F', Groen: '#3E7D4F', Blauw: '#2F5D9E', Paars: '#6E3C9A',
  Lila: '#B69AD6', Zwart: '#1A1614', Grijs: '#9A9A9A', Zilver: '#C0C4C9',
  Goud: '#C9A227', Gemengd: '#D8C3C3',
};

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
