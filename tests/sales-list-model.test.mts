import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countText, customerSections, documentSub, foldText, invoiceOverdue, listCaption, listMoney, matchesWords, paymentCell, salesTone, statusParts,
  type ListReceivable, type StatusFacts,
} from '../src/app/features/sales/sales-list-model.ts';
import type { SalesOrderView } from '../src/app/core/api/models.ts';
import type { SalesListEntry } from '../src/app/features/sales/sales-list-groups.ts';

/*
 * The Verkoop list on the Inkoop recipe (2026-10-19): the pure part of the
 * desk list. One group per customer on top of the container and split
 * groups, the money of the subbar and the group heads, the status line,
 * the Betaling cell and the captions.
 */
const TODAY = '2026-10-19';

function doc(id: number, changes: Record<string, unknown> = {}, view: Record<string, unknown> = {}): SalesOrderView {
  return {
    order: { id, number: `F-${id}`, docType: 'FACTUUR', status: 'VERZONDEN', customerId: 7, orderDate: '2026-10-01', validUntil: '2026-11-01',
      invoiceDueDate: '2026-10-31', ...changes },
    priced: { totals: { total: 100, totalInclVat: 121, pieces: 12 }, lines: [] }, awaitingResend: false, ...view,
  } as unknown as SalesOrderView;
}
/** Each test names what finance says is open on a row: remaining, received and credit by id. */
const money = (open: Record<number, Partial<ListReceivable>>) => (row: SalesOrderView): ListReceivable =>
  ({ receivedEur: 0, remainingEur: 0, creditEur: 0, ...open[row.order.id] });
const single = (row: SalesOrderView): SalesListEntry => ({ kind: 'DOCUMENT', key: `document-${row.order.id}`, row });

test('the open money counts issued invoices only; overdue is the part past its due date; credit notes add their tegoed', () => {
  const rows = [
    doc(1), doc(2, { invoiceDueDate: '2026-10-01' }), doc(3, { status: 'CONCEPT' }), doc(4, { status: 'GEANNULEERD' }),
    doc(5, { docType: 'CREDITNOTA', status: 'UITGEREIKT' }), doc(6, { docType: 'CREDITNOTA', status: 'CONCEPT' }),
    doc(7, { invoiceDueDate: '2026-10-01', status: 'BETAALD' }),
  ];
  const sums = listMoney(rows, money({ 1: { remainingEur: 120.1 }, 2: { remainingEur: 60.25 }, 3: { remainingEur: 999 }, 4: { remainingEur: 999 },
    5: { creditEur: 40 }, 6: { creditEur: 999 }, 7: { remainingEur: 0 } }), TODAY);
  assert.deepEqual(sums, { openEur: 180.35, overdueEur: 60.25, overdueCount: 1, tegoedEur: 40, offerEur: 0 });
});

test('the offer value is the live offers not invoiced yet, excl. btw; a paid invoice past its day is not overdue', () => {
  const offer = (id: number, changes = {}, view = {}) => doc(id, { docType: 'OFFERTE', status: 'VERZONDEN', ...changes }, view);
  const sums = listMoney([offer(1), offer(2, { status: 'CONCEPT' }), offer(3, { status: 'AFGEWEZEN' }), offer(4, {}, { invoicedAs: 'F-9', invoicedAsId: 9 }),
    doc(5, { invoiceDueDate: '2026-10-01' })], money({ 5: { remainingEur: 0, receivedEur: 121 } }), TODAY);
  assert.equal(sums.offerEur, 200);
  assert.equal(sums.overdueCount, 0);
  assert.equal(sums.openEur, 0);
});

