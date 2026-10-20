import assert from 'node:assert/strict';
import test from 'node:test';
import {
  containerHead, containerHint, containerPill, countText, customerSections, documentSub, foldText, invoiceOverdue, listCaption, listMoney, matchesWords,
  paymentCell, phoneLines, roundedAway, salesTone, splitHead, statusParts, trailEuro,
  type ListReceivable, type StatusFacts,
} from '../src/app/features/sales/sales-list-model.ts';
import type { SalesOrderView } from '../src/app/core/api/models.ts';
import type { SalesContainerGroup, SalesContainerStatus, SalesListEntry, SalesSplitGroup } from '../src/app/features/sales/sales-list-groups.ts';

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

/** Intl writes a no-break space after the euro sign: compare with plain spaces. */
const plain = (text: string): string => text.replace(/\u00a0/g, ' ');

test('the phone row: the facts line keeps the web and delivery facts, the trail what is open, a tegoed or the day', () => {
  const open = { state: 'open', overdue: true, openEur: 1234.56 } as const, none = { state: 'none', overdue: false, openEur: 0 } as const;
  const vervalt = { text: 'vervalt 01/10/2026', cls: 'danger' }, web = { text: 'Websitebestelling', cls: '' }, part = { text: 'Deel 2 · Wacht op voorraad', cls: 'gold' };
  const lines = phoneLines([vervalt, web, part], open, null);
  assert.deepEqual({ ...lines, trail: { ...lines.trail, text: plain(lines.trail.text) } },
    { facts: [web, part], trail: { kind: 'open', text: '€ 1.235 open', overdue: true }, unshown: 'vervalt 01/10/2026' }, 'the due day goes to the menu hint');
  assert.deepEqual(phoneLines([{ text: 'geldig tot 01/11/2026', cls: '' }], none, null),
    { facts: [], trail: { kind: 'day', text: 'geldig tot 01/11/2026', overdue: false }, unshown: null });
  const credit = { state: 'credit', overdue: false, openEur: 0 } as const;
  const tegoed = phoneLines([], credit, 1300.4).trail;
  assert.deepEqual({ ...tegoed, text: plain(tegoed.text) }, { kind: 'credit', text: '€ 1.300 tegoed', overdue: false }, 'only what the credit note still holds');
  assert.deepEqual(phoneLines([], credit, 0).trail, { kind: 'none', text: '', overdue: false }, "settled: the pill says 'Afgehandeld', no 'verrekend · afgehandeld' beside it");
  assert.deepEqual(phoneLines([{ text: 'Bestelling verzonden', cls: 'ok' }], { state: 'settled', overdue: false, openEur: 0 }, null),
    { facts: [{ text: 'Bestelling verzonden', cls: 'ok' }], trail: { kind: 'none', text: '', overdue: false }, unshown: null });
  assert.equal(phoneLines([], { state: 'concept', overdue: false, openEur: 0 }, 250).trail.kind, 'none', 'a concept credit note has no tegoed line yet');
});

test('a phone trail reads whole euros, under one euro with its cents; roundedAway tells the hint to give the exact figure', () => {
  assert.deepEqual([24519.9, 18846.43, 7000, 0.4, -0.4, 0, 0.995].map((value) => plain(trailEuro(value))),
    ['€ 24.520', '€ 18.846', '€ 7.000', '€ 0,40', '€ -0,40', '€ 0', '€ 1']);
  assert.deepEqual([24519.9, 7000, 0.4, 0, -18846.43].map(roundedAway), [true, false, false, false, true]);
});

/* ---- the phone's partner-container and split-order heads */
const status = (label: string, cls: string, count = 1, changes: Partial<SalesContainerStatus> = {}): SalesContainerStatus =>
  ({ label, cls, count, concept: false, inactive: false, ...changes });
