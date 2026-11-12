import type { PartnerReportPart, StaffPartnerReport } from '../../core/api/partner-sales-api';
import { STATUS_LABEL, STATUS_TONE, count, reportKind, KIND_SHORT } from '../partner/partner-format';

/**
 * The staff page's words and sums for meldingen (Veilingverkopen). Pure; the
 * labels and number formats are the partner portal's own (partner-format.ts),
 * so Frans and staff read the same words.
 */

/** "VV-12 · Veiling". */
export function reportTitle(report: StaffPartnerReport): string {
  return `${report.number} · ${KIND_SHORT[reportKind(report)]}`;
}

/** Commission, transport and extra kost together (the terugkoop stays apart). */
export function costsOf(report: StaffPartnerReport): number {
  const t = report.totals;
  return Math.round(((t.commissionEur || 0) + (t.transportEur || 0) + (t.extraCostEur || 0)) * 100) / 100;
}

/**
 * The average per sales unit when the melding sold one product; across
 * several products an average says nothing (each has its own in the details).
 */
export function singleAverage(report: StaffPartnerReport): number | null {
  const sales = report.entries.filter((entry) => entry.sale);
  return sales.length === 1 ? sales[0].sale!.unitPriceEur : null;
}

/** The invoices the parts went on, each once, in the order they appear. */
export function invoicesOf(report: StaffPartnerReport): { id: number; number: string }[] {
  const seen = new Map<number, string>();
  for (const part of report.parts ?? []) {
    if (part.invoiceId != null && !part.open && !seen.has(part.invoiceId)) {
      seen.set(part.invoiceId, part.invoiceNumber || `#${part.invoiceId}`);
    }
  }
  return [...seen].map(([id, number]) => ({ id, number }));
}

/** The status pill: Nog te factureren, Deels gefactureerd, Gefactureerd · F-…, Ingetrokken. */
export function statusPill(report: StaffPartnerReport): { label: string; tone: string } {
  const invoices = invoicesOf(report);
  const label = report.status === 'INVOICED' && invoices.length === 1
    ? `${STATUS_LABEL.INVOICED} · ${invoices[0].number}`
    : STATUS_LABEL[report.status];
  return { label, tone: STATUS_TONE[report.status] };
}

export interface PartGroup {
  key: string;
  /** The container's name, or "Eigen voorraad". */
  label: string;
  purchaseOrderId: number | null;
  parts: PartnerReportPart[];
}

/** The parts by source: the containers in the order they were filled, our own stock last. */
export function partsBySource(report: StaffPartnerReport): PartGroup[] {
  const groups = new Map<string, PartGroup>();
  for (const part of report.parts ?? []) {
    const key = part.purchaseOrderId == null ? 'own' : `po-${part.purchaseOrderId}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        label: part.purchaseOrderId == null ? 'Eigen voorraad' : part.containerName || `Container #${part.purchaseOrderId}`,
        purchaseOrderId: part.purchaseOrderId,
        parts: [],
      };
      groups.set(key, group);
    }
    group.parts.push(part);
  }
  return [...groups.values()].sort((a, b) => (a.purchaseOrderId == null ? 1 : 0) - (b.purchaseOrderId == null ? 1 : 0));
}

export interface ReportDay {
  day: string;
  reports: StaffPartnerReport[];
  /** Netto of the meldingen that still count (not ingetrokken). */
  netEur: number;
}

/** Meldingen by the day they sold, newest day first; within a day as the server sent them (newest first). */
export function groupByDay(reports: readonly StaffPartnerReport[]): ReportDay[] {
  const days = new Map<string, ReportDay>();
  for (const report of reports) {
    let day = days.get(report.soldOn);
    if (!day) { day = { day: report.soldOn, reports: [], netEur: 0 }; days.set(report.soldOn, day); }
    day.reports.push(report);
    if (report.status !== 'VOIDED') day.netEur = Math.round((day.netEur + (report.totals.netEur || 0)) * 100) / 100;
  }
  return [...days.values()].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
}

/** "100 stuks" in the melding's own unit when all its products share one, else stuks. */
export function quantityText(report: StaffPartnerReport, quantity: number): string {
  const first = report.entries[0];
  const same = first && report.entries.every((entry) => entry.unitOther === first.unitOther);
  return `${count(quantity)} ${same ? (quantity === 1 ? first.unitOne : first.unitOther) : 'stuks'}`;
}

/** "14:05" of an instant, on this device's clock. */
export function timeOf(iso: string | null | undefined): string {
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** Who entered it: the partner's person, or the staff member who typed in what Frans phoned in. */
export function whoOf(report: StaffPartnerReport): string {
  return report.createdByName?.trim() || report.createdBy?.trim() || '';
}
