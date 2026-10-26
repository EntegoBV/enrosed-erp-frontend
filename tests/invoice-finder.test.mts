import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACTION_LABELS, amountText, blockedText, bronWord, containerLabel, deskDate, deskFacts, downloadName, eurApprox, linkChips, monthGroups,
  odooFact, onlyOptions, phoneSub, phoneSubParts, previewFacts, previewKind, receivedLinkReady, rowActions, rowKeyValid, scopeOf, soortWord,
  statusWord, titleLine,
} from '../src/app/features/finance/invoice-finder.ts';
import type { InvoiceFile, InvoiceRow } from '../src/app/core/api/invoice-finder-api.ts';

const file = (extra: Partial<InvoiceFile> = {}): InvoiceFile => ({
  type: 'PURCHASE_DOCUMENT', id: 245, orderId: 41, moveId: null, name: 'CI-20260412.pdf', contentType: 'application/pdf', kind: 'PDF',
  sizeBytes: 183422, archived: false, ...extra,
});

const row = (extra: Partial<InvoiceRow> = {}): InvoiceRow => ({
  key: 'pi:12', source: 'CONTAINER_INVOICE', direction: 'IN', kind: 'INVOICE', docLabel: 'Commercial invoice', number: 'CI-20260412',
  date: '2026-04-12', sortDate: '2026-04-12', dateKind: 'INVOICE', dueDate: null, amount: 18420, currency: 'USD', amountEur: 16985.2,
  paidEur: 0, openEur: 16985.2, party: { name: 'Changsha Pretty', type: 'SUPPLIER', id: 3 }, payee: 'SUPPLIER', description: null,
  category: null, salesPurpose: null, status: 'OPEN', statusReason: null, origin: 'UPLOAD', peppolState: null, odooMoveId: null, odoo: null,
  container: { id: 41, number: 'PO-2026-012', alias: 'Rozen voorjaar' },
  links: [{ type: 'CONTAINER', id: 41, label: 'Rozen voorjaar', date: null, account: null },
    { type: 'TRANSACTION', id: 7781, label: '05/05', date: '2026-05-05', account: 'BE94731074082814' }],
  files: [file()], missingFile: false, ...extra,
});

const odoo = (extra: Partial<InvoiceRow> = {}, facts: Partial<NonNullable<InvoiceRow['odoo']>> = {}): InvoiceRow => row({
  key: 'odoo:900001', source: 'ODOO', docLabel: null, number: 'VT-2026-0412', date: '2026-10-02', sortDate: '2026-10-02', amount: 1250,
  currency: 'EUR', amountEur: 1250, paidEur: null, openEur: null, party: { name: 'Verhoeven Transport BV', type: 'ODOO_PARTNER', id: 77 },
  payee: null, status: 'NEW', origin: 'ODOO', peppolState: 'done', odooMoveId: 900001, container: null, links: [],
  files: [file({ type: 'ODOO_ATTACHMENT', id: 9000011, orderId: null, moveId: 900001, name: 'VT-2026-0412.pdf' })],
  odoo: { moveId: 900001, name: 'BILL/2026/10/001', moveType: 'in_invoice', state: 'posted', paymentState: 'not_paid', registrable: true,
    blockedBy: null, mark: null, ...facts },
  ...extra,
});

const cost = (extra: Partial<InvoiceRow> = {}): InvoiceRow => row({
  key: 'cost:12', source: 'COST', docLabel: null, number: 'F-2026-118', currency: 'EUR', amount: 72.6, amountEur: 72.6, payee: null,
  party: { name: 'Proximus NV', type: 'COST_PARTY', id: 4 }, description: 'Internet oktober', category: 'TELECOM', container: null, links: [],
  files: [file({ type: 'MEDIA_ASSET', id: 501, orderId: null, name: 'proximus.pdf' })], ...extra,
});