function container(rows: SalesOrderView[], summary: Partial<SalesContainerGroup['summary']> = {}): SalesContainerGroup {
  return { kind: 'PARTNER_CONTAINER', key: 'container-45-customer-7', purchaseOrderId: 45, customerId: 7, purchaseOrderName: 'Rose Amor - Cullinan',
    purchaseOrderNumber: 'PO-2026-011', rows, summary: { count: rows.length, totalEur: 0, draftCount: 0, draftEur: 0, issuedCount: rows.length, inactiveCount: 0,
      statuses: [], receivedEur: 0, remainingEur: 0, creditEur: 0, attentionCount: 0, containerPieces: null, ...summary } };
}
const noReasons = (): string[] => [];

test('one pill for the members: all settled Betaald, any concept Concept, else the most frequent; a tie goes to what still asks', () => {
  assert.deepEqual(containerPill([status('Afgehandeld', 'ok'), status('Betaald', 'ok')]), { label: 'Betaald', cls: 'ok' }, 'Half Heart Mix');
  assert.deepEqual(containerPill([status('Betaald', 'ok'), status('Geannuleerd', 'neutral', 1, { inactive: true })]), { label: 'Betaald', cls: 'ok' }, 'cancelled members stand aside');
  assert.deepEqual(containerPill([status('Concept', 'neutral', 1, { concept: true }), status('Betaald', 'ok', 2)]), { label: 'Concept', cls: 'neutral' });
  assert.deepEqual(containerPill([status('Uitgereikt', 'rose', 2), status('Deels betaald', 'gold')]), { label: 'Uitgereikt', cls: 'rose' });
  assert.deepEqual(containerPill([status('Betaald', 'ok'), status('Tegoed open', 'gold')]), { label: 'Tegoed open', cls: 'gold' });
  assert.deepEqual(containerPill([status('Gecrediteerd', 'neutral'), status('Afgehandeld', 'ok')]), { label: 'Gecrediteerd', cls: 'neutral' }, 'settled without a payment: list order');
  assert.deepEqual(containerPill([status('Geannuleerd', 'neutral', 2, { inactive: true })]), { label: 'Geannuleerd', cls: 'neutral' });
  assert.equal(containerPill([]), null);
});

test('a partner container head: its documents in the sub, the total in trail euros, what is open or one pill, the amber line', () => {
  const paid = doc(1, { status: 'BETAALD' }), open = doc(2, { invoiceDueDate: '2026-10-01' }), note = doc(3, { docType: 'CREDITNOTA', status: 'BETAALD' });
  const reasons = (row: SalesOrderView): string[] => (row.order.id === 2 ? ['Betaling opvolgen', 'Vervallen'] : []);
  const busy = containerHead(container([paid, open], { totalEur: 36290.55, statuses: [status('Betaald', 'ok'), status('Verzonden', 'rose')] }),
    money({ 2: { remainingEur: 18145.27 } }), TODAY, reasons);
  assert.deepEqual({ ...busy, total: plain(busy.total), status: busy.status && { ...busy.status, text: plain(busy.status.text) } }, {
    sub: 'Partnercontainer · 2 facturen', total: '€ 36.291',
    status: { kind: 'open', text: '€ 18.145 open', cls: '', overdue: true }, attention: { count: 2, text: 'Betaling opvolgen · Vervallen' },
  }, 'anything open: the amount, warn once overdue; no pill beside it; the amber line as the member cell reads it');
  const settled = containerHead(container([note, paid], { totalEur: 7941.14, statuses: [status('Afgehandeld', 'ok'), status('Betaald', 'ok')] }),
    money({}), TODAY, noReasons);
  assert.equal(settled.sub, 'Partnercontainer · 2 documenten', 'a credit note among them: documenten');
  assert.deepEqual(settled.status, { kind: 'pill', text: 'Betaald', cls: 'ok', overdue: false });
  assert.equal(settled.attention, null);
  assert.equal(containerHead(container([paid], { statuses: [status('Betaald', 'ok')] }), money({}), TODAY, noReasons).sub, 'Partnercontainer · 1 factuur');
  assert.equal(plain(containerHead(container([note], { totalEur: -991.1 }), money({}), TODAY, noReasons).total), '− € 991', 'a negative sum reads as a credit total');
});

