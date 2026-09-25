# AI context — Enrosed ERP frontend

Handover document for any AI assistant (or human) continuing this
codebase. Read this first; the git log tells the same story in finer
grain. The backend counterpart lives in `enrosed-erp-backend/AI-CONTEXT.md`.

## What this is

Angular 22 front end of the internal sales & sourcing ERP for **Enrosed
BV** (Belgian preserved-roses wholesaler, brand "Enrosed London"). Built
for trade-fair use on a phone: quotes drafted at the table while the
customer watches. There is also a public customer portal (quote viewing,
digital signing, change proposals) served by the same app.

- Dev: `npm start` → ng serve on **port 4321**, API at localhost:8080
- Prod: Vercel, https://enrosed-erp-frontend.vercel.app, API base from
  `src/environments/environment.prod.ts` (Railway domain) via
  fileReplacements
- Login: named `emre` and `berat` staff accounts; the password is exchanged once via
  `POST /api/auth/session` and only the signed, expiring session token is persisted.
  Portal routes remain public via their customer token.

## Standing conventions (agreed with the owner)

- **Code and code comments in English; UI texts in Dutch.** Commit
  messages in English, grouped per topic.
- Standalone components, signals, zoneless change detection, OnPush
  everywhere. Inline templates+styles in the component `.ts` files.
- Node tests:
  `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --experimental-strip-types tests/*.test.mts`;
  modules with a node test may only `import type` from other src files;
  also `npx ng build` and visual checks at 375 px and desk widths.
- Errors surface via `messageOf(failure, fallback)` - the backend sends
  readable Dutch messages on 409s; show them.

## Design system ("iOS 26" look, owner-approved)

- Accent palettes (core/platform/theme.ts): six, green is the default,
  stored per device, purely cosmetic. There is NO customer-safe/privacy
  mode: fd979b4 (2026-08-23) removed it and the brand-mark double-tap. Cost
  prices, margins and purchase figures are always visible to staff; only
  PDF choices (internal vs supplier/customer) differ. Rebuilding a
  customer-safe mode is an owner decision.
- Floating pill chrome: tabbar and action bars share 20 px radius; the
  appbar blurs through `.appbar::before` (blur on the bar itself creates
  a containing block that breaks `position:fixed` children - learned the
  hard way with the notification sheet).
- Hand-drawn SVG icon set in `shared/icon.ts` (24-grid, round caps).
- Skeleton loaders (`shared/skeleton.ts`: list/card/lines/stats) instead
  of "Laden…" - the layout never jumps.
- Cost breakdowns read as "the journey of the goods": `.cost-section`
  micro-headers + `.cost-hero` framed total (shared by sales totals,
  purchase totals and purchase view).
- Product view uses bento `spec`-tiles for identity facts; money stays in
  stat rows (tiles everywhere proved less scannable).
- Entrance animation `.anim-rise`, reveal-on-scroll patterns, subtle
  transitions; respect `prefers-reduced-motion`.

## Workspace kit (2026-09)

Shared building blocks for the desk and iOS 26 (Liquid Glass) layouts of
the workspaces. All CSS lives in one global partial,
`src/styles/workspace-kit.scss`; kit components have no styles array.

- Prefixes: `wk-*` is the desk (DesktopViewport.active(), 680 px and up),
  `ios-*` the phone; `tone-*`, `wk-meter`, `wk-equation`, `wk-amount` and
  `wk-dot` work on both.
- Opt-in: the desk shell (`.shell--workspace`) locks page scrolling only
  when the routed page renders `.wk-page`; the phone shell
  (`.shell--workspace-phone`) hides the ERP `.tabbar` only when the page
  renders `.ios-page`. A page that renders neither looks as before.
