import type { PartnerReportPart, StaffPartnerReport } from '../../core/api/partner-sales-api';
import { KIND_SHORT, reportKind } from '../partner/partner-format';

/**
 * The staff page's words for meldingen (Veilingverkopen). Pure; the labels
 * are the partner portal's own (partner-format.ts), so Frans and staff read
 * the same words. Filters, sums and dates: partner-sales-filters.ts.
 */

/** "VV-12 · Veiling". */
export function reportTitle(report: StaffPartnerReport): string {
  return `${report.number} · ${KIND_SHORT[reportKind(report)]}`;
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
