import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { computed, signal } from '@angular/core';
import { dayMon, dayMonth, eur, weekdayDayMonth } from '../src/app/features/finance/cash-format.ts';
import { CERTAINTY_LABEL } from '../src/app/features/finance/cash-forecast.ts';
import { parseFinanceLocation, patchLocation } from '../src/app/features/finance/finance-url.ts';

/* Bank as the home of Kosten & bank (spec-bank-forecast §3.1-§3.3): the total tile's words, what moved, the Kaslijn's facts and banner. */
async function selectedClass(file: string, name: string, members: string[], extra: Record<string, unknown> = {}) {
  const source = await readFile(new URL(`../src/app/features/finance/${file}`, import.meta.url), 'utf8');
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const cls = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === name)!;
  const kept = cls.members.filter(member => member.name && members.includes(member.name.getText(parsed)));
  assert.equal(kept.length, members.length);
  const isolated = ts.factory.updateClassDeclaration(cls, cls.modifiers?.filter(m => !ts.isDecorator(m)), cls.name, undefined, undefined, kept);
  const code = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: any = {};
  vm.runInNewContext(code, { exports, computed, signal, dayMon, dayMonth, eur, weekdayDayMonth, CERTAINTY_LABEL, ...extra });
  return exports[name];
}
const Cockpit = await selectedClass('bank-cockpit.ts', 'BankCockpit', ['bankKnown', 'bankStale', 'accountCount', 'bankSub', 'computedSub', 'moves', 'outlookComplete']);
const Kaslijn = await selectedClass('kaslijn-card.ts', 'KaslijnCard', ['tightText', 'largest', 'banner', 'setWeeks', 'others', 'bannerRest', 'bannerText', 'eurOf', 'mon', 'certainty']);
const AttentionRows = await selectedClass('bank-cockpit.ts', 'BankCockpit', ['phoneLabel', 'phoneVerb']);

function cockpit(accounts: any[], movements: any[] = [], extra: Record<string, unknown> = {}) {
  const panel = new Cockpit();
  panel.state = { accountsView: signal(accounts), today: () => '2026-10-15', cashInput: () => ({ movements }),
    bankLedger: () => ({ accounts: accounts.map(account => ({ currentEur: account.reading ? 1 : null })) }),
    containersLoading: signal(false), loadErrors: signal([]), kaslijn: () => ({ likelyPaid: [] }), ...extra };
  return panel;
}
const kbc = { account: 'BE94', label: 'KBC-zichtrekening', reading: { id: 1 }, ageDays: 5 };
const wise = { account: 'WISE', label: 'Wise EUR', reading: { id: 2 }, ageDays: 14 };

test('the total tile keeps the Overzicht\'s words: "{n} rekeningen · gecontroleerd {when}", "Berekend uit je saldo\'s en transacties …"', () => {
  const two = cockpit([kbc, wise]);
  assert.equal(two.accountCount(), '2 rekeningen');
  assert.equal(two.bankSub(), '2 rekeningen · gecontroleerd 5 dagen geleden');
  assert.equal(two.computedSub(), "Berekend uit je saldo's en transacties · laatst gecontroleerd 5 dagen geleden");
  assert.equal(two.bankStale(), false);
  const one = cockpit([{ ...kbc, ageDays: 1 }]);
  assert.deepEqual([one.accountCount(), one.bankSub()], ['1 rekening', '1 rekening · gecontroleerd gisteren']);
  const missing = cockpit([kbc, { ...wise, reading: null, ageDays: null }]);
  assert.equal(missing.bankSub(), 'deels bekend · 1 rekening zonder saldo');
  assert.equal(missing.outlookComplete(), false, 'an account without a reading leaves the Vooruitblik onvolledig');
  assert.equal(cockpit([{ ...kbc, ageDays: 20 }]).bankStale(), true);
  assert.equal(cockpit([]).bankSub(), 'Saldo invullen');
});

