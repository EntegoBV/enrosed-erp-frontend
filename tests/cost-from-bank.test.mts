import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { computed, signal } from '@angular/core';
import { bankAmountsMatch, bankTransactionDay } from '../src/app/shared/bank-transaction-options.ts';
import { blankCost } from '../src/app/features/finance/finance-sections.ts';
import { cashTotalOf, REVERSE_CHARGE } from '../src/app/features/finance/finance-metrics.ts';
import { exclFromIncl, fitAmountToRegime } from '../src/app/features/finance/cost-amount.ts';

/** Exercise production methods and signals; only injected services and the Angular host are replaced. */
async function selectedClass(path: string, name: string, names: string[], globals: Record<string, unknown>) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const cls = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === name)!;
  const members = cls.members.filter(member => member.name && names.includes(member.name.getText(parsed)));
  assert.equal(members.length, names.length);
  const isolated = ts.factory.updateClassDeclaration(cls, cls.modifiers?.filter(m => !ts.isDecorator(m)), cls.name, undefined, undefined, members);
  const code = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: any = {};
  vm.runInNewContext(code, { exports, signal, computed, ...globals });
  return exports[name];
}
const State = await selectedClass('../src/app/features/finance/finance-state.ts', 'FinanceState', [
  'costDraft', 'costBankTransaction', 'costFiles', 'duplicating', 'openCost', 'openCostFromBank', 'saveCost',
  'costBankCreatePending', 'costBankCreateConflict', 'createCostFromBank', 'reviewCostBankConflict', 'sourceErrors', 'attach', 'bankCostLinkPending', 'bankCostLinkError', 'addPaymentFromBank',
], { blankCost, bankAmountsMatch, bankTransactionDay, cashTotalOf, crypto: globalThis.crypto, messageOf: (error: any, fallback: string) => error.message || fallback });

const bank = { id: 70, amountEur: -121, account: 'KBC', bookedAt: '2026-10-01T22:15:00Z', timeZone: 'Europe/Brussels', source: 'ODOO',
  reference: 'Supplier invoice INV-42', counterparty: 'Example Supplier', salesPaymentId: null, allocated: false };
function setup() {
  const state = new State(), creates: any[] = [], links: any[] = [], atomic: any[] = [], notices: string[] = [];
  let fail = false;
  const committed = new Map<string, any>();
  Object.assign(state, {
    saving: signal(false), costSheetFocus: signal(null), costs: signal<any[]>([]), bankStatements: signal([bank]), paySheet: signal(null), errorMap: signal({}),
    today: () => '2026-10-13', archivedBankLine: () => false, cashRound: () => false,
    refreshBank: async () => {}, refreshCosts: async () => {}, reload: async () => {},
    ui: { toast: (message: string) => notices.push(message) },
    finance: {
      createCost: async (body: any) => { creates.push(body); return { ...body, id: 42 }; },
      updateCost: async () => { throw new Error('Unexpected cost update'); },
      createCostFromBank: async (lineId: number, body: any) => {
        atomic.push({ lineId, body });
        if (!committed.has(body.requestId)) committed.set(body.requestId, { line: { ...bank, allocated: true }, cost: { ...body.cost, id: 42, paidOn: '2026-10-02', payments: [{ id: 80, amountEur: 121, bankStatementLineId: lineId }] } });
        if (fail) throw new Error('Response lost after server commit');
        return committed.get(body.requestId);
      },
    },
    banking: {
      addCostPayment: async (lineId: number, costId: number) => {
        links.push({ lineId, costId }); if (fail) throw new Error('Temporary connection failure'); return { ...bank, allocated: true };
      },
      create: async () => { throw new Error('A selected bank row must never create another bank movement'); },
    },
  });
  return { state, creates, links, atomic, committed, notices, failLink: (value: boolean) => { fail = value; } };
}

test('bank-led manual cost starts from gross cash facts without guessing VAT or document classification', () => {
  const { state, creates, links } = setup(); state.openCostFromBank(bank);
  const draft = state.costDraft();
  assert.equal(draft.id, null); assert.equal(draft.amountInclEur, 121); assert.equal(draft.date, '2026-10-02');
  assert.equal(draft.paidOn, '2026-10-02'); assert.equal(draft.party, bank.counterparty); assert.equal(draft.reference, bank.reference);
  assert.equal(draft.vatPct, null); assert.equal(draft.vatRegime, null); assert.equal(draft.vatRegimeConfirmed, false);
  assert.equal(draft.supplierCountry, null); assert.equal(draft.costKind, null); assert.equal(draft.expenseType, null);
  assert.equal(draft.vatDeductiblePct, null); assert.equal(draft.taxDeductiblePct, null);
  assert.equal(state.costBankTransaction(), bank); assert.equal(state.costSheetFocus(), 'regime');
  assert.equal(creates.length + links.length, 0); assert.equal(bank.amountEur, -121);
});