const sales = (extra: Partial<InvoiceRow> = {}): InvoiceRow => row({
  key: 'so:9', source: 'SALES', direction: 'OUT', docLabel: null, number: 'INV-2026-0412', currency: 'EUR', amount: 1452, amountEur: 1452,
  party: { name: 'Bloemen De Smet', type: 'CUSTOMER', id: 8 }, payee: null, salesPurpose: 'STANDARD', origin: 'ENROSED',
  files: [file({ type: 'SALES_PDF', id: 9, orderId: null, name: 'INV-2026-0412.pdf' })], ...extra,
});

test('statusWord: every status, the credit words and "Ouder" before the start date', () => {
  const cases: [Partial<InvoiceRow>, string, string][] = [
    [{ status: 'PAID' }, 'Betaald', 'ok'],
    [{ status: 'PARTIAL' }, 'Deels betaald', ''],
    [{ status: 'OPEN' }, 'Open', ''],
    [{ status: 'OVERDUE' }, 'Vervallen', 'warn'],
    [{ status: 'SETTLED' }, 'Verrekend', 'ok'],
    [{ status: 'NO_DATA' }, 'Zonder gegevens', 'amber'],
    [{ status: 'NEW' }, 'Nieuw', 'accent'],
    [{ status: 'HANDLED' }, 'Afgehandeld', 'grey'],
    [{ status: 'HANDLED', statusReason: 'BEFORE_START' }, 'Ouder', 'grey'],
    [{ status: 'HANDLED', statusReason: 'COST_REMOVED' }, 'Afgehandeld', 'grey'],
    [{ status: 'CONTAINER' }, 'Bij container', 'grey'],
    [{ status: 'TICA' }, 'TICA', 'plum'],
    [{ status: 'CANCELLED' }, 'Geannuleerd', 'grey'],
  ];
  for (const [extra, label, tone] of cases) assert.deepEqual(statusWord(row(extra)), { label, tone }, JSON.stringify(extra));
  assert.equal(statusWord(sales({ kind: 'CREDIT_NOTE', status: 'PAID' })).label, 'Verrekend');
  assert.equal(statusWord(cost({ kind: 'CREDIT_NOTE', status: 'PAID' })).label, 'Terugbetaald');
  assert.equal(statusWord(cost({ kind: 'CREDIT_NOTE', status: 'OPEN' })).label, 'Te ontvangen');
  assert.equal(statusWord(sales({ kind: 'CREDIT_NOTE', status: 'OPEN' })).label, 'Open');
  assert.equal(statusWord(cost({ kind: 'CREDIT_NOTE', status: 'PARTIAL' })).label, 'Deels verrekend');
  assert.equal(statusWord(odoo({ kind: 'CREDIT_NOTE', status: 'PAID' })).label, 'Betaald');
});

test('bronWord and soortWord per source', () => {
  assert.equal(bronWord(row({ origin: 'UPLOAD' })), 'Opgeladen');
  assert.equal(bronWord(row({ origin: 'MANUAL' })), 'Ingevoerd');
  assert.equal(bronWord(odoo()), 'Odoo · Peppol');
  assert.equal(bronWord(odoo({ peppolState: null })), 'Odoo');
  assert.equal(bronWord(sales()), 'ENROSED');
  assert.equal(bronWord(sales({ peppolState: 'done' })), 'ENROSED · Peppol');

  assert.equal(soortWord(row()), 'Commercial invoice');
  assert.equal(soortWord(row({ source: 'CONTAINER_FILE', docLabel: 'Proforma invoice', kind: 'PROFORMA' })), 'Proforma invoice');
  assert.equal(soortWord(row({ docLabel: null })), 'Factuur');
  assert.equal(soortWord(cost()), 'Kost');
  assert.equal(soortWord(cost({ kind: 'CREDIT_NOTE' })), 'Creditnota');
  assert.equal(soortWord(odoo()), 'Factuur');
  assert.equal(soortWord(odoo({ kind: 'CREDIT_NOTE' })), 'Creditnota');
  assert.equal(soortWord(odoo({ direction: 'OUT' })), 'Verkoopfactuur');
  assert.equal(soortWord(odoo({ direction: 'OUT', kind: 'CREDIT_NOTE' })), 'Creditnota');
  assert.equal(soortWord(sales()), 'Verkoopfactuur');
  assert.equal(soortWord(sales({ salesPurpose: 'PARTNER_ADVANCE' })), 'Partnervoorschot');
  assert.equal(soortWord(sales({ salesPurpose: 'PARTNER_SETTLEMENT' })), 'Partnerafrekening');
  assert.equal(soortWord(sales({ kind: 'CREDIT_NOTE', salesPurpose: 'PARTNER_SETTLEMENT' })), 'Creditnota');
});