test('Vandaag and Deze week count the active accounts from Monday; an archived or unknown account stays out', () => {
  const moves = [{ account: 'BE94', day: '2026-10-15', amountEur: -423.5 }, { account: 'BE94', day: '2026-10-15', amountEur: -14.5 },
    { account: 'BE94', day: '2026-10-13', amountEur: -9000 }, { account: 'WISE', day: '2026-10-15', amountEur: 5000 },
    { account: 'BE94', day: '2026-10-12', amountEur: -2000 }, { account: 'BE94', day: '2026-10-11', amountEur: -777 }, { account: 'OLD', day: '2026-10-15', amountEur: 999 }];
  // Thursday 15 October: the week runs from Monday the 12th; Sunday the 11th is last week.
  assert.deepEqual(JSON.parse(JSON.stringify(cockpit([kbc, wise], moves).moves())), { today: 4562, week: -6438 });
  assert.equal(cockpit([kbc, wise], [], { containersLoading: signal(true) }).outlookComplete(), false);
  assert.equal(cockpit([kbc, wise]).outlookComplete(), true);
  assert.equal(cockpit([kbc, wise], [], { kaslijn: () => ({ likelyPaid: [{ lineId: 1 }] }) }).outlookComplete(), false,
    'a transaction that probably paid an open item counts twice until it is linked: onvolledig');
});

function kaslijn(forecast: any) {
  const card = new Kaslijn();
  const location = signal(parseFinanceLocation((key) => ({ view: 'bank', weeks: '13', account: 'BE94', q: '1452' } as Record<string, string>)[key] ?? null));
  card.state = { kaslijn: () => forecast, location, go: (patch: any) => location.set(patchLocation(location(), patch)) };
  return { card, location };
}
const item = (title: string, amountEur: number, date: string, certainty = 'EXPECTED') => ({ title, amountEur, date, certainty });

test('the Kaslijn facts: "Onder buffer" as d mmm–d mmm or "geen week", the largest outflow with its certainty', () => {
  const { card } = kaslijn({ tightWith: [{ from: '2026-10-22', to: '2026-12-10' }], likelyPaid: [],
    items: [item('Huur loods Wilrijk', -1452, '2026-11-01', 'FIXED'), item('PO-2026-021 · 70% bij vertrek', -28000, '2026-11-02', 'ESTIMATED'), item('F2026-0420', 4235, '2026-10-21')] });
  assert.equal(card.tightText(), '22 okt–10 dec');
  assert.equal(card.largest().title, 'PO-2026-021 · 70% bij vertrek');
  assert.equal(card.certainty(card.largest()), 'geschat');
  assert.equal(kaslijn({ tightWith: [], likelyPaid: [], items: [item('F2026-0420', 4235, '2026-10-21')] }).card.largest(), null);
  assert.equal(kaslijn({ tightWith: [], likelyPaid: [], items: [] }).card.tightText(), 'geen week');
});

test('the double-count banner names the transaction and the open item; "+ n andere" opens Te koppelen over every account; 8 weeks stays out of the address', () => {
  const match = { lineId: 111, itemKey: 'cost:12', amountEur: -423.5, counterparty: 'Vandersanden Drukwerk', day: '2026-10-15', account: 'KBC-zichtrekening', title: 'Brochures beurs' };
  const { card, location } = kaslijn({ tightWith: [], likelyPaid: [match, { ...match, lineId: 106 }], items: [] });
  assert.equal(card.banner().lineId, 111);
  assert.equal(card.bannerText(match).replace(/ /g, ' '),
    '− € 423,50 telt mogelijk dubbel: Vandersanden Drukwerk staat op 15/10 al op KBC-zichtrekening, Brochures beurs staat nog open. Tot je koppelt, telt de kaslijn hem als betaald.');
  card.setWeeks('8'); assert.equal(location().weeks, null);
  card.setWeeks('4'); assert.equal(location().weeks, 4);
  card.others();
  assert.deepEqual([location().tab, location().link, location().account, location().q], ['movements', 'unlinked', '', '']);
});

test('phone "Vraagt aandacht": a row that only opens its list keeps its figure as on main ("3 betalingen nog niet op de bank … € 15.860,40"); a row that does something shows its verb', () => {
  const rows = new AttentionRows();
  const item = (action: string | null, actionLabel = 'Bekijken') => ({ action, actionLabel });
  assert.equal(rows.phoneVerb(item('unbanked')), null, 'the unbanked row opens Transacties: its amount stays in the trail');
  assert.equal(rows.phoneVerb(item(null)), null);
  assert.deepEqual(['book', 'link', 'check'].map((action) => rows.phoneVerb(item(action))), ['Nu boeken', 'Koppel', 'Controleer']);
  assert.equal(rows.phoneVerb(item('fill', 'Saldo invullen')), 'Saldo invullen');
});