test('current allocated, incoming and archived transactions cannot open a new supplier cost', () => {
  for (const current of [{ ...bank, allocated: true }, { ...bank, salesPaymentId: 7 }, { ...bank, amountEur: 121 }]) {
    const { state } = setup(); state.bankStatements.set([current]); state.openCostFromBank(bank);
    assert.equal(state.costDraft(), null); assert.equal(state.costBankTransaction(), null);
  }
  const { state } = setup(); state.archivedBankLine = () => true; state.openCostFromBank(bank);
  assert.equal(state.costDraft(), null);
});

test('ordinary cost creation resets bank context and retains existing Belgian defaults and file support', () => {
  const { state } = setup(); state.openCostFromBank(bank);
  const file = { name: 'invoice.pdf' }; state.openCost(null, [file]);
  assert.equal(state.costBankTransaction(), null); assert.equal(state.costDraft().vatPct, 21);
  assert.equal(state.costDraft().vatRegime, 'BE'); assert.equal(state.costDraft().paidOn, null);
  assert.equal(state.costFiles()[0], file);
});

test('saving a bank-led cost uses one atomic request and preserves document date separately from the bank date', async () => {
  const { state, creates, links, atomic } = setup(); state.openCostFromBank(bank);
  const draft = { ...state.costDraft(), amountExclEur: 100, vatPct: 21, vatRegime: 'BE', vatRegimeConfirmed: true, supplierCountry: 'BE' };
  draft.date = '2026-09-20';
  const saved = await state.saveCost(draft, { bankTransaction: bank });
  assert.equal(saved.id, 42); assert.equal(creates.length + links.length, 0); assert.equal(atomic.length, 1);
  assert.equal(atomic[0].body.cost.paidOn, null); assert.equal(atomic[0].body.cost.date, '2026-09-20');
  assert.equal(atomic[0].lineId, 70); assert.equal(state.bankStatements()[0].id, 70); assert.equal(saved.payments[0].id, 80);
  assert.equal(state.bankStatements()[0].amountEur, -121); assert.equal(state.bankStatements()[0].source, 'ODOO');
  assert.equal(state.costDraft(), null); assert.equal(state.costBankTransaction(), null);
});

test('lost atomic response retries identical key and payload after close/reopen without duplicate create or payment', async () => {
  const { state, creates, links, atomic, committed, failLink } = setup(); state.openCostFromBank(bank); failLink(true);
  const draft = { ...state.costDraft(), amountExclEur: 100, vatPct: 21, vatRegime: 'BE', vatRegimeConfirmed: true };
  const file = { name: 'original.pdf' }; state.costFiles.set([file]);
  const saved = await state.saveCost(draft, { bankTransaction: bank });
  assert.equal(saved, null); assert.equal(atomic.length, 1); assert.ok(state.costBankCreatePending());
  assert.equal(await state.saveCost({ ...draft, description: 'Changed after uncertain outcome' }, { bankTransaction: bank }), null);
  assert.equal(atomic.length, 1);
  state.costDraft.set(null); state.costBankTransaction.set(null); state.costFiles.set([]);
  state.openCostFromBank(bank); assert.equal(state.costDraft().description, draft.description); assert.equal(state.costFiles()[0], file);
  failLink(false); const retried = await state.saveCost(state.costDraft(), { bankTransaction: bank });
  assert.equal(retried.id, 42); assert.equal(retried.payments[0].id, 80); assert.equal(atomic.length, 2);
  assert.equal(atomic[0].body.requestId, atomic[1].body.requestId); assert.equal(atomic[0].body.cost, atomic[1].body.cost);
  assert.equal(creates.length + links.length, 0); assert.equal(committed.size, 1); assert.equal(state.costBankCreatePending(), null);
});

