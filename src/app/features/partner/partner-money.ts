/**
 * The money of a melding, computed exactly as the server books it
 * (PartnerSaleMoney, contract round 2 sections 2 and v2-A/B), so the live
 * euros on the form are the euros of the answer. Pure and import-free: the
 * partner's Melden and the staff entry share it.
 *
 * - A part is a number of whole sales units Q and a price per piece. The
 *   piece price is taken to 4 decimals (p4, what is sent), the unit price is
 *   p4 x pieces per sales unit, and gross = round2(Q x unit price).
 * - Veilingcommissie and Transport = round2(gross x pct / 100) per product;
 *   both 0 on a direct sale.
 * - Extra kost lines (0..5): a percentage line adds round2(gross x pct / 100)
 *   per sale product; the amount lines are summed (each at 2 decimals) and
 *   that sum is spread once over the sale products by gross with the server's
 *   allocate rule (each share rounded half up from what is left, the last
 *   product with weight takes the rest).
 * - Sale net = gross - commission - transport - extra; below 0 is refused.
 * - Buyback (auction only): gross as above, plus commission and transport at
 *   the melding's percentages; terugkoopkost = gross + commission + transport,
 *   its net = -terugkoopkost. No extra kost on a buyback.
 * - Netto = sale net - terugkoopkost.
 * - Editing without moving stock (the server's money-only path), a side whose
 *   price stays keeps what it was booked with (`booked`): a sale its gross
 *   (its costs follow from it as above), a buyback its gross, commission
 *   and transport (a round-1 melding keeps its history).
 *
 * Rounding is half up on the decimal value (BigDecimal HALF_UP), on whole
 * cents in BigInt: no binary float ever decides a cent.
 */

export type MoneyChannel = 'AUCTION' | 'DIRECT';

/** A typed part: whole sales units and the average price per piece. */
export interface MoneyPart {
  /** Whole sales units; null while no count is typed or it is no whole number of them. */
  salesUnits: number | null;
  piecesPerSalesUnit: number;
  /** Average per piece (per roos); taken at 4 decimals. */
  piecePrice: number | null;
  /**
   * What the side was booked with, kept by the server while the edit moves no stock and the price stays: the gross
   * (a sale's costs follow from it); a buyback also keeps its commission and transport.
   */
  booked?: { grossEur: number; commissionEur?: number; transportEur?: number } | null;
}

export interface MoneyEntry {
  sale?: MoneyPart | null;
  buyback?: MoneyPart | null;
}

export interface MoneyExtraLine {
  mode: 'AMOUNT' | 'PCT';
  value: number | null;
}

export interface MoneyInput {
  channel: MoneyChannel;
  /** The melding's percentages; ignored on DIRECT. */
  commissionPct: number;
  transportPct: number;
  extraCosts?: readonly MoneyExtraLine[];
  entries: readonly MoneyEntry[];
}

export interface PartMoney {
  /** Sales units. */
  quantity: number;
  pieces: number;
  piecePriceEur: number;
  unitPriceEur: number;
  grossEur: number;
  commissionEur: number;
  transportEur: number;
}

export interface SaleMoney extends PartMoney {
  extraCostEur: number;
  netEur: number;
}

export interface BuybackMoney extends PartMoney {
  /** Terugkoopkost: gross + commission + transport. */
  costEur: number;
  /** -costEur. */
  netEur: number;
}

export interface EntryMoney {
  /** Null while the sale part is missing or not complete (no count or no price). */
  sale: SaleMoney | null;
  buyback: BuybackMoney | null;
  /** The costs of this product are higher than its gross: the server refuses the melding. */
  costsExceedGross: boolean;
}

export interface MoneyTotals {
  saleQuantity: number;
  salePieces: number;
  buybackQuantity: number;
  buybackPieces: number;
  grossEur: number;
  /** Of the sales (the buyback's own are in buybackEur). */
  commissionEur: number;
  transportEur: number;
  extraCostEur: number;
  saleNetEur: number;
  buybackGrossEur: number;
  buybackCommissionEur: number;
  buybackTransportEur: number;
  /** Terugkoopkost incl. its commission and transport. */
  buybackEur: number;
  netEur: number;
}

export interface MeldingMoney {
  entries: EntryMoney[];
  /** Per extra kost line (same order as the input): what it costs over the whole melding. */
  extraLines: number[];
  totals: MoneyTotals;
  costsExceedGross: boolean;
}

/**
 * A decimal number scaled to an integer, rounded half up on its decimal
 * representation: scaled(1.005, 2) is 101n (1.005 is 1.00499... in binary).
 */
