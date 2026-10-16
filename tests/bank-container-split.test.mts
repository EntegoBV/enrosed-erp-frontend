import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  splitChoiceText, splitChoices, splitRowPayee, splitStart, splitTarget, splitWeight, type SplitContainer, type SplitOpenPayment,
} from '../src/app/features/finance/container-split-rows.ts';
import type { ContainerPayable } from '../src/app/features/finance/payables.ts';

/*
 * Kosten & bank "Verdelen over containers" (Emre, 2026-10-16): a ticked
 * container starts on what the transfer paid there, an open payment of the
 * transfer's payee before a new one, never another payee's payment; the
 * select shows the row's own choice.
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
  assert.deepEqual(choices.map((choice) => choice.key), ['p:382', 'p:381', key, 'container:38:LOGISTICS', 'p:380'], 'ORDERED before SHIPPED, the transport payment last');
  const texts = choices.map((choice) => plain(splitChoiceText(choice, choices, splitRowPayee(po38, key))));
  assert.deepEqual(texts, ['Bestaand 25/09: € 3.070,20', 'Bestaand 20/09: € 900,00', 'Nieuw: 30% bij bestelling', 'Nieuw: Transport', 'Transport: € 300,00 (bestaand)']);
  assert.ok(texts.every((text) => text.length <= 30), 'whole in the 424 px inspector and on a phone');
  const one = container(39, [term(39, 'SUPPLIER', 'SHIPPED', 7163.8)], [pay(392, 'SUPPLIER', 'ORDERED', 3070.2)]);
  const oneChoices = splitChoices(one, 'p:392');
  assert.deepEqual(oneChoices.map((choice) => plain(splitChoiceText(choice, oneChoices, 'SUPPLIER'))), ['Bestaand: € 3.070,20', 'Nieuw: 70% bij vertrek']);
  // A row on the transport stream lists the transport payment first.
  assert.deepEqual(splitChoices(po38, 'container:38:LOGISTICS').map((choice) => choice.key), ['p:380', key, 'container:38:LOGISTICS', 'p:381', 'p:382']);
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
