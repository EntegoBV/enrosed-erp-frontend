import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { batchFormat } from '../src/app/core/api/stock-batch-units.ts';
import type {
  StockBatchBackfillReport, StockBatchBackfillRow, StockBatchCheckRow, StockBatchStatus,
} from '../src/app/core/api/stock-batch-models.ts';
import {
  FLAGGED_LIMIT, backfillFigures, backfillRowText, backfillRowValue, backfillRowValueTitle, checkLinkShown, checkRowText, flaggedRows,
  notBookedText, partnerValue, productsText, repairedCount, signedCount, statusBanner,
} from '../src/app/features/products/stock-batch-start.ts';

/* Intl writes a no-break space between € and the figure; compare with a plain space. */
const plain = (text: string) => text.replace(/[\u00a0\u202f]/g, ' ');
const fmt = batchFormat({ singular: 'stuk', plural: 'stuks' });

function row(overrides: Partial<StockBatchBackfillRow> = {}): StockBatchBackfillRow {
  return { productId: 94, sku: 'DOM-15X30-BL', name: 'Dome 15x30 blauw', unitPieces: 12, stockPieces: 1260, openingPieces: 0,
    unassignedPieces: 0, valueEur: 873.39, flags: [], notes: [],
    batches: [{ purchaseOrderId: 39, orderNumber: 'PO-2026-005', kind: 'RECEIPT', owner: 'OWN', piecesIn: 6000, piecesLeft: 1260,
      unitCostEur: 8.318, costState: 'APPLIED' }], ...overrides };
}

function report(overrides: Partial<StockBatchBackfillReport> = {}): StockBatchBackfillReport {
  return { dryRun: true, startedAt: null, products: 212, batches: 431, openingPieces: 1840, unassignedPieces: 6, valueEur: 184220.1,
    rows: [], notBooked: [], ...overrides };
}

function status(overrides: Partial<StockBatchStatus> = {}): StockBatchStatus {
  return { started: true, paused: false, startedAt: '2026-10-26T09:12:00Z', startedBy: 'emre', pausedAt: null, pausedBy: null,
    differences: 0, ...overrides };
}

function check(overrides: Partial<StockBatchCheckRow> = {}): StockBatchCheckRow {
  return { productId: 94, sku: 'DOM-15X30-BL', name: 'Dome 15x30 blauw', unitPieces: 1, stockPieces: 1260, batchPieces: 1250,
    unassignedPieces: 0, differencePieces: -10, ...overrides };
}

test('backfillFigures: Producten, Batches, Beginvoorraad and Zonder batch in pieces, Waarde in whole euros', () => {
  const figures = backfillFigures(report(), fmt);
  assert.deepEqual(figures.map((figure) => figure.label), ['Producten', 'Batches', 'Beginvoorraad', 'Zonder batch', 'Waarde']);
  assert.deepEqual(figures.map((figure) => plain(figure.value)), ['212', '431', '1.840 st', '6 st', '€ 184.220']);
  /* The cents stay one hover away; without partner batches there is no partner line. */
  assert.equal(plain(figures[4].title ?? ''), '€ 184.220,10');
  assert.equal(figures[4].sub, undefined);
  assert.deepEqual(backfillFigures(report({ products: 0, batches: 0, openingPieces: 0, unassignedPieces: 0, valueEur: 0 }), fmt)
    .map((figure) => plain(figure.value)), ['0', '0', '0 st', '0 st', '€ 0']);
});

test('flaggedRows keeps the server order and drops rows without a flag', () => {
  const rows = [row({ productId: 1, flags: ['OPENING'] }), row({ productId: 2 }), row({ productId: 3, flags: ['PARTNER'] })];
  assert.deepEqual(flaggedRows(report({ rows })).map((item) => item.productId), [1, 3]);
  assert.equal(FLAGGED_LIMIT, 30);
});