export function scaled(value: number, decimals: number): bigint {
  if (!Number.isFinite(value)) return 0n;
  const negative = value < 0;
  let text = String(Math.abs(value));
  if (/e/i.test(text)) text = Math.abs(value).toFixed(20);
  const [whole, fraction = ''] = text.split('.');
  let result = BigInt(whole + fraction.slice(0, decimals).padEnd(decimals, '0'));
  if (fraction.length > decimals && fraction.charCodeAt(decimals) >= 53 /* '5' */) result += 1n;
  return negative ? -result : result;
}

/** a / b rounded half up (away from zero), for b > 0. */
function divideHalfUp(a: bigint, b: bigint): bigint {
  if (a < 0n) return -divideHalfUp(-a, b);
  return (2n * a + b) / (2n * b);
}

const eurOf = (cents: bigint): number => Number(cents) / 100;

/** Euros at 2 decimals, half up (what an amount is sent as). */
export function round2(value: number): number {
  return eurOf(scaled(value, 2));
}

/** A price at 4 decimals, half up (what a piece price or a percentage is sent as). */
export function round4(value: number): number {
  return Number(scaled(value, 4)) / 10_000;
}

function wholeUnits(part: MoneyPart | null | undefined): number | null {
  const units = part?.salesUnits;
  return units != null && Number.isSafeInteger(units) && units > 0 ? units : null;
}

function perSalesUnit(part: MoneyPart): bigint {
  const n = part.piecesPerSalesUnit;
  return BigInt(Number.isSafeInteger(n) && n > 0 ? n : 1);
}

/** True when the part has whole sales units above 0 and a price of 0 or more. */
export function partComplete(part: MoneyPart | null | undefined): boolean {
  return wholeUnits(part) !== null && part!.piecePrice != null && Number.isFinite(part!.piecePrice) && part!.piecePrice >= 0;
}

/** A complete part's gross in cents, its pieces and its prices (piece price p4, unit price p4 x pieces per unit). */
function partGross(part: MoneyPart): { quantity: number; pieces: number; cents: bigint; piece4: bigint; unit4: bigint } {
  const quantity = wholeUnits(part)!;
  const per = perSalesUnit(part);
  const piece4 = scaled(part.piecePrice!, 4);
  const unit4 = piece4 * per;
  const cents = part.booked ? scaled(part.booked.grossEur, 2) : divideHalfUp(BigInt(quantity) * unit4, 100n);
  return { quantity, pieces: quantity * Number(per), cents, piece4, unit4 };
}

/** round2(gross x pct / 100) in cents; pct taken at 4 decimals (the column). */
function percentOf(grossCents: bigint, pct: number): bigint {
  const pct4 = scaled(pct, 4);
  if (pct4 === 0n) return 0n;
  return divideHalfUp(grossCents * pct4, 1_000_000n);
}

/**
 * PartnerSettlementLedger.allocate: each share = what is left x weight /
 * weight left, half up to the cent; a weight of 0 gets 0; the last weight
 * (it equals the weight left) takes the rest. All weights 0: equal weights.
 */
export function allocateCents(totalCents: bigint, weights: readonly bigint[]): bigint[] {
  if (weights.length === 0) return [];
  let used = weights;
  if (used.reduce((sum, weight) => sum + weight, 0n) === 0n) used = used.map(() => 1n);
  let remaining = totalCents;
  let weightLeft = used.reduce((sum, weight) => sum + weight, 0n);
  return used.map((weight) => {
    const share = weight === 0n ? 0n : weight === weightLeft ? remaining : divideHalfUp(remaining * weight, weightLeft);
    remaining -= share;
    weightLeft -= weight;
    return share;
  });
}

/** A line that counts: a value of 0 or more (a percentage at most 100 is the form's rule, not this one's). */
function lineValue(line: MoneyExtraLine): number | null {
  return line.value != null && Number.isFinite(line.value) && line.value >= 0 ? line.value : null;
}

