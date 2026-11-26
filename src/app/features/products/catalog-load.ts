import type { CatalogExportRequest } from '../../core/api/catalog-api';
import type { Product } from '../../core/api/models';
import {
  EURO_PALLET_HEIGHT_LIMIT_CM, KAR_HEIGHT_LIMIT_CM, KAR_MAX_HEIGHT_CM, PALLET_MAX_HEIGHT_CM, SPILL_LIMIT_CM, STANDARD_SPILL_CM,
  karSpec, minHeightCm, palletFit, palletSpec, type PalletSpec,
} from '../sales/pallet-calculator-model';

/**
 * What one catalogue PDF counts its per-pallet and per-kar figures with (Emre, 2026-11-26: "Catalogus pdf
 * zowel korte en lange daar moet ik ook eigenlijk kunnen aanpassen op pallet en deense car de hoogte zodat dan
 * de aantallen kunnen veranderen ook dynamisch want sommige klanten hebben andere standaard hoogtes", and
 * "De spill willen wij ook kunnen aanpassen"). Free of Angular: the studio (catalog-export.ts) keeps the pick,
 * the card "Laadhoogte en spill" (catalog-load-settings.ts) draws it.
 *
 * Whole centimetres. The server knows the same three values under the same names (the export request and the
 * preflight's `load` echo) and counts with the same rule (PalletCalculator.fit on the load floor), so the
 * preview and the PDF give one number.
 */
export interface CatalogLoad {
  /** The europallet's loaded height, the wood included. */
  palletHeightCm: number;
  /** The Deense kar's loading height, from the floor. */
  karHeightCm: number;
  /** How far an omdoos may stick out past an edge of the floor; on the kar across its width only (karSpec). */
  spillCm: number;
}

export type CatalogLoadKey = keyof CatalogLoad;

/** The house standard: what a PDF counts with when nothing is picked, and what a request without the fields means. */
export const CATALOG_LOAD_STANDARD: Readonly<CatalogLoad> = {
  palletHeightCm: PALLET_MAX_HEIGHT_CM,
  karHeightCm: KAR_MAX_HEIGHT_CM,
  spillCm: STANDARD_SPILL_CM,
};

/**
 * What can be picked, as the server accepts it (409 outside): a europallet 16 to 260 cm, the kar 18 to 300 cm,
 * the spill 0 to 5 cm. The heights step by 10, the spill by 1; any whole number within the bounds can be typed.
 */
export const CATALOG_LOAD_BOUNDS: Readonly<Record<CatalogLoadKey, { min: number; max: number; step: number }>> = {
  palletHeightCm: { min: minHeightCm('EURO_120X80'), max: EURO_PALLET_HEIGHT_LIMIT_CM, step: 10 },
  karHeightCm: { min: minHeightCm('DEENSE_KAR'), max: KAR_HEIGHT_LIMIT_CM, step: 10 },
  spillCm: { min: 0, max: SPILL_LIMIT_CM, step: 1 },
};

const KEYS: readonly CatalogLoadKey[] = ['palletHeightCm', 'karHeightCm', 'spillCm'];

/** A value as it may be kept: a whole number within its bounds; anything else is the standard. */
function kept(key: CatalogLoadKey, value: unknown): number {
  const { min, max } = CATALOG_LOAD_BOUNDS[key];
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : CATALOG_LOAD_STANDARD[key];
}

/** What was read back from the tab's store as a pick: every value a whole number within its bounds, the standard for one that is not. */
export function storedCatalogLoad(pick: Partial<Record<CatalogLoadKey, unknown>> | null | undefined): CatalogLoad {
  return { palletHeightCm: kept('palletHeightCm', pick?.palletHeightCm), karHeightCm: kept('karHeightCm', pick?.karHeightCm), spillCm: kept('spillCm', pick?.spillCm) };
}

/** A stepped or typed value brought within its bounds: a whole number, the nearest bound when it is outside. */
export function boundedLoadValue(key: CatalogLoadKey, value: number): number {
  const { min, max } = CATALOG_LOAD_BOUNDS[key];
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : CATALOG_LOAD_STANDARD[key];
}

/** Something differs from the standard. */
export function catalogLoadChanged(load: CatalogLoad): boolean {
  return KEYS.some((key) => load[key] !== CATALOG_LOAD_STANDARD[key]);
}

export type CatalogLoadFields = Pick<CatalogExportRequest, CatalogLoadKey>;