test('backfillRowText: Beginvoorraad at the card cost, negative notes, kost onbekend, partner pieces', () => {
  const opening = row({ flags: ['OPENING'], openingPieces: 100, batches: [
    { purchaseOrderId: null, orderNumber: null, kind: 'OPENING', owner: 'OWN', piecesIn: 100, piecesLeft: 100, unitCostEur: 2.5, costState: 'CARD' },
  ] });
  assert.deepEqual(backfillRowText(opening, fmt), { title: 'DOM-15X30-BL · Dome 15x30 blauw', sub: 'Beginvoorraad 100 st · kost van productkaart' });

  const negative = row({ flags: ['NEGATIVE'], unassignedPieces: 3, notes: ['Negatief op Tica Brussel: −3'] });
  assert.equal(backfillRowText(negative, fmt).sub, 'Negatief op Tica Brussel: −3');
  assert.equal(backfillRowText(row({ flags: ['NEGATIVE'], unassignedPieces: 3 }), fmt).sub, 'Negatief: −3 st', 'no note from the server');

  const everything = row({ sku: 'VAS-S', name: 'Ceramic vase S', unitPieces: 1, flags: ['OPENING', 'NEGATIVE', 'NO_COST', 'PARTNER'],
    openingPieces: 1500, unassignedPieces: 6, notes: ['Negatief op Showroom: −6', 'Negatief op Tica Brussel: −2'], batches: [
      { purchaseOrderId: null, orderNumber: null, kind: 'OPENING', owner: 'OWN', piecesIn: 1500, piecesLeft: 1500, unitCostEur: null, costState: 'NONE' },
      { purchaseOrderId: 44, orderNumber: 'PO-2026-008', kind: 'RECEIPT', owner: 'PARTNER', piecesIn: 100, piecesLeft: 60, unitCostEur: 3.1, costState: 'APPLIED' },
      { purchaseOrderId: 46, orderNumber: 'PO-2026-013', kind: 'RECEIPT', owner: 'PARTNER', piecesIn: 50, piecesLeft: 50, unitCostEur: 3.1, costState: 'CALCULATED' },
    ] });
  /* An opening batch without a card cost does not claim "kost van productkaart"; NO_COST says it. */
  assert.equal(backfillRowText(everything, fmt).sub,
    'Beginvoorraad 1.500 st · Negatief op Showroom: −6 · Negatief op Tica Brussel: −2 · kost onbekend · partner 110 st');

  assert.equal(backfillRowText(row({ sku: '', flags: ['NO_COST'] }), fmt).title, 'Dome 15x30 blauw', 'no SKU, no leading dot');
});

test('backfillRowValue: whole euros of own and partner batches, "—" when nothing in the row has a cost', () => {
  assert.equal(plain(backfillRowValue(row(), fmt)), '€ 873');
  assert.equal(backfillRowValueTitle(row(), fmt), null, 'no partner stock, no tooltip');
  assert.equal(backfillRowValue(row({ flags: ['OPENING', 'NO_COST'], valueEur: 0 }), fmt), '—');
  assert.equal(plain(backfillRowValue(row({ flags: ['NO_COST'], valueEur: 120.4 }), fmt)), '€ 120', 'a partly known value still shows');
  /* Only partner pieces (every container on production, 2026-10-26): the row shows their value, never "€ 0". */
  const partnerOnly = row({ flags: ['PARTNER'], valueEur: 0, batches: [
    { purchaseOrderId: 44, orderNumber: 'PO-2026-008', kind: 'RECEIPT', owner: 'PARTNER', piecesIn: 6000, piecesLeft: 1260, unitCostEur: 8.318, costState: 'APPLIED' },
  ] });
  assert.equal(partnerValue(partnerOnly), 873.39, 'unit cost per sales unit × pieces left ÷ 12, as the server values own batches');
  assert.equal(plain(backfillRowValue(partnerOnly, fmt)), '€ 873');
  assert.equal(plain(backfillRowValueTitle(partnerOnly, fmt) ?? ''), '€ 873,39 · waarvan partner € 873,39');
  /* Own and partner together; a partner batch without stock adds nothing. */
  const mixed = row({ flags: ['PARTNER'], valueEur: 873.39, batches: [...row().batches,
    { purchaseOrderId: 44, orderNumber: 'PO-2026-008', kind: 'RECEIPT', owner: 'PARTNER', piecesIn: 120, piecesLeft: 120, unitCostEur: 9, costState: 'CALCULATED' },
    { purchaseOrderId: 46, orderNumber: 'PO-2026-013', kind: 'RECEIPT', owner: 'PARTNER', piecesIn: 60, piecesLeft: 0, unitCostEur: 9, costState: 'APPLIED' },
  ] });
  assert.equal(partnerValue(mixed), 90);
  assert.equal(plain(backfillRowValue(mixed, fmt)), '€ 963');
  assert.equal(plain(backfillRowValueTitle(mixed, fmt) ?? ''), '€ 963,39 · waarvan partner € 90,00');
  /* Partner stock without a cost: "kost onbekend" in the sub, "—" as value; with a cost on part of it, that part shows. */
  const unknown = row({ unitPieces: 1, flags: ['NO_COST', 'PARTNER'], valueEur: 0, batches: [
    { purchaseOrderId: 44, orderNumber: 'PO-2026-008', kind: 'RECEIPT', owner: 'PARTNER', piecesIn: 50, piecesLeft: 50, unitCostEur: null, costState: 'NONE' },
  ] });
  assert.equal(backfillRowValue(unknown, fmt), '—');
  assert.match(backfillRowText(unknown, fmt).sub, /kost onbekend · partner 50 st$/);
  assert.equal(backfillRowValueTitle(unknown, fmt), null);
  const partly = row({ unitPieces: 1, flags: ['NO_COST', 'PARTNER'], valueEur: 0, batches: [...unknown.batches,
    { purchaseOrderId: 46, orderNumber: 'PO-2026-013', kind: 'RECEIPT', owner: 'PARTNER', piecesIn: 10, piecesLeft: 10, unitCostEur: 3.1, costState: 'APPLIED' },
  ] });
  assert.equal(plain(backfillRowValue(partly, fmt)), '€ 31');
  /* Stock worth less than a euro shows its cents rather than "€ 0". */
  const cheap = row({ unitPieces: 1, flags: ['PARTNER'], valueEur: 0, batches: [
    { purchaseOrderId: 44, orderNumber: 'PO-2026-008', kind: 'RECEIPT', owner: 'PARTNER', piecesIn: 4, piecesLeft: 4, unitCostEur: 0.08, costState: 'APPLIED' },
  ] });
  assert.equal(plain(backfillRowValue(cheap, fmt)), '€ 0,32');
  /* A display product: the cost is per display, pieces left are pieces (100 pieces = 8 displays + 4 loose). */
  assert.equal(partnerValue(row({ unitPieces: 12, batches: [
    { purchaseOrderId: 44, orderNumber: 'PO-2026-008', kind: 'RECEIPT', owner: 'PARTNER', piecesIn: 100, piecesLeft: 100, unitCostEur: 24, costState: 'APPLIED' },
  ] })), 200);
});

