/**
 * The money of a melding, computed exactly as the server books it (contract
 * section 1), so the live euros on the form are the euros of the answer.
 * Pure and import-free: the partner's Melden and the staff entry share it.
 *
 * - Sale gross = the typed total, else round2(quantity x average); the
 *   average is first taken to 4 decimals, the total to 2 (what is sent).
 * - Veilingcommissie and Transport = round2(gross x pct / 100) per product;
 *   both 0 on a direct sale.
 * - Extra kost: a percentage per product as above, or an amount for the
 *   whole melding spread over the sale products by gross with the server's
 *   allocate rule (each share rounded half up from what is left, the last
 *   product with weight takes the rest), so the shares sum to the amount.
 * - Net = gross - commission - transport - extra; a net below 0 is refused.
 * - Buyback (terugkoopkost) = round2(quantity x clock price) or its total;
 *   no percentages, no extra kost.
 * - Netto = sale net - terugkoopkost.
 *
 * Rounding is half up on the decimal value (BigDecimal HALF_UP), on whole
 * cents in BigInt: no binary float ever decides a cent.
 */

export type MoneyChannel = 'AUCTION' | 'DIRECT';

/** A typed part: quantity in sales units, and either the average per unit or the total. */
export interface MoneyPart {
  quantity: number | null;
  /** 'unit': price is the average per sales unit; 'total': price is the part's total. */
  mode: 'unit' | 'total';
  price: number | null;
}

export interface MoneyEntry {
  sale?: MoneyPart | null;
  buyback?: MoneyPart | null;
}

export interface MoneyExtraCost {
  mode: 'AMOUNT' | 'PCT';
  value: number | null;
}

export interface MoneyInput {
  channel: MoneyChannel;
  /** The melding's percentages (the partner's settings); ignored on DIRECT. */
  commissionPct: number;
  transportPct: number;
  extraCost?: MoneyExtraCost | null;
  entries: readonly MoneyEntry[];
}

export interface SaleMoney {
  quantity: number;
  unitPriceEur: number;
  grossEur: number;
  commissionEur: number;
  transportEur: number;
  extraCostEur: number;
  netEur: number;
}

export interface BuybackMoney {
  quantity: number;
  unitPriceEur: number;
  grossEur: number;
}

export interface EntryMoney {
  /** Null while the sale part is missing or not complete (no quantity or no price). */
  sale: SaleMoney | null;
  buyback: BuybackMoney | null;
  /** The costs of this product are higher than its gross: the server refuses the melding. */
  costsExceedGross: boolean;
}

export interface MoneyTotals {
  saleQuantity: number;
  buybackQuantity: number;
  grossEur: number;
  commissionEur: number;
  transportEur: number;
  extraCostEur: number;
  saleNetEur: number;
  buybackEur: number;
  netEur: number;
}