const euroFormat = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' });
const Band = await selectedClass('bank-cockpit.ts', 'BankCockpit', ['single', 'bandAge', 'splitText', 'phoneTrail', 'phoneVerb', 'phoneLabel', 'trailVerb'], { euro: euroFormat });

test('the band names its one account and its check; attention rows read in/uit, the VAT row "nog n d", and only doing rows get a button', () => {
  const band = new Band();
  band.state = { accountsView: signal([{ ...kbc, ageDays: 4 }]) };
  assert.equal(band.single().label, 'KBC-zichtrekening');
  assert.equal(band.bandAge(), 'gecontroleerd 4 dagen geleden');
  band.state.accountsView.set([kbc, wise]);
  assert.equal(band.single(), null, 'several accounts keep the total tile and the cards');
  const nbsp = (text: string) => text.replace(/\u00a0/g, ' ');
  assert.equal(nbsp(band.splitText({ split: { inEur: 19077.13, outEur: 203349.07 } })), 'in € 19.077,13 · uit € 203.349,07');
  assert.equal(nbsp(band.splitText({ split: { inEur: 0, outEur: 279.96 } })), 'uit € 279,96', 'a zero side is left out');
  assert.equal(band.phoneTrail({ kind: 'vat-deadline', action: null, dueInDays: 9, amountEur: null, count: 1 }), 'nog 9 d');
  assert.equal(band.phoneTrail({ kind: 'vat-deadline', action: null, dueInDays: 0, amountEur: null, count: 1 }), 'vandaag');
  assert.equal(nbsp(band.phoneTrail({ kind: 'unbanked-payments', action: 'unbanked', amountEur: 80276.76, count: 15 })), '€ 80.276,76');
  assert.deepEqual(['link', 'book', 'check', 'fill', null, 'unbanked'].map((action) => band.trailVerb({ action })),
    ['Koppelen', 'Nu boeken', 'Controleren', 'Saldo invullen', null, null]);
});

const Hero = await selectedClass('bank-cockpit.ts', 'BankCockpit', ['heroTap', 'toTransactions', 'capsule', 'leaving', 'runCapsule'], { bankTextOf: () => ({ title: 'X', sub: '' }) });

test('the one-account phone hero opens Transacties, or without a balance that account\'s own first reading (review 2026-10-17)', () => {
  const calls: unknown[] = [];
  const hero = new Hero();
  hero.state = { go: (patch: any, mode: string) => calls.push(['go', patch.view, patch.tab, mode]), checkOrFill: (key: string) => calls.push(['fill', key]), openBank: () => calls.push(['blank']) };
  hero.heroTap({ ...kbc, currentEur: 1200 });
  hero.heroTap({ ...kbc, currentEur: null });
  assert.deepEqual(calls, [['go', 'bank', 'movements', 'push'], ['fill', kbc.account]], 'never the blank balance form without an account');
});

test('only the Te koppelen row he links with its capsule leaves with a motion, and only while it links', async () => {
  // Contract §1.5: motion follows his own action, never a data load (the 5-minute refresh, an Odoo sync, another device).
  const line = { id: 31, amountEur: -80, bookedAt: '2026-10-15T08:00:00Z' };
  const suggestion = { target: { kind: 'cost-new', costId: 2, title: 'Kost · Huur' }, changesAmount: false, others: [] };
  let release!: () => void; const seen: (number | null)[] = [];
  const hero = new Hero();
  hero.state = { suggestions: () => new Map([[31, suggestion]]), linking: () => null,
    linkLine: () => { seen.push(hero.leaving()); return new Promise<string>((done) => { release = () => done(''); }); } };
  assert.equal(hero.leaving(), null, 'nothing leaves on a load');
  const running = hero.runCapsule(line);
  assert.deepEqual(seen, [31], 'set before the link starts, so the row that goes takes mo-leave');
  release(); await running;
  assert.equal(hero.leaving(), null, 'cleared afterwards: a later reload removes rows without motion');
});