test('the amber line of a head counts every task of its members and names each reason once', () => {
  const overdue = doc(1, { invoiceDueDate: '2026-10-01' }), late = doc(2, { invoiceDueDate: '2026-10-02' }), note = doc(3, { docType: 'CREDITNOTA', status: 'UITGEREIKT' });
  const reasons = (row: SalesOrderView): string[] => (row.order.docType === 'CREDITNOTA' ? ['Tegoed af te handelen'] : ['Betaling opvolgen']);
  const head = (rows: SalesOrderView[]) => containerHead(container(rows), money({ 1: { remainingEur: 500 }, 2: { remainingEur: 400 }, 3: { creditEur: 800 } }), TODAY, reasons);
  assert.deepEqual(head([overdue, note]).attention, { count: 2, text: 'Betaling opvolgen · Tegoed af te handelen' }, 'one invoice to chase, one tegoed: both named');
  assert.deepEqual(head([overdue, late]).attention, { count: 2, text: 'Betaling opvolgen' }, 'two invoices to chase');
});

test('nothing open but a credit note still holds a tegoed: the head says the tegoed, never Betaald beside the amber tegoed task', () => {
  const rows = [doc(1, { status: 'BETAALD' }), doc(2, { status: 'BETAALD' }), doc(3, { docType: 'CREDITNOTA', status: 'UITGEREIKT' })];
  const entry = container(rows, { totalEur: 12000, statuses: [status('Betaald', 'ok', 2), status('Tegoed open', 'gold')], creditEur: 800 });
  const receivable = money({ 1: { receivedEur: 6000 }, 2: { receivedEur: 6000 }, 3: { creditEur: 800 } });
  const head = containerHead(entry, receivable, TODAY, (row) => (row.order.id === 3 ? ['Tegoed af te handelen'] : []));
  assert.deepEqual({ ...head.status!, text: plain(head.status!.text) }, { kind: 'tegoed', text: '€ 800 tegoed', cls: '', overdue: false });
  assert.deepEqual(head.attention, { count: 1, text: 'Tegoed af te handelen' });
  assert.deepEqual(containerHint(entry, receivable, TODAY).map(plain), ['2 betaald, 1 tegoed open'], 'the menu adds the members, not the tegoed again');
  assert.deepEqual(containerHint({ ...entry, summary: { ...entry.summary, creditEur: 800.5 } }, money({ 3: { creditEur: 800.5 } }), TODAY).map(plain),
    ['2 betaald, 1 tegoed open', '€ 800,50 tegoed', 'incl. btw'], 'the exact tegoed when the head rounded it');
});

