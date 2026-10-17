import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import type { LedgerSummary, PayeeLedger } from '../src/app/features/purchasing/purchase-payment-ledger.ts';
import type { NacalcHeadline } from '../src/app/features/purchasing/purchase-nacalc-metrics.ts';
import type { PurchaseOrder, PurchaseOrderView } from '../src/app/core/api/models.ts';
import {
  HANDOFF_MS, PHONE_TABS, STEP_BUTTON, actionsMenu, costsAppliedFor, costsSupersededFor, editNextStep, landedTile, linePriceText, nacalcGlance, parseTab,
  countWords, lineCount, paymentTile, paymentsDot, productsDot, progressSteps, readNextStep, replaceTabInUrl, rootSectionOf, statusLabel, statusTone, stepConfirm,
  stepTarget, stepToward, tabOfSection, tabParam, tabSegments, takeHandoff, unsavedSummary,
  type ActionsMenuState, type AskedStep, type PhoneTab, type StepHandoff,
} from '../src/app/features/purchasing/purchase-phone-model.ts';

/** The euro formatter writes a no-break space; the assertions read plain spaces. */
const plain = (value: string): string => value.replace(/ /g, ' ');
const PAYEES = { SUPPLIER: 'Leverancier', LOGISTICS: 'Douane & transport', SEPARATE: 'Inspectie & andere kosten', OTHER: 'Bijkomende kosten' };
const returned: unknown[] = [];
const seen = <T,>(value: T): T => { returned.push(value); return value; };

/* ---- tabs ------------------------------------------------------------- */

test('the tab survives the URL round trip; anything unknown is Overzicht, which stays out of the URL', () => {
  for (const tab of PHONE_TABS) assert.equal(parseTab(tabParam(tab.id)), tab.id);
  assert.equal(tabParam('overzicht'), null);
  assert.equal(tabParam('kosten'), 'kosten');
  for (const raw of [null, undefined, '', 'Kosten', 'betaling', 'overzicht']) assert.equal(parseTab(raw), 'overzicht');
  assert.deepEqual(PHONE_TABS.map((tab) => tab.id), ['overzicht', 'producten', 'kosten', 'betalingen', 'dossier']);
});

test('every section lands on its tab, and a tab root maps back to the same tab', () => {
  const table: Record<PhoneTab, string[]> = {
    overzicht: ['purchase-overview', 'purchase-order-section', 'purchase-receipt-section', 'purchase-actions-section'],
    producten: ['purchase-products-section', 'purchase-capacity-section'],
    kosten: ['purchase-costs-section', 'purchase-summary-section', 'purchase-result-section', 'purchase-payment-result'],
    betalingen: ['purchase-payments-section', 'purchase-partner-section', 'purchase-partner-payments', 'purchase-advance-invoices'],
    dossier: ['purchase-files-section', 'purchase-notes-section', 'purchase-reports-section'],
  };
  for (const [tab, ids] of Object.entries(table)) for (const id of ids) assert.equal(tabOfSection(id), tab, id);
  assert.equal(tabOfSection('purchase-somewhere-else'), 'overzicht');
  for (const tab of PHONE_TABS) {
    assert.equal(tabOfSection(rootSectionOf(tab.id)), tab.id);
    assert.equal(rootSectionOf(tabOfSection(rootSectionOf(tab.id))), rootSectionOf(tab.id));
  }
  assert.deepEqual(PHONE_TABS.map((tab) => rootSectionOf(tab.id)),
    ['purchase-overview', 'purchase-products-section', 'purchase-costs-section', 'purchase-payments-section', 'purchase-files-section']);
});

test('the segments keep the order, labels and icons, with a warn dot only where asked', () => {
  const none = seen(tabSegments({ producten: false, betalingen: false }));
  assert.deepEqual(none.map((s) => [s.id, s.label, s.icon, s.dot]), [
    ['overzicht', 'Overzicht', 'order', null], ['producten', 'Producten', 'products', null], ['kosten', 'Kosten', 'tag', null],
    ['betalingen', 'Betalingen', 'bank', null], ['dossier', 'Dossier', 'folder', null]]);
  const both = tabSegments({ producten: true, betalingen: true });
  assert.deepEqual(both.map((s) => s.dot), [null, 'warn', null, 'warn', null]);
  assert.equal(both.some((s) => s.count != null), false, 'no counts');
  assert.deepEqual(tabSegments({ producten: false, betalingen: true }).map((s) => s.dot), [null, null, null, 'warn', null]);
});

test('a warn dot is aria-hidden, so the tab says what it means; a tab without one keeps its plain name', () => {
  assert.equal(tabSegments({ producten: false, betalingen: false }).some((s) => 'ariaLabel' in s), false);
  assert.deepEqual(seen(tabSegments({ producten: true, betalingen: true })).map((s) => s.ariaLabel ?? null),
    [null, 'Producten, afwijkingen bij ontvangst', null, 'Betalingen, er is nu iets te betalen', null]);
  assert.deepEqual(tabSegments({ producten: false, betalingen: true }).map((s) => s.ariaLabel ?? null),
    [null, null, null, 'Betalingen, er is nu iets te betalen', null]);
});