/** The live money of a melding; incomplete parts count as absent. */
export function meldingMoney(input: MoneyInput): MeldingMoney {
  const auction = input.channel === 'AUCTION';
  const commissionPct = auction ? input.commissionPct : 0;
  const transportPct = auction ? input.transportPct : 0;
  const lines = input.extraCosts ?? [];

  const sales = input.entries.map((entry) => (entry.sale && partComplete(entry.sale) ? partGross(entry.sale) : null));
  const saleIndexes = sales.flatMap((sale, index) => (sale ? [index] : []));

  /* The amount lines: summed once (each at 2 decimals), spread over the sale products by gross, in their order. */
  let amountCents = 0n;
  lines.forEach((line) => { const value = lineValue(line); if (line.mode === 'AMOUNT' && value !== null) amountCents += scaled(value, 2); });
  const amountShares = new Map<number, bigint>();
  if (amountCents > 0n && saleIndexes.length) {
    const shares = allocateCents(amountCents, saleIndexes.map((index) => sales[index]!.cents));
    saleIndexes.forEach((index, i) => amountShares.set(index, shares[i]));
  }
  const extraLines = lines.map((line) => {
    const value = lineValue(line);
    if (value === null || !saleIndexes.length) return 0;
    if (line.mode === 'AMOUNT') return eurOf(scaled(value, 2));
    return eurOf(saleIndexes.reduce((sum, index) => sum + percentOf(sales[index]!.cents, value), 0n));
  });

  let saleQuantity = 0, salePieces = 0, buybackQuantity = 0, buybackPieces = 0;
  let gross = 0n, commission = 0n, transport = 0n, extraTotal = 0n, saleNet = 0n;
  let buybackGross = 0n, buybackCommission = 0n, buybackTransport = 0n;
  let costsExceedGross = false;

  const entries = input.entries.map((entry, index): EntryMoney => {
    let saleMoney: SaleMoney | null = null;
    let exceeds = false;
    const sale = sales[index];
    if (sale) {
      const c = percentOf(sale.cents, commissionPct);
      const t = percentOf(sale.cents, transportPct);
      let x = amountShares.get(index) ?? 0n;
      lines.forEach((line) => { const value = lineValue(line); if (line.mode === 'PCT' && value !== null) x += percentOf(sale.cents, value); });
      const net = sale.cents - c - t - x;
      exceeds = net < 0n;
      saleMoney = {
        quantity: sale.quantity, pieces: sale.pieces, piecePriceEur: Number(sale.piece4) / 10_000, unitPriceEur: Number(sale.unit4) / 10_000,
        grossEur: eurOf(sale.cents), commissionEur: eurOf(c), transportEur: eurOf(t), extraCostEur: eurOf(x), netEur: eurOf(net),
      };
      saleQuantity += sale.quantity; salePieces += sale.pieces;
      gross += sale.cents; commission += c; transport += t; extraTotal += x; saleNet += net;
    }
    let buybackMoney: BuybackMoney | null = null;
    if (auction && entry.buyback && partComplete(entry.buyback)) {
      const part = partGross(entry.buyback);
      const kept = entry.buyback.booked;
      const c = kept?.commissionEur != null ? scaled(kept.commissionEur, 2) : percentOf(part.cents, commissionPct);
      const t = kept?.transportEur != null ? scaled(kept.transportEur, 2) : percentOf(part.cents, transportPct);
      const cost = part.cents + c + t;
      buybackMoney = {
        quantity: part.quantity, pieces: part.pieces, piecePriceEur: Number(part.piece4) / 10_000, unitPriceEur: Number(part.unit4) / 10_000,
        grossEur: eurOf(part.cents), commissionEur: eurOf(c), transportEur: eurOf(t), costEur: eurOf(cost), netEur: eurOf(-cost),
      };
      buybackQuantity += part.quantity; buybackPieces += part.pieces;
      buybackGross += part.cents; buybackCommission += c; buybackTransport += t;
    }
    costsExceedGross ||= exceeds;
    return { sale: saleMoney, buyback: buybackMoney, costsExceedGross: exceeds };
  });

  const buybackCost = buybackGross + buybackCommission + buybackTransport;
  return {
    entries,
    extraLines,
    costsExceedGross,
    totals: {
      saleQuantity, salePieces, buybackQuantity, buybackPieces,
      grossEur: eurOf(gross), commissionEur: eurOf(commission), transportEur: eurOf(transport),
      extraCostEur: eurOf(extraTotal), saleNetEur: eurOf(saleNet),
      buybackGrossEur: eurOf(buybackGross), buybackCommissionEur: eurOf(buybackCommission), buybackTransportEur: eurOf(buybackTransport),
      buybackEur: eurOf(buybackCost), netEur: eurOf(saleNet - buybackCost),
    },
  };
}

/** The piece price a part stands for at 4 decimals (what the 5x check compares), or null. */
export function piecePriceOf(part: MoneyPart | null | undefined): number | null {
  return part && partComplete(part) ? Number(scaled(part.piecePrice!, 4)) / 10_000 : null;
}

/** round2(gross x pct / 100) in euros, as a percentage line costs one product (the server's pctOf). */
export function percentOfEur(grossEur: number, pct: number): number {
  return eurOf(percentOf(scaled(grossEur, 2), pct));
}
