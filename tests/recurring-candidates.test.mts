import assert from 'node:assert/strict';
import test from 'node:test';
import { intervalOfGap, recurringCandidates, recurringPartyKey } from '../src/app/features/finance/recurring-candidates.ts';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { blankRecurring } from '../src/app/features/finance/finance-sections.ts';
import { monthShort } from '../src/app/features/finance/finance-format.ts';
import { cashTotalOf, intervalLabel } from '../src/app/features/finance/finance-metrics.ts';

/* "Lijkt te herhalen" on Vaste kosten: the production shapes of 16 Oct 2026 (Linc & Partners ×6 in two spellings, Railway ×3, Action at two fairs). */
let id = 0;
const cost = (party: string, date: string, extra: Record<string, unknown> = {}): any => ({ id: ++id, date, party, category: 'ANDERE', description: party,
  amountExclEur: 300, vatPct: 21, recurringCostId: null, ...extra });
const TODAY = '2026-10-16';
const linc = ['2026-05-12', '2026-06-12', '2026-07-12', '2026-08-12', '2026-09-12'].map((day, index) =>
  cost(index % 2 ? 'Linc&Partners BV' : 'Linc & Partners', day, { category: 'BOEKHOUDER' }))
  .concat(cost('Linc & Partners', '2026-10-12', { category: 'BOEKHOUDER', amountExclEur: 300, vatPct: 21, description: 'Boekhouding oktober' }));
const railway = ['2026-08-03', '2026-09-03', '2026-10-03'].map((day) => cost('Railway', day, { category: 'SOFTWARE', amountExclEur: 18.4, vatPct: 0 }));
const action = [cost('Action', '2026-09-02', { category: 'BEURS' }), cost('Action', '2026-09-20', { category: 'BEURS' }), cost('Action', '2026-10-05', { category: 'BEURS' })];

test('Linc & Partners (both spellings) and Railway are candidates; Action (two months, Beurs) is not', () => {
  const found = recurringCandidates([...linc, ...railway, ...action], [], TODAY);
  assert.deepEqual(found.map((row) => [row.party, row.count]), [['Linc & Partners', 6], ['Railway', 3]]);
  assert.equal(found[0].since, '2026-05-12');
  assert.equal(found[0].last.description, 'Boekhouding oktober');
});

test('the rhythm comes from the bookings and the start is the next expected booking, never today or earlier', () => {
  const [lincRow, railwayRow] = recurringCandidates([...linc, ...railway], [], TODAY);
  assert.equal(lincRow.interval, 'MONTHLY');
  assert.equal(lincRow.nextDate, '2026-11-12', 'monthly bookings on the 12th give the next 12th, so October is not booked twice');
  assert.equal(railwayRow.nextDate, '2026-11-03');
  const quarterly = ['2026-01-15', '2026-04-15', '2026-07-15'].map((day) => cost('Kantoor Partners', day, { category: 'HUUR' }));
  const [row] = recurringCandidates(quarterly, [], TODAY);
  assert.deepEqual([row.interval, row.nextDate], ['QUARTERLY', '2027-01-15'], 'a missed 15 Oct moves on to the next quarter, never today or earlier');
  assert.deepEqual([intervalOfGap(7), intervalOfGap(31), intervalOfGap(91), intervalOfGap(182), intervalOfGap(365)], ['WEEKLY', 'MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY']);
});

test('legal suffixes, punctuation and "&" merge; a party with a definition and booked-by-definition costs stay out', () => {
  assert.equal(recurringPartyKey('Linc & Partners BV'), recurringPartyKey('LINC PARTNERS'));
  assert.equal(recurringPartyKey('Ggm Moebel GmbH'), 'ggm moebel');
  assert.deepEqual(recurringCandidates([...linc, ...railway], ['Linc&Partners'], TODAY).map((row) => row.party), ['Railway']);
  assert.deepEqual(recurringCandidates(railway.map((row: any) => ({ ...row, recurringCostId: 4 })), [], TODAY), []);
  const old = ['2025-06-01', '2025-07-01', '2025-08-01'].map((day) => cost('Oud BV', day));
  assert.deepEqual(recurringCandidates(old, [], TODAY), [], 'only the last 365 days count');
});

/* The panel's "Lijkt te herhalen" row and its "Instellen…" (review 2026-10-17): the app's short month, and no blind regime confirmation. */

async function panelClass() {
  const file = 'recurring-panel.ts';
  const source = await readFile(new URL(`../src/app/features/finance/${file}`, import.meta.url), 'utf8');
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const cls = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'RecurringPanel')!;
  const kept = cls.members.filter((member) => member.name && ['candidateText', 'setUp'].includes(member.name.getText(parsed)));
  const isolated = ts.factory.updateClassDeclaration(cls, cls.modifiers?.filter((m) => !ts.isDecorator(m)), cls.name, undefined, undefined, kept);
  const js = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: any = {};
  vm.runInNewContext(js, { exports, blankRecurring, monthShort, cashTotalOf, intervalLabel, formatEuro: (value: number) => `€ ${value.toFixed(2)}` });
  return exports.RecurringPanel;
}

test('monthShort: the app\'s short month ("mrt", not "maa"), with the year when it is another one', () => {
  assert.equal(monthShort('2026-03-12', TODAY), 'mrt');
  assert.equal(monthShort('2026-05-01', TODAY), 'mei');
  assert.equal(monthShort('2025-10-20', TODAY), 'okt 2025', 'a 365-day window can start in last year\'s same month');
});

test('"Lijkt te herhalen" reads "sinds mrt", and "Instellen…" keeps a derived VAT regime unconfirmed', async () => {
  const Panel = await panelClass();
  let draft: any = null;
  const panel = new Panel();
  panel.state = { today: () => TODAY, recurringDraft: { set: (value: any) => { draft = value; } } };
  const last = cost('Linc & Partners', '2026-10-12', { vatRegime: 'BE', vatRegimeConfirmed: false, supplierCountry: 'BE', expenseType: 'STANDARD' });
  const candidate = { party: 'Linc & Partners', count: 8, since: '2026-03-12', last, interval: 'MONTHLY', nextDate: '2026-11-12' };
  assert.match(panel.candidateText(candidate), /^8 boekingen sinds mrt · laatst /);
  panel.setUp(candidate);
  assert.equal(draft.vatRegime, 'BE');
  assert.equal(draft.vatRegimeConfirmed, false, 'derived: the sheet opens its regime section and he confirms it there');
  assert.equal(draft.startDate, '2026-11-12');
  panel.setUp({ ...candidate, last: { ...last, vatRegimeConfirmed: true } });
  assert.equal(draft.vatRegimeConfirmed, true, 'a regime he confirmed on the booking stays confirmed');
  panel.setUp({ ...candidate, last: { ...last, vatRegime: null, vatRegimeConfirmed: true } });
  assert.deepEqual([draft.vatRegime, draft.vatRegimeConfirmed], ['BE', false], 'no regime at all: a default to confirm');
});