type DotView = Pick<PurchaseOrderView, 'order' | 'receiptReports' | 'receiptVariance'>;
const line = (quantity: number, extra: Record<string, unknown> = {}) => ({ id: 1, productId: 10, quantity, exwPrice: null, exwCurrency: null,
  extraUnitCost: null, orderedQuantity: quantity, ...extra });
const dotView = (status: PurchaseOrder['status'], extra: Partial<DotView> = {}, lines = [line(100)]): DotView =>
  ({ order: { status, lines } as unknown as PurchaseOrder, ...extra });

test('Producten gets its dot after damage, a shortage or a report on a received container', () => {
  assert.equal(productsDot(dotView('ONTVANGEN', { receiptVariance: { affectedLines: 1 } as DotView['receiptVariance'] })), true);
  assert.equal(productsDot(dotView('ONTVANGEN', { receiptVariance: { affectedLines: 0 } as DotView['receiptVariance'] })), false);
  assert.equal(productsDot(dotView('ONTVANGEN', { receiptReports: [{ productName: 'Roos' }] as DotView['receiptReports'] })), true);
  assert.equal(productsDot(dotView('BESTELD', { receiptReports: [{ productName: 'Roos' }] as DotView['receiptReports'],
    receiptVariance: { affectedLines: 2 } as DotView['receiptVariance'] })), false, 'only once received');
  // Older orders without the server aggregate count their lines.
  assert.equal(productsDot(dotView('ONTVANGEN', {}, [line(100, { damagedQuantity: 2 })])), true);
  assert.equal(productsDot(dotView('ONTVANGEN', {}, [line(90, { orderedQuantity: 100 })])), true);
  assert.equal(productsDot(dotView('ONTVANGEN', {}, [line(100, { orderedQuantity: null })])), false);
  assert.equal(productsDot(dotView('ONTVANGEN', {}, [line(100)])), false);
});

test('Betalingen gets its dot when loaded payments have something due now', () => {
  assert.equal(paymentsDot({ dueNowEur: 120 }, 'ready'), true);
  assert.equal(paymentsDot({ dueNowEur: 120 }, 'refreshing'), true, 'a refresh keeps the figures on screen');
  assert.equal(paymentsDot({ dueNowEur: 120 }, 'loading'), false);
  assert.equal(paymentsDot({ dueNowEur: 120 }, 'error'), false);
  assert.equal(paymentsDot({ dueNowEur: 0 }, 'ready'), false);
  assert.equal(paymentsDot(null, 'ready'), false);
});

/* ---- summary card ------------------------------------------------------- */

test('status words and tones', () => {
  assert.deepEqual((['CONCEPT', 'BESTELD', 'ONDERWEG', 'ONTVANGEN'] as const).map((s) => [statusLabel(s), statusTone(s)]), [
    ['Concept', 'tone-grey'], ['Besteld', 'tone-accent'], ['Vertrokken', 'tone-blue'], ['Ontvangen', 'tone-ok']]);
});

test('the progress shows four steps with the day each was reached and the expected arrival', () => {
  const base = { orderDate: '2026-09-22', shippedOn: '2026-10-10', receivedOn: '2026-11-14', expectedArrival: '2026-11-20' };
  const steps = (status: PurchaseOrder['status'], extra: Partial<typeof base> = {}, created: string | null = '2026-09-18T08:00:00Z') =>
    seen(progressSteps({ ...base, ...extra, status }, created));
  assert.deepEqual(steps('CONCEPT').map((s) => [s.label, s.state, s.date, s.prefix]), [
    ['Concept', 'now', '2026-09-18T08:00:00Z', null], ['Besteld', 'todo', null, null], ['Vertrokken', 'todo', null, null],
    ['Ontvangen', 'todo', '2026-11-20', 'verwacht']]);
  assert.deepEqual(steps('BESTELD').map((s) => [s.state, s.date]), [
    ['done', '2026-09-18T08:00:00Z'], ['now', '2026-09-22'], ['todo', null], ['todo', '2026-11-20']]);
  assert.deepEqual(steps('ONDERWEG', { shippedOn: undefined }).map((s) => [s.state, s.date]), [
    ['done', '2026-09-18T08:00:00Z'], ['done', '2026-09-22'], ['now', null], ['todo', '2026-11-20']]);
  assert.deepEqual(steps('ONDERWEG').map((s) => s.date), ['2026-09-18T08:00:00Z', '2026-09-22', '2026-10-10', '2026-11-20']);
  const received = steps('ONTVANGEN', {}, null);
  assert.deepEqual(received.map((s) => [s.state, s.date, s.prefix]), [
    ['done', null, null], ['done', '2026-09-22', null], ['done', '2026-10-10', null], ['done', '2026-11-14', null]]);
  assert.deepEqual(steps('BESTELD', { expectedArrival: undefined }).at(-1), { label: 'Ontvangen', state: 'todo', date: null, prefix: null });
});

const payee = (kind: string, extra: Partial<PayeeLedger> = {}) =>
  ({ label: 'Leverancier', paidEur: 900, reviewEur: 0, higherEur: 40, status: { kind }, ...extra }) as unknown as PayeeLedger;