- Pieces (src/app/shared unless noted): `app-segmented` (desk/ios,
  tabs/radio, arrow keys), `app-ios-nav` (large title that condenses into
  a glass bar; [lead] [trail] [caption] [below] slots), `app-ios-tabbar`
  (floating tab bar plus accessory button; tabs use replaceUrl),
  `[appSwipeActions]` (multi-action swipe rows, geometry in row-actions.ts),
  `app-wk-side-foot` (sidebar foot with "Terug naar …" and the account),
  `keyContext()` (typing / overlay / scope checks for shortcuts),
  `elementWidth()` + `WK_DOCK_MIN_PX` (inspector docks at 1000 px of page
  host, else a drawer), `WorkspaceReturn` + `returnLabel()` in
  core/platform (remembers the ERP screen a workspace was opened from),
  `MediaApi.allAssets()` + `collectPages()` (paging past the server's
  200-row cap), `appAuthLazy` on AuthImage, `Ui.toast(text, kind, action)`
  for undo toasts, `variant="ios"` on app-sheet and app-context-menu,
  `iconName` / `checked` / `cancelLabel` on context menus, and about sixty
  icons in icon.ts ('more' is the horizontal ellipsis).
- Tones: `tone-accent`, `-ok`, `-warn`, `-danger`, `-blue`, `-teal`,
  `-amber`, `-green`, `-plum`, `-grey`, `-ink` set `--tone` for tiles,
  pills, chips, dots, meters and swipe buttons. Record types: Product and
  Reeks accent, Inkooporder blue, Kost teal, Planner amber, Niet gekoppeld
  grey. Payees: Leverancier accent, Douane & transport blue, Inspectie &
  andere kosten amber, Bijkomende kosten grey.
- Trap rule: size containers (`.wk-toolbar`, `.wk-pane`, any `container:`
  element), transformed elements (`.ios-swipe__row`) and blurred elements
  trap `position:fixed` children. Render app-sheet, app-context-menu,
  `.wk-inspector--drawer` and Quick Look at page-host level. Sticky bars
  blur only on `::before`.
- Areas scope under their host: never restyle a bare kit class; override
  kit custom properties only (`--wk-cols`, `--wk-group-span`,
  `--wk-sticky-top`, `--wk-max`, `--wk-side-w`, `--ios-inset`,
  `--ios-sep-inset`). Area partials: finance-workspace / finance-phone /
  finance-legacy, files-workspace / files-phone, purchase-payments.

## Workspaces

### Kosten & bank
- Six sections, one question each (finance-sections.ts, same order in the
  sidebar, the phone tab bar and the shortcuts 1-6): Overzicht, Te betalen
  (Alles/Kosten/Containers/Vaste kosten; buckets Nu / Binnenkort 30 dagen /
  Later), Te ontvangen (Openstaand/Ontvangen), Bank (Rekeningen/Bewegingen),
  Uitgaven (Bedrijfskosten/Containers/Vaste kosten) and Analyse (phone: ⋯).
- The address is the state: finance-url.ts alone parses and writes it
  (`view`, `tab`, period/from/to, q, cat, status, channel, docs, container,
  cost, scope, account, dir, link, kind, purpose, year; defaults omitted).
  Filters replace the history entry, drill-ins push. Legacy view=recurring,
  view=bank and ?container=<id> keep working; ?cost=<id> inspects a cost.
- Money basis: cash figures (Overzicht, Te betalen, Te ontvangen, Bank) are
  incl. btw and may add container EUR, labelled 'verwacht' when forecast;
  cost figures (Uitgaven › Bedrijfskosten, Analyse) are excl. btw with the
  btw beside them and never include container cash.
- Container payables (payables.ts) bucket the server's reconciliation per PO
  and payee; supplier terms replace the stream, never both. reached() is a
  copy of purchase-instalment-state.ts. Payee words follow Inkoop's
  PAYEE_LABEL (cost-ledger.ts, asserted in tests).
- Betaald zetten: PaySheet with a date and an optional outgoing bank line per
  cost carrying a 'kost #id' marker (bank-markers.ts); undo reverts only
  what nobody touched since. Outgoing lines cannot be allocated to a cost or
  a container payment (needs the backend): markers and a ±7-day amount match
  only drive 'Nog niet op de bank' and link chips, never money maths.
