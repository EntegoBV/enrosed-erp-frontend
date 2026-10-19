import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  splitChoiceText, splitChoices, splitNextPart, splitRowPayee, splitSpread, splitStart, splitTarget, splitWeight, type SplitContainer, type SplitOpenPayment,
} from '../src/app/features/finance/container-split-rows.ts';
import type { ContainerPayable } from '../src/app/features/finance/payables.ts';
import { splitCents } from '../src/app/features/purchasing/purchase-payment-share.ts';

/*
 * Kosten & bank "Verdelen over containers" (Emre, 2026-10-16): a ticked
 * container starts on what the transfer paid there, an open payment of the
 * transfer's payee before a new one, never another payee's payment; the
 * select shows the row's own choice; the larger-transaction question offers
 * the split first and chooses nothing beforehand.
 */

const plain = (text: string) => text.replace(/[  ]/g, ' ');
const term = (orderId: number, payee: ContainerPayable['payee'], due: ContainerPayable['due'], remaining: number, planned = remaining,
  label: string | null = due === 'ORDERED' ? '30% bij bestelling' : due === 'SHIPPED' ? '70% bij vertrek' : null): ContainerPayable => ({
  key: `container:${orderId}:${payee}${due ? ':' + due : ''}`, orderId, orderNumber: `PO-2026-0${orderId}`, alias: null, status: 'BESTELD', archived: false, payee,
  termLabel: label, due, plannedEur: planned, paidEur: planned - remaining, remainingEur: remaining, bucket: 'now', whenLabel: 'nu', invoiceNumber: null, viaSupplier: false,
});
const pay = (id: number, payee: SplitOpenPayment['payee'], due: SplitOpenPayment['due'], amountEur: number, label: string | null = null,
  paidOn = '2026-09-25'): SplitOpenPayment => ({ id, payee, due, amountEur, label, paidOn, currency: 'EUR', amount: amountEur });
const container = (orderId: number, terms: ContainerPayable[], open: SplitOpenPayment[]): SplitContainer =>
  ({ orderId, number: `PO-2026-0${orderId}`, alias: null, supplier: 'Yunnan Pubei Flowers Co., Ltd', supplierId: 8, terms, open });

test("the first container starts on the supplier's term or its noted payment, never on an older transport payment", () => {
  // PO-038: an older open transport payment of € 300 and its open 30 % term (the review's example).
  const po38 = container(38, [term(38, 'SUPPLIER', 'ORDERED', 3070.2), term(38, 'SUPPLIER', 'SHIPPED', 7163.8), term(38, 'LOGISTICS', null, 1300)],
    [pay(380, 'LOGISTICS', null, 300, 'Transport voorschot', '2026-09-01')]);
  assert.deepEqual(splitStart(po38, null), { key: 'container:38:SUPPLIER:ORDERED', amountEur: 3070.2 });
  // Its 30 % noted (the term is then covered): that payment, not a new one on the 70 %.
  const noted = container(38, [term(38, 'SUPPLIER', 'SHIPPED', 7163.8), term(38, 'LOGISTICS', null, 1300)],
    [pay(380, 'LOGISTICS', null, 300, 'Transport voorschot', '2026-09-01'), pay(381, 'SUPPLIER', 'ORDERED', 3070.2, '30% bij bestelling')]);
  assert.deepEqual(splitStart(noted, null), { key: 'p:381', amountEur: 3070.2 });
  // The matched payment (the best match, or 'Verdelen over containers' on it) wins; a matched term takes its noted payment.
  assert.deepEqual(splitStart(noted, null, { paymentId: 380 }), { key: 'p:380', amountEur: 300 });
  const both = container(39, [term(39, 'SUPPLIER', 'ORDERED', 500, 3070.2)], [pay(392, 'SUPPLIER', 'ORDERED', 2570.2)]);
  assert.deepEqual(splitStart(both, null, { termKey: 'container:39:SUPPLIER:ORDERED' }), { key: 'p:392', amountEur: 2570.2 }, 'never a second payment for the instalment');
  // Only a transport payment and nothing else open: that one (the owner ticked it).
  assert.deepEqual(splitStart(container(44, [], [pay(440, 'LOGISTICS', null, 300)]), null), { key: 'p:440', amountEur: 300 });
  assert.equal(splitStart(container(45, [], []), null), null);
});