const summary = (kind: string, extra: Partial<LedgerSummary> = {}): LedgerSummary => ({
  dueNowEur: 29_889.3, openEur: 36_323.7, reviewEur: 0, paidTotalEur: 13_109.7, agreedEur: 49_433,
  headline: { kind, payee: null }, next: { payee: 'SUPPLIER', due: 'SHIPPED', label: '70% bij vertrek', amountEur: 29_889.3, now: true, when: 'nu' },
  ...extra,
}) as unknown as LedgerSummary;

test('the payment tile speaks the Betalingen headline, case by case', () => {
  const tile = (s: LedgerSummary | null, state: 'loading' | 'refreshing' | 'error' | 'ready' = 'ready') =>
    seen(paymentTile(s, state, '30% bij bestelling · 70% bij vertrek', PAYEES));
  assert.deepEqual(tile(summary('due'), 'loading'), { label: 'Betalingen', valueEur: null, sub: 'Bijwerken…', tone: 'neutral' });
  assert.deepEqual(tile(summary('due'), 'error'), { label: 'Betalingen', valueEur: null, sub: 'Opnieuw laden', tone: 'neutral' });
  assert.deepEqual(tile(null), { label: 'Betalingen', valueEur: null, sub: 'Bijwerken…', tone: 'neutral' });
  assert.deepEqual(tile(summary('due')), { label: 'Nu te betalen', valueEur: 29_889.3, sub: '70% bij vertrek · Leverancier', tone: 'warn' });
  assert.deepEqual(tile(summary('due'), 'refreshing').label, 'Nu te betalen');
  assert.equal(tile(summary('due', { next: null })).sub, '');
  assert.equal(tile(summary('due', { next: { payee: 'SEPARATE', due: null, label: 'Inspectie & andere kosten', amountEur: 300, now: true, when: 'nu' } })).sub,
    'Inspectie & andere kosten', 'a payee without terms is named once');
  assert.deepEqual(tile(summary('later', { next: { payee: 'LOGISTICS', due: null, label: 'Douane & transport', amountEur: 4_000, now: false, when: 'bij aankomst' } })),
    { label: 'Niets nu te betalen', valueEur: 36_323.7, sub: 'Volgende: Douane & transport · bij aankomst', tone: 'neutral' });
  assert.equal(tile(summary('later', { next: null })).sub, '');
  assert.deepEqual(tile(summary('done')), { label: 'Alles betaald', valueEur: 13_109.7, sub: '', tone: 'ok' });
  assert.deepEqual(tile(summary('concept')), { label: 'Nog niet besteld', valueEur: 49_433, sub: '30% bij bestelling · 70% bij vertrek', tone: 'neutral' });
  assert.deepEqual(tile(summary('empty')), { label: 'Nog geen bedragen', valueEur: null, sub: 'Voeg producten en kosten toe.', tone: 'neutral' });
});

test('the review tile follows the headline rule: without agreement, overpaid or incomplete', () => {
  const review = (p: PayeeLedger | null, reviewEur = 0) =>
    seen(paymentTile(summary('review', { headline: { kind: 'review', payee: p }, reviewEur }), 'ready', '', PAYEES));
  assert.deepEqual(review(payee('UNBUDGETED')), { label: 'Nakijken', valueEur: 900, sub: 'Leverancier: betaald zonder afspraak', tone: 'warn' });
  assert.deepEqual(review(payee('OVERPAID', { reviewEur: 12.5 })), { label: 'Nakijken', valueEur: 12.5, sub: 'Leverancier: te veel betaald', tone: 'warn' });
  assert.equal(review(payee('OVERPAID')).valueEur, 40, 'falls back on the higher amount');
  assert.deepEqual(review(payee('INCOMPLETE')), { label: 'Nakijken', valueEur: null, sub: 'Leverancier: bedragen onvolledig', tone: 'warn' });
  assert.deepEqual(review(null, 7), { label: 'Nakijken', valueEur: 7, sub: '', tone: 'warn' });
});

test('a line row states the agreed price, else the product card price in its own currency, never the converted costing figure', () => {
  const format = (value: number) => value.toFixed(3).replace('.', ',');
  // A CNY card at ¥70 on a line without its own price: never '¥ 9,800 afgesproken' (70 × 0.14 USD under the yuan sign).
  assert.equal(seen(linePriceText({ price: null, currency: 'CNY' }, { amount: 70, currency: 'CNY' }, format)), '¥ 70,000 kaartprijs');
  assert.equal(linePriceText({ price: undefined, currency: 'USD' }, { amount: 12.5, currency: 'EUR' }, format), '€ 12,500 kaartprijs',
    'the card keeps its own currency');
  assert.equal(linePriceText({ price: 2, currency: 'USD' }, { amount: 3, currency: 'USD' }, format), '$ 2,000 afgesproken', 'the order\'s own price wins');
  assert.equal(linePriceText({ price: 0, currency: 'CNY' }, { amount: 3, currency: 'USD' }, format), '¥ 0,000 afgesproken', 'zero is a price');
  assert.equal(linePriceText({ price: 64.5, currency: 'EUR' }, null, format), '€ 64,500 afgesproken');
  assert.equal(linePriceText({ price: null, currency: 'USD' }, null, format), null, 'neither: the row leaves the price out');
});

