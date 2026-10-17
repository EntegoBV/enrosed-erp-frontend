import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

/* confirmLeave lives in shared/ui.ts next to Angular components: lift just it and its words out. */
const text = await readFile(new URL('../src/app/shared/ui.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('ui.ts', text, ts.ScriptTarget.Latest, true);
const wanted = parsed.statements.filter((node) =>
  (ts.isFunctionDeclaration(node) && node.name?.text === 'confirmLeave')
  || (ts.isVariableStatement(node) && node.declarationList.declarations.some((d) => d.name.getText(parsed) === 'LEAVE_CONFIRM_TEXT')));
assert.equal(wanted.length, 2);
const js = ts.transpileModule(wanted.map((node) => node.getFullText(parsed)).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const exports: Record<string, any> = {};
vm.runInNewContext(js, { exports });
const { confirmLeave, LEAVE_CONFIRM_TEXT } = exports;

interface Asked { options: any; onConfirm: () => void; onSecondary?: () => void; onCancel?: () => void }
function fakeUi() {
  const asked: Asked[] = [];
  return { asked, confirm(options: any, onConfirm: () => void, onSecondary?: () => void, onCancel?: () => void) { asked.push({ options, onConfirm, onSecondary, onCancel }); } };
}

test('with a save function: Opslaan, Niet opslaan, Annuleren', async () => {
  const ui = fakeUi();
  let saved = 0;
  const answer = confirmLeave(ui, () => { saved++; });
  const [q] = ui.asked;
  assert.equal(q.options.title, 'Niet-opgeslagen wijzigingen');
  assert.equal(q.options.message, 'Je hebt wijzigingen die nog niet zijn opgeslagen. Opslaan voor je verdergaat?');
  assert.equal(q.options.confirmLabel, 'Opslaan');
  assert.equal(q.options.secondaryLabel, 'Niet opslaan');
  assert.ok(!q.options.danger);
  q.onConfirm();
  assert.equal(await answer, true);
  assert.equal(saved, 1);
});

test('a save that fails or says no keeps the screen', async () => {
  for (const save of [() => false, async () => false, async () => { throw new Error('409'); }]) {
    const ui = fakeUi();
    const answer = confirmLeave(ui, save);
    ui.asked[0].onConfirm();
    assert.equal(await answer, false);
  }
});

test('Niet opslaan leaves, Annuleren stays', async () => {
  const ui = fakeUi();
  const leave = confirmLeave(ui, () => true);
  ui.asked[0].onSecondary!();
  assert.equal(await leave, true);
  const stay = confirmLeave(ui, () => true);
  ui.asked[1].onCancel!();
  assert.equal(await stay, false);
});

test('without a save function: Niet opslaan (danger) or Annuleren', async () => {
  const ui = fakeUi();
  const answer = confirmLeave(ui);
  const [q] = ui.asked;
  assert.equal(q.options.message, 'Als je dit scherm verlaat, gaan je wijzigingen verloren.');
  assert.equal(q.options.confirmLabel, 'Niet opslaan');
  assert.equal(q.options.danger, true);
  assert.equal(q.onSecondary, undefined);
  q.onConfirm();
  assert.equal(await answer, true);
  const stay = confirmLeave(ui);
  ui.asked[1].onCancel!();
  assert.equal(await stay, false);
});

test("a screen may phrase the question itself; the words are the app's own", () => {
  const ui = fakeUi();
  void confirmLeave(ui, () => true, { message: 'Deze offerte heeft wijzigingen die nog niet zijn opgeslagen.' });
  assert.equal(ui.asked[0].options.message, 'Deze offerte heeft wijzigingen die nog niet zijn opgeslagen.');
  assert.doesNotMatch(JSON.stringify(LEAVE_CONFIRM_TEXT), /Bewaren|bewaard/);
});