- FinanceState (page-scoped) owns data, reload(sources), the forms (cost,
  recurring, balance, movement, pay, check), the inspector target and the one
  page-level context menu. Sections provide FINANCE_SECTION (strip, status,
  keyboard, selection) and the page finds them with viewChild. Every sheet,
  menu, drawer and the allocation dialog render at page level (trap rule).
  FinanceShell (root) carries the sidebar/tab counts.
- 'Zonder document' is one rule (cost-ledger missingDocument): a company cost
  without a file, recurring bookings excepted; the filter, the attention row,
  Analyse and the accountant package count the same rows. A receipt linked to
  a bank line counts on that line's account (FinanceState.receiptAccountKey).
- Forms: fields sit in `.fin-group` wrappers, an inset `.ios-group` on a phone
  (label left, value right; `.fin-field--stack` for chips, segments, notes)
  and `display: contents` on a desk, where the `.fin-form` grid stays. Desk
  tables fit their pane at every width (track sets per container threshold;
  Vaste kosten measures its own column, container fin-rec). On a phone
  Analyse is a pushed sub-screen with a back chevron (openAnalysis).
- Harness caveat: tests/bank-movement-panel.test.mts compiles
  bank-movement-panel.ts with imports stripped; a new import, global or state
  member used at construction or in tested code needs a harness entry.

### Documenten & media
- /files, `features/files`: FilesPage is a thin shell (desk or phone view,
  plus every sheet, menu and Quick Look at page-host level); the logic is
  FilesController (provided per visit); folders, drags and folder requests
  from the nav live in the root FilesStore. The pure modules are
  node-tested: files-collections (URL, record lens, routes, file types,
  dates, sorts), files-rules (tree and counts, lifecycle, upload
  destination, where-line, the one action list `fileActions`),
  files-selection, files-keys, media-action-identity (now really stamped
  per mutation). Styles: styles/files-workspace.scss (desk, dialogs, the
  upload tray, Quick Look, nav) and styles/files-phone.scss; no files
  component has a styles array.
- Places: Recent (`view=all`), Mappen (none, or `map=<id>`), Gekoppeld aan
  (`view=product|family|purchase|cost|planner|unused`, optional
  `doel=<recordId>`), Archief (`view=all&archief=1`). Modifiers `kind`,
  `q` (global in folder places, scoped in views and Archief) and
  `bestand=<id>` replace the history entry; places push. `view=quote|invoice`
  is rewritten to Recent (nothing ever set those roles).
- Folders are primary: the backend auto-files by first link (Productfoto's,
  Kosten/<jaar>, Inkooporders/<order>…), unlinked uploads land in
  Overig/Foto's|Documenten. Folder counts from the server are cumulative;
  `folderCounts` derives the direct ones.
- Lifecycle: archive first (confirm only when linked, with what changes
  where), then in Archief Terughalen or Definitief verwijderen (only when
  nothing links to it). Links with `createdBy === 'system'` come from a
  source record (indexer): shown as "Via bron", never unlinked here.
- Linking to an inkooporder downloads the bytes and posts them as a dossier
  document (`sourcing.addDocument`); the one-minute indexer then links the
  same asset back, so the inspector shows a pending row meanwhile.
- Public links always go through a confirm (extra warning for cost and
  purchase documents: `isSensitive`, LINK_VIEWS.sensitive and
  `costTargetMeta` are the hooks a future customer-safe mode would gate).
- Desk: kit toolbar (the selection swaps only the tools, the location
  stays; words fold away as the bar narrows), table/grid with Finder
  selection (click, ⌘, ⇧), row menus by right-click or long press
  (MenuTrigger), drag to folders, crumbs and the nav tree, inspector docked
  from 1000px of page width, else a drawer; keyboard table in files-keys
  ("?" lists it). Phone: own ios tab bar (Recent, Bladeren, Archief) with
  + accessory, swipe rows, long-press menus, a file screen with the
  two-step share; "Toon in map" opens the folder list, not the file.
- Uploads: a finished tray with failures, failed links or files the
  library already had never closes by itself; a toast, the phone's pill
  and the desk status bar lead back to it.