test('definite validation rejection unlocks correction while conflict keeps the original retry operation', async () => {
  for (const status of [400, 422, 409]) {
    const { state } = setup(); state.openCostFromBank(bank);
    state.finance.createCostFromBank = async () => { throw { status, message: 'Rejected' }; };
    assert.equal(await state.saveCost(state.costDraft(), { bankTransaction: bank }), null);
    assert.equal(!!state.costBankCreatePending(), status === 409);
  }
});

test('required-source errors report only current failures of requested data, not unrelated sources', () => {
  const { state } = setup(); state.errorMap = signal({ costs: 'Kosten: offline', orders: 'Facturen: offline', attachments: 'Documenten: offline' });
  assert.deepEqual(Array.from(state.sourceErrors(['costs', 'orders', 'costs', 'statements'])), ['Kosten: offline', 'Facturen: offline']);
  state.errorMap.set({ attachments: 'Documenten: offline' }); assert.equal(state.sourceErrors(['costs', 'orders']).length, 0);
});

test('another staff member conflict refreshes the bank and opens the existing cost without creating anything', async () => {
  const { state, creates, atomic } = setup(); state.openCostFromBank(bank);
  state.finance.createCostFromBank = async () => { throw { status: 409, message: 'Deze banktransactie is al gekoppeld' }; };
  await state.saveCost(state.costDraft(), { bankTransaction: bank }); assert.ok(state.costBankCreateConflict());
  const locations: any[] = [], actions: any[] = [], inspected: any[] = [];
  state.reload = async () => { state.bankStatements.set([{ ...bank, allocated: true }]); state.costs.set([{ id: 81, payments: [{ bankStatementLineId: 70 }] }]); };
  state.go = (location: any) => locations.push(location); state.inspectItem = (item: any) => inspected.push(item);
  state.ui.toast = (_text: string, _kind: string, action: any) => { if (action) actions.push(action); };
  await state.reviewCostBankConflict();
  assert.equal(state.costBankCreatePending(), null); assert.equal(state.costDraft(), null); assert.equal(locations[0].account, 'KBC');
  actions[0].run(); assert.equal(inspected[0].id, 81); assert.equal(creates.length + atomic.length, 0);
});

test('editing imported supplier-credit classification preserves its negative original gross and net amounts', async () => {
  const { state, creates, links } = setup();
  const original = { ...blankCost('2026-10-01'), id: 95, description: 'Leverancierscreditnota', party: 'Example Supplier',
    reference: 'CN-95', amountExclEur: -78.99, amountInclEur: -95.58, vatPct: null, vatRegime: null, vatRegimeConfirmed: false };
  const updates: any[] = []; state.costs.set([original]); state.openCost(original);
  state.finance.updateCost = async (id: number, body: any) => { updates.push({ id, body }); return { ...body, id }; };
  const saved = await state.saveCost({ ...original, category: 'RECLAME', vatRegime: 'BE', vatRegimeConfirmed: true });
  assert.equal(saved.id, 95); assert.equal(updates.length, 1); assert.equal(updates[0].body.amountInclEur, -95.58);
  assert.equal(updates[0].body.amountExclEur, -78.99); assert.equal(updates[0].body.reference, 'CN-95');
  assert.equal(updates[0].body.category, 'RECLAME'); assert.equal(updates[0].body.vatRegime, 'BE');
  assert.equal(creates.length + links.length, 0); assert.equal(state.costs()[0].amountInclEur, -95.58);
});

const Sheet = await selectedClass('../src/app/features/finance/cost-sheet.ts', 'CostSheet', [
  'bankOrigin', 'selectedBank', 'bankCreatePending', 'toBank', 'regimeProblem', 'fitAmountTo', 'patch', 'setVat', 'close', 'save',
], {
  storedIncl: (cost: any) => cost.amountInclEur || 0, exclFromIncl, fitAmountToRegime, bankTransactionDay,
  NO_VAT_REGIMES: new Set(['EXEMPT', 'OUT_OF_SCOPE', 'NO_INVOICE']), REVERSE_CHARGE,
  // Country/classification rules have their own focused tests; this host supplies their public guard result.
  regimeProblem: (draft: any) => draft.vatRegime ? null : 'Kies eerst de btw-regeling',
});
function sheetFor(state: any) {
  // The real component injects state before its field initializers run.
  Sheet.prototype.state = state; Sheet.prototype.preference = { on: true, accountKey: 'OLD' };
  const sheet = new Sheet();
  Object.assign(sheet, {
    draft: signal(state.costDraft()), mode: signal('incl'), typedIncl: true, totalKept: false,
    sourceLocked: () => false, vatShown: () => !['EXEMPT', 'OUT_OF_SCOPE', 'NO_INVOICE'].includes(sheet.draft().vatRegime),
    tried: signal(false), canSave: () => !sheet.regimeProblem(), pending: signal<any[]>(state.costFiles()), becomingPaid: () => true,
    account: () => 'OLD',
  });
  return sheet;
}