test("a later container follows the first row's payee and term: its noted payment on it, else that open term", () => {
  const first = { payee: 'SUPPLIER' as const, due: 'ORDERED' as const };
  // PO-039 noted its 30 %: linked.
  assert.equal(splitStart(container(39, [term(39, 'SUPPLIER', 'SHIPPED', 7163.8)], [pay(392, 'SUPPLIER', 'ORDERED', 3070.2)]), first)?.key, 'p:392');
  // PO-041: an open SHIPPED payment and its ORDERED term still open (the review's example): the ORDERED term.
  const po41 = container(41, [term(41, 'SUPPLIER', 'ORDERED', 3070.2), term(41, 'SUPPLIER', 'SHIPPED', 2000)], [pay(412, 'SUPPLIER', 'SHIPPED', 5163.8)]);
  assert.deepEqual(splitStart(po41, first), { key: 'container:41:SUPPLIER:ORDERED', amountEur: 3070.2 });
  // Nothing on that term: the payee's noted payment before a new one on another term.
  assert.equal(splitStart(container(42, [term(42, 'SUPPLIER', 'SHIPPED', 2000)], [pay(422, 'SUPPLIER', 'SHIPPED', 5163.8)]), first)?.key, 'p:422');
  // Another payee's payment never starts a supplier row while the supplier has something open.
  const po43 = container(43, [term(43, 'SUPPLIER', 'ORDERED', 3070.2)], [pay(430, 'LOGISTICS', null, 300, 'Transport voorschot', '2026-09-01')]);
  assert.equal(splitStart(po43, first)?.key, 'container:43:SUPPLIER:ORDERED');
  // A forwarder's transfer: the first row on the transport stream, so is the next (its noted transport payment first).
  const logistics = { payee: 'LOGISTICS' as const, due: null };
  assert.equal(splitStart(container(46, [term(46, 'SUPPLIER', 'ORDERED', 3070.2), term(46, 'LOGISTICS', null, 1300)], [pay(460, 'SUPPLIER', 'ORDERED', 3070.2)]), logistics)?.key,
    'container:46:LOGISTICS');
  assert.equal(splitStart(container(47, [term(47, 'LOGISTICS', null, 1300)], [pay(470, 'SUPPLIER', null, 900), pay(471, 'LOGISTICS', null, 650)]), logistics)?.key, 'p:471');
  // splitTarget reads the first row back from its key.
  const all = [po41, container(39, [], [pay(392, 'SUPPLIER', 'ORDERED', 3070.2)])];
  assert.deepEqual(splitTarget(all, 'p:392'), { payee: 'SUPPLIER', due: 'ORDERED' });
  assert.deepEqual(splitTarget(all, 'container:41:SUPPLIER:SHIPPED'), { payee: 'SUPPLIER', due: 'SHIPPED' });
  assert.equal(splitTarget(all, 'p:999'), null);
});

test("the row's select: its payee's noted payments, the open terms, other payees' payments last; short words, the amounts under the row", () => {
  const po38 = container(38, [term(38, 'SUPPLIER', 'ORDERED', 3070.2), term(38, 'LOGISTICS', null, 1300)],
    [pay(380, 'LOGISTICS', null, 300, 'Transport voorschot', '2026-09-01'), pay(381, 'SUPPLIER', 'SHIPPED', 900, null, '2026-09-20'), pay(382, 'SUPPLIER', 'ORDERED', 3070.2, null, '2026-09-25')]);
  const key = 'container:38:SUPPLIER:ORDERED';
  const choices = splitChoices(po38, key);
  assert.deepEqual(choices.map((choice) => choice.key), ['p:382', 'p:381', key, 'container:38:LOGISTICS', 'p:380', 'fee'], 'ORDERED before SHIPPED, the transport payment, then Transactiekosten last');
  const texts = choices.map((choice) => plain(splitChoiceText(choice, choices, splitRowPayee(po38, key))));
  assert.deepEqual(texts, ['Bestaand 25/09: € 3.070,20', 'Bestaand 20/09: € 900,00', 'Nieuw: 30% bij bestelling', 'Nieuw: Transport', 'Transport: € 300,00 (bestaand)',
    'Nieuw: Transactiekosten']);
  assert.ok(texts.every((text) => text.length <= 30), 'whole in the 424 px inspector and on a phone');
  const one = container(39, [term(39, 'SUPPLIER', 'SHIPPED', 7163.8)], [pay(392, 'SUPPLIER', 'ORDERED', 3070.2)]);
  const oneChoices = splitChoices(one, 'p:392');
  assert.deepEqual(oneChoices.map((choice) => plain(splitChoiceText(choice, oneChoices, 'SUPPLIER'))), ['Bestaand: € 3.070,20', 'Nieuw: 70% bij vertrek', 'Nieuw: Transactiekosten']);
  // A row on the transport stream lists the transport payment first.
  assert.deepEqual(splitChoices(po38, 'container:38:LOGISTICS').map((choice) => choice.key), ['p:380', key, 'container:38:LOGISTICS', 'p:381', 'p:382', 'fee']);
});