- Records link back with "In Documenten & media ›" (product card here;
  cost sheet and purchase dossier in their own rounds): `?view=<key>&doel=`.

### Inkoop · Betalingen
Money out of a container, per payee: Leverancier, Douane & transport,
Inspectie & andere kosten and Bijkomende kosten (no agreement, never in
Afspraak or Open). One pure, node-tested view model,
`purchase-payment-ledger.ts`, turns the server reconciliation into every
figure on screen, in cents: Afspraak − Betaald (− Minder betaald · afgerekend)
(+ Meer betaald) = Open, and Open splits into Nu te betalen and Later
(`PAYEE_DUE_STATUSES`: transport is due once the container sails,
inspection once ordered; the supplier follows its plan). It also builds the
payee statuses, 'Te doen', the ledger rows with proof coverage and the bridge
to the landed total ('Opbouw van het totaal'). The server stays the judge of
allocation, settlement and FX; a missing reconciliation shows 'Voorlopige
cijfers'.
- Desk: [Producten | Betalingen] in the main pane (⌥1/⌥2);
  `app-purchase-payment-workbench` (strip, 'Per ontvanger', 'Alle
  betalingen', Te doen, Opbouw; N adds, A settles). The rail lost Betalingen
  and gained Partner (money in); Kosten has Calculatie | Nacalculatie.
- Phone: `app-purchase-payment-overview` (read view and editor step 4) with
  `app-purchase-payee-sheet`; the read view records through
  `/purchasing/:id/edit?section=pay&payee=…&due=…` and returns to
  `?section=ledger`. Partner financing and the Nacalculatie are cards of
  their own.
- Shared sheets: payment ('Aan wie?' moves a payment), settle (flags an
  existing payment, no money moves), first instalment; every payment action
  saves a dirty order first (`whenSaved`), because payment writes rewrite the
  order notes on the server.
- Deep links: `?section=payments` partner financing, `ledger` money out,
  `payment-result` the Nacalculatie, `pay` the payment sheet. Styles live in
  `styles/purchase-payments.scss`.
- Proof coverage is unknown (documents `null`) while the documents load and
  after a failed request (`documentsFailed`), never "no proof". Rows with
  `appMenuTrigger` and their own `(click)` skip `$event.defaultPrevented`,
  the click that trails a long press.
- Nacalculatie (round 2, superseded by round 3 below; `app-purchase-payment-result` and
  `purchase-payment-result-rows.ts` are gone): it always showed the
  equation Enrosed kost + minder betaald − meer betaald − bijkomend = Enrosed
  kost + resultaat (with zeros) and a 'Per ontvanger' list built from the
  ledger by `purchase-payment-result-rows.ts` (same figures and words as
  Betalingen; Bijkomende kosten only once paid, counted as 'meer'; a payee
  without a settled difference reads 'nog niet afgerekend' until it is
  finalized). The rows are plain: their buttons are the actions (inline
  Afrekenen…/undo, 'Betalingen ›'), never the row itself. The desk rail
  (Kosten › Nacalculatie, 'Betalingen ›' preselects the payee in the
  workbench via `focusPayee`) and the phone Kosten card (`openPayee` opens
  the payee sheet; 44 px links) share it; below it
  `app-purchase-reconciliation` (kit look, styles in purchase-payments.scss,
  `hosted` swaps the router link for an output) shows betaald + open =
  externe kost with the begroot figure beside the variance, the per-stuk
  block and the Per product (four decimals, begroot per line) and Toelichting
  disclosures; Analyses keeps the per-stream rows (`showStreams`). The
  workbench has a third side card 'Nacalculatie' (`purchaseNacalcSummary`),
  the side column scrolls inside its sticky box when three cards outgrow the
  viewport, and the bridge shows 'Totaal geland' as a subtotal before the
  separate costs, with its own rounding row above it when the landed part
  needs one. Table tiers of `pw-main`: 880 (Nu te betalen folds into the sub
  lines, always shown when something is due) / 760 (Verschil and text
  buttons go, the ⋯ stays) / 600 (Status pill under the name); the Verschil
  column only renders once a payee or term was settled for another amount.
  'Betaald · afgerekend' is the settled word in both vocabularies (ledger
  statuses and reconciliationStatusLabel), also after a term-level settle,
  so it appears exactly when 'Afrekening ongedaan maken' does; a ledger row
  that carries the flag says 'Rekent de termijn af' / 'Rekent alles af'.
- Nacalculatie (round 3): one story on both devices, computed by the pure,
  node-tested `purchase-nacalc-metrics.ts` (cents, type-only imports) from
  `PurchaseOrderView` + the payment ledger + `purchaseNacalcSummary(view,
  ledger)` (+ `PartnerFinancing` when the host has it): state machine
  concept | provisional | review | final with a state pill and sentence, the
  headline (Begroot on ordered pieces → Verwachte eindkost / Eindkost →
  signed Verschil with % → per stuk on ordered or usable pieces), one reason
  word per payee (`nacalcReason`, precedence additional → incomplete →
  unbudgeted → review → legacy → partly-settled → open →
  settled-lower/-higher → none) with at most one action (`payeeRowAction` in
  the ledger, stamped on every payee as `action`; 'Nakijken…' only for an
  overpayment, a small difference settles before it is paid, an incomplete
  payee gets no action), the receipt block (server `receiptVariance` first,
  reconciliation lines as fallback, over-received value from the order
  lines, supplier fact, LATER reports shown but never counted), the bridge
  from 'Calculatie · totaal geland' to 'Begroot extern' ('Afronding' up to €
  1 before receipt, 'Correctie naar bestelde stuks' after) and on to the
  eindkost, the explained differences (`purchasePaymentResult`, never budget
  minus paid), the partner block (costPct ?? 100, sharePct ?? 50, advance on
  `totalWithSeparateCostsEur`, financing when loaded, short-delivery handoff
  to the creditnota) and the koersverschil per payment (`paymentFxEur`:
  stored amountEur minus the foreign amount at the order rate; 0 for EUR or
  a missing rate). `purchaseNacalc({ view, ledger, summary, partner? })`
  takes `summary = purchaseNacalcSummary(view, ledger)` from the host (a
  runtime import would break the node suite) and returns null without a
  reconciliation or summary (hosts show 'nog niet beschikbaar' +
  Vernieuwen); `nacalcBridge(view, summary)` likewise; with a null ledger
  `payees` is null and the rest renders from the server report. Desk: third
  main view Nacalculatie (⌥3, dot on review) =
  `app-purchase-nacalc-workbench` (container `nc`; the tables fold on the
  main column: < 1000 pill and reason under the payee, < 760
  Afspraak/Begroot/Verschil and text buttons go); the rail's Kosten pane and
  the Betalingen side card share `app-purchase-nacalc-summary`
  (`PurchaseNacalcSummaryCard`, 'Volledig ›'); Betalingen is the only place
  that records money (row 'Noteer ›' → `showPayments(payee)`), settle/undo
  use the desk's page-level sheets. Phone: `app-purchase-nacalc-overview`
  replaces the two Kosten cards in the read view and editor step 3 (hero +
  meter, WAAR HET VERSCHIL ZIT cells → payee sheet, one action cell from the
  ledger's todos via `todoCopy` (read mode settles in the editor:
  `?section=payment-result`), ONTVANGST, PER STUK with the bridge
  disclosure, PER PRODUCT collapsed, PARTNER, TOELICHTING, footer PDF /
  Betalingen / Kosten & bank); the Betalingen card's closing cell shows the
  live eindkost. Both roots carry id `purchase-payment-result`; the desk
  deep link sets `mainView('nacalc')`. Hosts fetch `/partner-financing` once
  per partner container (editor: effect on the loaded order and its partner;
  view: after load and partner changes) into `partnerFinancing:
  PartnerFinancing | null | 'loading' | 'error'`. The payment sheet offers
  'Afgeschreven in euro' for USD/CNY payments (placeholder and hint =
  order-rate estimate, non-blocking warn beyond 15 %); the editor sends
  `amountEur` only when filled in and the currency is not EUR, clears it
  when the foreign amount changes, prefills it when editing a foreign
  payment; settle and undo PUT bodies never carry it.
  `app-purchase-reconciliation` serves Analyses › Inkoop only; styles for
  the Nacalculatie live in `styles/purchase-nacalc.scss` (.nc-* desk, .np-*
  phone, .nc-summary), purchase-payments.scss keeps the Betalingen rules and
  .desk-body--payments (applied for both wide views).

