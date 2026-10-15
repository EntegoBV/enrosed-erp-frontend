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
async function selectedClass(file: string, name: string, members: string[]) {
  const source = await readFile(new URL(`../src/app/features/finance/${file}`, import.meta.url), 'utf8');
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const cls = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === name)!;
  const kept = cls.members.filter(member => member.name && members.includes(member.name.getText(parsed)));
  assert.equal(kept.length, members.length);
  const isolated = ts.factory.updateClassDeclaration(cls, cls.modifiers?.filter(m => !ts.isDecorator(m)), cls.name, undefined, undefined, kept);
  const code = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: any = {};
  vm.runInNewContext(code, { exports, computed, signal, dayMon, dayMonth, eur, weekdayDayMonth, CERTAINTY_LABEL });
  return exports[name];
}
const Cockpit = await selectedClass('bank-cockpit.ts', 'BankCockpit', ['bankKnown', 'bankStale', 'accountCount', 'bankSub', 'computedSub', 'moves', 'outlookComplete']);
const Kaslijn = await selectedClass('kaslijn-card.ts', 'KaslijnCard', ['tightText', 'largest', 'banner', 'setWeeks', 'others', 'bannerRest', 'bannerText', 'eurOf', 'mon', 'certainty']);
const AttentionRows = await selectedClass('bank-cockpit.ts', 'BankCockpit', ['phoneLabel', 'phoneVerb']);

function cockpit(accounts: any[], movements: any[] = [], extra: Record<string, unknown> = {}) {
  const panel = new Cockpit();
  panel.state = { accountsView: signal(accounts), today: () => '2026-10-15', cashInput: () => ({ movements }),
    bankLedger: () => ({ accounts: accounts.map(account => ({ currentEur: account.reading ? 1 : null })) }),
    containersLoading: signal(false), loadErrors: signal([]), ...extra };
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