test('titleLine names the party and the number; a payee word stands in for a forwarder; a file without data shows its kind', () => {
  assert.equal(titleLine(row()), 'Changsha Pretty · CI-20260412');
  assert.equal(titleLine(row({ party: { name: null, type: 'PAYEE', id: null }, payee: 'LOGISTICS', number: 'FW-1' })), 'Douane & transport · FW-1');
  assert.equal(titleLine(row({ party: { name: null, type: 'ODOO_PARTNER', id: null }, payee: null })), 'Onbekend · CI-20260412');
  assert.equal(titleLine(row({ source: 'CONTAINER_FILE', number: null, docLabel: 'Proforma invoice' })), 'Changsha Pretty · Proforma invoice');
});

test('deskFacts: at most three per source, empties dropped', () => {
  assert.deepEqual(deskFacts(row()), ['Commercial invoice', 'Opgeladen']);
  assert.deepEqual(deskFacts(cost()), ['Internet oktober', 'Opgeladen']);
  assert.deepEqual(deskFacts(cost({ description: ' ', category: 'TELECOM', origin: 'MANUAL' })), ['TELECOM', 'Ingevoerd']);
  assert.deepEqual(deskFacts(odoo({}, { state: 'draft' })), ['Factuur', 'Odoo · Peppol', 'concept in Odoo']);
  assert.deepEqual(deskFacts(odoo()), ['Factuur', 'Odoo · Peppol']);
  assert.deepEqual(deskFacts(sales({ peppolState: 'done' })), ['Verkoopfactuur', 'Rozen voorjaar', 'via Peppol']);
  assert.deepEqual(deskFacts(sales({ container: null, peppolState: 'error' })), ['Verkoopfactuur', 'Peppol-fout']);
  assert.deepEqual(deskFacts(sales({ container: null, peppolState: 'to_send' })), ['Verkoopfactuur', 'Peppol bezig']);
  for (const sample of [row(), cost(), odoo({}, { state: 'draft' }), sales({ peppolState: 'done' })]) assert.ok(deskFacts(sample).length <= 3);
});

test('phoneSub by sortDate: the year only for another year; the status as the last part', () => {
  assert.equal(phoneSub(row(), '2026-10-26'), '12 apr · Rozen voorjaar · Open');
  assert.equal(phoneSub(row({ sortDate: '2025-12-30', date: '2026-01-02' }), '2026-10-26'), '30 dec 2025 · Rozen voorjaar · Open');
  assert.equal(phoneSub(cost({ status: 'PAID' }), '2026-10-26'), '12 apr · Kost · Betaald');
  assert.deepEqual(phoneSubParts(odoo({ status: 'OVERDUE' }), '2026-10-26'), { lead: '2 okt · Factuur', status: 'Vervallen' });
  assert.equal(phoneSub(row({ sortDate: '2026-03-03' }), '2026-10-26').startsWith('3 mrt'), true);
});