## Screens and their scenarios

### Dashboard
Stat tiles (open sales, gross margin - internal only, incoming
containers, catalogue size), open-work chips (proposals, delivery terms,
freight to fill), recent orders with status badges, and a **Markt**
section: ECB exchange rates (EUR↔USD, EUR↔CNY; tap flips the pair) with
half-year sparkline, month tick labels showing the rate at each month
start, and a plain-language hint about EXW buying power (freight is USD
too); container freight log per route (Ningbo/Guangzhou/Shenzhen manual
forwarder quotes with dated history sheets and backfill, Shanghai row fed
weekly by the backend's Drewry scrape).

### Sales editor (the heart)
- Card sections: status/history (newest first, latest event on the bar),
  Order (customer, country, incoterm, payment terms pick-list with "Van
  de klant" default and "Anders…"), lines (picker prefills one carton; carton snap after 2 s pause,
  per-line delivery week via week-field), totals (journey layout, freight
  "aanpassen" inline panel: TE_BEPALEN or own amount), revision handling
  with two-line buttons (Wijzigen/Overnemen explain themselves, Afwijzen
  quiet), floating action bar with total · pallets · margin (intern).
- **Pallets**: optional hand layout in a bottom sheet - start from the
  calculation or empty, steppers per product ([− n +], + disabled when
  everything is placed), pallet type select (Europallet default,
  "Anders…" prompt), small height field (cm) echoed in the count line,
  reorder/rename (pencil affordance)/delete, "indeling compleet" status
  chip, Herbereken, "Terug naar automatisch". Freight follows manual
  pallet count when pallets exist; never required for sending.
- PDF sheet: quote PDF in any of 8 languages, plus **Pakbon** (packing
  slip, grouped per pallet when laid out).
- **Save queue**: every mutation goes through `enqueue(make)` - a strict
  promise chain applying each change to the freshest order. Two quick
  taps used to race and resurrect stale state (pallets came back
  shuffled). Same pattern in the purchase editor. Never bypass it.

### Creditnota's (2026-09-25)
A third `DocumentType` CREDITNOTA reduces an invoice's claim: lines and
amounts stay positive, the sign lives in the type (`creditedInvoiceId`,
`creditReason`, `goodsReturnedAt` on the order;
`creditNotes[]`/`creditedEur` on invoices, `creditedInvoiceNumber/Status` on
credit notes; a credit note's `paymentSummary.invoiceTotalEur` is negative
and `creditEur` is the open tegoed). The pure, node-tested module
`features/sales/sales-credit-note.ts` is the one place for the rules:
`isCreditNote` / `isClaimDocument` (an invoice or a credit note is a money
document — a `docType === 'FACTUUR'` check that means 'money' uses it, one
that means 'the positive invoice' stays), `canCreateCreditNote`,
`creditNoteJourney` (Concept → Uitgereikt[· verstuurd] → Verrekend /
Terugbetaald / Afgehandeld, 'Geannuleerd' stop), `creditNoteSettlement`
(tegoed = |invoiceTotalEur|, verrekend = rows with `offsetPaymentId`,
terugbetaald = the other negative rows, open = server `creditEur`),
`creditNoteNextStep` (issue → apply when the credited invoice still has an
open amount → refund → done), `creditDraftTotals` (client preview only, cent
rounding; the server prices at CONTAINER_COST), `creditRequestFrom`,
`creditNoteStatusLabel` ('Tegoed open' outranks the mail state) and
`signedClaim`. `quote-status.statusOf` repeats the pill rules inline (it may
only import types) and reads 'Gecrediteerd' on a fully credited invoice;
`sales-invoice-journey.ts` is untouched — the desk and the phone view switch
to `creditNoteJourney` themselves. Sheets: `app-sales-credit-note-sheet`
(lead seam; invoice mode `[invoiceId]`, partner mode `[purchaseOrderId]` →
`partnerCreditProposal` picks `suggestedAdvanceInvoiceId`, reason fixed
PARTNER_SHORTFALL, one prefilled amount; desk `[wide]`, phone
`variant="ios"`; it navigates to the new document itself and emits
`created`) and `app-sales-offset-sheet` ('Verrekenen': the customer's open
issued invoices, original first; a partner credit note lists the container's
open documents; `applyCredit` then `(changed)` → the host adopts the credit
note and reloads history). `SalesReceipts` renders 'Tegoed & afhandeling'
for credit notes (`credit()`, `settlement()`, `original` = the credited
invoice fetched on every view so 'Verrekenen met F-… · € X' knows its cap;
`(applyRequested)` → the host opens the offset sheet; `[refundRequest]`
opens the REFUND sheet; 'Intrekken' on an offset row calls `deletePayment`,
the server voids the pair); the receipt-bank-account harness rule stands:
new construction-time members go in its `names[]`, new imports in its
globals. `SalesEditor` (desk and phone editor) owns the credit state:
`isCreditNoteDoc` / `isClaimDoc`, `creditOriginal` + `creditProposal` loaded
from `adopt()` via `loadCreditContext` (listed in the split-editor harness),
`creditLineCap`/`creditLineHint` (invoiced − credited on the other live
notes, this concept's saved quantity added back; price ≤ invoiced net unit;
no carton snap for credit notes), `openCreditSheet`, `issueCreditNote`
(confirm, no mail), `cancelCreditNote` (issued, no money history, no return;
`cancelQuote(id, '', false)`), `openReturnSheet`/`confirmReturnGoods`
(STANDARD, product lines, original shipped, once),
`openOffset`/`offsetApplied`; `canCancel` and the product picker exclude
credit notes, `canDelete` is false while an invoice has live credit notes.
`SalesView` duplicates the same for the phone read view (hero bar
'Annuleren'/'Beheren' only while concept, next-step card, Meer acties). The
Verkoop list buckets `docType !== 'OFFERTE'` under Facturen with
`docs=all|f|cn` (app-segmented in `sales-document-navigation`), credit rows
('− € x', tegoed line, 'Tegoed af te handelen'), 'Alleen nog te ontvangen'
keeps invoices with remainingEur > 0 and credit notes with creditEur > 0,
`todo()` skips credit notes and fully credited invoices; `sales-list-groups`
subtracts credit totals inside a container group. `sales-list-swipe` (unused
concept only) and `sales-reopen` (also false with live credit notes or
`goodsReturnedAt`) treat credit notes like invoices; `sales-pdf-sheet` takes
`[creditNote]` ('Creditnota instellen', no packing slip). Partner
containers: `purchase-partner-payments` loads `partnerCreditProposal` next
to the financing and shows the 'Tekort na ontvangst' card (received ∧ no
settlement ∧ overFinancingEur > 0 → 'Creditnota maken op {advance}' emits
the lead's `creditNote` output; a concept advance credit note reads 'in
concept · open ›'; not received / settlement exists → the two hints); its
documents list and Betaalhistorie know credit notes and 'verrekend'. Kosten
& bank: `incoming-money` (`isOffsetRow`; `incomingMoneyTotals` leaves offset
pairs out of every cash sum and reports `offsetEur` once per pair;
`receivableTotals` adds `creditEur`/`creditNoteCount`, `invoiceReceivable`
handles credit notes without a summary), `FinanceState.receivables` rows of
kind 'credit' (remainingEur 0, `creditEur`, credited number), Te ontvangen
chips/strip/headline 'Tegoeden − € X' (`kind=credit`), Ontvangen
'Verrekening · CN ↔ F' rows with `dir=offset` and the 'Verrekend' figure,
the Overzicht tile subline, `cashOutlook(…, openCreditEur)` and the
'open-credits' attention row; `bank-movement-panel` offers credit notes for
OUTGOING lines only and never matches offset rows (no new imports: harness).
Analyses: issued credit notes come off Gefactureerd ('waarvan gecrediteerd −
€ X'), the monthly trend and the top lists (signed), `documentAccounting`
also covers issued credit notes (server accounting: standard credits
negative, advance credits zero, settlement credits revenue only),
outstanding/overdue stay FACTUUR-only, attention says 'Tegoed af te
handelen' and never 'Betaling open' for a credit note; dashboard, settings
('Nummering creditnota's', one CN series) and the trash (`CREDIT_NOTE` →
'Creditnota') follow. Every credit style lives in
`src/styles/sales-credit-note.scss` (`cn-*`, `receipts--credit`, `credit-*`,
`so-credit*`, `partner-shortage`, `fin-credit-row`, `fin-offset-row`); the
desk and editor style arrays did not grow.

### Purchasing
- List rows swipe left (iOS pattern) to a confirm-guarded delete.
- List → **read-only view first** (stepper without Onderweg, products
  with expandable per-line cost build-up, Totaal/Per stuk toggle,
  journey cost card, container fill bar, Gegevens above costs), edit
  behind a button. New orders open straight in the editor.
- Editor: rates on one row (RMB→USD, USD→EUR goods/transport), costs
  section, product picker that can **quick-create** a product (name,
  supplier currency price, pieces/carton, carton size) without leaving,
  per-line EXW currency, status advance button at the bottom, apply
  landed costs with confirm dialog.
- Purchase figures are always shown to staff (no privacy mode since
  fd979b4); the PDF sheet picks the internal or supplier variant.

### Products
- List (search, skeletons) → view first: price and margin (intern) in
  the title line, snap carousel with corner expand icon, lightbox with
  download (originals are print quality), bento tiles, barcode placement:
  piece EAN with the product, outer ITF-14 with the carton.
- Editor behind Bewerken; EXW price with currency select; CSV
  master-data and translations import/export live in Settings.

### Translation workspace (Codex, 2026-08-21)
- Settings → translation workspace (`content-translation-workspace.ts`):
  site copy, legal pages and category texts per language, 8 languages,
  saved through the revisioned content-translation endpoints. The
  `website-sync-status.ts` badge shows the rebuild outbox state
  (NOT_CONFIGURED / QUEUED / TRIGGERED / LIVE / FAILED_OR_STALE) and keeps
  polling while Vercel builds.
- Products: `product-translation-editor.ts` (+ adapter) edits a product's
  name/colour/size per language against the strict-language contract;
  the publication editor lists every missing path before a family may go
  READY/PUBLISHED. Exports can be made per locale, strictly.
- Category saves carry the server `revision`; a stale one is refused
  with "Categorie is intussen gewijzigd" - reload, do not retry blindly.
- `unsaved-changes.guard.ts` protects the workspace from navigating away
  with dirty edits; `desktop-viewport.ts` keeps the workspace desktop-only.

### Portal (customer-facing, calm colours)
Quote view in the customer's language (texts from the backend bundle),
carton rounding parity with the backend, digital signing, change
proposals with "wij kijken ernaar" status, PDF download. Terms/privacy
page NL/EN.

## Gotchas learned the hard way

- Angular dev server + wholesale file rewrites: scoped component CSS can
  go stale - restart `ng serve` when styles mysteriously stop applying.
- `showPicker()` needs a visible input on iOS; date/week fields overlay a
  transparent native input on the button instead.
- iOS Safari snaps near-miss taps to the nearest button (the "phantom PDF
  downloads" mystery).
- Actions that depend on loaded data must wait for it: the new-order
  sheet decides "no customers yet → add form" only after loading -
  deciding on an in-flight empty list opened the wrong flow.
- Never trust `sessionStorage` auth outside `api.config.ts` helpers.