test("'Volgens afspraak' weighs a noted payment by its euro and a term by what is open on it (its Afspraak when nothing is)", () => {
  const po40 = container(40, [term(40, 'SUPPLIER', 'ORDERED', 3903.38), term(40, 'SUPPLIER', 'SHIPPED', 0, 9000)], [pay(400, 'SUPPLIER', 'SHIPPED', 4500)]);
  assert.equal(splitWeight(po40, 'p:400'), 4500);
  assert.equal(splitWeight(po40, 'container:40:SUPPLIER:ORDERED'), 3903.38);
  assert.equal(splitWeight(po40, 'container:40:SUPPLIER:SHIPPED'), 9000);
  assert.equal(splitWeight(po40, 'p:1'), null);
});

test("the split's select shows the row its own choice; the modes and each part's effect are there", async () => {
  const split = await readFile(new URL('../src/app/features/finance/container-split.ts', import.meta.url), 'utf8');
  const select = split.slice(split.indexOf('<select class="select fin-split__term"'), split.indexOf('</select>'));
  // A [value] on the select is set before its @for options exist: the browser then shows the first option, whatever the row stands on.
  assert.equal(/<select[^>]*\[value\]/.test(select), false);
  assert.match(select, /<option \[value\]="choice\.key" \[selected\]="choice\.key === row\.key">/);
  assert.match(split, /Volgens afspraak<\/button>/);
  assert.match(split, /Gelijk verdelen<\/button>/);
  assert.match(split, /effectOf\(container, row\)/);
});

test("Kosten & bank's larger-transaction question offers 'Splitsen…' first and chooses nothing beforehand", async () => {
  const detail = await readFile(new URL('../src/app/features/finance/transaction-detail.ts', import.meta.url), 'utf8');
  const radios = detail.slice(detail.indexOf('class="fin-txd__radios"'), detail.indexOf('</div>', detail.indexOf('class="fin-txd__radios"')));
  // Review 2026-10-20: one name for the one split view, as the offer below calls it.
  assert.ok(radios.indexOf('Splitsen…<small>Over containers, termijnen of transactiekosten</small>') > 0);
  assert.ok(radios.indexOf('Splitsen…') < radios.indexOf('Bedrag aanpassen naar'), 'Splitsen first');
  assert.match(radios, /\(change\)="openSplit\(target\)"/);
  assert.match(detail, /readonly surplus = signal<'ADJUST' \| 'INSPECTION' \| 'FEE' \| null>\(null\);/, "no 'Bedrag aanpassen' beforehand");
  assert.equal(/this\.surplus\.set\('ADJUST'\)/.test(detail), false, 'never reset to it either');
  assert.match(detail, /preview\.blockedText \|\| this\.surplusAsked\(preview, target\)/, 'the link waits for the answer');

  const steps = await readFile(new URL('../src/app/features/finance/bank-allocation-steps.ts', import.meta.url), 'utf8');
  const choices = steps.slice(steps.indexOf('class="bank-alloc-choices"'), steps.indexOf('Niet koppelen'));
  assert.ok(choices.indexOf('<b>Splitsen…</b><span>Over containers, termijnen of transactiekosten</span>') > 0);
  assert.ok(choices.indexOf('Splitsen…') < choices.indexOf('Bedrag aanpassen naar'));
});

/* ---- Splitsen (Emre, 2026-10-19): several parts per container, Transactiekosten, one payment never twice */

test("'+ Deel' adds the next part of the container: its payee's next term, then Transactiekosten, then another payee", () => {
  const po = container(39, [term(39, 'SUPPLIER', 'ORDERED', 3070.2), term(39, 'SUPPLIER', 'SHIPPED', 7163.8), term(39, 'LOGISTICS', null, 1300)], []);
  assert.equal(splitNextPart(po, ['container:39:SUPPLIER:ORDERED']), 'container:39:SUPPLIER:SHIPPED', '30 % + 70 %');
  assert.equal(splitNextPart(po, ['container:39:SUPPLIER:ORDERED', 'container:39:SUPPLIER:SHIPPED']), 'fee', 'goods + Transactiekosten');
  assert.equal(splitNextPart(po, ['container:39:SUPPLIER:ORDERED', 'container:39:SUPPLIER:SHIPPED', 'fee']), 'container:39:LOGISTICS', 'goods + Douane & transport');
  // A row on the noted part of the 30 %: never a new payment on that same term beside it.
  const noted = container(40, [term(40, 'SUPPLIER', 'ORDERED', 500, 3070.2), term(40, 'SUPPLIER', 'SHIPPED', 7163.8)], [pay(401, 'SUPPLIER', 'ORDERED', 2570.2)]);
  assert.equal(splitNextPart(noted, ['p:401']), 'container:40:SUPPLIER:SHIPPED');
  assert.equal(splitRowPayee(po, 'fee'), 'OTHER', 'Transactiekosten are Bijkomende kosten');
  const choices = splitChoices(po, 'fee');
  assert.equal(plain(splitChoiceText(choices.at(-1)!, choices, 'OTHER')), 'Nieuw: Transactiekosten');
});

