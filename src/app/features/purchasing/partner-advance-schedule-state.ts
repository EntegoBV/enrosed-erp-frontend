import type { PartnerAdvanceSchedule, PartnerAdvanceScheduleRequest, PartnerAdvanceScheduleRow } from '../../core/api/models';

export interface AdvanceScheduleDraft {
  id?: number;
  label: string;
  mode: 'PERCENT' | 'AMOUNT';
  value: number;
  dueDate: string;
  locked: boolean;
  fixedAmountEur?: number;
}

export const cents = (value: number): number => Math.round(value * 100) / 100;

export function scheduleDraft(rows: readonly PartnerAdvanceScheduleRow[]): AdvanceScheduleDraft[] {
  return rows.map((row) => ({ id: row.id, label: row.label, mode: row.percentage == null ? 'AMOUNT' : 'PERCENT',
    value: row.percentage ?? row.amountEur, dueDate: row.dueDate ?? '', locked: row.invoiceId != null,
    ...(row.invoiceId != null ? { fixedAmountEur: row.amountEur } : {}) }));
}

/** Only recreating an unused legacy plan may adopt the current purchase basis. */
export function shouldRecalculateLegacySchedule(plan: PartnerAdvanceSchedule | null): boolean {
  return !!plan && plan.financingBasis !== 'PURCHASE_TOTAL_WITH_SEPARATE_COSTS'
    && !plan.invoicingBlocked && !(plan.reservedOutsideScheduleEur > 0)
    && plan.rows.every(row => row.invoiceId == null);
}

/** Preview a new agreement without writing or changing any linked invoice. */
export function recreatedScheduleDraft(plan: PartnerAdvanceSchedule, agreedEur: number): AdvanceScheduleDraft[] {
  const rows = scheduleDraft(plan.rows);
  if (!shouldRecalculateLegacySchedule(plan)) return rows;
  if (!rows.length) return schedulePreset('30_70', agreedEur);
  if (rows.every(row => row.mode === 'PERCENT')) return rows;
  const previous = plan.agreedAmountEur;
  if (!(previous > 0) || !Number.isFinite(agreedEur) || agreedEur < 0) return rows;
  // The thirds preset uses amounts to avoid rounding a percentage approximation.
  if (rows.length === 2 && rows.every(row => row.mode === 'AMOUNT')
      && rows[0].label.trim().toLowerCase() === '1/3 bij start productie'
      && rows[1].label.trim().toLowerCase() === '2/3 na productie'
      && rows[0].value === cents(previous / 3) && rows[1].value === cents(previous - rows[0].value)) {
    const first = cents(agreedEur / 3);
    return rows.map((row, index) => ({ ...row, value: index === 0 ? first : cents(agreedEur - first) }));
  }
  // Custom fixed amounts are an explicit choice; the user must complete their new allocation.
  return rows;
}

export function schedulePreset(preset: '30_70' | 'THIRDS' | 'FULL', agreedEur: number): AdvanceScheduleDraft[] {
  const row = (label: string, mode: AdvanceScheduleDraft['mode'], value: number): AdvanceScheduleDraft => ({ label, mode, value, dueDate: '', locked: false });
  if (preset === 'FULL') return [row('Volledige financiering', 'PERCENT', 100)];
  if (preset === 'THIRDS') {
    const first = cents(agreedEur / 3);
    return [row('1/3 bij start productie', 'AMOUNT', first), row('2/3 na productie', 'AMOUNT', cents(agreedEur - first))];
  }
  return [row('30% bij start productie', 'PERCENT', 30), row('70% na productie', 'PERCENT', 70)];
}

export function scheduleRowAmount(row: AdvanceScheduleDraft, agreedEur: number): number {
  if (row.locked && row.fixedAmountEur != null) return row.fixedAmountEur;
  return cents(row.mode === 'PERCENT' ? agreedEur * row.value / 100 : row.value);
}

/** A 100% percentage plan consumes the exact agreed cents; linked invoices stay fixed. */
export function scheduleRowAmounts(rows: readonly AdvanceScheduleDraft[], agreedEur: number): number[] {
  const amounts = rows.map((row) => scheduleRowAmount(row, agreedEur));
  if (rows.length && rows.every((row) => row.mode === 'PERCENT')
      && Math.abs(rows.reduce((total, row) => total + row.value, 0) - 100) < .0000001) {
    let index = rows.length - 1;
    while (index >= 0 && rows[index].locked) index -= 1;
    if (index >= 0) amounts[index] = cents(amounts[index] + agreedEur - amounts.reduce((total, amount) => total + amount, 0));
  }
  return amounts;
}

export function scheduleRequest(rows: readonly AdvanceScheduleDraft[], agreedEur: number, reservedOutsideEur = 0, allowEmpty = false): PartnerAdvanceScheduleRequest {
  if (!rows.length && !allowEmpty) throw new Error('Voeg minstens één factuurtermijn toe.');
  for (const row of rows) {
    if (!row.label.trim()) throw new Error('Geef elke termijn een duidelijke naam.');
    if (!Number.isFinite(row.value) || row.value <= 0 || row.mode === 'PERCENT' && row.value > 100) throw new Error('Vul voor elke termijn een positief bedrag of percentage tot 100% in.');
    if (row.mode === 'PERCENT' && Math.abs(row.value * 10000 - Math.round(row.value * 10000)) > .00001) throw new Error('Percentages mogen maximaal vier decimalen hebben.');
    if (row.mode === 'AMOUNT' && Math.abs(row.value * 100 - Math.round(row.value * 100)) > .00001) throw new Error('Bedragen mogen maximaal twee decimalen hebben.');
    if (row.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(row.dueDate)) throw new Error('Vul een geldige vervaldatum in.');
  }
  const amounts = scheduleRowAmounts(rows, agreedEur);
  if (amounts.some((amount) => amount < .01)) throw new Error('Elke factuurtermijn moet na afronding minstens € 0,01 zijn.');
  const allocated = cents(amounts.reduce((sum, amount) => sum + amount, 0));
  if (allocated + reservedOutsideEur > cents(agreedEur) + .005) throw new Error('De factuurtermijnen en bestaande voorschotten overschrijden de afgesproken partnerfinanciering.');
  return { rows: rows.map((row) => ({ ...(row.id == null ? {} : { id: row.id }), label: row.label.trim(),
    ...(row.mode === 'PERCENT' ? { percentage: row.value } : { amountEur: cents(row.value) }), dueDate: row.dueDate || null })) };
}

/** Invoice creation allocates the complete positive advance across distinct draft invoices. */
export function advanceInvoiceScheduleRequest(rows: readonly AdvanceScheduleDraft[], agreedEur: number): PartnerAdvanceScheduleRequest {
  if (!Number.isFinite(agreedEur) || agreedEur <= 0) throw new Error('De afgesproken bijdrage is ongeldig.');
  const request = scheduleRequest(rows, agreedEur);
  const allocated = cents(scheduleRowAmounts(rows, agreedEur).reduce((sum, amount) => sum + amount, 0));
  if (allocated !== cents(agreedEur)) throw new Error('Verdeel de afgesproken bijdrage volledig over de betaaltermijnen voordat je de conceptfacturen maakt.');
  return request;
}