test('an all-partner preview: Waarde counts the partner stock and names it, the rows show their value', () => {
  const partner = (productId: number, sku: string, unitPieces: number, piecesLeft: number, unitCostEur: number | null): StockBatchBackfillRow => row({
    productId, sku, name: sku, unitPieces, stockPieces: piecesLeft, valueEur: 0, flags: unitCostEur === null ? ['NO_COST', 'PARTNER'] : ['PARTNER'],
    batches: [{ purchaseOrderId: 44, orderNumber: 'PO-2026-008', kind: 'RECEIPT', owner: 'PARTNER', piecesIn: piecesLeft, piecesLeft, unitCostEur,
      costState: unitCostEur === null ? 'NONE' : 'APPLIED' }],
  });
  const rows = [partner(1, 'DOM-15X30-BL', 12, 1260, 8.318), partner(2, 'VAS-S', 1, 400, 3.1), partner(3, 'VAS-L', 1, 25, null)];
  const preview = report({ products: 3, batches: 3, openingPieces: 0, unassignedPieces: 0, valueEur: 0, rows });
  const figures = backfillFigures(preview, fmt);
  assert.equal(plain(figures[4].value), '€ 2.113', '873,39 + 1.240,00 of partner stock, not "€ 0"');
  assert.equal(plain(figures[4].sub ?? ''), 'waarvan partner € 2.113');
  assert.equal(plain(figures[4].title ?? ''), '€ 2.113,39 · waarvan partner € 2.113,39');
  assert.deepEqual(flaggedRows(preview).map((item) => plain(backfillRowValue(item, fmt))), ['€ 873', '€ 1.240', '—']);
  assert.deepEqual(flaggedRows(preview).map((item) => backfillRowText(item, fmt).sub), ['partner 1.260 st', 'partner 400 st', 'kost onbekend · partner 25 st']);
  /* Own and partner together: the own value of the server plus the partner part. */
  const mixed = backfillFigures(report({ valueEur: 184220.1, rows }), fmt)[4];
  assert.equal(plain(mixed.value), '€ 186.333');
  assert.equal(plain(mixed.title ?? ''), '€ 186.333,49 · waarvan partner € 2.113,39');
});