test('the container menu hint holds what the head leaves out: exact total, the statuses with the concept share, the pieces, the money in', () => {
  const hint = (summary: Partial<SalesContainerGroup['summary']>, rows = [doc(1), doc(2)], open: Record<number, Partial<ListReceivable>> = {}) =>
    containerHint(container(rows, summary), money(open), TODAY).map(plain);
  assert.deepEqual(hint({ totalEur: 24519.9, statuses: [status('Betaald', 'ok', 2)], containerPieces: 1968, receivedEur: 24519.9 }),
    ['€ 24.519,90 excl. btw', '1.968 stuks in container', '€ 24.519,90 ontvangen', 'incl. btw'], 'one status: the pill says it');
  assert.deepEqual(hint({ totalEur: 7000, draftCount: 1, draftEur: 3000, statuses: [status('Concept', 'neutral', 1, { concept: true }), status('Verzonden', 'rose'),
    status('Geannuleerd', 'neutral', 1, { inactive: true })], remainingEur: 4840.5, creditEur: 991.1 }),
  ['1 concept (€ 3.000,00), 1 verzonden, 1 geannuleerd (buiten totaal)', '€ 4.840,50 open', '€ 991,10 tegoed', 'incl. btw'],
  'the concept share on its own status, said once');
  assert.deepEqual(hint({ totalEur: 7941, remainingEur: 7941, statuses: [status('Uitgereikt · niet gemaild', 'rose')] }, [doc(1, { status: 'UITGEREIKT' })], { 1: { remainingEur: 7941 } }),
    ['1 uitgereikt (niet gemaild)'], "the head shows '€ x open' and no pill: the one status reads here; whole amounts the trail shows exactly stay out");
  assert.deepEqual(hint({ totalEur: 7941, remainingEur: 3000, receivedEur: 4941, statuses: [status('Betaald', 'ok'), status('Uitgereikt · niet gemaild', 'rose')] },
    [doc(1, { status: 'BETAALD' }), doc(2, { status: 'UITGEREIKT' })], { 2: { remainingEur: 3000 } }),
  ['1 betaald, 1 uitgereikt (niet gemaild)', '€ 4.941,00 ontvangen', 'incl. btw'], "a label's own ' · ' never reads as a fact of its own");
  const note = doc(3, { docType: 'CREDITNOTA', status: 'BETAALD' });
  assert.deepEqual(hint({ totalEur: -6374.71, statuses: [status('Afgehandeld', 'ok')] }, [note]), ['− € 6.374,71 excl. btw'], 'signed as the head writes it');
  assert.deepEqual(hint({ totalEur: -1999.5, draftCount: 1, draftEur: -3000, statuses: [status('Concept', 'neutral', 1, { concept: true }), status('Betaald', 'ok')] },
    [doc(1, { status: 'BETAALD' }), doc(2, { docType: 'CREDITNOTA', status: 'CONCEPT' })]), ['− € 1.999,50 excl. btw', '1 concept (− € 3.000,00), 1 betaald']);
});

test('a split order head: n delen and its pieces, the delivery in one pill in the desk order, the amber line over its parts', () => {
  const split = (summary: Partial<SalesSplitGroup['summary']>, rows = [doc(1), doc(2)]): SalesSplitGroup => ({ kind: 'SPLIT_ORDER', key: 'split-g-7', groupId: 'g',
    rootOrderId: 1, rows, summary: { parts: 2, totalEur: 1200.4, pieces: 240, unavailableCount: 0, waitingCount: 0, shippedCount: 0, ...summary } });
  const pill = (summary: Partial<SalesSplitGroup['summary']>) => splitHead(split(summary), noReasons).status?.text;
  const head = splitHead(split({}), (row) => (row.order.id === 2 ? ['Bestelling nog te verzenden'] : []));
  assert.deepEqual({ ...head, total: plain(head.total) }, { sub: 'Gesplitste order · 2 delen · 240 stuks', total: '€ 1.200',
    status: { kind: 'pill', text: 'Leveringen gepland', cls: 'blue', overdue: false }, attention: { count: 1, text: 'Bestelling nog te verzenden' } });
  assert.equal(splitHead(split({ parts: 1, pieces: 1240 }), noReasons).sub, 'Gesplitste order · 1 van 2 delen · 1.240 stuks');
  assert.equal(splitHead(split({ pieces: 0 }), noReasons).sub, 'Gesplitste order · 2 delen');
  assert.deepEqual([pill({ unavailableCount: 2, waitingCount: 1 }), pill({ waitingCount: 1, shippedCount: 1 }), pill({ shippedCount: 1 }), pill({ shippedCount: 2 }), pill({ pieces: 0 })],
    ['2 niet beschikbaar', 'Wacht op voorraad', 'Deels verzonden', 'Verzonden', undefined]);
  const parts = [doc(1, { goodsShippedAt: '2026-10-14T10:00:00Z' }, { fulfillment: { part: 1, status: 'SHIPPED' } }),
    doc(2, {}, { fulfillment: { part: 2, status: 'WAITING_FOR_STOCK' } })];
  assert.equal(splitHead(split({ waitingCount: 1, shippedCount: 1 }, parts), noReasons).status?.text, 'Deel 2 wacht op voorraad', 'one part shipped: the pill names the part that waits');
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