test('amountText: euro, a credit, a foreign currency; ≈ euro beside foreign amounts', () => {
  assert.equal(amountText(odoo()), '€ 1.250,00');
  assert.equal(amountText(odoo({ kind: 'CREDIT_NOTE', amount: 125 })), '− € 125,00');
  assert.equal(amountText(odoo({ currency: 'USD', amount: 840, amountEur: null })), '$ 840,00');
  assert.equal(amountText(row()), '$ 18.420,00');
  assert.equal(amountText(row({ currency: 'CNY', amount: 5000 })), '¥ 5.000,00');
  assert.equal(amountText(row({ source: 'CONTAINER_FILE', amount: null })), '—');
  assert.equal(eurApprox(row()), '≈ € 16.985,20');
  assert.equal(eurApprox(odoo()), null);
  assert.equal(eurApprox(odoo({ currency: 'USD', amountEur: null })), null);
});

test('containerLabel: alias, else number, else Inkoop #id', () => {
  assert.equal(containerLabel({ id: 41, number: 'PO-2026-012', alias: 'Rozen voorjaar' }), 'Rozen voorjaar');
  assert.equal(containerLabel({ id: 41, number: 'PO-2026-012', alias: '  ' }), 'PO-2026-012');
  assert.equal(containerLabel({ id: 41, number: null, alias: null }), 'Inkoop #41');
});

test('linkChips: the container, "Bank dd/mm" per transaction, TICA', () => {
  const chips = linkChips(row({ links: [...row().links, { type: 'TICA', id: 5, label: 'TICA', date: null, account: null }] }));
  assert.deepEqual(chips.map((chip) => [chip.type, chip.id, chip.label]), [['CONTAINER', 41, 'Rozen voorjaar'], ['TRANSACTION', 7781, 'Bank 05/05'], ['TICA', 5, 'TICA']]);
  assert.equal(chips[1].title, 'Banktransactie · 5/5/2026 · BE94731074082814');
  assert.deepEqual(linkChips(row({ links: [{ type: 'TRANSACTION', id: 1, label: null, date: '2026-06-09', account: null }] })).map((chip) => chip.label), ['Bank 09/06']);
  assert.deepEqual(linkChips(row({ links: [{ type: 'CONTAINER', id: 41, label: null, date: null, account: null }] })).map((chip) => chip.label), ['Rozen voorjaar']);
});

test('previewKind: purchase XML has no preview, Odoo and media XML go through their PDF route, sales is a PDF', () => {
  assert.equal(previewKind(file()), 'pdf');
  assert.equal(previewKind(file({ kind: 'XML', name: 'ci.xml', contentType: 'application/xml' })), 'none');
  assert.equal(previewKind(file({ type: 'ODOO_ATTACHMENT', kind: 'XML' })), 'xml');
  assert.equal(previewKind(file({ type: 'MEDIA_ASSET', kind: 'XML' })), 'xml');
  assert.equal(previewKind(file({ type: 'SALES_PDF', kind: 'FILE' })), 'pdf');
  assert.equal(previewKind(file({ type: 'MEDIA_ASSET', kind: 'IMAGE' })), 'image');
  assert.equal(previewKind(file({ kind: 'FILE', name: 'x.docx' })), 'none');
});

