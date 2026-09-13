export type ContainerMarkupUnit = 'PERCENT' | 'EUR_PER_UNIT';

export function validContainerMarkup(value: number | null, unit: ContainerMarkupUnit): boolean {
  return value !== null && Number.isFinite(value) && value >= 0
    && (unit !== 'EUR_PER_UNIT' || Math.abs(value * 10000 - Math.round(value * 10000)) < 0.00001);
}

/** Cost quote preview uses the same four-decimal product prices as the sales API. */
export function containerQuoteUnitPrice(cost: number, markup: number, unit: ContainerMarkupUnit): number {
  const price = unit === 'EUR_PER_UNIT' ? cost + markup : cost * (1 + markup / 100);
  return Math.round((price + Number.EPSILON * Math.max(1, price)) * 10000) / 10000;
}

export function containerQuoteLineTotal(unitPrice: number, quantity: number): number {
  const total = unitPrice * quantity;
  return Math.round((total + Number.EPSILON * Math.max(1, total)) * 100) / 100;
}

/** The API rounds the aggregate product amount, not each displayed row first. */
export function containerQuoteSubtotal(lines: readonly { unitPrice: number; quantity: number }[]): number {
  const total = lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  return containerQuoteLineTotal(total, 1);
}