test('a payment chosen twice: another row\'s open payment is not a choice, its own stays; + Deel takes the free one', () => {
  const two = container(41, [], [pay(411, 'SUPPLIER', 'ORDERED', 1000), pay(412, 'SUPPLIER', 'SHIPPED', 2000)]);
  assert.deepEqual(splitChoices(two, 'p:412', ['p:411']).map((choice) => choice.key), ['p:412', 'fee']);
  assert.deepEqual(splitChoices(two, 'p:411', ['p:411']).map((choice) => choice.key), ['p:411', 'p:412', 'fee'], "a row's own payment stays in its select");
  assert.equal(splitNextPart(two, ['p:411']), 'p:412');
  assert.equal(splitNextPart(two, ['p:411', 'p:412']), 'fee');
});

test("'Volgens afspraak' and 'Gelijk verdelen' share the transaction less the Transactiekosten; those keep what was typed", () => {
  const goods = (weight: number | null, amountEur: number | null = null) => ({ fee: false, amountEur, weight });
  const fee = (amountEur: number | null) => ({ fee: true, amountEur, weight: null });
  assert.deepEqual(splitSpread(3100, [goods(3070.2, 3070.2), fee(29.8)], splitCents), [3070.2, 29.8]);
  assert.deepEqual(splitSpread(-3100, [goods(5000, 5000), fee(25)], splitCents), [3075, 25], 'one goods row takes the rest');
  assert.deepEqual(splitSpread(10259, [goods(3070.2), goods(7163.8), fee(25)], splitCents), [3070.2, 7163.8, 25], '30 % + 70 % + the fee');
  assert.deepEqual(splitSpread(100.01, [goods(1), goods(1), fee(0.01)], splitCents), [50, 50, 0.01], 'Gelijk verdelen');
  assert.deepEqual(splitSpread(3100, [goods(5000, 5000), fee(null)], splitCents), [3100, 0], 'a fee not typed yet counts as nothing');
  assert.equal(splitSpread(3100, [fee(25)], splitCents), null, 'nothing to share it over');
  assert.equal(splitSpread(25, [goods(1), fee(25)], splitCents), null, 'nothing left');
  assert.equal(splitSpread(3100, [goods(null), fee(25)], splitCents), null, 'a weight missing');
});