test('Totaal geland says what the road adds on top of the goods', () => {
  assert.deepEqual(seen(landedTile({ totalEur: 50_333, goodsEur: 42_655 }, false)), { valueEur: 50_333, sub: '+ 18 % op de goederen' });
  assert.deepEqual(landedTile({ totalEur: 50_333, goodsEur: 50_333 }, true), { valueEur: 50_333, sub: 'DDP · transport en rechten in de prijs' });
  assert.deepEqual(landedTile({ totalEur: 1_200, goodsEur: 0 }, false), { valueEur: 1_200, sub: 'nog geen goederen geladen' });
});

const head = (extra: Partial<NacalcHeadline> = {}): NacalcHeadline => ({
  kind: 'provisional', label: 'Verwachte eindkost', pill: { label: 'Voorlopig', tone: 'warn' }, sentence: 'Voorlopig · 3 ontvangers nog open',
  eindkostEur: 49_433, begrootEur: 49_433, verschilEur: 0, verschilPct: 0, reviewEur: 0, ...extra,
}) as unknown as NacalcHeadline;

test('the Nacalculatie glance: concept, zero, cheaper, dearer, a review and a missing percentage', () => {
  const concept = seen(nacalcGlance(head({ kind: 'concept', pill: { label: 'Concept', tone: 'outline' } as NacalcHeadline['pill'] })));
  assert.equal(concept.concept, true);
  assert.equal(concept.pillTone, 'wk-pill--outline');
  assert.equal(concept.sub, 'volgens de calculatie · nog niets betaald');
  assert.equal(concept.foot, 'De nacalculatie begint bij de bestelling: zodra betalingen genoteerd zijn, zie je hier wat de container echt kost.');
  const zero = seen(nacalcGlance(head()));
  assert.deepEqual([zero.concept, zero.label, zero.pill, zero.pillTone, zero.afspraakEur, plain(zero.verschilText), zero.verschilWords, zero.verschilTone, zero.sub, zero.foot],
    [false, 'Verwachte eindkost', 'Voorlopig', 'tone-warn', 49_433, '€ 0,00', 'geen verschil', 'none', '', 'Voorlopig · 3 ontvangers nog open']);
  // The trail holds the signed amount only; the percentage leads the words below it, so 390px never cuts it.
  const cheaper = seen(nacalcGlance(head({ eindkostEur: 49_383, verschilEur: -50, verschilPct: -0.5, pill: { label: 'Afgerond', tone: 'ok' } as NacalcHeadline['pill'] })));
  assert.deepEqual([plain(cheaper.verschilText), cheaper.verschilWords, cheaper.verschilTone, cheaper.pillTone], ['− € 50,00', '0,5 % goedkoper dan afgesproken', 'in', 'tone-ok']);
  const dearer = seen(nacalcGlance(head({ verschilEur: 120, verschilPct: 1.24 })));
  assert.deepEqual([plain(dearer.verschilText), dearer.verschilWords, dearer.verschilTone], ['+ € 120,00', '1,2 % duurder dan afgesproken', 'warn']);
  const large = nacalcGlance(head({ eindkostEur: 112_345.67, begrootEur: 100_000, verschilEur: 12_345.67, verschilPct: 12.345 }));
  assert.deepEqual([plain(large.verschilText), large.verschilWords], ['+ € 12.345,67', '12,3 % duurder dan afgesproken']);
  const review = seen(nacalcGlance(head({ reviewEur: 30 })));
  assert.deepEqual([plain(review.verschilWords), review.verschilTone], ['geen verschil · waarvan € 30,00 na te kijken', 'warn']);
  const dearerReview = nacalcGlance(head({ verschilEur: 120, verschilPct: 1.24, reviewEur: 30 }));
  assert.equal(plain(dearerReview.verschilWords), '1,2 % duurder dan afgesproken · waarvan € 30,00 na te kijken');
  const noPct = seen(nacalcGlance(head({ verschilEur: 1_250.5, verschilPct: null })));
  assert.equal(plain(noPct.verschilText), '+ € 1.250,50');
  assert.equal(noPct.verschilWords, 'duurder dan afgesproken');
  assert.equal(nacalcGlance(head({ pill: { label: 'Open', tone: 'neutral' } as unknown as NacalcHeadline['pill'] })).pillTone, '');
});

/* ---- the next step ------------------------------------------------------ */