test('downloadName: readable, sanitised, with an extension and a number for the next files', () => {
  assert.equal(downloadName(row(), file(), 0), 'Changsha Pretty - CI-20260412 - 2026-04-12.pdf');
  const forwarder = row({ party: { name: null, type: 'PAYEE', id: null }, payee: 'LOGISTICS', number: null, date: '2026-05-02', sortDate: '2026-05-02' });
  assert.equal(downloadName(forwarder, file(), 0), 'Douane & transport - PO-2026-012 - 2026-05-02.pdf');
  assert.equal(downloadName(row({ number: 'INV/2026:"04"' }), file(), 0), 'Changsha Pretty - INV 2026 04 - 2026-04-12.pdf');
  assert.equal(downloadName(row(), file({ name: 'document', contentType: 'application/xml' }), 0), 'Changsha Pretty - CI-20260412 - 2026-04-12.xml');
  assert.equal(downloadName(row(), file({ name: 'scan', contentType: 'image/jpeg' }), 0), 'Changsha Pretty - CI-20260412 - 2026-04-12.jpg');
  assert.equal(downloadName(row(), file({ name: 'scan', contentType: null }), 0), 'Changsha Pretty - CI-20260412 - 2026-04-12');
  assert.equal(downloadName(cost(), file({ name: 'B.PDF' }), 1), 'Proximus NV - F-2026-118 - 2026-04-12 (2).pdf');
  assert.equal(downloadName(cost(), file({ name: 'C.png' }), 2), 'Proximus NV - F-2026-118 - 2026-04-12 (3).png');
  const empty = row({ party: { name: null, type: 'ODOO_PARTNER', id: null }, payee: null, number: null, container: null, date: '' });
  assert.equal(downloadName(empty, file({ name: 'origineel.pdf' }), 0), 'origineel.pdf');
  assert.ok(downloadName(row({ number: 'x'.repeat(300) }), file(), 0).length <= 124);
});

test('monthGroups go by sortDate, so an invoice dated in another month still sits under its accounting month', () => {
  const rows = [
    odoo({ key: 'odoo:1', sortDate: '2026-10-02', date: '2026-10-01' }),
    odoo({ key: 'odoo:2', sortDate: '2026-10-01', date: '2026-09-28' }),
    odoo({ key: 'odoo:3', sortDate: '2026-10-01', date: '2026-10-01' }),
    odoo({ key: 'odoo:4', sortDate: '2026-09-30', date: '2026-09-30' }),
  ];
  const groups = monthGroups(rows);
  assert.deepEqual(groups.map((group) => [group.label, group.rows.map((item) => item.key)]),
    [['oktober 2026', ['odoo:1', 'odoo:2', 'odoo:3']], ['september 2026', ['odoo:4']]]);
  assert.deepEqual(monthGroups([]), []);
});

test('onlyOptions and scopeOf per direction; anything unknown is ALL', () => {
  assert.deepEqual(onlyOptions('in').map((option) => option.label), ['Alles', 'Containers', 'Kosten', 'Nieuw in Odoo', 'Zonder bestand']);
  assert.deepEqual(onlyOptions('out').map((option) => option.label), ['Alles', 'Facturen', "Creditnota's", 'Odoo']);
  assert.deepEqual(onlyOptions('in').map((option) => scopeOf('in', option.id)), ['ALL', 'CONTAINERS', 'COSTS', 'ODOO_NEW', 'NO_FILE']);
  assert.deepEqual(onlyOptions('out').map((option) => scopeOf('out', option.id)), ['ALL', 'INVOICES', 'CREDIT_NOTES', 'ODOO']);
  assert.equal(scopeOf('in', 'bogus'), 'ALL');
  assert.equal(scopeOf('in', 'credit-notes'), 'ALL', 'a chip of the other direction');
  assert.equal(scopeOf('out', 'odoo-new'), 'ALL');
});

test('rowKeyValid: five kinds, no zero start, at most 18 digits', () => {
  for (const key of ['pi:12', 'pd:1', 'cost:9', 'odoo:900001', 'so:4', `pi:${'9'.repeat(18)}`]) assert.equal(rowKeyValid(key), true, key);
  for (const key of ['pi:0', 'pi:012', 'x:1', 'pi:', 'pi:1a', `pi:${'9'.repeat(19)}`, 'PI:1', ' pi:1']) assert.equal(rowKeyValid(key), false, key);
});

