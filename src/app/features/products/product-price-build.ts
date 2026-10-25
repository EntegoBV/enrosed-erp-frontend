import type { LandedCostLine, Product, ProductCostHistoryEntry, PurchaseCostLabels } from '../../core/api/models';
import type { CostKind } from './product-cost-history-model';

/*
 * The cost build-up of the product page, apart from the screen. A build-up
 * never mixes sources: the stored cost is explained by the parts stored with
 * it (the history row that set it), and the container's calculation of today
 * is a block of its own with its own total. When the two differ, the drift
 * says by how much. Only type imports, so node runs it as it is
 * (tests/product-price-build.test.mts).
 */

/** What one unit was made of, in euro, in the order of the purchase calculation. */
export interface UnitCostParts {
  goodsEur: number;
  originEur: number;
  freightEur: number;
  dutyEur: number;
  destinationEur: number;
  /** The Enrosed kost. */
  enrosedEur: number;
  /** Inspection and other named costs, when a key spread them into the piece price. */
  separateEur: number;
}

export type CostPartKey = keyof UnitCostParts;

const PART_KEYS: readonly CostPartKey[] = ['goodsEur', 'originEur', 'freightEur', 'dutyEur', 'destinationEur', 'enrosedEur', 'separateEur'];

/** One rounded figure of a build-up: a part, the rounding that closes the gap, or the total. */
export interface CostRow {
  key: CostPartKey | 'rounding' | 'total';
  eur: number;
}

/** A row as the product page prints it; "+ " and "± " lead the parts after the first. */
export interface PriceRow {
  label: string;
  hint?: string;
  eur: number;
  sum?: boolean;
  note?: boolean;
  aside?: boolean;
}

/** The newest history row, and the parts that explain the stored cost (null when they do not). */
export interface AppliedCost {
  /** False when the history could not be loaded: then nothing is known about the parts. */
  loaded: boolean;
  row: ProductCostHistoryEntry | null;
  /** The newest row's kind; a copy took its cost and parts over from another product. */
  kind: CostKind | null;
  /** The newest row holds the stored cost (to 4 decimals). */
  matches: boolean;
  parts: UnitCostParts | null;
}

/** The container's calculation of today for one unit. */
export interface LiveCost {
  parts: UnitCostParts;
  unitEur: number;
  quantity: number;
}

export interface CostDrift {
  /** Today's calculation minus the stored cost, both as the screen shows them (2 decimals). */
  differenceEur: number;
  /** The two figures on screen differ. */
  drift: boolean;
}

/** "PO-2026-005 rekent nu € 10,39 per stolp (+ € 2,07)": the line on the price card, the cost tiles and the history. */
export interface CostDriftNotice {
  orderId: number;
  orderNumber: string;
  unitEur: number;
  /** Null when the stored cost holds on another basis (per display against per piece is no difference). */
  differenceEur: number | null;
  absEur: number | null;
  up: boolean;
  /** "per stolp", "per display". */
  per: string;
  /** "toegepast per display van 12": instead of the difference when the stored cost holds on another basis. */
  basisNote: string | null;
}

/** The words of the parts: the container's own labels when its view is loaded. */
export interface PartWords {
  labels?: PurchaseCostLabels | null;
  /** "Invoerrechten 10 %"; left out when unknown. */
  dutyPct?: number | null;
  hsCode?: string | null;
  /** "18 stolpen in PO-2026-005". */
  goodsHint?: string | null;
}

export interface CostBuildInput {
  storedEur: number | null | undefined;
  applied: AppliedCost;
  live: LiveCost | null;
  /** The source container while it still exists. */
  order: { id: number; number: string } | null;
  /** The basis words of the stored cost and of today's calculation. */
  appliedPer: string;
  livePer: string;
  /** The stored cost holds on today's basis; false gives the drift no difference. Default true. */
  sameBasis?: boolean;
  appliedWords?: PartWords;
  liveWords?: PartWords;
  decimals?: number;
}

export interface CostBuild {
  /** The stored cost explained by its own parts, or the cost alone with why. */
  applied: PriceRow[];
  /** "PO-2026-005 rekent nu", with its own total. */
  live: { title: string; rows: PriceRow[] } | null;
  drift: CostDriftNotice | null;
}

const round4 = (value: number): number => Math.round(value * 10000) / 10000;

/** costKind of product-cost-history-model, kept here so node runs this file as it is. */
function rowKind(row: ProductCostHistoryEntry): CostKind {
  const kind = row.kind;
  if (kind === 'APPLY' || kind === 'REAPPLY' || kind === 'SEED' || kind === 'COPY') return kind;
  return row.appliedBy === 'system' ? 'SEED' : 'APPLY';
}

