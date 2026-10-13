import type { CompanyCost, SalesOrderView } from '../../core/api/models';
import type { ContainerPayable } from './payables';

/** A local document or agreed purchase term. EUR on a purchase term is a budget, not a supplier invoice. */
export interface BankAllocationTarget {
  key: string; kind: 'cost' | 'sales' | 'purchase'; id: number;
  title: string; party: string; reference: string; date: string;
  totalEur: number; openBankEur: number; paidEur: number; label: string;
  estimated: boolean; container?: ContainerPayable;
}

export function bankAllocationTargets(bankAmount: number, costs: readonly CompanyCost[], sales: readonly SalesOrderView[],
  containers: readonly ContainerPayable[], customerName: (id: number | null) => string,
  cash: (cost: CompanyCost) => number, open: (cost: CompanyCost) => number, purchaseIdentity: (id: number) => { party: string; date: string } = () => ({ party: '', date: '' })): BankAllocationTarget[] {
  const direction = Math.sign(bankAmount), rows: BankAllocationTarget[] = [];
  for (const cost of costs) {
    const total = cash(cost), remainder = open(cost);
    if (!cost.id || !total || -Math.sign(total) !== direction) continue;
    rows.push({ key: `cost:${cost.id}`, kind: 'cost', id: cost.id, title: cost.description, party: cost.party ?? '', reference: cost.reference ?? '', date: cost.date,
      totalEur: total, openBankEur: -remainder, paidEur: total - remainder,
      label: total < 0 ? 'Creditnota leverancier' : 'Factuur / uitgave', estimated: false });
  }
  for (const view of sales) {
    const order = view.order;
    if (!['FACTUUR', 'CREDITNOTA'].includes(order.docType ?? '') || ['CONCEPT', 'GEANNULEERD', 'AFGEWEZEN', 'VERLOPEN'].includes(order.status)) continue;
    if (direction > 0 && order.docType === 'CREDITNOTA') continue;
    const total = view.paymentSummary?.invoiceTotalEur ?? view.priced?.totals?.totalInclVat ?? 0;
    const available = direction > 0 ? view.paymentSummary?.remainingEur ?? Math.max(0, total) : view.paymentSummary?.refundableEur ?? 0;
    if (direction < 0 && available <= 0 && !(view.paymentSummary?.payments ?? []).some(payment => payment.amountEur < 0 && payment.offsetPaymentId == null)) continue;
    rows.push({ key: `sales:${order.id}`, kind: 'sales', id: order.id, title: order.number, party: customerName(order.customerId), reference: order.number, date: order.orderDate ?? '',
      totalEur: total, openBankEur: direction * Math.max(0, available), paidEur: Math.max(0, Math.abs(total) - available),
      label: direction < 0 ? 'Terugbetaling klant' : 'Verkoopfactuur', estimated: false });
  }
  if (direction < 0) for (const term of containers) {
    rows.push({ key: term.key, kind: 'purchase', id: term.orderId, title: term.alias || term.orderNumber, party: purchaseIdentity(term.orderId).party || term.orderNumber,
      reference: term.termLabel ?? ({ SUPPLIER: 'Leverancier', LOGISTICS: 'Douane & transport', SEPARATE: 'Inspectie & andere kosten', OTHER: 'Bijkomende kosten' }[term.payee]), date: purchaseIdentity(term.orderId).date,
      totalEur: term.plannedEur, openBankEur: -term.remainingEur, paidEur: term.paidEur, label: 'Inkoop / container', estimated: true, container: term });
  }
  return rows;
}

const normal = (text: string): string => text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('nl-BE');
export function filterBankAllocationTargets(rows: readonly BankAllocationTarget[], query: string, bank: { amountEur: number; counterparty?: string | null; reference?: string | null }): BankAllocationTarget[] {
  const terms = normal(query).split(/\s+/).filter(Boolean);
  const hint = normal([bank.counterparty, bank.reference].filter(Boolean).join(' '));
  const score = (row: BankAllocationTarget): number => Number(row.openBankEur !== 0) * 10
    + Number(Math.abs(Math.round(row.openBankEur * 100) - Math.round(bank.amountEur * 100)) <= 2) * 40
    + Number(row.reference.length > 3 && hint.includes(normal(row.reference))) * 30
    + Number(row.party.length > 3 && hint.includes(normal(row.party))) * 20;
  return rows.filter(row => {
    const text = normal([row.label, row.title, row.party, row.reference, row.date, row.date.split('-').reverse().join('/'), row.openBankEur ? 'open' : 'betaald',
      Math.abs(row.totalEur).toFixed(2), Math.abs(row.totalEur).toFixed(2).replace('.', ','), Math.abs(row.openBankEur).toFixed(2), Math.abs(row.openBankEur).toFixed(2).replace('.', ',')].join(' '));
    return terms.every(term => text.includes(term));
  }).sort((a, b) => score(b) - score(a) || b.date.localeCompare(a.date) || a.key.localeCompare(b.key));
}