test('odooFact: removed cost, the mark note (40 chars), a concept, Odoo payment states', () => {
  assert.equal(odooFact(odoo({}, { state: 'draft' })), 'concept in Odoo');
  assert.equal(odooFact(odoo({}, { paymentState: 'paid' })), 'betaald in Odoo');
  assert.equal(odooFact(odoo({}, { paymentState: 'in_payment' })), 'betaald in Odoo');
  assert.equal(odooFact(odoo({}, { paymentState: 'partial' })), 'deels betaald in Odoo');
  assert.equal(odooFact(odoo({ status: 'HANDLED', statusReason: 'COST_REMOVED' }, { state: 'draft' })), 'kost verwijderd');
  const mark = { resolution: 'CONTAINER' as const, purchaseOrderId: 41, note: 'zit in PO-2026-012', markedAt: '2026-10-25T09:12:00Z', markedBy: 'emre' };
  assert.equal(odooFact(odoo({ status: 'CONTAINER' }, { mark })), 'zit in PO-2026-012');
  const long = odooFact(odoo({ status: 'CONTAINER' }, { mark: { ...mark, note: 'a'.repeat(60) } }))!;
  assert.ok(long.length <= 40 && long.endsWith('…'));
  assert.equal(odooFact(odoo()), null);
  assert.equal(odooFact(cost()), null);
});

test('blockedText: every reason of an incoming Odoo row; nothing when registrable or outgoing', () => {
  const words: [string, string][] = [['CANCELLED', 'Geannuleerd in Odoo'], ['NO_DATE', 'Nog geen factuurdatum in Odoo'], ['ZERO', 'Bedrag is nul'],
    ['NOT_EUR', 'Niet in euro'], ['TICA', 'Via TICA-afrekeningen'], ['MARKED', 'Eerst markering wissen'], ['COST_REMOVED', 'Kost verwijderd in ENROSED'], ['DEMO', 'Voorbeeldgegevens']];
  for (const [code, text] of words) assert.equal(blockedText(odoo({}, { registrable: false, blockedBy: code as never })), text, code);
  assert.equal(blockedText(odoo()), null);
  assert.equal(blockedText(odoo({ direction: 'OUT' }, { registrable: false, blockedBy: 'OUTGOING', moveType: 'out_invoice' })), null);
  assert.equal(blockedText(cost()), null);
});

test('rowActions: every line of the table, first match wins; no download without files', () => {
  const mark = { resolution: 'HANDLED' as const, purchaseOrderId: null, note: null, markedAt: '2026-10-25T09:12:00Z', markedBy: 'emre' };
  const cases: [string, InvoiceRow, string | null, string[]][] = [
    ['container invoice', row(), 'open-purchase', ['download']],
    ['container file', row({ source: 'CONTAINER_FILE', status: 'NO_DATA' }), 'open-purchase', ['download']],
    ['cost', cost(), 'open-cost', ['download']],
    ['sales', sales(), 'open-sales', ['download']],
    ['marked', odoo({ status: 'HANDLED' }, { mark, registrable: false, blockedBy: 'MARKED' }), 'clear-mark', ['download']],
    ['tica', odoo({ status: 'TICA' }, { registrable: false, blockedBy: 'TICA' }), 'open-tica', ['download']],
    ['cancelled', odoo({ status: 'CANCELLED' }, { state: 'cancel', registrable: false, blockedBy: 'CANCELLED' }), 'download', []],
    ['cost removed', odoo({ status: 'HANDLED', statusReason: 'COST_REMOVED' }, { registrable: false, blockedBy: 'COST_REMOVED' }), 'container', ['download']],
    ['outgoing', odoo({ direction: 'OUT', status: 'OPEN' }, { moveType: 'out_invoice', registrable: false, blockedBy: 'OUTGOING' }), 'download', []],
    ['new registrable', odoo(), 'register', ['handled', 'container', 'download']],
    ['before start registrable', odoo({ status: 'HANDLED', statusReason: 'BEFORE_START' }), 'register', ['handled', 'container', 'download']],
    ['new not registrable', odoo({}, { registrable: false, blockedBy: 'NOT_EUR' }), 'handled', ['container', 'download']],
  ];
  for (const [name, sample, primary, more] of cases) assert.deepEqual(rowActions(sample), { primary, more }, name);
  assert.deepEqual(rowActions(row({ files: [] })), { primary: 'open-purchase', more: [] });
  assert.deepEqual(rowActions(odoo({ status: 'CANCELLED', files: [] }, { state: 'cancel', registrable: false })), { primary: null, more: [] });
  assert.deepEqual(rowActions(odoo({ files: [] }, { registrable: false, blockedBy: 'DEMO' })), { primary: 'handled', more: ['container'] });
  assert.equal(ACTION_LABELS.register, 'Registreren bij transactie…');
  assert.equal(ACTION_LABELS.container, 'Hoort bij container…');
});