test('the read view offers the status road, then the shelf, then the catalogue costs', () => {
  const read = (status: PurchaseOrder['status'], extra: Partial<Parameters<typeof readNextStep>[0]> = {}) =>
    readNextStep({ status, lineCount: 3, stockBooked: null, costsApplied: false, ...extra });
  assert.equal(read('CONCEPT'), 'BESTELLEN');
  assert.equal(read('BESTELD'), 'VERTROKKEN');
  assert.equal(read('ONDERWEG'), 'ONTVANGEN');
  assert.equal(read('ONTVANGEN', { stockBooked: false }), 'BIJBOEKEN');
  assert.equal(read('ONTVANGEN', { stockBooked: false, costsApplied: true }), 'BIJBOEKEN');
  assert.equal(read('ONTVANGEN'), 'KOSTPRIJZEN', 'stockBooked null on an old order means booked');
  assert.equal(read('ONTVANGEN', { stockBooked: true }), 'KOSTPRIJZEN');
  assert.equal(read('ONTVANGEN', { costsApplied: true }), null);
  assert.equal(read('ONTVANGEN', { superseded: true }), null, 'a newer container\'s costs are never pushed aside');
  for (const status of ['CONCEPT', 'BESTELD', 'ONDERWEG', 'ONTVANGEN'] as const) assert.equal(read(status, { lineCount: 0 }), null);
});

test('the editor offers the status road and the shelf; Kostprijzen stays under Acties', () => {
  const edit = (status: PurchaseOrder['status'], lineCount = 3, stockBooked: boolean | null = null) => editNextStep({ status, lineCount, stockBooked });
  assert.equal(edit('CONCEPT', 0), 'PRODUCTEN');
  assert.equal(edit('CONCEPT'), 'BESTELLEN');
  assert.equal(edit('BESTELD'), 'VERTROKKEN');
  assert.equal(edit('ONDERWEG'), 'ONTVANGEN');
  assert.equal(edit('ONTVANGEN', 3, false), 'BIJBOEKEN');
  assert.equal(edit('ONTVANGEN', 3, null), null);
  assert.equal(edit('ONTVANGEN', 3, true), null);
  assert.deepEqual(Object.values(STEP_BUTTON), ['Bestellen', 'Container vertrokken', 'Container ontvangen', 'Voorraad bijboeken', 'Kostprijzen toepassen']);
  assert.deepEqual((['BESTELLEN', 'VERTROKKEN', 'ONTVANGEN', 'BIJBOEKEN', 'KOSTPRIJZEN'] as const).map(stepTarget), ['BESTELD', 'ONDERWEG', 'ONTVANGEN', null, null]);
  assert.deepEqual(['BESTELD', 'ONDERWEG', 'ONTVANGEN', 'CONCEPT', null].map(stepToward), ['BESTELLEN', 'VERTROKKEN', 'ONTVANGEN', null, null]);
});

test('every step asks first, in exactly these words', () => {
  const ctx = { number: 'PO-2026-047', planLabel: '30% bij bestelling · 70% bij vertrek', location: 'Magazijn Gent', dirty: false };
  const ask = (step: AskedStep, extra: Partial<typeof ctx> = {}) => seen(stepConfirm(step, { ...ctx, ...extra }));
  assert.deepEqual(ask('BESTELLEN'), { title: 'Bestellen?', confirmLabel: 'Ja, bestellen', tracking: false, dirtyNote: false,
    message: 'PO-2026-047 gaat van Concept naar Besteld. Betalingen volgen vanaf nu het betaalplan: 30% bij bestelling · 70% bij vertrek.' });
  assert.deepEqual(ask('VERTROKKEN'), { title: 'Container vertrokken?', confirmLabel: 'Ja, vertrokken', tracking: true, dirtyNote: false,
    message: 'Zet dit pas als het schip echt vaart: PO-2026-047 gaat naar Vertrokken, de volgende betaling valt en de tracking start.' });
  assert.deepEqual(ask('ONTVANGEN'), { title: 'Container ontvangen?', confirmLabel: 'Ontvangst tellen', tracking: false, dirtyNote: false,
    message: 'Je telt eerst per product wat er echt in de container zat. Pas als je die telling bevestigt, gaat PO-2026-047 naar Ontvangen.' });
  assert.deepEqual(ask('BIJBOEKEN'), { title: 'Voorraad bijboeken?', confirmLabel: 'Bijboeken', tracking: false, dirtyNote: false,
    message: 'Ontvangen min beschadigd gaat nu in de voorraad op Magazijn Gent.' });
  // Kostprijzen toepassen asks in the cost history round's sheet in the editor, never here.
  assert.deepEqual((['BESTELLEN', 'VERTROKKEN', 'ONTVANGEN', 'BIJBOEKEN'] as const).map((step) => ask(step, { dirty: true }).dirtyNote),
    [true, true, true, true], 'the steps that save the draft say so');
});

