import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { isAdvanceDocument } from '../src/app/features/sales/sales-payment-state.ts';

async function helpers(file: string, globals: Record<string, unknown>) {
  const source = await readFile(new URL(`../src/app/features/sales/${file}.ts`, import.meta.url), 'utf8');
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const executable = ts.factory.updateSourceFile(parsed, parsed.statements.filter(node => !ts.isImportDeclaration(node)));
  const javascript = ts.transpileModule(ts.createPrinter().printFile(executable), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: Record<string, any> = {};
  vm.runInNewContext(javascript, { exports, ...globals });
  return exports;
}
const { advanceContentsFor } = await helpers('sales-advance-contents-state', { isAdvanceDocument, Intl });
const { advancePurchasePricing } = await helpers('sales-advance-pricing', { advanceContentsFor });

function fixture(): { view: any; purchase: any } {
  return {
    view: {
      order: { id: 81, docType: 'FACTUUR', purpose: 'PARTNER_ADVANCE', partnerPurchaseOrderId: 45, lines: [] },
      priced: { totals: { total: 18145.27 } },
      advanceContents: { purchaseOrderId: 45, lines: [{ productId: 2, productName: 'Vastgelegde roos', quantity: 8460 }], totals: { pieces: 8460 } },
    },
    purchase: {
      order: { id: 45 },
      costing: {
        lines: [{ productId: 2, quantity: 8460, landedUnitEur: 6.3743, totalEur: 53926.82 }],
        totals: { totalEur: 53926.82, separateCostsEur: 509, separateCostsInPiecePrice: false, totalWithSeparateCostsEur: 54435.82 },
      },
    },
  };
}

test('internal advance pricing uses exact purchase row and container totals without changing its invoice claim', () => {
  const { view, purchase } = fixture(), before = JSON.stringify({ view, purchase });
  const prices = advancePurchasePricing(view, purchase);
  assert.equal(prices.lines[0].unitPriceEur, 6.3743);
  assert.equal(prices.lines[0].totalEur, 53926.82);
  assert.notEqual(prices.lines[0].totalEur, Math.round(6.3743 * 8460 * 100) / 100);
  assert.equal(prices.totalEur, 54435.82);
  assert.equal(prices.goodsTotalEur, 53926.82);
  assert.equal(prices.separateCostsEur, 509);
  assert.equal(prices.separateCostsIncluded, false);
  assert.equal(prices.contentsDiffer, false);
  assert.equal(JSON.stringify({ view, purchase }), before);
  assert.equal(view.priced.totals.total, 18145.27);
});

test('costs already spread into products are identified as included and never added twice', () => {
  const { view, purchase } = fixture();
  purchase.costing.totals.separateCostsInPiecePrice = true;
  purchase.costing.totals.totalEur = 54435.82;
  purchase.costing.lines[0].totalEur = 54435.82;
  const prices = advancePurchasePricing(view, purchase);
  assert.equal(prices.separateCostsIncluded, true);
  assert.equal(prices.totalEur, 54435.82);
  assert.equal(prices.goodsTotalEur, 54435.82);
});

test('changed purchase quantities are explicit and never prorated to the frozen cargo quantity', () => {
  const { view, purchase } = fixture();
  purchase.costing.lines[0].quantity = 8400;
  purchase.costing.lines[0].totalEur = 53800.01;
  const prices = advancePurchasePricing(view, purchase);
  assert.equal(prices.lines[0].quantityDiffers, true);
  assert.equal(prices.lines[0].quantity, 8400);
  assert.equal(prices.lines[0].totalEur, 53800.01);
  assert.equal(prices.contentsDiffer, true);
  assert.equal(view.advanceContents.lines[0].quantity, 8460);
});

test('missing, duplicate and newly added products do not borrow another product price', () => {
  const { view, purchase } = fixture();
  purchase.costing.lines[0].productId = 3;
  let prices = advancePurchasePricing(view, purchase);
  assert.equal(prices.lines[0].unitPriceEur, null);
  assert.equal(prices.lines[0].totalEur, null);
  assert.equal(prices.contentsDiffer, true);
  purchase.costing.lines[0].productId = 2;
  purchase.costing.lines.push({ ...purchase.costing.lines[0] });
  prices = advancePurchasePricing(view, purchase);
  assert.equal(prices.lines[0].totalEur, null, 'Ambiguous source rows cannot duplicate a claim');
  purchase.costing.lines.pop();
  view.advanceContents.lines.push({ ...view.advanceContents.lines[0] });
  assert.equal(advancePurchasePricing(view, purchase).lines[0].totalEur, null);
});

test('missing totals and nonfinite prices stay unknown rather than becoming zero or being reconstructed', () => {
  const { view, purchase } = fixture();
  delete purchase.costing.totals.totalWithSeparateCostsEur;
  purchase.costing.lines[0].landedUnitEur = Number.NaN;
  purchase.costing.lines[0].totalEur = Number.POSITIVE_INFINITY;
  const prices = advancePurchasePricing(view, purchase);
  assert.equal(prices.totalEur, null);
  assert.equal(prices.lines[0].unitPriceEur, null);
  assert.equal(prices.lines[0].totalEur, null);
  purchase.costing.lines[0].landedUnitEur = 0;
  purchase.costing.lines[0].totalEur = 0;
  assert.equal(advancePurchasePricing(view, purchase).lines[0].totalEur, 0);
});

test('ordinary sales, unavailable purchases and stale responses for another container have no pricing projection', () => {
  const { view, purchase } = fixture();
  assert.equal(advancePurchasePricing(view, null), null);
  purchase.order.id = 50;
  assert.equal(advancePurchasePricing(view, purchase), null);
  purchase.order.id = 45;
  for (const purpose of ['STANDARD', 'PARTNER_SETTLEMENT']) {
    view.order.purpose = purpose;
    assert.equal(advancePurchasePricing(view, purchase), null);
  }
  view.order.purpose = 'PARTNER_ADVANCE';
  view.order.docType = 'OFFERTE';
  assert.equal(advancePurchasePricing(view, purchase), null);
});