test('previewFacts: Datum by sortDate with the due date, Factuurdatum only when it differs, ≈ euro, the Odoo number and the note', () => {
  const facts = previewFacts(odoo({ sortDate: '2026-09-30', date: '2026-09-28', dueDate: '2026-10-30' }));
  assert.deepEqual(facts.map((fact) => [fact.label, fact.value]), [
    ['Datum', '30/9/2026 · vervalt 30/10/2026'], ['Factuurdatum', '28/9/2026'], ['Bedrag', '€ 1.250,00'], ['Soort', 'Factuur'],
    ['Bron', 'Odoo · Peppol'], ['Status', 'Nieuw'], ['Odoo-nummer', 'BILL/2026/10/001'],
  ]);
  const container = previewFacts(row());
  assert.deepEqual(container.find((fact) => fact.label === 'Bedrag')?.value, '$ 18.420,00 ≈ € 16.985,20');
  assert.equal(container.some((fact) => fact.label === 'Factuurdatum'), false);
  assert.equal(deskDate('2026-04-12'), '12/04/26');
});

test('receivedLinkReady: amounts must match, the difference stays within 2 cents, candidates need a choice', () => {
  const match = (bank: number, recorded: number): boolean => Math.sign(bank) === Math.sign(recorded) && Math.abs(Math.round(bank * 100) - Math.round(recorded * 100)) <= 2;
  const preview = {
    document: {} as never, snapshotHash: 'abc', invoiceTotalEur: 1250, netEur: 1033.06, vatEur: 216.94, paymentAmountEur: 1250, differenceEur: 0,
    supplierCountry: 'BE', companyCostId: null, existingCandidates: [], eligible: true, unavailableReason: null,
  };
  assert.equal(receivedLinkReady(preview, -1250, null, match), true);
  assert.equal(receivedLinkReady(preview, -1300, null, match), false, 'amount mismatch');
  assert.equal(receivedLinkReady({ ...preview, differenceEur: 0.03 }, -1250, null, match), false, 'a difference of 3 cents');
  assert.equal(receivedLinkReady({ ...preview, differenceEur: 0.02 }, -1250, null, match), true);
  assert.equal(receivedLinkReady(preview, null, null, match), false, 'no line chosen');
  assert.equal(receivedLinkReady({ ...preview, eligible: false }, -1250, null, match), false);
  assert.equal(receivedLinkReady({ ...preview, snapshotHash: '' }, -1250, null, match), false);
  assert.equal(receivedLinkReady(null, -1250, null, match), false);
  const candidates = { ...preview, existingCandidates: [{ id: 7, description: 'x', party: null, date: '2026-10-01', reference: null, totalEur: 1250, openEur: 1250, bankStatementLineId: null }] };
  assert.equal(receivedLinkReady(candidates, -1250, null, match), false, 'candidates need a choice');
  assert.equal(receivedLinkReady(candidates, -1250, 7, match), true);
  assert.equal(receivedLinkReady(candidates, -1250, 8, match), false, 'a cost that is not a candidate');
  assert.equal(receivedLinkReady({ ...candidates, companyCostId: 12 }, -1250, null, match), true, 'companyCostId set');
});
