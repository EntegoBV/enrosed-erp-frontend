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
_Filled in by the Documenten & media round._

### Inkoop · Betalingen
_Filled in by the Inkoop round._

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