/** Half away from zero, without the binary slip of 1,005 → 1,00. */
export function roundHalfUp(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) return 0;
  const abs = Math.abs(value);
  if (abs < 1e-9) return 0;
  const scaled = Math.round(Number(`${abs.toFixed(10)}e${decimals}`));
  const rounded = Number(`${scaled}e-${decimals}`);
  return value < 0 && rounded !== 0 ? -rounded : rounded;
}

function hasParts(row: ProductCostHistoryEntry): boolean {
  return [row.goodsEur, row.originEur, row.freightEur, row.dutyEur, row.destinationEur, row.enrosedEur, row.separateEur]
    .some((value) => value != null);
}

/**
 * The newest cost-history row explains the stored cost when it holds that
 * very cost (4 decimals) and kept its parts. A seed, an apply from before the
 * parts were kept, a copy of a changed cost, or a row that is not the stored
 * cost leave the cost unexplained. A copy keeps parts only when its cost is
 * the source row's, so those parts do explain it. `rows` null: the history
 * did not load.
 */
export function appliedParts(product: Pick<Product, 'landedCostEur'> | { landedCostEur?: number | null },
  rows: readonly ProductCostHistoryEntry[] | null): AppliedCost {
  const loaded = rows !== null;
  const row = rows?.[0] ?? null;
  const kind = row ? rowKind(row) : null;
  const stored = product.landedCostEur;
  const matches = row !== null && stored != null && round4(row.landedUnitEur) === round4(stored);
  if (!row || !matches || !hasParts(row)) return { loaded, row, kind, matches, parts: null };
  return {
    loaded, row, kind, matches,
    parts: {
      goodsEur: row.goodsEur ?? 0, originEur: row.originEur ?? 0, freightEur: row.freightEur ?? 0, dutyEur: row.dutyEur ?? 0,
      destinationEur: row.destinationEur ?? 0, enrosedEur: row.enrosedEur ?? 0, separateEur: row.separateEur ?? 0,
    },
  };
}

/** A container line per unit, inspection and other costs included; null without a quantity. */
export function liveParts(line: LandedCostLine | null | undefined): LiveCost | null {
  if (!line || !(line.quantity > 0)) return null;
  const per = (total: number | null | undefined) => (total ?? 0) / line.quantity;
  return {
    parts: {
      goodsEur: per(line.goodsEur), originEur: per(line.originEur), freightEur: per(line.freightEur), dutyEur: per(line.dutyEur),
      destinationEur: per(line.destinationEur), enrosedEur: per(line.extraRevenueEur), separateEur: per(line.separateEur),
    },
    unitEur: line.landedUnitEur,
    quantity: line.quantity,
  };
}

/**
 * Each part rounded half-up, an Afronding row for what the rounded parts
 * miss of the rounded total, then the total: the rows always add up. Only
 * parts that are nothing (at 4 decimals) are left out; a part below half a
 * cent stays as 0,00, so Afronding is only the rounding.
 */
export function costRows(parts: UnitCostParts, total: number, decimals = 2): CostRow[] {
  const rows: CostRow[] = [];
  let sum = 0;
  for (const key of PART_KEYS) {
    if (round4(parts[key]) === 0) continue;
    const eur = roundHalfUp(parts[key], decimals);
    rows.push({ key, eur });
    sum += eur;
  }
  const totalEur = roundHalfUp(total, decimals);
  const rest = roundHalfUp(totalEur - sum, decimals);
  if (rest !== 0) rows.push({ key: 'rounding', eur: rest });
  rows.push({ key: 'total', eur: totalEur });
  return rows;
}

/** Decided on the figures the screen shows, so the line never names a difference the tiles do not show. */
export function costDrift(storedEur: number, liveUnitEur: number, decimals = 2): CostDrift {
  const differenceEur = roundHalfUp(roundHalfUp(liveUnitEur, decimals) - roundHalfUp(storedEur, decimals), decimals);
  return { differenceEur, drift: differenceEur !== 0 };
}

/** The duty rate the stored parts were made with: duty over the customs value (goods, origin and freight), to 0,1 %. */
export function impliedDutyPct(parts: UnitCostParts): number | null {
  const base = parts.goodsEur + parts.originEur + parts.freightEur;
  if (!(parts.dutyEur > 0) || !(base > 0)) return null;
  return Math.round((parts.dutyEur / base) * 1000) / 10;
}

/** Belgian date, as the dateNl pipe prints it: 23/08/2026. */
export function costDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = dateOnly ? new Date(Date.UTC(+dateOnly[1], +dateOnly[2] - 1, +dateOnly[3])) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('nl-BE', { day: '2-digit', month: '2-digit', year: 'numeric', ...(dateOnly ? { timeZone: 'UTC' } : {}) }).format(date);
}

