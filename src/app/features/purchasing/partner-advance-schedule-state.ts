import type { PartnerAdvanceSchedule, PartnerAdvanceScheduleRequest, PartnerAdvanceScheduleRow } from '../../core/api/models';

export interface AdvanceScheduleDraft {
  id?: number;
  label: string;
  mode: 'PERCENT' | 'AMOUNT';
  value: number;
  dueDate: string;
  /** A FIXED term: its invoice was issued, sent, paid or credited. It stays exactly as it is. */
  locked: boolean;
  fixedAmountEur?: number;
  /** A never-issued concept invoice on an open term: it follows the new split (same number), but the term cannot go. */
  conceptNumber?: string | null;
}

export const cents = (value: number): number => Math.round(value * 100) / 100;

/**
 * A term is FIXED when its invoice exists and is not a never-issued concept.
 * The server says so in `invoiceFixed`; an older backend does not, and then
 * any invoice fixes the term, as before.
 */
export function scheduleRowFixed(row: Pick<PartnerAdvanceScheduleRow, 'invoiceId' | 'invoiceFixed'>): boolean {
  if (row.invoiceId == null) return false;
  return typeof row.invoiceFixed === 'boolean' ? row.invoiceFixed : true;
}

export function scheduleDraft(rows: readonly PartnerAdvanceScheduleRow[]): AdvanceScheduleDraft[] {
  return rows.map((row) => {
    const fixed = scheduleRowFixed(row);
    return { id: row.id, label: row.label, mode: row.percentage == null ? 'AMOUNT' : 'PERCENT',
      value: row.percentage ?? row.amountEur, dueDate: row.dueDate ?? '', locked: fixed,
      ...(fixed ? { fixedAmountEur: row.amountEur } : {}),
      ...(!fixed && row.invoiceId != null ? { conceptNumber: row.invoiceNumber ?? '' } : {}) };
  });
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

const SHARE_LABEL = /^\s*(\d+\s*\/\s*\d+|\d+(?:[.,]\d+)?\s*%)\s*/;

/**
 * The label a re-split term keeps. A share-like label ('2/3 na productie',
 * '70% na productie') would lie about the new amount: it takes the given
 * label, else loses its share ('Na productie'). Own words stay.
 */
function resplitLabel(existing: string | undefined, given: string | undefined, position: number): string {
  const label = (existing ?? '').trim();
  if (label && !SHARE_LABEL.test(label)) return label;
  if (given?.trim()) return given.trim();
  const rest = label.replace(SHARE_LABEL, '').trim();
  return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : `Termijn ${position}`;
}

/**
 * Re-split what is not fixed yet. Fixed terms keep id and amount; the rest of
 * the agreed amount (minus reservations outside the plan) is split into
 * `parts` AMOUNT terms in cents, the last one taking the residual cent. The
 * open terms are reused in order (id, label, due date), so a concept invoice
 * follows its term with the same number; a term that carries a concept is
 * never dropped, so there are at least as many parts as such terms.
 */
export function resplitRemainder(rows: readonly AdvanceScheduleDraft[], agreedEur: number, reservedOutsideEur: number,
  parts: number, labels: readonly string[] = []): AdvanceScheduleDraft[] {
  const fixed = rows.filter((row) => row.locked);
  const open = rows.filter((row) => !row.locked);
  const withConcept = open.filter((row) => row.conceptNumber != null).length;
  const count = Math.max(Math.floor(Number.isFinite(parts) ? parts : 0), withConcept, 1);
  const fixedEur = fixed.reduce((sum, row) => sum + scheduleRowAmount(row, agreedEur), 0);
  const rest = cents(agreedEur - (Number.isFinite(reservedOutsideEur) ? reservedOutsideEur : 0) - fixedEur);
  const each = cents(rest / count);
  // Terms with a concept come first, then the others in their order, so a shorter plan drops only plain terms.
  const reusable = [...open.filter((row) => row.conceptNumber != null), ...open.filter((row) => row.conceptNumber == null)]
    .slice(0, count).sort((left, right) => open.indexOf(left) - open.indexOf(right));
  const split: AdvanceScheduleDraft[] = Array.from({ length: count }, (_, index) => {
    const previous = reusable[index];
    const value = index === count - 1 ? cents(rest - each * (count - 1)) : each;
    return {
      ...(previous?.id != null ? { id: previous.id } : {}),
      label: resplitLabel(previous?.label, labels[index], fixed.length + index + 1),
      mode: 'AMOUNT', value, dueDate: previous?.dueDate ?? '', locked: false,
      ...(previous?.conceptNumber != null ? { conceptNumber: previous.conceptNumber } : {}),
    };
  });
  return [...fixed, ...split];
}

const euroText = (value: number): string =>
  `€ ${Math.abs(value).toLocaleString('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** What is left to spread once the fixed terms and the reservations outside the plan are counted. */
export function scheduleRemainder(rows: readonly AdvanceScheduleDraft[], agreedEur: number, reservedOutsideEur = 0): { fixedEur: number; openEur: number; restEur: number; leftEur: number } {
  const amounts = scheduleRowAmounts(rows, agreedEur);
  const fixedEur = cents(rows.reduce((sum, row, index) => sum + (row.locked ? amounts[index] : 0), 0));
  const openEur = cents(rows.reduce((sum, row, index) => sum + (row.locked ? 0 : amounts[index]), 0));
  const restEur = cents(agreedEur - reservedOutsideEur - fixedEur);
  return { fixedEur, openEur, restEur, leftEur: cents(restEur - openEur) };
}

/**
 * Whether a draft adds or changes terms against the saved plan. Only then
 * does a plan with a fixed term have to spread the whole agreed amount;
 * merely dropping unused open terms (before a settlement) may leave part of
 * it unplanned, as the server allows.
 */
export function scheduleDraftChanges(draft: readonly AdvanceScheduleDraft[], saved: readonly PartnerAdvanceScheduleRow[]): boolean {
  const before = new Map(scheduleDraft(saved).map((row) => [row.id, row] as const));
  return draft.some((row) => {
    const previous = row.id == null ? undefined : before.get(row.id);
    return !previous || previous.label.trim() !== row.label.trim() || previous.mode !== row.mode
      || Math.abs(previous.value - row.value) > 1e-9 || (previous.dueDate || '') !== (row.dueDate || '');
  });
}

/** Once a term is fixed, the new split must spread the whole agreed amount: nothing may stay unplanned. */
export function remainderRequest(rows: readonly AdvanceScheduleDraft[], agreedEur: number, reservedOutsideEur = 0): PartnerAdvanceScheduleRequest {
  const request = scheduleRequest(rows, agreedEur, reservedOutsideEur);
  const { leftEur } = scheduleRemainder(rows, agreedEur, reservedOutsideEur);
  if (Math.abs(leftEur) >= .005) throw new Error(`Verdeel het resterende voorschot volledig: nog ${euroText(leftEur)} te verdelen.`);
  return request;
}