test('one section per customer in list order; partner and split groups count their members and stay inside', () => {
  const a = doc(1, { customerId: 7 }), b = doc(2, { customerId: 8 }), c = doc(3, { customerId: 7 }), d = doc(4, { customerId: null });
  const container = { kind: 'PARTNER_CONTAINER', key: 'container-45-customer-8', customerId: 8, rows: [doc(5, { customerId: 8 }), doc(6, { customerId: 8 })] } as unknown as SalesListEntry;
  const split = { kind: 'SPLIT_ORDER', key: 'split-g-7', rows: [doc(7, { customerId: 7 }), doc(8, { customerId: 7 })] } as unknown as SalesListEntry;
  const names: Record<string, string> = { 7: 'Bloemen Jansen', 8: 'Café Brel' };
  const sections = customerSections([single(a), single(b), container, single(c), split, single(d)], (id) => names[String(id)] ?? 'Geen klant',
    money({ 1: { remainingEur: 10 }, 5: { remainingEur: 5 } }), TODAY);
  assert.deepEqual(sections.map((section) => [section.id, section.name, section.count]), [[7, 'Bloemen Jansen', 4], [8, 'Café Brel', 3], [0, 'Geen klant', 1]]);
  assert.deepEqual(sections[0].entries.map((entry) => entry.key), ['document-1', 'document-3', 'split-g-7'], 'entries keep their order inside the customer');
  assert.equal(sections[1].money.openEur, 5, 'the container members count towards their customer');
  assert.equal(sections[0].money.openEur, 10);
});

test('the status class reads as a kit tone', () => {
  assert.deepEqual(['ok', 'danger', 'gold', 'rose', 'blue', 'neutral', 'warn', 'credit', undefined].map(salesTone),
    ['tone-ok', 'tone-danger', 'tone-amber', 'tone-accent', 'tone-blue', 'tone-grey', 'tone-warn', 'tone-plum', 'tone-grey']);
});

test('the status line: geldig tot on a sent offer, vervalt while money is open, the website and delivery facts', () => {
  const facts = (changes: Partial<StatusFacts> = {}): StatusFacts => ({
    order: { docType: 'FACTUUR', status: 'VERZONDEN', validUntil: '2026-11-01', invoiceDueDate: '2026-10-01' }, invoiced: false, remainingEur: 50, overdue: true,
    webOrder: false, webPill: null, websiteRequest: false, delivery: null, shipped: false, unavailable: 0, ...changes,
  });
  assert.deepEqual(statusParts(facts()), [{ text: 'vervalt 01/10/2026', cls: 'danger' }]);
  assert.deepEqual(statusParts(facts({ overdue: false })), [{ text: 'vervalt 01/10/2026', cls: '' }]);
  assert.deepEqual(statusParts(facts({ remainingEur: 0 })), [], 'a paid invoice has no due date to watch');
  assert.deepEqual(statusParts(facts({ order: { docType: 'OFFERTE', status: 'BEKEKEN', validUntil: '2026-11-01', invoiceDueDate: null } })),
    [{ text: 'geldig tot 01/11/2026', cls: '' }]);
  assert.deepEqual(statusParts(facts({ order: { docType: 'OFFERTE', status: 'VERZONDEN', validUntil: '2026-11-01', invoiceDueDate: null }, invoiced: true })), []);
  assert.deepEqual(statusParts(facts({ remainingEur: 0, webOrder: true, webPill: { label: 'Klant kan nog wijzigen', cls: 'gold' },
    delivery: { part: 2, label: 'Wacht op voorraad', cls: 'gold' }, unavailable: 2 })).map((part) => part.text),
    ['Websitebestelling', 'Klant kan nog wijzigen', 'Deel 2 · Wacht op voorraad', '2 producten niet beschikbaar']);
  assert.deepEqual(statusParts(facts({ remainingEur: 0, websiteRequest: true, shipped: true })),
    [{ text: 'Websiteaanvraag', cls: '' }, { text: 'Bestelling verzonden', cls: 'ok' }]);
});

