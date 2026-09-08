import type { PartnerSettlementAvailability } from '../../core/api/models';

const money = (value: number): number => Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100;

/** Reserve only this batch's remaining cost and proportional uncredited advances. */
export function partialSettlementPreview(
  availability: PartnerSettlementAvailability,
  quantities: Readonly<Record<number, number>>,
  proceeds: Readonly<Record<number, number>>,
  profitSharePct: number,
) {
  const rows = availability.lines.map((line) => {
    const quantity = Math.max(0, Math.min(line.remainingQuantity, Math.floor(quantities[line.productId] ?? 0)));
    const costEur = quantity === line.remainingQuantity ? line.remainingCostEur
      : line.remainingQuantity > 0 ? money(line.remainingCostEur * quantity / line.remainingQuantity) : 0;
    const proceedsEur = quantity > 0 ? money(proceeds[line.productId] ?? 0) : 0;
    const profitEur = money(proceedsEur - costEur);
    const profitShareEur = money(profitEur * Math.max(0, Math.min(100, profitSharePct)) / 100);
    return { productId: line.productId, quantity, costEur, proceedsEur, profitEur, profitShareEur, revenueEur: money(costEur + profitShareEur) };
  });
  const sum = (key: 'quantity' | 'costEur' | 'revenueEur' | 'profitShareEur') => money(rows.reduce((total, row) => total + row[key], 0));
  const quantity = sum('quantity');
  const remainingQuantity = availability.lines.reduce((total, line) => total + line.remainingQuantity, 0);
  const remainingCostEur = money(availability.lines.reduce((total, line) => total + line.remainingCostEur, 0));
  const costEur = sum('costEur');
  const finalSettlement = quantity > 0 && quantity === remainingQuantity;
  const advanceEur = finalSettlement ? availability.remainingAdvanceEur
    : remainingCostEur > 0 ? money(availability.remainingAdvanceEur * costEur / remainingCostEur) : 0;
  const revenueEur = sum('revenueEur');
  return { rows, quantity, costEur, revenueEur, profitShareEur: sum('profitShareEur'), advanceEur,
    netEur: money(revenueEur - advanceEur), finalSettlement, remainingQuantity: remainingQuantity - quantity };
}