test('the start sheet shows the partner line under Waarde and the row tooltip', async () => {
  const sheet = await readFile(new URL('../src/app/features/products/stock-batch-start-sheet.ts', import.meta.url), 'utf8');
  assert.match(sheet, /@if \(figure\.sub\) \{ <small class="sbs-figs__sub">\{\{ figure\.sub \}\}<\/small> \}/);
  assert.match(sheet, /\[attr\.title\]="backfillValueTitle\(row\)"/);
});

test('notBookedText names every received container that was never booked', () => {
  assert.equal(notBookedText(report()), null);
  assert.equal(notBookedText(report({ notBooked: [{ purchaseOrderId: 51, orderNumber: 'PO-2026-019' }, { purchaseOrderId: 52, orderNumber: 'PO-2026-020' }] })),
    'Niet bijgeboekt: PO-2026-019, PO-2026-020');
});

test('checkRowText: voorraad, batches, zonder batch and the signed difference', () => {
  assert.deepEqual(checkRowText(check(), fmt), { title: 'DOM-15X30-BL · Dome 15x30 blauw',
    sub: 'voorraad 1.260 · batches 1.250 · zonder batch 0', value: '−10' });
  assert.equal(checkRowText(check({ batchPieces: 1268, unassignedPieces: 6, differencePieces: 2 }), fmt).value, '+2');
  /* A display product reads in displays plus loose pieces, the difference too. */
  const display = checkRowText(check({ unitPieces: 12, stockPieces: 1264, batchPieces: 1254, unassignedPieces: 0, differencePieces: -10 }), fmt);
  assert.equal(display.sub, 'voorraad 105 + 4 los · batches 104 + 6 los · zonder batch 0');
  assert.equal(display.value, '−10 los');
  assert.equal(signedCount(14, 12, fmt), '+1 + 2 los');
  assert.equal(signedCount(0, 12, fmt), '0');
  assert.equal(signedCount(-24, 12, fmt), '−2');
});

test('statusBanner: not started, paused, differences, and nothing when the batches run clean', () => {
  assert.equal(statusBanner(null), null, 'no status (failed or older backend): nothing about batches');
  assert.deepEqual(statusBanner(status({ started: false, startedAt: null, startedBy: null })),
    { text: 'Batches zijn nog niet gestart.', link: 'Batches opbouwen ›', mode: 'start', warn: false });
  assert.deepEqual(statusBanner(status({ paused: true, pausedAt: '2026-10-27T08:00:00Z', pausedBy: 'emre', differences: 2 })),
    { text: 'Batches staan op pauze.', link: 'Bekijken ›', mode: 'check', warn: true });
  assert.deepEqual(statusBanner(status({ differences: 2 })),
    { text: '2 producten wijken af van hun batches', link: 'Bekijken ›', mode: 'check', warn: true });
  assert.equal(statusBanner(status({ differences: 1 }))?.text, '1 product wijkt af van zijn batches');
  assert.equal(statusBanner(status({ differences: 1200 }))?.text, '1.200 producten wijken af van hun batches');
  assert.equal(statusBanner(status()), null);
});

test('checkLinkShown only while the batches run clean, so pause stays one click away', () => {
  assert.equal(checkLinkShown(status()), true);
  assert.equal(checkLinkShown(status({ differences: 2 })), false, 'the banner offers Bekijken');
  assert.equal(checkLinkShown(status({ paused: true })), false, 'the banner offers Bekijken');
  assert.equal(checkLinkShown(status({ started: false })), false);
  assert.equal(checkLinkShown(null), false);
});

test('toast counts: products text and how many products Herstellen cleared', () => {
  assert.equal(productsText(1, fmt), '1 product');
  assert.equal(productsText(212, fmt), '212 producten');
  assert.equal(productsText(1500, fmt), '1.500 producten');
  const before = [check({ productId: 97 }), check({ productId: 113 })];
  assert.equal(repairedCount(before, []), 2);
  assert.equal(repairedCount(before, [check({ productId: 113 })]), 1);
  assert.equal(repairedCount([], []), 0);
});

test('the module stays node-loadable: only type imports from src', async () => {
  const source = await readFile(new URL('../src/app/features/products/stock-batch-start.ts', import.meta.url), 'utf8');
  for (const line of source.split('\n').filter((item) => /^import /.test(item))) assert.match(line, /^import type /, line);
});