test('a handoff is taken only for its order, within thirty seconds, and only once', async () => {
  const offered: StepHandoff = { orderId: 50, step: 'VERTROKKEN', tracking: 'MSKU 7741203', tab: 'kosten', at: 1_000_000 };
  assert.equal(takeHandoff(offered, 50, 1_000_000), offered);
  assert.equal(takeHandoff(offered, 50, 1_000_000 + HANDOFF_MS), offered);
  assert.equal(takeHandoff(offered, 51, 1_000_000), null, 'another order');
  assert.equal(takeHandoff(offered, 50, 1_000_000 + HANDOFF_MS + 1), null, 'older than 30 s');
  assert.equal(takeHandoff(offered, 50, 999_999), null, 'a timestamp from the future');
  assert.equal(takeHandoff(null, 50, 1_000_000), null);
  // The root service around it: its decorator and import dropped, takeHandoff handed in.
  const source = await readFile(new URL('../src/app/features/purchasing/purchase-step-handoff.ts', import.meta.url), 'utf8');
  const parsed = ts.createSourceFile('purchase-step-handoff.ts', source, ts.ScriptTarget.Latest, true);
  const original = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'PurchaseStepHandoff');
  assert.ok(original);
  const isolated = ts.factory.updateClassDeclaration(original, original.modifiers?.filter((modifier) => !ts.isDecorator(modifier)),
    original.name, original.typeParameters, undefined, original.members);
  const javascript = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: Record<string, new () => any> = {};
  vm.runInNewContext(javascript, { exports, takeHandoff });
  const service = new exports['PurchaseStepHandoff']();
  service.offer(offered);
  assert.equal(service.take(51, 1_000_100), null, 'another order leaves it waiting');
  assert.equal(service.take(50, 1_000_100), offered);
  assert.equal(service.take(50, 1_000_200), null, 'consumed once');
  service.offer(offered);
  assert.equal(service.take(51, 1_000_000 + HANDOFF_MS + 5), null);
  service.offer({ ...offered, at: 2_000_000 });
  assert.equal(service.take(50, 2_000_000)?.at, 2_000_000, 'a stale handoff was dropped, a new one replaces it');
  service.offer(offered);
  assert.equal(service.take(51, 1_000_000 + HANDOFF_MS + 5), null);
  assert.equal(service.take(50, 1_000_000), null, 'the stale one was cleared on the way');
  // Waiting is a look, never a take; discard drops only this order's handoff.
  service.offer(offered);
  assert.equal(service.waiting(51, 1_000_100), false);
  assert.equal(service.waiting(50, 1_000_000 + HANDOFF_MS + 1), false, 'stale');
  assert.equal(service.waiting(50, 1_000_100), true);
  assert.equal(service.waiting(50, 1_000_100), true, 'still waiting');
  service.discard(51);
  assert.equal(service.waiting(50, 1_000_100), true, 'another order\'s editor leaves it');
  service.discard(50);
  assert.equal(service.waiting(50, 1_000_100), false);
  assert.equal(service.take(50, 1_000_100), null, 'a discarded step never runs');
});

test('costs count as applied when a product carries this container\'s number; a newer container supersedes', () => {
  const lines = [{ productId: 1 }, { productId: 2 }];
  const products = (sources: (string | null)[]) => sources.map((source, index) => ({ id: index + 1, landedCostSource: source }));
  assert.equal(costsAppliedFor(lines, products(['PO-2026-047', null]), 'PO-2026-047'), true);
  assert.equal(costsAppliedFor(lines, products(['PO-2026-046', null]), 'PO-2026-047'), false);
  assert.equal(costsAppliedFor(lines, [], 'PO-2026-047'), false);
  assert.equal(costsSupersededFor(lines, products(['PO-2026-048', null]), 'PO-2026-047'), true);
  assert.equal(costsSupersededFor(lines, products(['PO-2026-1000', null]), 'PO-2026-047'), true, 'numbers compare as numbers');
  assert.equal(costsSupersededFor(lines, products(['PO-2026-046', 'PO-2026-047']), 'PO-2026-047'), false);
  assert.equal(costsSupersededFor(lines, products(['handmatig', 'INK/9']), 'PO-2026-047'), false, 'sources that do not compare keep the rule');
});

/* ---- Acties ------------------------------------------------------------- */

const menuState = (extra: Partial<ActionsMenuState> = {}): ActionsMenuState => ({
  status: 'BESTELD', step: 'ONDERWEG', lineCount: 3, stockBooked: null, costsApplied: false, partner: false, canQuote: true,
  dirty: false, saving: false, booking: false, deleting: false, stepBackBusy: false, ...extra,
});