test("Splitsen: one button on an outgoing transaction, '+ Deel' per container, Transactiekosten in both calls; 'Al genoteerd' only with something", async () => {
  const detail = await readFile(new URL('../src/app/features/finance/transaction-detail.ts', import.meta.url), 'utf8');
  const offers = detail.slice(detail.indexOf("@if (view() !== 'containers') {"), detail.indexOf('<b>Geen factuur of kost?</b>'));
  assert.match(offers, /@if \(row\.amountEur < 0 && !splitAsked\(\)\) \{/, 'an incoming line has its invoice: no Splitsen; the question offers it itself');
  assert.match(offers, /<b>Splitsen<\/b><small>Over containers, termijnen of transactiekosten<\/small>/);
  assert.equal((offers.match(/Splitsen…<\/button>/g) ?? []).length, 1);
  assert.match(offers, /\(click\)="openSplit\(null\)">Splitsen…<\/button>/);
  assert.equal(detail.includes('Verdelen over containers…</button>'), false, 'the same view once');
  assert.match(detail, /if \(command === 'split' && open\) \{ if \(row\.amountEur < 0 && this\.state\.cashRound\(\)\) this\.openSplit\(null\); return true; \}/);
  assert.match(detail, /if \(split === row\.id && row\.amountEur < 0 && this\.state\.cashRound\(\)\) this\.openSplit\(null\);/, "the list's Splitsen… opens the detail in it");
  assert.match(detail, /this\.allocationStep\(\) === 'payments' && !this\.existingCount\(\) && !this\.localLoading\(\)/, 'an empty Al genoteerd falls back');
  const radios = detail.slice(detail.indexOf('class="fin-txd__radios"'), detail.indexOf('</div>', detail.indexOf('class="fin-txd__radios"')));
  assert.match(radios, /\(change\)="surplus\.set\('FEE'\)" \/><span>Rest als transactiekosten<small>Bijkomende kosten van de container<\/small><\/span>/);
  assert.match(detail, /<option value="TRANSACTIEKOSTEN">Transactiekosten van de container<\/option><option value="KOERSVERSCHIL">Koersverschil<\/option>/);
  assert.equal(detail.includes('<option value="BANKKOSTEN">'), false, 'a fee never lands twice (company cost and container)');
  assert.match(detail, /Waarvan transactiekosten \(€\)/);

  const split = await readFile(new URL('../src/app/features/finance/container-split.ts', import.meta.url), 'utf8');
  assert.match(split, /@for \(row of parts; track row\.id; let first = \$first, i = \$index\)/, 'rows by their own id');
  assert.match(split, />\+ Deel<\/button>/);
  // Review 2026-10-20: every part's controls say which part of which container they are.
  assert.match(split, /@let part = parts\.length > 1 \? ' deel ' \+ \(i \+ 1\) : '';/);
  assert.match(split, /\[attr\.aria-label\]="'Betaling' \+ part \+ ' voor ' \+ container\.number"/);
  assert.match(split, /\[attr\.aria-label\]="'Bedrag' \+ part \+ ' voor ' \+ container\.number"/);
  assert.match(split, /\[attr\.aria-label\]="'Deel ' \+ \(i \+ 1\) \+ ' van ' \+ container\.number \+ ' weghalen'"/);
  assert.match(split, /\[attr\.aria-label\]="'Deel toevoegen aan ' \+ container\.number"/);
  assert.match(split, /if \(row\.key === SPLIT_FEE_KEY\) return feeSharePart\(row\.orderId, amountEur\);/);
  assert.match(split, /if \(row\.key === SPLIT_FEE_KEY\) return feePaymentPart\(this\.lineDay\(\), parse\(row\.amountInput\)!, row\.orderId\);/);
  assert.match(split, /new Set\(payments\)\.size === payments\.length/, 'Koppelen waits while one payment is chosen twice');

  const steps = await readFile(new URL('../src/app/features/finance/bank-allocation-steps.ts', import.meta.url), 'utf8');
  assert.match(steps, /@if \(p\.existingCount\(\); as count\) \{ <button [^>]*>Al genoteerd \{\{ count \}\}<\/button> \}/);
  assert.match(steps, /<p class="fin-hint">Al genoteerd in Inkoop of Kosten, nog zonder banktransactie\.<\/p>/);
  assert.match(steps, /\{\{ signed\(-payment\.amountEur\) \}\}/, '− € 20.289,56, never € -20.289,56');
  const noted = steps.slice(steps.indexOf('Al genoteerd in Inkoop of Kosten'), steps.indexOf('Geen betaling gevonden voor deze zoekterm.'));
  assert.equal(noted.includes('| eur }}'), false, 'every amount on the tab signed');
  // Review 2026-10-20: the preview of the payments chosen there is signed as well.
  assert.match(steps, /<dt>Bestaande betalingen<\/dt><dd>\{\{ signed\(-p\.outgoingTotal\(\)\) \}\}<\/dd>/);
  assert.match(steps, /<dt>Bestaande betaling<\/dt><dd>\{\{ signed\(p\.existingSalesAmount\(payment\)\) \}\}<\/dd>/);
  assert.match(steps, /<b>Rest als transactiekosten<\/b>/);
  assert.match(steps, /Waarvan transactiekosten \(€\)/);
});

test('a best match without other candidates still leads to the steps: "Zoek in ENROSED ›" under it', async () => {
  // Review 2026-10-20: the search view was reachable only from "Andere mogelijkheden", which hides when it is empty.
  const detail = await readFile(new URL('../src/app/features/finance/transaction-detail.ts', import.meta.url), 'utf8');
  const after = detail.slice(detail.indexOf('@if (alternatives().length) {'), detail.indexOf("@if (view() !== 'containers') {"));
  assert.equal((after.match(/\(click\)="searchAll\(\)">Zoek in ENROSED ›<\/button>/g) ?? []).length, 2, 'with and without alternatives');
  assert.match(after, /\} @else \{\s*<!--[^>]*-->\s*<section class="wk-section"><button class="wk-link" type="button" \(click\)="searchAll\(\)">/);
  assert.match(detail, /if \(this\.view\(\) === 'search' \|\| this\.status\(\) !== 'SUGGESTED'\) return null;/, 'the search view drops the best match');
});