test('the Betaling cell: nothing on an offer, the concept, open with what came in, settled, the credit note its own line', () => {
  const cell = (docType: string, status: string, remainingEur = 0, receivedEur = 0, overdue = false) =>
    paymentCell({ docType: docType as never, status: status as never }, { remainingEur, receivedEur }, overdue);
  assert.equal(cell('OFFERTE', 'VERZONDEN', 50).state, 'none');
  assert.equal(cell('FACTUUR', 'CONCEPT', 50).state, 'concept');
  assert.equal(cell('CREDITNOTA', 'UITGEREIKT').state, 'credit');
  assert.equal(cell('CREDITNOTA', 'CONCEPT').state, 'concept');
  assert.equal(cell('FACTUUR', 'GEANNULEERD', 50).state, 'none');
  assert.deepEqual(cell('FACTUUR', 'VERZONDEN', 60.255, 20, true), { state: 'open', openEur: 60.26, receivedEur: 20, overdue: true });
  assert.deepEqual(cell('FACTUUR', 'BETAALD', 0, 121, true), { state: 'settled', openEur: 0, receivedEur: 121, overdue: false });
});

test('the Document sub names the linked documents as text', () => {
  assert.equal(documentSub({ kind: 'Verkoopfactuur', date: '2026-10-18', sourceQuote: 'ENR-2026-0041' }), 'Verkoopfactuur · 18/10/2026 · uit ENR-2026-0041');
  assert.equal(documentSub({ kind: 'Offerte', date: '2026-10-18', invoicedAs: 'F-2026-0007' }), 'Offerte · 18/10/2026 · factuur F-2026-0007');
  assert.equal(documentSub({ kind: 'Creditnota', date: '2026-10-18', creditedInvoice: 'F-2026-0007', creditReason: 'Retour' }), 'Creditnota · 18/10/2026 · op F-2026-0007 · Retour');
  assert.equal(documentSub({ kind: 'Offerte', date: null, creditReason: 'Retour' }), 'Offerte', 'a reason only with the invoice it credits');
});

test('the phone caption: the tab in singular or plural, Facturen with what is to receive, narrowed n van m', () => {
  assert.equal(listCaption('OFFERTE', 1, 1, false, 0), '1 offerte');
  assert.equal(listCaption('OFFERTE', 3, 3, false, 0), '3 offertes');
  assert.equal(listCaption('FACTUUR', 1, 1, false, 0), '1 factuur');
  assert.match(listCaption('FACTUUR', 5, 5, false, 2480), /^5 facturen · €\s2\.480 te ontvangen$/);
  assert.equal(listCaption('ARCHIEF', 11, 11, false, 300), '11 in het archief');
  assert.match(listCaption('FACTUUR', 2, 5, true, 120.4), /^2 van 5 · €\s120 open$/);
  assert.equal(listCaption('OFFERTE', 0, 3, true, 0), '0 van 3');
  assert.equal(countText(1, 'document', 'documenten'), '1 document');
});

test('the search folds accents and wants every word', () => {
  assert.equal(foldText('  Café BREL '), 'cafe brel');
  assert.equal(matchesWords('Café Brel ENR-2026-0041 PO-45', 'cafe 0041'), true);
  assert.equal(matchesWords('Café Brel ENR-2026-0041', 'cafe 0042'), false);
  assert.equal(matchesWords('anything', '   '), true);
});

test('an invoice is overdue only while issued and past its day', () => {
  assert.equal(invoiceOverdue({ docType: 'FACTUUR', status: 'UITGEREIKT', invoiceDueDate: '2026-10-18' }, TODAY), true);
  assert.equal(invoiceOverdue({ docType: 'FACTUUR', status: 'VERZONDEN', invoiceDueDate: TODAY }, TODAY), false, 'the due day itself is not late');
  assert.equal(invoiceOverdue({ docType: 'FACTUUR', status: 'BETAALD', invoiceDueDate: '2026-10-01' }, TODAY), false);
  assert.equal(invoiceOverdue({ docType: 'OFFERTE', status: 'VERZONDEN', invoiceDueDate: '2026-10-01' }, TODAY), false);
});