test('the stock page: status on load, banner on desk and phone, quiet check link, one sheet host', async () => {
  const page = await readFile(new URL('../src/app/features/products/stock-page.ts', import.meta.url), 'utf8');
  assert.match(page, /this\.stockBatches\.status\(\)/);
  assert.match(page, /<div class="wk-banner wk-banner--inset sk-batches" \[class\.wk-banner--warn\]="banner\.warn"/);
  assert.match(page, /<div class="ios-banner skp-batches" \[class\.ios-banner--info\]="!banner\.warn"/);
  assert.equal(page.match(/>Batches controleren</g)?.length, 2, 'desk subbar and phone foot');
  assert.equal(page.match(/<app-stock-batch-start-sheet /g)?.length, 1);
  assert.match(page, /\(changed\)="loadBatchStatus\(\)"/);
  const sheet = await readFile(new URL('../src/app/features/products/stock-batch-start-sheet.ts', import.meta.url), 'utf8');
  assert.match(sheet, /api\.backfill\(true\)/);
  assert.match(sheet, /api\.backfill\(false\)/);
  assert.match(sheet, /api\.repair\(\[\]\)/);
  assert.match(sheet, /Proef: er wordt nog niets bewaard\./);
  assert.match(sheet, /Geen verschillen\./);
  assert.match(sheet, /'Batches gepauzeerd' : 'Batches hervat'/);
  assert.doesNotMatch(sheet, /reset\(/, 'no screen calls the reset');
});

test('Batches opbouwen asks once more before the real start: the start locks every product (plan §7.2 R1)', async () => {
  const ts = (await import('typescript')).default;
  const vm = await import('node:vm');
  const { signal } = await import('@angular/core');
  const text = await readFile(new URL('../src/app/features/products/stock-batch-start-sheet.ts', import.meta.url), 'utf8');
  const parsed = ts.createSourceFile('stock-batch-start-sheet.ts', text, ts.ScriptTarget.Latest, true);
  const original = parsed.statements.find((node): node is import('typescript').ClassDeclaration =>
    ts.isClassDeclaration(node) && node.name?.text === 'StockBatchStartSheet');
  assert.ok(original);
  const names = new Set(['report', 'busy', 'start', 'startNow']);
  const members = original.members.filter((member) => member.name && ts.isIdentifier(member.name) && names.has(member.name.text));
  assert.equal(members.length, names.size);
  const isolated = ts.factory.updateClassDeclaration(original, original.modifiers?.filter((modifier) => !ts.isDecorator(modifier)),
    original.name, original.typeParameters, undefined, members);
  const javascript = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: Record<string, new () => any> = {};
  vm.runInNewContext(javascript, { exports, signal, productsText,
    messageOf: (failure: unknown, fallback: string) => failure instanceof Error ? failure.message : fallback });
  const calls: boolean[] = [];
  const asked: { options: { title: string; message: string; confirmLabel?: string }; yes: () => void }[] = [];
  const toasts: [string, string | undefined][] = [];
  let emitted = 0;
  const sheet = new exports['StockBatchStartSheet']();
  Object.assign(sheet, {
    fmt,
    api: { backfill: async (dryRun: boolean) => { calls.push(dryRun); return report({ dryRun, products: 3 }); } },
    ui: { confirm: (options: { title: string; message: string }, yes: () => void) => asked.push({ options, yes }),
      toast: (message: string, kind?: string) => toasts.push([message, kind]) },
    changed: { emit: () => { emitted++; } },
    closed: { emit: () => undefined },
  });
  /* Without the dry run read, nothing is asked. */
  sheet.start();
  assert.equal(asked.length, 0);
  sheet.report.set(report());
  sheet.start();
  assert.equal(asked.length, 1, 'the click asks first');
  assert.deepEqual(calls, [], 'nothing starts before the yes');
  assert.equal(asked[0].options.title, 'Batches echt opbouwen?');
  assert.match(asked[0].options.message, /alle producten liggen vast|liggen alle producten vast/);
  assert.match(asked[0].options.message, /buiten de kantooruren/);
  assert.equal(asked[0].options.confirmLabel, 'Ja, opbouwen');
  asked[0].yes();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls, [false], 'the yes starts it for real, once');
  assert.equal(emitted, 1);
  assert.equal(toasts.at(-1)?.[1], 'ok');
});