test('Acties holds the old Afronden card and Meer acties, in order, per status', () => {
  const ids = (extra: Partial<ActionsMenuState>) => seen(actionsMenu(menuState(extra))).map((item) => item.id);
  assert.deepEqual(ids({ status: 'CONCEPT', step: 'BESTELD' }), ['next', 'apply', 'quote', 'copy', 'pdf', 'delete']);
  assert.deepEqual(ids({}), ['next', 'apply', 'quote', 'copy', 'pdf', 'step-back', 'delete']);
  assert.deepEqual(ids({ status: 'ONDERWEG', step: 'ONTVANGEN' }), ['next', 'apply', 'quote', 'copy', 'pdf', 'step-back', 'delete']);
  assert.deepEqual(ids({ status: 'ONTVANGEN', step: null, stockBooked: false }), ['book', 'apply', 'quote', 'copy', 'pdf']);
  assert.deepEqual(ids({ status: 'ONTVANGEN', step: null, stockBooked: null }), ['apply', 'quote', 'copy', 'pdf']);
  const labels = (extra: Partial<ActionsMenuState>) => actionsMenu(menuState(extra)).map((item) => item.label);
  assert.equal(labels({ status: 'CONCEPT', step: 'BESTELD' })[0], 'Bestellen');
  assert.equal(labels({})[0], 'Container vertrokken');
  assert.equal(labels({ status: 'ONDERWEG', step: 'ONTVANGEN' })[0], 'Container ontvangen');
  assert.ok(labels({ partner: true }).includes('Conceptvoorschotfacturen maken'));
  assert.ok(labels({}).includes('Verkoopofferte maken'));
  assert.ok(labels({ costsApplied: true }).includes('Opnieuw kostprijzen toepassen'));
  const menu = actionsMenu(menuState());
  const item = (id: string, items = menu) => items.find((entry) => entry.id === id)!;
  assert.equal(item('step-back').label, 'Status terugzetten…');
  assert.equal(item('delete').danger, true);
  assert.equal(item('delete').label, 'Calculatie verwijderen');
  assert.match(item('delete').hint!, /Tijdelijk verwijderen\. Herstellen kan via Instellingen → Beheer → Verwijderde items\./);
  assert.deepEqual(menu.map((entry) => entry.iconName), ['truck', 'tag', 'sales', 'copy', 'pdf', 'restore', 'trash']);
  const disabled = (extra: Partial<ActionsMenuState>) => Object.fromEntries(actionsMenu(menuState(extra)).map((entry) => [entry.id, !!entry.disabled]));
  assert.deepEqual(disabled({}), { next: false, apply: false, quote: false, copy: false, pdf: false, 'step-back': false, delete: false });
  assert.deepEqual(disabled({ saving: true, canQuote: false, stepBackBusy: true }),
    { next: true, apply: false, quote: true, copy: false, pdf: false, 'step-back': true, delete: true });
  assert.equal(disabled({ deleting: true }).delete, true);
  assert.equal(disabled({ status: 'ONTVANGEN', step: null, stockBooked: false, booking: true }).book, true);
});

/* ---- the save bar --------------------------------------------------------- */

const LABELS = { seaFreight: 'Zeevracht', origin: 'Kosten in China', destination: 'Kosten in Antwerpen' };
const saved = (): PurchaseOrder => ({
  id: 50, number: 'PO-2026-047', alias: 'Rozen najaar', supplierId: 7, orderDate: '2026-09-22', status: 'BESTELD', containerType: 'FORTY_HC',
  cnyToUsd: 0.14, usdToEurGoods: 0.86, usdToEurTransport: 0.86, freightUsd: 4_200, originCosts: 300, originCurrency: 'USD', destinationCostsEur: 650,
  defaultDutyRatePct: 4, extraRevenueEur: 0, allocFreight: 'CBM', allocOrigin: 'CBM', allocDestination: 'CBM', allocExtra: 'PIECES',
  departurePort: 'Ningbo', destinationPort: 'Antwerpen', notes: '',
  lines: [
    { id: 1, productId: 10, quantity: 2_000, exwPrice: 9.3, exwCurrency: 'USD', extraUnitCost: null, orderedQuantity: 2_000, priceBasis: 'EXW' },
    { id: 2, productId: 11, quantity: 1_000, exwPrice: null, exwCurrency: null, extraUnitCost: null, orderedQuantity: 1_000, priceBasis: 'EXW' },
  ],
}) as PurchaseOrder;

test('the save bar names what is not saved yet', () => {
  const summarise = (change: (order: PurchaseOrder) => PurchaseOrder) => seen(unsavedSummary(saved(), change(saved()), LABELS));
  assert.equal(unsavedSummary(saved(), saved(), LABELS), '');
  assert.equal(unsavedSummary(null, saved(), LABELS), '');
  assert.equal(summarise((o) => ({ ...o, freightUsd: 4_400 })), 'Zeevracht gewijzigd');
  assert.equal(summarise((o) => ({ ...o, usdToEurGoods: 0.87, usdToEurTransport: 0.87 })), 'USD naar EUR gewijzigd', 'one row, two fields');
  assert.equal(summarise((o) => ({ ...o, alias: '' })), 'Herkenbare naam gewijzigd');
  assert.equal(summarise((o) => ({ ...o, notes: 'Afspraak', orderDate: '2026-09-23' })), 'Orderdatum en Dagboek gewijzigd', 'table order');
  assert.equal(summarise((o) => ({ ...o, notes: 'x', freightUsd: 1, trackingReference: 'MSKU' })), '3 wijzigingen');
  assert.equal(summarise((o) => ({ ...o, lines: [o.lines[0], { ...o.lines[1], quantity: 1_200 }] })), '1 regel aangepast');
  assert.equal(summarise((o) => ({ ...o, lines: [{ ...o.lines[0], quantity: 1 }] })), '2 regels aangepast', 'a change and a removal');
  assert.equal(summarise((o) => ({ ...o, freightUsd: 1, lines: [...o.lines, { ...o.lines[1], id: null, productId: 12 }] })), 'Zeevracht en 1 regel gewijzigd');
  assert.equal(summarise((o) => ({ ...o, lines: o.lines.map((l) => ({ ...l, priceBasis: 'DDP' as const })) })), 'Prijsbasis en munt gewijzigd');
  assert.equal(summarise((o) => ({ ...o, freightViaSupplier: true })), 'Prijsbasis en munt gewijzigd');
  assert.equal(summarise((o) => ({ ...o, lines: o.lines.map((l) => ({ ...l, exwCurrency: 'CNY' as const })) })), 'Prijsbasis en munt gewijzigd');
  assert.equal(summarise((o) => ({ ...o, allocExtra: 'MANUAL' as const, extraRevenueEur: 300,
    lines: o.lines.map((l) => ({ ...l, extraShareEur: 150 })) })), 'Enrosed kost en Verdeelsleutels gewijzigd', 'a split by hand is the Enrosed kost');
  assert.equal(summarise((o) => ({ ...o, allocFreight: 'VALUE' as const, groupVariants: false })), 'Verdeelsleutels gewijzigd');
  assert.equal(summarise((o) => ({ ...o, paymentTerms: 'CUSTOM' as PurchaseOrder['paymentTerms'], payPctOrdered: 50 })), 'Betaalplan gewijzigd');
  assert.equal(summarise((o) => ({ ...o, originCurrency: 'CNY' as const })), 'Kosten in China gewijzigd');
  assert.equal(summarise((o) => ({ ...o, status: 'ONDERWEG' as const })), 'Wijzigingen klaar', 'a difference no row names');
});