export interface MeldingMoney {
  entries: EntryMoney[];
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

/** Euros at 2 decimals, half up (what a total is sent as). */
export function round2(value: number): number {
  return eurOf(scaled(value, 2));
}

/** A unit price at 4 decimals, half up (what an average is sent as). */
export function round4(value: number): number {
  return Number(scaled(value, 4)) / 10_000;
}

/** A positive whole quantity, or null. */
function quantityOf(part: MoneyPart | null | undefined): number | null {
  const quantity = part?.quantity;
  return quantity != null && Number.isSafeInteger(quantity) && quantity > 0 ? quantity : null;
}

/** True when the part has a quantity above 0 and a price of 0 or more. */
export function partComplete(part: MoneyPart | null | undefined): boolean {
  return quantityOf(part) !== null && part!.price != null && Number.isFinite(part!.price) && part!.price >= 0;
}

/** A complete part's gross in cents and its unit price (the stored one: total / quantity at 4 decimals). */
function partGross(part: MoneyPart): { quantity: number; cents: bigint; unitPriceEur: number } {
  const quantity = quantityOf(part)!;
  const price = part.price!;
  if (part.mode === 'total') {
    const cents = scaled(price, 2);
    /* T / Q at 4 decimals: cents x 100 ten-thousandths, over Q. */
    const unit = divideHalfUp(cents * 100n, BigInt(quantity));
    return { quantity, cents, unitPriceEur: Number(unit) / 10_000 };
  }
  const unit = scaled(price, 4);
  return { quantity, cents: divideHalfUp(BigInt(quantity) * unit, 100n), unitPriceEur: Number(unit) / 10_000 };
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

/** The live money of a melding; incomplete parts count as absent. */
export function meldingMoney(input: MoneyInput): MeldingMoney {
  const auction = input.channel === 'AUCTION';
  const commissionPct = auction ? input.commissionPct : 0;
  const transportPct = auction ? input.transportPct : 0;
  const extra = input.extraCost && input.extraCost.value != null && Number.isFinite(input.extraCost.value)
    && input.extraCost.value >= 0 ? input.extraCost : null;

  const sales = input.entries.map((entry) => (entry.sale && partComplete(entry.sale) ? partGross(entry.sale) : null));
  /* An amount is spread over the products that have a sale, in their order. */
  const saleIndexes = sales.flatMap((sale, index) => (sale ? [index] : []));
  const amountShares = new Map<number, bigint>();
  if (extra?.mode === 'AMOUNT' && saleIndexes.length) {
    const shares = allocateCents(scaled(extra.value!, 2), saleIndexes.map((index) => sales[index]!.cents));
    saleIndexes.forEach((index, i) => amountShares.set(index, shares[i]));
  }

  let saleQuantity = 0, buybackQuantity = 0;
  let gross = 0n, commission = 0n, transport = 0n, extraTotal = 0n, saleNet = 0n, buyback = 0n;
  let costsExceedGross = false;

  const entries = input.entries.map((entry, index): EntryMoney => {
    let saleMoney: SaleMoney | null = null;
    let exceeds = false;
    const sale = sales[index];
    if (sale) {
      const c = percentOf(sale.cents, commissionPct);
      const t = percentOf(sale.cents, transportPct);
      const x = extra?.mode === 'PCT' ? percentOf(sale.cents, extra.value!) : (amountShares.get(index) ?? 0n);
      const net = sale.cents - c - t - x;
      exceeds = net < 0n;
      saleMoney = {
        quantity: sale.quantity, unitPriceEur: sale.unitPriceEur, grossEur: eurOf(sale.cents),
        commissionEur: eurOf(c), transportEur: eurOf(t), extraCostEur: eurOf(x), netEur: eurOf(net),
      };
      saleQuantity += sale.quantity;
      gross += sale.cents; commission += c; transport += t; extraTotal += x; saleNet += net;
    }
    let buybackMoney: BuybackMoney | null = null;
    if (auction && entry.buyback && partComplete(entry.buyback)) {
      const part = partGross(entry.buyback);
      buybackMoney = { quantity: part.quantity, unitPriceEur: part.unitPriceEur, grossEur: eurOf(part.cents) };
      buybackQuantity += part.quantity;
      buyback += part.cents;
    }
    costsExceedGross ||= exceeds;
    return { sale: saleMoney, buyback: buybackMoney, costsExceedGross: exceeds };
  });

  return {
    entries,
    costsExceedGross,
    totals: {
      saleQuantity, buybackQuantity,
      grossEur: eurOf(gross), commissionEur: eurOf(commission), transportEur: eurOf(transport),
      extraCostEur: eurOf(extraTotal), saleNetEur: eurOf(saleNet), buybackEur: eurOf(buyback),
      netEur: eurOf(saleNet - buyback),
    },
  };
}

/** The average per sales unit a part stands for (what the 5x check compares), or null. */
export function averageOf(part: MoneyPart | null | undefined): number | null {
  return part && partComplete(part) ? partGross(part).unitPriceEur : null;
}

/** Converts a typed price when its mode flips, keeping what it means: average <-> total. Null when it cannot. */
export function convertPrice(part: MoneyPart, to: 'unit' | 'total'): number | null {
  if (part.mode === to) return part.price;
  const quantity = quantityOf(part);
  if (quantity === null || part.price == null || !Number.isFinite(part.price)) return null;
  return to === 'total' ? eurOf(partGross(part).cents) : round4(part.price / quantity);
}
