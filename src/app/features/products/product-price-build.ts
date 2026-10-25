import type { LandedCostLine, Product, ProductCostHistoryEntry, PurchaseCostLabels } from '../../core/api/models';

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
  row: ProductCostHistoryEntry | null;
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
  /** Today's calculation minus the stored cost, to 4 decimals. */
  differenceEur: number;
  /** At least half a cent apart, so it shows at 2 decimals. */
  drift: boolean;
}

/** "PO-2026-005 rekent nu € 10,39 per stolp (+ € 2,07)": the line on the price card, the cost tiles and the history. */
export interface CostDriftNotice {
  orderId: number;
  orderNumber: string;
  unitEur: number;
  differenceEur: number;
  absEur: number;
  up: boolean;
  /** "per stolp", "per display van 12". */
  per: string;
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
 * cost leave the cost unexplained.
 */
export function appliedParts(product: Pick<Product, 'landedCostEur'> | { landedCostEur?: number | null },
  rows: readonly ProductCostHistoryEntry[]): AppliedCost {
  const row = rows[0] ?? null;
  const stored = product.landedCostEur;
  const matches = row !== null && stored != null && round4(row.landedUnitEur) === round4(stored);
  if (!row || !matches || !hasParts(row)) return { row, matches, parts: null };
  return {
    row, matches,
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
 * miss of the rounded total, then the total: the rows always add up. Parts
 * that round to nothing are left out.
 */
export function costRows(parts: UnitCostParts, total: number, decimals = 2): CostRow[] {
  const rows: CostRow[] = [];
  let sum = 0;
  for (const key of PART_KEYS) {
    const eur = roundHalfUp(parts[key], decimals);
    if (eur === 0) continue;
    rows.push({ key, eur });
    sum += eur;
  }
  const totalEur = roundHalfUp(total, decimals);
  const rest = roundHalfUp(totalEur - sum, decimals);
  if (rest !== 0) rows.push({ key: 'rounding', eur: rest });
  rows.push({ key: 'total', eur: totalEur });
  return rows;
}

export function costDrift(storedEur: number, liveUnitEur: number): CostDrift {
  const differenceEur = round4(liveUnitEur - storedEur);
  return { differenceEur, drift: Math.abs(differenceEur) >= 0.005 };
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
 * its own parts ("toegepast 23/08/2026"), or alone with "Opbouw niet bewaard"
 * when no row explains it. The container's calculation of today follows as a
 * block of its own when the container still exists and it either differs
 * from the stored cost or is the only build-up there is.
 */
export function costBuild(input: CostBuildInput): CostBuild {
  const decimals = input.decimals ?? 2;
  const stored = input.storedEur ?? null;
  const { row, matches, parts } = input.applied;
  const date = matches ? costDate(row?.appliedAt) : null;
  const applied: PriceRow[] = stored === null ? []
    : parts ? labelRows(costRows(parts, stored, decimals), input.appliedWords ?? {}, `Kostprijs ${input.appliedPer}`,
      date ? `toegepast ${date}` : undefined)
    : [{ label: `Kostprijs ${input.appliedPer}`, hint: `Opbouw niet bewaard bij het toepassen${date ? ` (${date})` : ''}.`,
      eur: roundHalfUp(stored, decimals), sum: true }];

  const live = input.order ? input.live : null;
  const drift = live && stored !== null ? costDrift(stored, live.unitEur) : null;
  const notice: CostDriftNotice | null = drift?.drift && input.order ? {
    orderId: input.order.id, orderNumber: input.order.number, unitEur: live!.unitEur, differenceEur: drift.differenceEur,
    absEur: Math.abs(drift.differenceEur), up: drift.differenceEur > 0, per: input.livePer,
  } : null;
  const liveBlock = live && input.order && (notice !== null || parts === null) ? {
    title: `${input.order.number} rekent nu`,
    rows: labelRows(costRows(live.parts, live.unitEur, decimals), input.liveWords ?? {}, `Geland ${input.livePer}`),
  } : null;
  return { applied, live: liveBlock, drift: notice };
}