const pct = (value: number): string => value.toLocaleString('nl-BE', { maximumFractionDigits: 1 });

/** The rows in the words of the purchase calculation; the total takes the given label. */
export function labelRows(rows: readonly CostRow[], words: PartWords, totalLabel: string, totalHint?: string): PriceRow[] {
  const labels = words.labels ?? null;
  const text = (value: string | null | undefined) => value?.trim() || undefined;
  return rows.map((row, index): PriceRow => {
    const lead = index === 0 ? '' : '+ ';
    switch (row.key) {
      case 'goodsEur': return { label: `${lead}Inkoopprijs (EXW)`, hint: text(words.goodsHint), eur: row.eur };
      case 'originEur': return { label: `${lead}${labels?.originCostsLabel || 'Lokale kosten bij vertrek'}`,
        hint: [text(labels?.originRoute), 'vervoer naar de haven, export, laden'].filter(Boolean).join(' · '), eur: row.eur };
      case 'freightEur': return { label: `${lead}${labels?.seaFreightLabel || 'Zeevracht'}`, hint: text(labels?.seaFreightRoute), eur: row.eur };
      case 'dutyEur': return { label: `${lead}Invoerrechten${words.dutyPct ? ` ${pct(words.dutyPct)} %` : ''}`,
        hint: words.hsCode?.trim() ? `douane, HS-code ${words.hsCode.trim()}` : 'douane', eur: row.eur };
      case 'destinationEur': return { label: `${lead}${labels?.destinationCostsLabel || 'Kosten na aankomst'}`,
        hint: 'havenkosten, inklaring en levering aan het magazijn', eur: row.eur };
      case 'enrosedEur': return { label: `${lead}Enrosed kost`, eur: row.eur };
      case 'separateEur': return { label: `${lead}Inspectie en andere kosten`, eur: row.eur };
      case 'rounding': return { label: '± Afronding', eur: row.eur };
      default: return { label: totalLabel, ...(totalHint ? { hint: totalHint } : {}), eur: row.eur, sum: true };
    }
  });
}

/**
 * The cost part of the product's price build-up. The stored cost reads from
 * its own parts ("toegepast 23/08/2026", a copy "overgenomen bij kopiëren"),
 * or alone with "Opbouw niet bewaard" when no row explains it. The container's calculation of today follows as a
 * block of its own when the container still exists and it either differs
 * from the stored cost or is the only build-up there is.
 */
export function costBuild(input: CostBuildInput): CostBuild {
  const decimals = input.decimals ?? 2;
  const stored = input.storedEur ?? null;
  const { row, kind, matches, parts } = input.applied;
  const date = matches ? costDate(row?.appliedAt) : null;
  /* A copy's date is the day it was copied, not the day the cost was applied. */
  const copied = matches && kind === 'COPY';
  const hint = !input.applied.loaded ? 'Opbouw niet geladen.'
    : `Opbouw niet bewaard bij het ${copied ? 'kopiëren' : 'toepassen'}${date ? ` (${date})` : ''}.`;
  const applied: PriceRow[] = stored === null ? []
    : parts ? labelRows(costRows(parts, stored, decimals), input.appliedWords ?? {}, `Kostprijs ${input.appliedPer}`,
      date ? `${copied ? 'overgenomen bij kopiëren' : 'toegepast'} ${date}` : undefined)
    : [{ label: `Kostprijs ${input.appliedPer}`, hint, eur: roundHalfUp(stored, decimals), sum: true }];

  const live = input.order ? input.live : null;
  const drift = live && stored !== null ? costDrift(stored, live.unitEur, decimals) : null;
  /* Per display against per piece is no difference: then the line names the basis instead. */
  const sameBasis = input.sameBasis ?? true;
  const notice: CostDriftNotice | null = drift?.drift && input.order ? {
    orderId: input.order.id, orderNumber: input.order.number, unitEur: live!.unitEur,
    differenceEur: sameBasis ? drift.differenceEur : null, absEur: sameBasis ? Math.abs(drift.differenceEur) : null,
    up: drift.differenceEur > 0, per: input.livePer, basisNote: sameBasis ? null : `toegepast ${input.appliedPer}`,
  } : null;
  const liveBlock = live && input.order && (notice !== null || parts === null) ? {
    title: `${input.order.number} rekent nu`,
    rows: labelRows(costRows(live.parts, live.unitEur, decimals), input.liveWords ?? {}, `Geland ${input.livePer}`),
  } : null;
  return { applied, live: liveBlock, drift: notice };
}