/**
 * What travels in the export request: only a value that differs from the standard. A request without the
 * fields is the one every server knows and means the standard.
 */
export function catalogLoadFields(load: CatalogLoad): CatalogLoadFields {
  const fields: CatalogLoadFields = {};
  for (const key of KEYS) if (load[key] !== CATALOG_LOAD_STANDARD[key]) fields[key] = load[key];
  return fields;
}

/** "Pallet 260 cm · Deense kar 230 cm · spill 2 cm": the card's line, there without opening anything. */
export function catalogLoadSummary(load: CatalogLoad): string {
  return `Pallet ${load.palletHeightCm} cm · Deense kar ${load.karHeightCm} cm · spill ${load.spillCm} cm`;
}

/** The europallet and the Deense kar a catalogue counts on, as the server builds them for the same three values. */
export interface CatalogCarriers {
  pallet: PalletSpec;
  kar: PalletSpec;
}

/**
 * The server's two specs for a PDF: SalesSettings.pallet() (a Europallet 120 × 80, the wood included, 700 kg)
 * and PalletSpec.deenseKar() at the picked heights, each with the picked spill. The kar takes the spill across
 * its width only; that rule is karSpec's, never written again here.
 */
export function catalogCarriers(load: CatalogLoad): CatalogCarriers {
  return { pallet: palletSpec('EURO_120X80', load.palletHeightCm, load.spillCm), kar: karSpec(load.karHeightCm, load.spillCm) };
}

/**
 * A product's figure on a pallet or a kar as the PDF prints it: whole omdozen (palletFit: upright, laid down
 * only when it fits no carrier upright) times what one omdoos holds, in the unit of 20ft and 40ft. Null when
 * nothing fits or the omdoos's contents are unknown (the PDF's "-").
 */
export function catalogueUnits(product: Product, carrier: PalletSpec): number | null {
  const perCarton = product.carton.piecesPerCarton;
  const cartons = palletFit(product.carton, carrier).cartonsPerPallet;
  return cartons > 0 && perCarton ? cartons * perCarton : null;
}

/**
 * The older-server guard, as the one for prices per customer. A request that carries a height or a spill is
 * exported only when the preflight echoes the load the server will count with (`load`), and that load is the
 * one on screen. A server from before 2026-11-26 drops the fields silently and would print the standard figures
 * in a PDF made for another height. Null when the request is fine to send; otherwise the Dutch message.
 */
export function catalogLoadProblem(request: CatalogLoadFields, echo: unknown): string | null {
  if (KEYS.every((key) => request[key] == null)) return null;
  if (!echo || typeof echo !== 'object') {
    return 'De server kent een eigen laadhoogte en spill nog niet. Zet Laadhoogte en spill op Standaard, of probeer het later opnieuw.';
  }
  /* What is on screen: the picked value, the standard for a field that did not travel. */
  const honoured = KEYS.every((key) => {
    const answered = Number((echo as Record<string, unknown>)[key]);
    return Number.isFinite(answered) && Math.abs(answered - (request[key] ?? CATALOG_LOAD_STANDARD[key])) < 0.001;
  });
  return honoured ? null
    : 'De server telt met een andere laadhoogte of spill dan hier staat. Zet Laadhoogte en spill op Standaard, of probeer het later opnieuw.';
}

/**
 * This tab only (as the recipient and the one-off prices): a height picked for one customer must never be in
 * the next customer's PDF unseen. Only what differs from the standard is kept, so a tab that picked nothing
 * follows the standard.
 */
const LOAD_STATE_KEY = 'enrosed.catalogBuilder.load.v1';

export function storeCatalogLoad(load: CatalogLoad): void {
  try {
    if (catalogLoadChanged(load)) sessionStorage.setItem(LOAD_STATE_KEY, JSON.stringify({ version: 1, ...catalogLoadFields(load) }));
    else sessionStorage.removeItem(LOAD_STATE_KEY);
  } catch {
    /* Blocked tab storage: the pick lasts as long as this screen. */
  }
}

export function restoreCatalogLoad(): CatalogLoad {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(LOAD_STATE_KEY) ?? 'null') as ({ version?: unknown } & Partial<Record<CatalogLoadKey, unknown>>) | null;
    return parsed?.version === 1 ? storedCatalogLoad(parsed) : { ...CATALOG_LOAD_STANDARD };
  } catch {
    /* A damaged or blocked tab store starts on the standard. */
    return { ...CATALOG_LOAD_STANDARD };
  }
}