/* ---- the URL ------------------------------------------------------------ */

test('the tab is written into the URL in place: other params stay, a used deep link goes', () => {
  const location = (url: string) => {
    const calls: unknown[][] = [];
    return { calls, path: (includeHash?: boolean) => { calls.push(['path', includeHash]); return url; },
      replaceState: (path: string, query?: string, state?: unknown) => calls.push(['replace', path, query, state]),
      getState: () => ({ navigationId: 7 }) };
  };
  const a = location('/purchasing/14?section=ledger&payee=SUPPLIER&due=SHIPPED&terms=edit&tab=kosten');
  replaceTabInUrl(a, 'dossier');
  assert.deepEqual(a.calls, [['path', false], ['replace', '/purchasing/14', 'terms=edit&tab=dossier', { navigationId: 7 }]]);
  const b = location('/purchasing/14/edit?tab=kosten');
  replaceTabInUrl(b, 'overzicht');
  assert.deepEqual(b.calls.at(-1), ['replace', '/purchasing/14/edit', '', { navigationId: 7 }]);
  const c = location('/purchasing/14');
  replaceTabInUrl(c, 'betalingen');
  assert.deepEqual(c.calls.at(-1), ['replace', '/purchasing/14', 'tab=betalingen', { navigationId: 7 }]);
});

/* ---- words ---------------------------------------------------------------- */

test('nothing the module can say uses "begroot"', async () => {
  const source = await readFile(new URL('../src/app/features/purchasing/purchase-phone-model.ts', import.meta.url), 'utf8');
  const words: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node)
      || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) words.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile('purchase-phone-model.ts', source, ts.ScriptTarget.Latest, true));
  assert.ok(words.length > 50);
  assert.deepEqual(words.filter((word) => /begroot/i.test(word)), []);
  assert.ok(returned.length > 20);
  assert.doesNotMatch(JSON.stringify(returned), /begroot/i);
  for (const step of ['BESTELLEN', 'VERTROKKEN', 'ONTVANGEN', 'BIJBOEKEN'] as const) {
    assert.doesNotMatch(JSON.stringify(stepConfirm(step, { number: 'X', planLabel: 'Y', location: 'Z', dirty: true })), /begroot/i);
  }
});

test('the count word follows what the container holds: Stuks, Displays or Eenheden (Inkoop redesign F18)', () => {
  assert.deepEqual(countWords('DISPLAY'), { label: 'Displays', plural: 'displays', short: 'displays' });
  assert.deepEqual(countWords('MIXED'), { label: 'Eenheden', plural: 'stuks en displays', short: 'eenheden' });
  assert.deepEqual(countWords('PIECE'), { label: 'Stuks', plural: 'stuks', short: 'st' });
  assert.deepEqual(countWords(undefined), { label: 'Stuks', plural: 'stuks', short: 'st' }, 'an older server without setBasis counts pieces');
  assert.equal(lineCount(1), '1 regel');
  assert.equal(lineCount(0), '0 regels');
  assert.equal(lineCount(12), '12 regels');
});

test('one counting word per container: no container total says stuks, st or regels on its own (F18)', async () => {
  const read = (name: string) => readFile(new URL(`../src/app/features/purchasing/${name}`, import.meta.url), 'utf8');
  for (const name of ['purchase-desk.ts', 'purchase-view.ts', 'purchase-editor.ts']) {
    const source = await read(name);
    assert.doesNotMatch(source, /data\.costing\.totals\.pieces \| num \}\} (st|stuks)\b/, `${name}: the container's pieces in countWords`);
    assert.doesNotMatch(source, /data\.costing\.totals\.pieces \| num\) \+ ' st'/, `${name}: the phone Lading tile too`);
    assert.doesNotMatch(source, /lines\.length \}\} regels/, `${name}: lineCount, so one line reads '1 regel'`);
  }
});
