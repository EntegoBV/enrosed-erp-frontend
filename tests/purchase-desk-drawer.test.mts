import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { computed, signal } from '@angular/core';

/*
 * The container desk's panel (Inkoop redesign I3) run, not read: the desk's own
 * drawer methods lifted out of purchase-desk.ts with real signals and the real
 * keyContext. Below PDK_DOCK_MIN_PX the panel is a drawer that showRail opens
 * (the partner deep link included); Esc closes it, but never an Esc meant for
 * a field or already used by one, and never behind a sheet.
 */
class FakeElement {
  focused = 0;
  isConnected = true;
  readonly tagName: string;
  constructor(tagName: string) { this.tagName = tagName; }
  focus() { this.focused++; }
  closest() { return null; }
}
class FakeHTMLElement extends FakeElement { isContentEditable = false; }
class FakeInput extends FakeHTMLElement { type = 'text'; constructor() { super('INPUT'); } }
class FakeTextArea extends FakeHTMLElement { constructor() { super('TEXTAREA'); } }
class FakeSelect extends FakeHTMLElement { constructor() { super('SELECT'); } }
let overlayOpen = false;
const fakeDocument = { body: null, activeElement: null as FakeElement | null, querySelector: (selector: string) => (overlayOpen && selector.includes('.overlay') ? {} : null) };
Object.assign(globalThis, { Element: FakeElement, HTMLElement: FakeHTMLElement, HTMLInputElement: FakeInput, HTMLTextAreaElement: FakeTextArea,
  HTMLSelectElement: FakeSelect, document: fakeDocument });
const { keyContext } = await import('../src/app/shared/key-context.ts');

const source = await readFile(new URL('../src/app/features/purchasing/purchase-desk.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('purchase-desk.ts', source, ts.ScriptTarget.Latest, true);
const desk = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'PurchaseDesk');
assert.ok(desk);
const wanted = new Set(['railTab', 'mainView', 'hasPartnerTab', 'activeRailTab', 'railDocked', 'drawerOpen', 'drawerShown', 'viewSwitched', 'drawerOpener',
  'switchView', 'toggleDrawer', 'openDrawer', 'closeDrawer', 'onDrawerEscape', 'onDrawerOutside', 'showRail']);
const members = desk.members.filter((member) => member.name && ts.isIdentifier(member.name) && wanted.has(member.name.text))
  .map((member) => ts.canHaveDecorators(member) && ts.getDecorators(member)?.length
    ? (ts.isMethodDeclaration(member) ? ts.factory.updateMethodDeclaration(member, member.modifiers?.filter((m) => !ts.isDecorator(m)), member.asteriskToken,
        member.name, member.questionToken, member.typeParameters, member.parameters, member.type, member.body) : member)
    : member);
assert.equal(members.length, wanted.size, 'every lifted member is still on the desk');
const constants = parsed.statements.filter((node) => ts.isVariableStatement(node)
  && ['PDK_DOCK_MIN_PX', 'OVERLAY'].includes(node.declarationList.declarations[0].name.getText(parsed)));
assert.equal(constants.length, 2);
const isolated = ts.factory.updateClassDeclaration(desk, desk.modifiers?.filter((modifier) => !ts.isDecorator(modifier)), desk.name, undefined, undefined, members);
const javascript = ts.transpileModule(ts.createPrinter().printList(ts.ListFormat.MultiLine, ts.factory.createNodeArray([...constants, isolated] as ts.Statement[]), parsed), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText + '\nexports.PurchaseDesk = PurchaseDesk;';

function setup(width: number, partner = true) {
  overlayOpen = false;
  const exports: Record<string, any> = {};
  vm.runInNewContext(javascript, { exports, signal, computed, keyContext, document: fakeDocument, requestAnimationFrame: () => 0 });
  const screen = new exports['PurchaseDesk']();
  Object.assign(screen, {
    hostWidth: signal(width), host: { nativeElement: { contains: () => true } },
    view: signal({ order: { id: 47, partnerCustomerId: partner ? 5 : null } }),
  });
  return { desk: screen, PDK_DOCK_MIN_PX: exports['PDK_DOCK_MIN_PX'] as number };
}

function escape(target: FakeElement, defaultPrevented = false) {
  return { key: 'Escape', target, defaultPrevented, metaKey: false, ctrlKey: false, preventDefault() { this.defaultPrevented = true; } };
}

test('below the dock width the partner deep link opens the drawer on Partner; docked it only picks the tab', () => {
  const narrow = setup(1100);
  assert.ok(1100 < narrow.PDK_DOCK_MIN_PX);
  narrow.desk.mainView.set('payments');
  narrow.desk.showRail('partner', false);
  assert.deepEqual([narrow.desk.drawerOpen(), narrow.desk.drawerShown(), narrow.desk.activeRailTab(), narrow.desk.mainView()], [true, true, 'partner', 'products']);
  const wide = setup(1440);
  wide.desk.showRail('partner', false);
  assert.deepEqual([wide.desk.drawerOpen(), wide.desk.drawerShown(), wide.desk.railDocked(), wide.desk.activeRailTab()], [false, false, true, 'partner']);
});

test('Esc typed in a drawer field, or already used by one, leaves the drawer open', () => {
  const { desk } = setup(1100);
  const opener = new FakeHTMLElement('BUTTON');
  desk.toggleDrawer('order', { currentTarget: opener });
  assert.equal(desk.drawerShown(), true);
  const typing = escape(new FakeInput());
  desk.onDrawerEscape(typing);
  assert.equal(desk.drawerOpen(), true, 'Track & trace or the Order form: the Esc is the field\'s');
  assert.equal(typing.defaultPrevented, false);
  desk.onDrawerEscape(escape(new FakeTextArea()));
  assert.equal(desk.drawerOpen(), true);
  desk.onDrawerEscape(escape(new FakeHTMLElement('BUTTON'), true));
  assert.equal(desk.drawerOpen(), true, 'the document rename cancelled itself with this Esc');
  overlayOpen = true;
  desk.onDrawerEscape(escape(new FakeHTMLElement('BUTTON')));
  assert.equal(desk.drawerOpen(), true, 'a sheet above the drawer takes the Esc');
  overlayOpen = false;
  const plain = escape(new FakeHTMLElement('BUTTON'));
  desk.onDrawerEscape(plain);
  assert.equal(desk.drawerOpen(), false);
  assert.equal(plain.defaultPrevented, true);
  assert.equal(opener.focused, 1, 'focus goes back to the bar button that opened it');
});

test('the same bar button closes its drawer; a docked desk ignores Esc', () => {
  const { desk } = setup(1100);
  desk.toggleDrawer('files', { currentTarget: new FakeHTMLElement('BUTTON') });
  assert.equal(desk.drawerOpen(), true);
  desk.toggleDrawer('files', { currentTarget: new FakeHTMLElement('BUTTON') });
  assert.equal(desk.drawerOpen(), false);
  const docked = setup(1440).desk;
  const event = escape(new FakeHTMLElement('BUTTON'));
  docked.onDrawerEscape(event);
  assert.equal(event.defaultPrevented, false);
});