test('cost form preselects the bank, requires explicit VAT and preserves gross when choosing rate', () => {
  const { state } = setup(); state.openCostFromBank(bank); const sheet = sheetFor(state);
  assert.equal(sheet.selectedBank(), bank); assert.equal(sheet.toBank(), false); assert.match(sheet.regimeProblem(), /btw-regeling/);
  sheet.patch({ vatRegime: 'BE', vatRegimeConfirmed: true, supplierCountry: 'BE' }); sheet.fitAmountTo('BE', null);
  assert.equal(sheet.draft().vatPct, null); assert.equal(sheet.draft().amountInclEur, 121); assert.match(sheet.regimeProblem(), /percentage/);
  sheet.setVat(21); assert.equal(sheet.draft().amountExclEur, 100); assert.equal(sheet.draft().amountInclEur, 121); assert.equal(sheet.regimeProblem(), null);
  sheet.setVat(0); assert.equal(sheet.draft().amountExclEur, 121); assert.equal(sheet.regimeProblem(), null);
  sheet.close(); assert.equal(state.costBankTransaction(), null); assert.equal(state.costDraft(), null);
});

test('the form retains uploaded files and passes its bank selection without changing manual-bank preferences', async () => {
  const { state, creates, links, atomic } = setup(); state.openCostFromBank(bank); const sheet = sheetFor(state);
  sheet.patch({ vatRegime: 'BE', vatRegimeConfirmed: true, supplierCountry: 'BE' }); sheet.setVat(21);
  const attachments: any[] = [], file = { name: 'invoice.pdf' }; sheet.pending.set([file]);
  state.rememberPayToBank = () => { throw new Error('Bank selection must not change manual-bank preference'); };
  state.attach = async (costId: number, files: any[]) => { attachments.push({ costId, files }); };
  await sheet.save();
  assert.equal(creates.length + links.length, 0); assert.equal(atomic.length, 1); assert.equal(attachments[0].costId, 42);
  assert.equal(attachments[0].files[0], file); assert.equal(state.costFiles().length, 0);
});

test('files upload once only after the lost atomic response is recovered, including closing and reopening', async () => {
  const { state, committed, atomic, failLink } = setup(); state.openCostFromBank(bank); const sheet = sheetFor(state);
  sheet.patch({ vatRegime: 'BE', vatRegimeConfirmed: true, supplierCountry: 'BE' }); sheet.setVat(21);
  const files = [{ name: 'invoice.pdf' }], uploads: any[] = []; sheet.pending.set(files);
  state.attach = async (costId: number, items: any[]) => { uploads.push({ costId, items }); };
  failLink(true); await sheet.save(); assert.equal(uploads.length, 0); assert.equal(sheet.bankCreatePending(), true);
  sheet.close(); state.openCostFromBank(bank); const retry = sheetFor(state);
  assert.equal(retry.pending()[0], files[0]); failLink(false); await retry.save();
  assert.equal(committed.size, 1); assert.equal(atomic.length, 2); assert.equal(uploads.length, 1); assert.equal(uploads[0].costId, 42);
});

test('upload failure keeps the already-created cost reachable and never retries financial creation', async () => {
  const { state, creates, atomic, notices } = setup(); state.openCostFromBank(bank);
  const saved = await state.saveCost(state.costDraft(), { bankTransaction: bank });
  const inspected: any[] = [], actions: any[] = [];
  state.uploading = signal(false); state.reloadAttachments = async () => {};
  state.media = { upload: async () => { throw new Error('Attachment offline'); } };
  state.inspectItem = (item: any) => inspected.push(item);
  state.ui.toast = (text: string, _kind: string, action: any) => { notices.push(text); if (action) actions.push(action); };
  await state.attach(saved.id, [{ name: 'invoice.pdf' }]);
  assert.match(notices.at(-1)!, /kost blijft bewaard/); actions[0].run(); assert.equal(inspected[0].id, 42);
  assert.equal(state.costs()[0].id, 42); assert.equal(atomic.length, 1); assert.equal(creates.length, 0);
});
