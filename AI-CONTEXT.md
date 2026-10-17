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
- Floating pill chrome: tabbar and action bars share 20 px radius. The
  page bar (`app-page-header`, styles/shell.scss) is the 52 px desk toolbar
  and the iOS 26 phone bar; on the phone its glass sits on
  `.appbar::before` (blur on the bar itself creates a containing block
  that breaks `position:fixed` children - learned the hard way with the
  notification sheet). See "Shell and motion".
- Hand-drawn SVG icon set in `shared/icon.ts` (24-grid, round caps).
- Skeleton loaders (`shared/skeleton.ts`: list/card/lines/stats, and
  table/group since 2026-10-16) instead of "Laden…" - the layout never
  jumps. A failed load shows `app-load-error`.
- Cost breakdowns read as "the journey of the goods": `.cost-section`
  micro-headers + `.cost-hero` framed total (shared by sales totals,
  purchase totals and purchase view).
- Product view uses bento `spec`-tiles for identity facts; money stays in
  stat rows (tiles everywhere proved less scannable).
- Motion: the tokens and mo-* utilities of styles/motion.scss (see "Shell
  and motion"); `.anim-rise` stays for opt-in blocks. Everything is
  instant under `prefers-reduced-motion`. `--muted` is #736a64 (AA).

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
  tabs/radio, arrow keys; `.ios-seg--stacked` puts an icon over an 11px
  label so five view tabs fit 360px), `app-ios-nav` (large title that
  condenses into a glass bar; [lead] [trail] [caption] [below] slots;
  `customLarge` + [hero] put the screen's own block in place of the large
  title), `app-ios-tabbar`
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
  finance-legacy, files-workspace / files-phone, purchase-payments,
  purchase-phone.

## Shell and motion (redesign foundation, 2026-10-16)

The foundation of the 2026-10-16 redesign (contract:
scratchpad redesign/foundation/design.md + critique.md; the critique wins).
Areas build on these pieces and never restyle `.sidebar*`, `.appbar*`,
`.tabbar*`, `.fab` or bare kit classes. Built so far: F0, F1, F2a, the desk
toolbar (F5a-1), the phone header (F4a), the sidebar from NAV_GROUPS
(F5a-2, light skin) and the AA contrast colours. Still to come from the
foundation: sheet/toast leave and drag to dismiss (F2b), the dark sidebar
skin, rail count chips, Meldingen foot item and skip link (F5a rest, F5b),
the tab bar geometry and the '+' accessory (F4b), Meer on the kit (F6),
phone push/pop (F3), 404 + aliases + route titles + badge refresh (F7a),
login extras, Sneltoetsen, route progress, preloading (F7b).

**Motion** (`src/styles/motion.scss`, loaded after the kit; `shared/motion.ts`):
- Tokens: `--dur-1` 120 ms (press, hover, fades), `--dur-2` 200 ms (menus,
  drawers, accordions, list insert/remove), `--dur-3` 320 ms (phone push,
  sheets), `--dur-out` 220 ms, `--ease-out/-in/-spring/-snap`, `--mo-shift`
  28 px, `--mo-lift` 8 px. Use them with a fallback in area partials:
  `var(--dur-2, 200ms)`.
- Keyframes (enter ones end on `transform:none`, trap rule): `mo-fade-in`,
  `mo-fade-out`, `mo-push-in`, `mo-pop-in`, `mo-lift-in`, `mo-sheet-in`,
  `mo-sheet-out`, `mo-dialog-out`, `mo-toast-out`, `mo-row-in`,
  `mo-row-out`, `mo-hold`.
- Utilities: `.mo-enter` / `.mo-leave` for rows the user adds or removes
  (`animate.enter="mo-enter"`, `animate.leave="mo-leave"`; never on data
  loads), `.mo-fade`. Page changes fade `.content` over `--dur-1`.
- Press: `scale(.97)` on touch only; desk buttons never shrink.
- Reduced motion: tokens 0, one 0.01 ms cycle for anything left (loops
  stop), `scroll-behavior:auto`; `installReducedMotionScroll` (App) turns
  `behavior:'smooth'` from code into `'auto'`. New code may use
  `scrollBehavior()` / `prefersReducedMotion()`.

**Page header** (`shared/page-header.ts`, styles in `styles/shell.scss`; the
host stays inline):
- Inputs: `title`, `subtitle`, `showBell`, `titleEditable` /
  `(titleChange)`, `backTo`, and new `[parent]` (`{label, url,
  phoneLabel?}`; undefined = `parentOf(url)`, null = no crumb) and
  `[large]` (undefined = a phone large title on root screens, i.e.
  `parentOf(url) === null`). `showBack` no longer changes what renders.
- Desk: 52 px toolbar (`--appbar-h: calc(52px + safe-t)` from 680), title
  18/720, crumb "Inkoop ›" on detail screens (a real link; a click goes up
  through NavHistory), the subtitle stacked under the title when a crumb
  shows, inline otherwise; projected `.btn` (direct children) at 32 px, a
  divider and the 32 px bell. A title that would be cut folds the crumb to
  a chevron, then away.
- Phone: 44 px bar (`--appbar-h: calc(44px + safe-t)`), large title 34/800
  with the subtitle as caption on root screens (condenses into the glass
  bar, `observeLargeTitle` in `shared/large-title.ts`, shared with
  app-ios-nav), the glass bar with title over subtitle on detail screens.
  Back control: none on the five tab roots, else the screen below in the
  history ("‹ Verkoop", history back), without history the parent's label,
  backTo's screen label, or "Meer"; over ten characters, or when the title
  would be cut, a chevron circle. Projected `.btn` become glass capsules
  (primary: accent), `.btn--icon-mobile` glass circles, the bell a glass
  circle with the red badge. `.content` right after a large title gets
  padding-top 4 px.

**Navigation helpers** (core/platform, pure and node-tested unless noted):
- `nav-items.ts`: `NAV_HOME`, `NAV_GROUPS` (five groups, items with label,
  short, meerLabel, icon, link, query, exact, countKey, groupCount, hint,
  railMain, wide, newUntil, tabRoot, tone), `NAV_WORKSPACES`,
  `NAV_DEVICE`, `NAV_MORE`, `navItemActive`, `navItemUrl`, `navItemIsNew`,
  `groupCountKeys`, `meerItems`. The desk sidebar renders from it (Meer will
  too). `NavCountKey` names WorkQueue signals; extend it with the signal.
- `phone-tabs.ts`: `phoneTabForUrl` (screens reached from Meer light Meer),
  `isPhoneTabRoot`, `PHONE_TABS`. The tab bar highlight uses it.
- `page-parent.ts`: `parentOf(url)` → `{label, url, phoneLabel}` or null.
- `nav-history.ts` (stack keyed by navigation id) and the injectable
  `NavHistory` (`nav-history-service.ts`, created by App): `below()`,
  `belowLabel()`, `lastUrlFor(path)`, `upHref(parentUrl)`, `up(parentUrl)`
  (history back when the parent is below, else its last URL), `back(fallback)`.
- `nav-direction.ts`: `navDirection(prev, next, trigger, info, PHONE_TABS)`
  → push / pop / tab / none; a navigation may name itself with
  `info: { nav: 'push' }` (used by the coming phone push/pop).
- `app-shortcuts.ts`: `GLOBAL_SHORTCUTS`, `PAGE_SHORTCUTS` (areas append
  rows for their routes), `pageShortcutsFor`, `shortcutCommand` ('/' and
  '?'), `PAGE_SEARCH_SELECTOR` (`[data-page-search]` marks a page's main
  search).
- `return-label.ts`: `screenLabel(url)` ("Verkoop", "Order", "Inkooporder",
  "Vandaag", "Meer"…) and `capsuleLabel(label)` (≤ 10 characters, else '').
- `sidebarGroupForUrl`: `/settings`, `/settings/deleted-items`,
  `/voorwaarden`, `/activity` and sectie=company → Bedrijf; `/categories` →
  Producten & voorraad. No automatic sidebar rail any more.

**Kit pieces** (workspace-kit.scss unless noted): `.wk-subbar` (+
`__end`; sticky under the toolbar, tables after it stick under it),
`.wk-search > .wk-kbd` ('/' hint), `.ios-count`, `.ios-cell__sub--2`,
`.ios-tile--sm`, `.ios-disclosure__body` (indented child cells, animated
open where `::details-content` exists), `.content--narrow` (shell.scss,
960 px), `app-skeleton kind="table" | "group"`, `app-load-error`
(`[message]`, `[title]`, `[busy]`, `(retry)`; "Dit scherm kon niet worden
geladen" / "Opnieuw proberen"), `confirmLeave(ui, save?, {message?})` in
shared/ui.ts ("Niet-opgeslagen wijzigingen", Opslaan / Niet opslaan /
Annuleren) for `canDeactivate(): boolean | Promise<boolean>`.

**Load speed**: production builds no longer inline critical CSS (one
render-blocking stylesheet, no unstyled first frame); vercel.json marks the
hashed chunk/main/polyfills/styles files immutable and push-sw.js no-cache.

## Workspaces

### Kosten & bank
- Five sections, one question each (finance-sections.ts `FINANCE_SECTIONS`,
  the `view`): Bank (`accounts` = the cockpit, `movements` = Transacties),
  Te betalen (Alles/Kosten/Containers/Vaste kosten; buckets Nu / Binnenkort
  30 dagen / Later), Te ontvangen (Openstaand/Ontvangen), Inkoop & kosten
  (Facturen & kosten/Containers/Vaste kosten/Aan wie & beurzen) and
  Rapportage (phone: ⋯). The sidebar, the phone tab bar and the keys 1-6 go
  by `FINANCE_NAV`, where Bank and Transacties are two places. The Overzicht
  is gone since 2026-10-16: see "Bank cockpit and Kasprognose" below.
- The address is the state: finance-url.ts alone parses and writes it
  (`view`, `tab`, period/from/to, q, cat, status, channel, docs, container,
  cost, scope, account, dir, link, kind, purpose, year, quarter, regime,
  line, weeks; defaults omitted). Filters replace the history entry,
  drill-ins push. Legacy view=overview (now Bank), view=recurring,
  view=bank and ?container=<id> keep working; ?cost=<id> inspects a cost,
  ?line=<id> a bank transaction (on every section).
- Money basis: cash figures (Bank, Te betalen, Te ontvangen) are
  incl. btw and may add container EUR, labelled 'verwacht' when forecast;
  cost figures (Uitgaven › Bedrijfskosten, Analyse) are excl. btw with the
  btw beside them and never include container cash.
- Container payables (payables.ts) bucket the server's reconciliation per PO
  and payee; supplier terms replace the stream, never both. reached() is a
  copy of purchase-instalment-state.ts. Payee words follow Inkoop's
  PAYEE_LABEL (cost-ledger.ts, asserted in tests).
- BankTransactionPicker is inline in sales receipts, purchase payments and
  cost payments: search reference/amount/counterparty/date, optional exact
  EUR filter, source/account badges and disabled allocated rows. Manual
  payment entry remains available. Purchase first-instalment and receiving
  final-payment shortcuts now open the shared payment sheet before recording
  money; the cost full-swipe does likewise. Bulk costs retain manual payment
  entry with a hint to link existing transactions per cost. Odoo rows preserve their imported identity
  and cannot be deleted; unlinking preserves the bank row and payment.
- Existing outgoing payments link via POST bank-statements/{id}/links with
  same-sign summed EUR equality within €0.02 (integer cents). New cost and purchase payments use atomic
  /cost-payment and /purchase-payment endpoints: the bank row is the retry
  identity, and purchase responses retain ordered goods/part ids before
  proof uploads. Never infer a new cost payment id from a stale payments list.
  Sales allocation reuses an equal signed receipt even if its historical
  account label differs from the imported IBAN; only an explicit selection
  creates another same-amount receipt. Legacy markers remain for display.
- Bank accounts have an API registry (`/api/bank-accounts`): explicit aliases
  merge historical names with their canonical key; display labels never become
  write identities. Archive/restore retains financial history and removes only
  active account totals/options. The account editor is rendered at page-host
  level with the other finance sheets.
- An imported ODOO row establishes account authority even before registry load.
  On these accounts only Odoo rows after the chosen balance checkpoint affect
  cash; synthetic sales receipts and legacy manual rows remain outside it.
  Historical rows are still viewable. New Odoo checkpoints use end-of-day
  balances because imported dates have no bank timestamp; old readings stay intact.
  `Te koppelen` includes money in and out. Outgoing matching selects existing
  cost/container payments within €0.02 of the summed payment cents; imported rows never match
  by approximate date, amount or reference marker. Unlink an earlier manual
  row explicitly before reassigning its payment to an imported row.
- Bank allocation also offers received Odoo/Peppol supplier invoices and
  credit notes through `/bank-statements/{id}/odoo-purchase-invoices`, preview
  and atomic `/odoo-purchase-invoice` registration/link. Supplier credits are
  negative costs/payments matched to positive bank receipts. Preview locks the
  snapshot, exposes VAT/document evidence, and requires explicit reuse of an
  existing candidate; selecting one refreshes preview with existingCompanyCostId.
  Retry preserves bank/document/hash identity. Stored allocationDifferenceEur
  remains visible after linking; invoice/payment/bank amounts are never rewritten
  solely to hide a rounding difference. Existing manual partial-payment flows remain.
  CostSheet loads `/costs/{id}/odoo-source`, protects original fields/totals and
  leaves classification separate; no source VAT regime is inferred by the UI.
- OdooConnectionPanel imports bank rows and browses incoming/outgoing Odoo
  files. SalesPeppolPanel is collapsed on issued invoices/credit notes:
  local preview works without connection settings; named customer match,
  immutable preview, Odoo draft and explicit final-send confirmation are
  separate steps. Unknown/blocked outcomes allow status refresh only.
  Outbound/send flags and mapping checks are enforced by the backend;
  credentials never enter the browser. New API contracts are in banking-api,
  odoo-api and odoo-outbox-api. No automatic Peppol sending on invoice save.
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
- Container invoices and payments in parts (2026-10-15, see Inkoop ·
  Betalingen): Uitgaven › Containers (unfolded row) and the container
  inspector render `app-container-payment-tree` (container-payment-tree.ts,
  node-tested with its invoice words handed in): per payee its invoices
  against the Afspraak with 'Bestand ↗', invoice files '· zonder gegevens',
  'Nog geen factuur bij deze container', the supplier's terms
  '{label} · € paid van € planned' with their payments, payments
  '{dd/MM} · {label} · € · {bank}' ('op de bank · KBC', 'niet op de bank',
  'verrekend tegoed', 'via leverancier · zelfde transactie' for an inspection
  on the goods' transfer), a payment in parts as '· N transacties' with its
  transfers indented. Bank status = the hard link, else the old
  'containerbetaling #id' marker (`FinanceState.containerPaymentLine`), never an
  amount guess. Payables and allocation targets carry `invoiceNumber`
  (search; +30 when the bank reference names it, spaces/dashes ignored);
  the payables sub-line adds 'Factuur …' and ' · via leverancier'.
  Bewegingen: a line paying several payees of one container reads
  'Goederen + inspectie (PO-…)' (`containerLinkLabel`); credit offsets are
  never 'zonder bankkoppeling', never in attention, never offered in
  'Bestaande betaling' (`PurchasePaymentRow.creditOffset`). In 'Bestaande
  betaling' one purchase payment larger than the line is 'Deel koppelen'
  (POST /purchase-payment-splits/{id}/bank-part: the line's part is carved
  out, the rest stays open as a second transfer); one group member that
  matches goes through bank-part too (it takes the line's day); everything
  else keeps /links. 'Factuur of uitgave' lists the container's invoices and
  the term's payments from the tree (an older server: the commercial
  invoice files as before), hints 'Er staat al een betaling van € x; koppel
  een deel via Bestaande betaling.', and for a supplier target offers
  'Waarvan inspectie via leverancier': goods + inspection become two
  payments on the line (splitTransfer, the inspection sets the flag). All
  new actions hide while `paymentRoundOnServer(purchaseViews()[0])` is false.

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
- Phone: `app-purchase-payment-overview` (read view and editor, Betalingen tab) with
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
- A supplier term is never a dead end (containers round 2026-09-29, F1): a
  term paid to the cent with a tied payment and no flag has `canConfirm`
  (kept apart from `canSettle`, which `pickScope` uses for the default term)
  and every term carries `paymentIds` (tied payments, newest first).
  `termMenuItems`/`termHasMenu` in purchase-payment-menus.ts build the one
  term menu for the desk ⋯ and the phone payee sheet (editor only): 'Betaling
  noteren voor deze termijn' (open), 'Termijn afrekenen' (canSettle or
  canConfirm), 'Afrekening ongedaan maken' (per term, `undoSettle({ payee:
  'SUPPLIER', due })`) and 'Betaling aanpassen…' (newest tied payment); paid
  rows keep no text button. The settle sheet's TERM warning relinks the
  newest supplier payment WITHOUT a term (`relinkPayment`: a whole-supplier
  settle strips the term and undo keeps it null); a GROUP settle already
  prefers a term-less carrier (`settleCarriers`). The phone read view's
  'Betaling' detail has 'Bewerken' (→ `/purchasing/:id/edit?section=ledger`)
  and says 'Aanpassen of afrekenen kan in Bewerken.' The server's PUT payment
  has no settle guard: this was UI only.
- Tegoed leverancier (2026-09-29, F3): money the supplier owes back (short
  delivery, damage, price) lives in its own server entity, never as a
  negative payment. `view.supplierCredits` (reason SHORTAGE/DAMAGE/PRICE/OTHER
  = Tekort/Schade/Prijsverschil/Andere, status OPEN/REFUNDED/OFFSET = 'Tegoed
  open'/'Terugbetaald dd/mm'/'Verrekend met INK-…') feeds `ledgerCredits`;
  the supplier payee carries `credits`, `creditEur` (server stream.creditEur
  first) and `creditOpenEur`, the summary's forecast is paid + open − credit
  (as the server's), Betaald/Open/Afspraak never move, and an open credit is
  a 'credit' todo. Endpoints (all return the order view; the host just calls
  `refreshPaymentState`): POST/PUT/DELETE `/purchase-orders/:id/supplier-credits`
  and POST `…/:creditId/offset` (a normal supplier payment 'Verrekend tegoed
  INK-…' on another ordered container of the same supplier, `creditOffsetTargets`
  from the purchase list, optional term). `app-purchase-supplier-credit-sheet`
  (page level in editor and desk, `crediting`) does add/edit (date, reason
  segments, amount + currency with the receipt value as proposal via
  `supplierCreditPrefill`, 'Afgeschreven in euro', note), refund (date +
  euro) and offset; remove and 'Terugbetaling ongedaan maken' are confirms;
  every write goes through `requestCredit` (whenSaved). The PUT bodies come
  from `supplierCreditEditBody` (euro field starts empty and goes along only
  when typed for USD/CNY, else the server keeps the stored euro or takes the
  order rate for a new amount/currency; note always sent, '' clears it) and
  `supplierCreditRefundBody` (a EUR refund of another sum sends it as amount
  and amountEur, the server requires them equal). An untouched euro proposal
  empties when the Munt turns USD/CNY. Desk: sub rows under
  Leverancier in 'Per ontvanger' with a ⋯ (`creditMenuItems`), 'Tegoed
  noteren…' in the payee ⋯; phone: rows under Leverancier and a section in
  the payee sheet (menus in the editor only). A target's offset payment
  (`view.creditOffsets`, `LedgerRow.creditOffset`) locks amount, currency and
  payee in the payment sheet and cannot be moved; deleting it reopens the
  credit. Nacalculatie: reason 'credit' after 'open', 'Tegoed leverancier −
  € x' under the supplier's eindkost, a CREDIT bridge row between Open and
  the eindkost, the receipt block's credit line and 'Tegoed noteren…' (the
  read view opens `/purchasing/:id/edit?section=credit`), ' · tegoed € x
  open' after the state sentence. Kosten & bank does not show credits yet.
- CIF (2026-09-29, F4): 'Prijsbasis en munt van de leverancier' has EXW |
  CIF | DDP chips; CIF = EXW lines + `order.freightViaSupplier = true`, EXW
  and DDP clear a set flag to null (never write false over null: the server
  refuses a CIF toggle once Leverancier or Douane & transport is settled).
  `purchaseCif(view)` (flag and not DDP) drives the words: supplier basis
  'Goederen + zeevracht (CIF) · plan' and composition Goederen + Lokale kosten
  China + Zeevracht, Douane & transport 'invoerrechten en lokale kosten
  aankomst · zeevracht via de leverancier (CIF)' with only duty + arrival, the
  bridge 'Leverancier · goederen + zeevracht'. The server adds the supplier
  term FREIGHT 'Zeevracht (CIF)' (payable.supplierFreightEur); it is in every
  Due union/Record, due 'bij vertrek' like SHIPPED (reached() in
  purchase-instalment-state.ts and finance/payables.ts), ordered ORDERED,
  SHIPPED, FREIGHT, ARRIVED, and reaches the payment sheet's term picker and
  quick-fill chips, the Nacalculatie term rows and Kosten & bank through the
  server's supplierInstalments. The payment plan sheet splits the goods only
  (`planAgreedEur` = supplier Afspraak − supplierFreightEur) and never warns
  about a FREIGHT term dropping out of a plan.
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
  externe kost with the afspraak figure beside the variance, the per-stuk
  block and the Per product (four decimals, afspraak per line) and Toelichting
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
  headline (Afspraak on ordered pieces → Verwachte eindkost / Eindkost →
  signed Verschil with % → per stuk on ordered or usable pieces), one reason
  word per payee (`nacalcReason`, precedence additional → incomplete →
  unbudgeted → review → legacy → partly-settled → open →
  settled-lower/-higher → none) with at most one action (`payeeRowAction` in
  the ledger, stamped on every payee as `action`; 'Nakijken…' only for an
  overpayment, a small difference settles before it is paid, an incomplete
  payee gets no action), the receipt block (server `receiptVariance` first,
  reconciliation lines as fallback, over-received value from the order
  lines, supplier fact, LATER reports shown but never counted), the bridge
  from 'Calculatie · totaal geland' to 'Afspraak extern' ('Afronding' up to €
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
  the Afspraak and Verschil columns of payees and products and the text
  buttons go); the rail's Kosten pane and
  the Betalingen side card share `app-purchase-nacalc-summary`
  (`PurchaseNacalcSummaryCard`, 'Volledig ›'); Betalingen is the only place
  that records money (row 'Noteer ›' → `showPayments(payee)`), settle/undo
  use the desk's page-level sheets. Phone: `app-purchase-nacalc-overview`
  sits on the Kosten tab of the read view and the editor (hero +
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
- Invoices, betaalbewijs and payments in parts (2026-10-15, Emre's requests
  1-4; contract scratchpad spec-purchase-payments.md). One commercial invoice
  per container (number, date, amount; `view.invoices`, POST/PUT/DELETE
  `/purchase-orders/:id/invoices`) that every supplier term points to; a
  second invoice of a payee is extra on top (a correction is edited on the
  first, a credit note stays a tegoed). Which payments belong to an invoice is
  the server's (`invoice.paymentIds`); `purchase-invoices.ts` (pure,
  node-tested) only words it: `invoiceComparison` ('gelijk aan de afspraak',
  '€ x meer/minder dan de afspraak', '+ inspectie' against
  `order.inspectionCostEur` when the supplier's primary covers the
  inspection), `resolveInvoice` (explicit → the payee's only invoice → the
  supplier's primary for an inspection `viaSupplier` → none; primary = lowest
  id), `isInvoiceFile` (COMMERCIAL_INVOICE, INVOICE, an invoice's file, OTHER
  'Factuur …'): invoice files are never payment proof. Legacy invoice files
  without data come as `view.invoiceFiles` with 'Gegevens invullen'.
  `app-purchase-invoice-sheet` (page level in editor and desk, `invoicing`)
  uploads the file once (COMMERCIAL_INVOICE for the supplier, else INVOICE,
  no paymentId), then POSTs/PUTs; a changed USD/CNY amount drops the typed
  euro (as payments do), and after 'Ander bestand' the host offers to delete
  the replaced file (else it stays as a file without data). Kosten & bank
  heads each stream with the ERP's payee words, never the server's label. The betaalbewijs is the bank link: a ledger
  row is `proven` when it is a credit offset or every transfer is on the bank
  (hard link or old marker; every host passes `bankedPaymentIds`) or has a
  proof file; every 'zonder betaalbewijs' reads `proven === false`, counted per
  row. 'Bewijs toevoegen' is gone: files, the invoice and bank transactions
  are managed in the payment sheet ('Banktransacties' with Losmaken /
  'Banktransactie koppelen' / per open transfer Bedrag, Koppelen, 'Deel
  verwijderen'; 'Betaalbewijs (bestanden)' with ✕; 'Factuur' select with
  inline 'Factuur toevoegen…'). Several transfers on one payment: one
  `purchase_payment` row per transfer, `groupId` = the root's id; the ledger
  shows one row per group with `parts`, `bank {linked,total,sharedWith}`,
  'N transacties' and a sub-row per transfer; group actions address
  `row.payment` (the root) and send `applyToGroup: true` (edit, settle, undo,
  move; one write per group); removing goes per transfer. Linking from the
  sheet (`purchase-payment-links.ts` decides): one line matching or smaller →
  `/purchase-payment-splits/{id}/bank-part`, 2-10 lines making the amount →
  `/bank-lines` (the server splits and redates each part to its bank day);
  an older server: one matching line through /links with paidOn = the
  line's day. The sheet and the save judge picked lines with one rule
  (`pendingPartEur`: a payment never split at the draft's euro, since the
  save writes it first; a transfer at its correction or booked euro).
  Inspection via the supplier: `order.inspectionViaSupplier`
  (server-owned, `PUT …/inspection-via-supplier`; the host refreshes, never
  sets the view from the answer), ticked on a new supplier transfer's
  inspection part or split off a saved goods payment ('Inspectie afsplitsen',
  `/inspection` after the links, `expectedAmountEur` = the euro the PUT
  answered, frozen for retries; never in the same save as a carve or a split
  over several lines: such a pick clears the field and the save refuses it);
  an inspection on the goods' line reads '· zelfde transactie als de
  goederen'. Every new action hides while `paymentRoundOnServer(view)` is
  false (no `invoices` in the view): the backend ships first.
- Per display / per stuk (2026-10-15; said 'set' until the sales-unit round of the same day): reconciliation lines and totals carry
  `salesUnit`, `piecesPerUnit`, unit nouns and per-piece figures
  (`setBasis` PIECE | DISPLAY | MIXED); `unitCostQuantity` and
  `forecastExternalUnitEur` stay per sales unit (partner settlement multiplies
  them). The Nacalculatie (desk, phone, summary card) says 'Per display' with the
  piece price beside it ('100 bestelde displays × 12 rozen · € 2,6000 per stuk'),
  in a mixed container 'Gem. per stuk' ('1.400 stuks · displays als 12 rozen
  geteld'); the shared words live in purchase-nacalc-metrics.ts
  (`nacalcUnitBasis`, `nacalcProductUnit`, `nacalcReceiptUnitLine`, …). The
  bridge row is 'Correctie naar bestelde aantallen'. Desk and phone product
  tables label a display product's landed cost '/display' with '€ … /stuk'
  (desk Per product: the figure, then '/display' on its own small line under
  it like the total row, `nacalcProductUnit().amount`/`.per`; one line cut to
  '€ 30,9600 /dis…' in the 92 px column at 1440).
- Round 2 of the payments round (Emre's follow-ups of 2026-10-15; contract
  scratchpad spec-purchase-payments-r2.md, backend AI-CONTEXT 'Round 2').
  A linked transaction carries the payment: one payment (or one open
  transfer of a group) and one line go through `bank-part`, which takes the
  line's day and, for a whole match, its euro (a euro payment's amount with
  it; USD/CNY keeps its amount, the sheet's 'Koers' row shows the new rate).
  A USD/CNY payment is compared in its own currency, as the backend's
  `linkForeign`: one line is the whole payment (never a euro carve, never
  'hoger', never the inspection rest; a warning when the euro is more than
  15 % off the booked one) unless the part it paid is named in that currency
  ('Alleen een deel? Deel in USD', sheet and Kosten & bank; `ForeignLink`,
  sent as bank-part's `amount`, worded like the server's `carvedForeign`).
  The sheet no longer PUTs before such a link when only the transaction was
  picked (typed money goes back to the stored payment on a pick); changed
  words, term or invoice still go first with the stored money. A line more
  than € 0,02 above the payment is 'higher' (`pendingLinkPlan`): the sheet
  asks 'Transactie is € x hoger dan deze betaling' with 'Bedrag aanpassen
  naar € y' (`higher: 'ADJUST'`), 'Rest als inspectie via leverancier'
  (`'INSPECTION'`, only where the server's `inspectionRestRefusal` takes it:
  `inspectionRestOffered` = a euro supplier goods payment, not the CIF term,
  of a container with `inspectionCostEur` > 0, no inspection noted with the
  transfer, and the via-supplier inspection not yet reaching that cost) and
  'Annuleren'; save stays blocked until a choice. A refused link never locks
  the choice: when the sheet wrote nothing (`paymentWritten` unset) the
  pending state clears and the error does not say 'Betaling bewaard'; after
  a write the retry keeps the saved payment, and the options, Annuleren and
  ✕ stay usable. The inspection noted with the goods of
  the same day (`transferCompanions`, unlinked SEPARATE payments) joins a
  line that makes both (`withPaymentIds`, the inspection keeps its amount):
  never a second inspection. 'Wat verandert' (`linkChange`: Bedrag, Betaald
  op, Koers, Inspectie via leverancier, Bewijs; Betaling nu → Na koppelen)
  shows before every single-line link, also in Kosten & bank › Bestaande
  betaling (one payment, or goods + its inspection, go through `bank-part`
  there too; several others keep /links). After a link the server's
  `notice` (else `linkNotice`) shows as a closable banner on Betalingen
  (`paymentNotice`, per order) and as the toast in Kosten & bank. A retry
  after a lost answer recognises transactions already on the payment
  (`pendingAlreadyLinked`) and clears the pick. The payment sheet has one
  'Betaalbewijs' list: the transactions first (with 'Deze transactie draagt
  ook: Inspectie € 300,00 (via leverancier)' when the line carries more of
  the container; no 'Inspectie afsplitsen' then), the files, 'Bestand
  toevoegen', the count of what it lists (`fileRoom` = listed proofs + the
  payment's free places); an older invoice file on the payment is listed
  under Factuur with open and ✕. One word for adding a transaction:
  'Transactie toevoegen' (on a payment fully on the bank too, see round 3).
  Invoices: `invoiceCoverage` words 'Geldt voor alle betalingen van
  Leverancier (n)' or 'Geldt voor n van m betalingen' with 'Toewijzen aan
  alle betalingen' (desk row and ⋯, phone payee sheet; `POST
  …/invoices/{id}/assign-all`, one call); editing a payment of a payee with
  two invoices and none of its own starts on the main one; an invoice made
  in the payment sheet is one multipart call with its file and
  `assignAll` ('Voor alle deelbetalingen', on by default, a switch only
  when the payee has another invoice, else the 'Geldt voor alle betalingen'
  note); a number the payee already has is refused before any call with
  'Kies CI-…' (the typed file follows to that invoice), and a retry reuses
  an invoice by number only when this sheet sent it (`invoiceAttempt`).
  'Bestand bij de factuur' sends a file to an invoice without one
  (`…/invoices/{id}/document`), never to the payment: to the invoice the
  sheet showed (`invoiceFileFor`; an inspection via the supplier resolves to
  the supplier's invoice), kept in the sheet when there is none. One date rule for a
  payment in parts: its newest transfer's day with 'eerste dd/mm' (ledger,
  sheet, phone rows, Kosten & bank tree). No average over different
  products (`nacalcUnitMix`; the server's `totals.containerAverage` wins,
  else one product only, like ReconciliationUnits.containerAverage): the summary
  card, the desk strip and the phone hero show 'n producten · € min – € max'
  per stuk (per display when every line is a display of one size) with the products
  by value (round 3 removed every remaining average, see below).
- Round 3 of the payments round (Emre's screen check of round 2,
  2026-10-15). No mixed average anywhere ('klopt niet' with several
  products): where a container holds different products every per-unit
  figure is their range and the products themselves, never 'gem.'. The
  order header, the desk Kosten chain and the confirm sheet read
  `landedUnit`/`landedUnitText` (costing lines, a display at its piece price:
  '2 producten · € 2,600 – € 8,867 per stuk'; one display product '€ 30,960 per
  display · € 2,580 per stuk'); the Nacalculatie strip and phone hero say
  '7.976 st bruikbaar · …' (`mixQuantity`) and 'incl. Enrosed kost € a – € b'
  (`mixPricingRange`), the Kostbasis the same range, the product table's
  total row the range, the receipt line per product (`mixReceiptLine`); in
  Analyses › Inkoop the container table and the Kostprijs block show the
  range too. Only one product keeps its figure (no family rule). The
  Betalingen table keeps every column on a floor (amounts 84 px for a bold
  total, Status the longest pill word) and lets Status take what is left,
  so a pill never breaks inside a word at 1440 or 1100. 'Transactie
  toevoegen' on a payment whose every transfer is hard-linked
  (`transferAddable`; sheet beside 'Bestand toevoegen' and the ⋯ menu,
  desk and phone): one picked line (`growLinkPlan`), previewed as 'De
  betaling wordt € 12.500,00 (was € 12.000,00); de termijn komt € 500,00
  boven de afspraak' (`growPreview` with `payingTermStanding`), sent as
  bank-part with 'ADJUST' (the server's addTransfer). 'Bedrag aanpassen'
  says its consequence on the choice (`adjustConsequence`, sheet and Kosten
  & bank); the sheet's question has no Annuleren of its own (Kosten & bank:
  'Niet koppelen'). A lost answer is told in its number and with what
  changed (`alreadyLinkedText`: 'Transactie al gekoppeld · bedrag nu … (was
  …)'). A saved payment whose words and money did not change is not written
  (`storedUnchanged`): a proof file alone only uploads, 'Bewijs toegevoegd'.
  On the bank the proof head says 'Bewijs: transactie ✓' with 'bestanden
  (optioneel) n/m'; a linked USD/CNY payment shows 'Koers 0,8704 (bank)'
  instead of the order-rate hint; payment amounts show as '4.320,00'
  (`amountInputText`). Factuur of uitgave lists the container's payments of
  the payee not on the bank yet first ('Bestaande betaling · € 12.000,00
  (30%)', 'Deel koppelen' when larger; `localOpenPayments`) above 'Nieuwe
  betaling'. The proof todo says 'Koppel de banktransactie'.
- Round 4 (2026-10-15). Analyses › Inkoop speaks in each product's unit
  (`reconciliationUnit`, `reconciliationLineUnit`): column 'Per eenheid',
  a display product '€ 30,9600 per display' with '€ 2,5800 per stuk' and '400
  bestelde displays' under it, the Kostprijs block 'Verwachte externe kost per
  display' and 'Per display incl. opslag' with their piece prices, Per product
  per display or per stuk; several products keep their range. Betalingen with
  a Verschil column: gaps 4 px, the name 138 px and Status 104 px (a whole
  'Koersverschil' pill) from a 782 px main column, 112 px just below it.
  Koersverschil: a USD/CNY payment on its bank transaction takes the bank's
  euro; when the supplier's goods are agreed in that currency (every order
  line naming it, `ledgerFxRate`) and every term money was booked on or
  netted with was paid exactly its foreign amount (within 0.01 of that
  currency plus the Afspraak's euro cent; `paidAsAgreed`), the euro
  overpayment is 'Koersverschil € 44,80 (bank)': term pill, payee status
  (kind FX), the Verschil cells ('koersverschil (bank)'), the strip note,
  a neutral line in Te doen, never a 'nakijken' to-do; `reviewEur` leaves
  it out and the Nacalculatie stays Voorlopig (not Na te kijken) for it.
  A real over- or underpayment in the foreign currency, or a term only
  covered by netting, keeps the old words; the netting is untouched (the
  server nets a surplus into an unpaid later term, which then reads
  'verrekend').
- Verdelen over containers (Emre, 2026-10-16: one transfer paid the 30 %
  of three containers). The larger-transaction question starts with
  'Verdelen over containers' ('Deze transactie betaalde ook andere
  containers'; a USD/CNY payment far below its line gets it as a link under
  the warning), before 'Bedrag aanpassen naar …' and 'Rest als inspectie
  via leverancier'; never for Andere kosten, a credit offset or 'Transactie
  toevoegen'. The share block lists this container (`containerName`, its
  part) and each other one on its open payment ('Bestaand: € x': linked and
  followed, carved when smaller, grown when larger) or a new payment on a
  term ('Nieuw: <term>'), with 'Container toevoegen…', 'Volgens afspraak' /
  'Gelijk verdelen' (`splitCents`, to the cent; a typed amount makes it
  manual), what each part does (`shareEffect`) and 'Samen € x van € y ✓';
  'Verdelen en koppelen' waits for the two-cent match and sends one POST
  `/bank-statements/{id}/purchase-share` (`shareBody`: this payment first,
  with the euro the sheet saw), toast 'Verdeeld over 3 containers: …'. The
  editor proposes the same supplier's open payments on this term noted
  within a week (`proposeShare`). A new payment's 'Deze transactie dekt ook
  andere containers' starts a container on its open payment and then saves
  through purchase-share too, so no container gets a second payment;
  without open payments the old `/purchase-payment` call stays.
  Betaalbewijs names the other containers' parts ('Deze transactie draagt
  ook: …', `lineShares` from GET `/purchase-payments`). Pure, node-tested:
  `purchase-payment-share.ts`, `purchase-also-containers.ts`. An older
  server (404/405): 'Verdelen over containers kan zodra de server
  bijgewerkt is.'
- No 'Ook als bankbeweging noteren' (2026-10-16): a picked transaction is
  the bank's movement, so the purchase payment sheet, the pay sheet and the
  cost form note no manual bank line and bind no account. A manual movement
  is Kosten & bank's 'Bankbeweging noteren', which still starts on the
  remembered account (`pay-to-bank-preference.ts`; its stored `on` is
  ignored).
- One payment sheet per screen: the desk's in `purchase-desk.ts` and the
  phone's at host level of `purchase-editor.ts` (opened from the Betalingen
  tab). Both bind the same inputs and outputs (orderName, orderNumber,
  lineShares, alsoState, alsoLoad with the payee); a new binding goes on
  both lines (`purchase-phone-templates.test.mts` checks them).
- Wording (owner, 2026-09-26): the planned payee amount is 'Afspraak'
  everywhere in Inkoop and Analyses › Inkoop — never begroot, begroting,
  budget or raming (afspraak/afgesproken in sub lines, 'Afspraak extern' in
  the bridge, 'Verschil met afspraak' in the summary card; a concept's
  headline is 'Verwachte eindkost' with the 'Nog niet besteld' pill). A payee
  paid without an agreement is 'Betaald zonder afspraak' (warn), so it never
  reads like Bijkomende kosten, which are 'zonder afspraak' by design; such a
  payee never shows 'afspraak € 0,00'. The basis of a payee says Afspraak
  too ('Afspraak inspectie € 300,00 · via leverancier', on Betalingen
  'Afspraak € 300,00' with 'via leverancier' on its own line; 'Afspraak:
  vracht, lokale kosten en invoerrechten'); the composition rows are 'Opbouw
  uit Kosten'. Never 'Raming'. Code identifiers (`begrootEur`,
  `UNBUDGETED`, `BUDGET`) keep their names.

## Screens and their scenarios

### Dashboard (home, `features/dashboard/`)
- `/dashboard` is a shell (`dashboard-home.ts`): `app-home-desk` from 680 px
  (DesktopViewport), else `app-home-phone`; `/dashboard/agenda` and
  `/dashboard/open` (Open punten) are pushed phone pages. Every home route
  calls `enterHome()`: the day is checked every 60 s and on window focus, a
  new day loads again, page data older than 20 s is fetched again.
- **`HomeData`** (root, `home-data.ts`) loads and derives everything once:
  sales, purchases, products, families, suppliers, website (7 d), costs,
  incoming payments, partner financing, customers, planner and the bell;
  each source fails on its own (`stateOf`/`combined`: loading, ready,
  failed - the last good data stays). It shares the root `CashData` with
  Analyses and builds the 6-month forecast with `cashOptionsOf(
  DEFAULT_CASH_LOCATION, …)` at idle (the same lowest point as Analyses),
  the Kas headline (`home-cash.ts`), the Vooruitblik, the ranked tasks and
  the agenda model. Actions: `klaar`, `morgen`, `later`, `makeTask`.
- **What counts as important**: `home-priority.ts` (pure, node-tested) ranks
  every source into Nu / Vandaag / Ook nog; ALL thresholds sit in its §4.1
  block. At most 7 Nu + Vandaag rows; one "Klanten wachten · n" row with the
  bell's count (the server feed is the one customer-waiting set, incl.
  "opnieuw versturen"). Later is per browser (`home-later.ts`,
  `enrosed.home.later.v1`). "Taak van maken" puts `[home:<key>#<hash>]` on
  the task note's last line; shown notes strip it (`visibleNote`).
  `home-sources.ts` adapts the API data (containerPayables,
  partnerFinancingAnalysis, `overdueInvoiceRows` - the same list as Verkoop
  "Te laat" -, financeAttention's sentences and targets, the forecast's
  BASE items) and names every container through `containerName()`, also in
  the forecast's money titles (`containerTitleOf`: the forecast itself says
  the PO number).
- **Agenda**: `agenda-days.ts` (UTC day math, no DST double days) and
  `agenda-entries.ts` (entries per day, markers, Komend from tomorrow, pin
  countdown, Daarna). The planner sheets stay in `planner-cards.ts`
  (`section` 'all' | 'tasks' | 'none'). A dated list (Komend under the desk
  Maand's day, the home strip, the phone Dag of an empty day) gets `[month]`,
  the month it sits beside (the grid's; this month for the strip): a day
  outside it shows its month under it, "di 1" over "dec" (`agendaDay`), in
  the day column's own width.
- When not every source answered and nothing is open, Te doen reads 'Nog
  niet alles nagekeken' with 'Niet geladen: …' and Opnieuw (it wraps at
  360, never cut). The desk ends with 'Meer cijfers' and 'Alle analyses ›'
  (/analyses/overview) over the second grid, like the phone's Meer cijfers.
- **Figure blocks** (`widgets/home-*.ts`, variant 'desk' | 'phone', fixed
  order, no edit mode): Kas, Verkoop, Inkoop & containers, Resultaat,
  Ontvangen, Voorraad, Partners, Website, (Search Console), Markt. One tap
  target each; a failed source reads "— · Opnieuw", never 0. Styles live in
  the global partials `styles/home-*.scss` (no component styles).
- `home-figures.ts` (pure): month windows that follow the day, Δ%, bars,
  next container events, the desk briefing, greeting, week number, the
  Markt quote (own forwarder routes only, never an index in points).
- The full market page is Analyses › Markt (`/analyses/market`,
  `analyses/market-analysis.ts`): ECB exchange rates (EUR↔USD, EUR↔CNY; tap
  flips the pair) with a half-year sparkline, month tick labels showing the
  rate at each month start, and a plain-language hint about EXW buying power
  (freight is USD too); the container freight log per route
  (Ningbo/Guangzhou/Shenzhen manual forwarder quotes with dated history
  sheets and backfill, Shanghai fed weekly by the backend's Drewry scrape).

### Sales editor (the heart)
- Card sections: status/history (newest first, latest event on the bar),
  Order (customer, country, incoterm, payment terms pick-list with "Van
  de klant" default and "Anders…"), lines (picker prefills one order step - see "Verkocht
  per" under Products; a typed quantity is
  re-priced without saving 5 s after the last digit, or at once on blur/Enter (`flushPreview`) -
  never between two digits, because the server's rounded quantity is what the field shows;
  meanwhile the amounts fade (`figuresWaiting`); every other edit re-prices after 250 ms;
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

### Container name in Verkoop (sales round 2026-09-30, G1)
One rule for naming a container everywhere in Verkoop: the purchase order's
alias ('Herkenbare naam') trimmed, else its number, else 'Inkoop #id'. The
pure, node-tested `features/purchasing/container-name.ts` holds it:
`containerName(po, fallbackId)`, `containerNumberHint(name, number)` (the PO
number as title/small print only when it differs), `containerPhrase(name)`
('container PO-…', but 'container/2026/002' as it is: never the word twice),
`linkedPurchaseOrderId(order)` (source ?? partner, like the backend) and
`salesContainerName/Number(view, livePo?)` (loaded PO first, then the
server's `partnerContainerName`/`partnerContainerNumber` on SalesOrderView,
then the advance cargo snapshot, then 'Inkoop #id'). The server also sends
`containerName` on the credit-note proposal's container and on the partner
credit proposal; every field is optional so an older backend still works.
Used by: the Verkoop list group header (`purchaseOrderName`, PO number as
title) and search (name and number, regular container sales too), the
container menu, the advance contents link, `SalesEditor.containerLabel` /
`containerNumber` (desk tag '<naam> · Partner 50 %', partner-section links,
'Reguliere verkoop uit <naam>', the advance-invoices subtitle) and
`partnerReference` (auction sheet 'voor <containerPhrase>'; the purchase
screens pass `containerName(order)` too), the phone view hero ('· <naam>' or
'· uit <naam>' linking to the container) and the credit-note sheet (proposal
name; no invented `PO-<id>`). Inkoop keeps its own alias || number display.
Stored lines and notes of issued documents are never rewritten.

### Partner advance plan: re-split the rest (sales round 2026-09-30, G2)
A term is FIXED only when its invoice is no longer a concept, has payment
history or a live credit note (2026-10-01: an issued-then-reopened concept is
NOT fixed; Verhoeven BV's container/2026/009). The server alone decides:
`invoiceFixed` on PartnerAdvanceScheduleRow, `invoiceReopened` for a concept
issued before; `scheduleRowFixed(row)` falls back to 'has an invoiceId' for an
older backend, and no screen keeps its own 'was issued' or 'has a number'
rule. Only fixed terms are `locked` in `scheduleDraft`; a term with a
concept (`conceptNumber`, `conceptReopened`) is editable (label, amount, due
date: the server revises that concept in place, same number) but never
removable. Wording: `scheduleConceptNote(row, withNumber?)` ('Concept {nr} ·
heropend · volgt de nieuwe verdeling', 'nog niet uitgegeven' only when the
server says it never was, '· staat vast (betaalhistoriek of creditnota)'),
`scheduleDraftStatus(row)` for the editor heads, `thirdsResplitAvailable`
for the one-click '1/3 · 1/3 · 1/3' (€ 54.435,82: 18.145,27 fixed + 18.145,28
+ 18.145,27). The sales 'Voorschotfacturen' block (desk/editor/view) uses the
same note, reloads on a status change and links 'Termijnen aanpassen' to
`/purchasing/{id}?section=payments&terms=edit`, which opens the editor once
and then drops `terms` from the URL (replaceUrl). On the purchase order the
'Alle offertes & facturen' list takes a concept's note from the plan card
(viewChild), else just 'Concept'; the partner panel shows no extra suffix.
Deleting a reopened term stays refused by the server (409 "... het nummer
blijft bestaan. Pas de verdeling aan via Termijnen aanpassen ...").
Pure helpers in partner-advance-schedule-state.ts: `resplitRemainder(rows,
agreed, outside, parts, labels?)` keeps fixed terms (id, amount), splits the
rest into `parts` AMOUNT terms in cents (last takes the residual cent),
reuses the open terms' ids/labels/due dates in order, never drops a concept
term and replaces share-like labels ('2/3 na productie') with the given ones
or strips the share; `scheduleRemainder` gives fixed / re-split / left;
`remainderRequest` requires Σ = agreed ('Verdeel het resterende voorschot
volledig: nog € X te verdelen.'). `app-partner-advance-schedule`: header
'Termijnen aanpassen'; with a fixed term (or a reservation outside the plan)
the presets become 'Resterend bedrag opnieuw verdelen' (Rest in 2 / 3
termijnen, + Eigen termijn, and '1/3 · 1/3 · 1/3' when exactly one fixed term
is a third), rows read 'Gefactureerd · staat vast' / 'Nog te factureren'
('· concept … · volgt de nieuwe verdeling'), the intro names the fixed terms,
the total line reads '€ A gefactureerd · € B opnieuw verdeeld · € C nog te
verdelen', save 'Nieuwe verdeling bewaren' + toast. `remainderRequest` is used
only when a term is fixed AND the draft adds or changes terms
(`scheduleDraftChanges`, the server's rule too); without a fixed term, or when
only unused terms are dropped (before a settlement), the old ≤ agreed rule
stays. The quote sheet's locked note points to Termijnen aanpassen.

### Partner advance credit note prefilled (sales round 2026-09-30, G3)
The credit-note sheet in advance mode leads with the partner's share after
receipt. `partnerCreditPrefill(partner, advanceId, containerName, vatPct)` in
sales-credit-note.ts → { amountEur, restEur, wantedEur, description, state
ok|pending|none|not-received|settlement }: the server's per-advance
`suggestedCreditEur` wins; an older backend gets wanted = max(0,
overFinancingEur − (pendingCreditEur ?? 0)) capped by the room excl. btw
(maxCreditInclVatEur × 100 / (100 + btw), rounded down). Two meanings sit
side by side on purpose: `overFinancingEur` stays issued-only (the 'Tekort na
ontvangst' card and its concept link rely on it) while the suggestion
subtracts concept credit notes (`pendingCreditEur`/`pendingCreditNumbers`),
so a second sheet never proposes the same shortage twice. Never recompute the
amount from `shortValueEur` (half cents). The server's target advance is the
latest unpaid one that can absorb the credit. Sheet: 'Voorstel: € x excl. btw
terug aan <partner>' (+ incl. btw when btw > 0), the reasoning line
(gefinancierd excl. btw · afgesproken deel na ontvangst (pct van basis) ·
verschil · stuks minder ontvangen), 'Nog € x past niet op deze
voorschotfactuur' for the rest, the pending state 'Er staat al een
conceptcreditnota … maak geen tweede.' with a link (ids from the container's
partner financing documents), the amount field prefilled ('voorstel' tag
while untouched), switching advance re-caps, and the invoice caps as small
print. Description 'Voorschot te veel gefinancierd · <naam> (108 stuks niet
ontvangen)'; damaged pieces stay in the basis and are not counted in it.

### Voorschotfacturen and slotfactuur for regular sales (sales round 2026-09-30, G4)
A regular STANDARD quote (typically a whole container for a French customer)
can be billed in advances: POST `/sales-orders/{quoteId}/advance-invoice`
{ percentage | amountEur, dueDate? } (`SalesApi.createAdvanceInvoice`) makes
a CONCEPT F-series invoice with one line 'Voorschot 30 % · offerte …'; the
existing 'Factuur maken' (`createInvoiceFrom`) becomes the slotfactuur, with a
server-owned negative line 'Voorschotfactuur F-… van dd/mm/jjjj' per issued
advance (VAT on the balance). Purpose stays STANDARD: never add a SalesPurpose
value (`!== 'STANDARD'` means partner in dozens of places). JSON (all optional):
`advanceBilling` { stage ADVANCE|FINAL, quoteId, quoteNumber, percentage,
amountExclEur } on those invoices, `advanceInvoices[]` on the quote (id,
number, status, invoiceDate, percentage, amountExclEur, totalInclVatEur,
paidAt, receivedEur, remainingEur, receipts[{ receivedOn, amountEur }]),
`advanceDeductions[]` on the slotfactuur (frozen, with `paidOn` and receipts).
The pure, node-tested `sales-advance-billing.ts` holds the rules the UI can
know: base = quote total excl. btw, live advances, remaining, `advancePreview`
(pct half-up to cents or amount, VAT 0 under a legal mention, the cap message),
`advanceInvoiceBlock` (regular open quote, freight known, not split, not yet
invoiced), `advancePaymentState` ('Betaald op dd/mm/jjjj' from the last
receipt / 'Deels betaald' / 'Open' / concept), `deductionPaidText`,
`finalInvoicePlan` (guard 'Reik eerst voorschotfactuur … uit of verwijder
ze.', balance, negative), `invoiceConfirmOptions(view, escapeHtml)` (the one
confirm for desk, phone view and editor: ordinary or 'Slotfactuur maken' with
the deductions; the sales-advance-agreement harness lists it as a global),
`invoiceActionLabel`, `billingKind`/`billingTag` ('Voorschotfactuur · offerte
…', 'Slotfactuur · offerte …') and `isDeductionLine`. Components (styles in
`src/styles/sales-advance-billing.scss`, `adv-*`, so desk/editor style arrays
did not grow): `app-sales-advance-billing` (card on a regular quote once sent,
accepted, from a container or advanced: list with pills, totals, the guard,
'Voorschotfactuur maken…', 'Slotfactuur maken'), `app-sales-advance-invoice-
sheet` (page level; chips 30 % · 50 % · Eigen % · Bedrag, vervaldatum, preview,
'Conceptvoorschotfactuur maken' then opens the new invoice) and
`app-sales-advance-deductions` (on the slotfactuur: desk main flow, phone view
above Totalen, editor step 4). `SalesEditor.extraLineLocked` keeps the
deduction lines read-only (desk table and phone editor; set/remove refuse
them). Advance invoices hide the minimum-order notice. The container's
`app-purchase-sales-links` names 'Voorschotfactuur 30 %' / 'Slotfactuur' with
their status; the Verkoop list and the hero eyebrows use `billingKind`.
Review fixes: a voorschotfactuur is the server's (an update puts its line and
freight back): `SalesEditor.advanceLocked` turns off products, lines (every
extra line is `extraLineLocked`), customer/country, order discount and
shipping (`canEditShipping`), with 'Het bedrag van een voorschotfactuur staat
vast; verwijder dit concept en maak een nieuw voorschot vanuit de offerte'.
It has no goods: `skipsShipping(view)` (sales-payment-state.ts: partner
advance or advanceBilling ADVANCE) replaces `!isAdvance(order)` in every
shipping step (phone next step, desk KPI/action/`invoiceNextStep`, packing
slip, Verkoop todo) and the lifecycle uses `advanceInvoiceJourney`.
`finalInvoicePlan` deducts `amountExclEur − creditedExclEur` per issued
advance (optional field on `advanceInvoices[]`, Σ excl. btw of its issued
credit notes) and skips a fully credited one, as the server does; without the
field (older backend) the amounts read 'vóór creditnota's' (`creditsKnown`).
The card needs `advanceInvoices` to be an array (older backend: no card) and,
once the quote has its slotfactuur (`quoteSettlement`), links it with its
status and shows nothing left to invoice; `advanceInvoiceBlock` names the
slotfactuur before the archive.

### Prospects & outreach (2026-09-28)
- `/prospects` and `/prospects/:id` are staff-only routes under Verkoop;
  the phone menu links to "Prospects & groothandels". The page keeps search,
  status, country and pagination in query parameters, with a responsive
  company list, details, editor and activity timeline.
- `core/api/prospect-api.ts` follows `/api/prospects`. Company state uses
  `DO_NOT_CONTACT` for opt-out. Activity state is separate: drafts, reserved,
  scheduled, sent, received, failed, completed and cancelled remain distinct.
  The Brussels-day email summary counts sent + reserved + scheduled against
  the server limit. The UI records manual actions; it never sends messages.
  Native Gmail scheduling is an external workflow. EMAIL / OUTREACH / RESERVED
  imports call only the reservation endpoint with `occurredAt` as `scheduledFor`,
  holding the future day's capacity before any Gmail action. Re-imported
  reservations are rechecked by the server; closed or changed records surface
  conflicts. The UI explicitly distinguishes these slots from Gmail schedules.
  A verified Gmail schedule
  can be imported as EMAIL / OUTREACH / SCHEDULED: a new externalId reserves
  the specified future date before recording the scheduled state. Existing
  IDs go directly through the idempotent recording endpoint. An import error
  does not cancel anything in Gmail and explicitly asks the user to check it.
- "Importeer contactlog" accepts version-1 JSON with at most 250 prospects,
  2000 activities and 5 MB. It validates before writing, matches exact email
  or Instagram identities, refuses ambiguous matches and never updates
  existing company fields or notes. Recording actual contact can advance
  NEW/QUALIFIED to CONTACTED through the server timeline rule. Stable
  `externalId` values use the server's
  idempotency check; changed duplicate payloads surface a conflict. Connection
  or authorization errors stop the remaining import safely. Re-importing
  the same log can finish a partial import without duplicating its history.
- Pure validation, identity, URL and Brussels-date helpers have focused node
  tests in `tests/prospect-state.test.mts`. Errors use `messageOf`; pending
  edits/imports prevent accidental navigation. No prospect data is public.

### Login-aanvragen and Websitelogin (2026-10-05)
Website visitors ask for a login (form, tick box in the quote request, or a
"new link" request); staff decide here. A logged-in customer sees prices in
the website's bestelscherm even when 'Prijzen tonen op de website' is off.
The ERP never calls `/api/v1/public/account` and never sees a password.
- `core/api/login-request-api.ts` is the whole staff client:
  `/api/login-requests` (list per status, detail, approve, reject) and
  `/api/customer-logins` (per customer, give, new link, withdraw). The
  pending count comes through `SalesApi.loginRequestSummary()` because
  `WorkQueue` injects only that client; it sets `loginRequestCount`,
  `loginIntakeFull` and `loginIntakeFullSources` in a try block of its own,
  so a failing summary never empties the bell feed and the reverse.
- Route `/klantlogins` (`LOGIN_REQUESTS_PATH`), under Verkoop. It must not
  start with `/login`, `/offerte` or `/voorwaarden`: the shell renders those
  bare. Counts sit on the sidebar link, the folded Verkoop group, the Meer
  tab and row, and a dashboard row; login requests are not in the bell feed.
- `features/login-requests`: `LoginRequestsPage` (segments Open / Goedgekeurd
  / Afgewezen on `?status=`, `?open=<id>`, 'Meer laden' per 50, the red
  'lijst is vol' alerts, one wide sheet) on classic global classes, not the
  workspace kit. Every rule is in the pure, node-tested
  `login-request-state.ts`: `defaultChoice` (the customer that already holds
  an INVITED/ACTIVE login for the e-mail wins and is locked; else the
  lowest-id customer with the same e-mail; a VAT-only match is never
  preselected, VAT numbers are public), `needsMismatchConfirm` (a freely
  chosen customer with another e-mail needs a second confirm, sent as
  `confirmEmailMismatch`), `applicantEntries` / `newLinkMarker` (later
  requests for the same e-mail are kept beside the first, up to five),
  `existingAccountAlert`, `newLinkAlert` (a NEW_LINK request ignores the
  body; a withdrawn login cannot get a link there), `linkLine`. Binding a
  login to a customer is a human decision: do not add defaults.
- The sheet's answers belong to the request they were sent for: an approve,
  reject or new link only closes or reloads the sheet when `openId()` is
  still that request, and `open()` clears choice, form and note, so staff
  can close a sheet and open another one while a call is under way. A
  reload of the same sheet goes through `reconcileChoice` (a login given
  meanwhile fixes the choice). The list is always fetched from page 0 up to
  the loaded page and replaced (`mergePages`), never appended by offset: the
  open list shrinks while colleagues decide. `emailMismatch` is on purpose
  not looser than the server (no `trim()`): a missing confirm is a dead end.
  Rejecting takes an optional internal note (`rejectNote`, 500 characters).
- Customer sheet: `app-customer-login-block` (`customer-login-block.ts`,
  block 'Websitelogin', only for a saved customer) loads
  `logins(customerId)` and acts at once, apart from the sheet's Opslaan:
  no login → e-mail input (prefilled from the customer) + 'Login geven en
  link sturen' behind a confirm; INVITED / ACTIVE → 'Nieuwe link sturen' and
  'Login intrekken' (confirm); DISABLED → 'Login opnieuw geven' (the same
  invitation call). Wording per status lives in the pure, node-tested
  `customer-login-state.ts` (`loginRowText`, `loginActions`, `linkToast`,
  `loginBadge`). The login keeps its own e-mail: editing the customer's
  e-mail does not move it.
- Link lifetime is never hardcoded: screens print `linkExpiresAt` /
  `invitation.expiresAt` from the server. A mail failure never undoes the
  approval or the login: the answer has `invitation.sent: false`, the toast
  is an error and `lastLinkError` shows as a warning until a link leaves.
- `tests/work-queue.test.mts` imports the real injectables and only runs
  through the esbuild bundle its header names; in the plain node run it is
  one of the known failing files.

### Websitebestellingen (2026-10-08)
A logged-in customer places an order on the website; staff confirm it here.
The document is an ordinary quote whose view carries a `webOrder` block
(and `delivery`, the address of that order) beside `order`. The block is the
only key: the `[WEBSITE_AANVRAAG]` note marker also sits on legacy requests
and on copies. Without the blocks (older backend) every screen is as before.
- `quote-status.ts` holds the pure helpers (`isWebOrder`,
  `customerCanStillChange`, `customerRevised`, `cancelledByCustomer`,
  `webOrderInProcessing`, `webOrderRevision`, `webOrderDeletable`,
  `webOrderTermsState`, `webOrderInvoiceable`, `webOrderMailDue`,
  `webOrderMailRepeatable`, `countsAsNewWebsiteItem`, `isWebOrderConflict`).
- **Read-only until taken.** While `customerCanStillChange` the customer may
  still change or cancel on the website, so desk, phone editor and read view
  offer no editing, transport, Versturen, invoice, advance invoice, split,
  Archiveren or Verwijderen; PDF, Nieuwe kopie and `Bestelling annuleren`
  stay. `In verwerking nemen` (confirm sheet, `takeIntoProcessing`) ends it
  and mails the customer. Any other staff mutation takes the order too, on
  the server; that is why nothing else is offered before the button.
- **Revision.** Every mutating call of `SalesApi` takes `webOrderRevision`
  as its last argument and must get `webOrderRevision(view)` of the copy
  that screen shows, never the work queue's. A stale copy gets 409
  `WEB_ORDER_CHANGED`: on a save the sentence lands in the save alert with
  `Laatste versie laden` (no `Opnieuw opslaan`, Opslaan disabled, the alert
  scrolled into view); on every other action the screen reloads by itself
  and the toast is `WEB_ORDER_RELOADED`, not the server's "laad de laatste
  versie". The list reloads its rows. Every failure handler gets the id of
  the order the action ran on (`actionFailed(failure, fallback, orderId)`):
  the screens are reused across ids, and a late answer must not touch the
  order now on screen. `persistOrder` and `saveDeliveryWeek` refuse to write
  while `customerEditable`: no save or autosave takes an order by itself.
- **Wording.** A web order never shows request wording: `Websitebestelling`,
  `Bestelling annuleren`, and so on in every state. `webOrderNotice` in
  `sales-invoice-actions.ts` is the single source of the banner and the
  compare line per `termsState`; `canCreateInvoiceFromQuote` allows an
  invoice without sending only for a taken order with `ORDER_EQUAL` or
  `APPROVED`; there the invoice is the primary action
  (`webOrderInvoiceFirst`). The send action of a taken concept always reads
  `Versturen ter goedkeuring` (`webOrderSendsForApproval`), and the send
  sheet and toast come from `webOrderSendCopy`. The banner sits straight
  under the hero on desk, phone editor and read view (where it also carries
  `In verwerking nemen` on a phone) and names a cancellation by the customer.
  Verwijderen on a document follows `documentDeletable`: a web order once
  it is cancelled or declined. The cancel switch follows the customer
  record's e-mail address, as the server does.
  A customer-cancelled order cannot be reopened (`sales-reopen.ts`). No
  `Order splitsen` and no partner link on a web order.
- `sales-web-order-note.ts` (`app-sales-web-order-note`) shows the delivery
  or pickup block, who ordered, the customer's cancellation and the state of
  the customer mail with `Opnieuw sturen`; a derived invoice carries only
  the delivery block. Staff cannot edit that address. It is mounted only
  when the view has `webOrder` or `delivery` (a plain document keeps the old
  markup, pixel for pixel), and its mail buttons are `blocked` while the host
  has unsaved edits: the answer is a whole view and must not replace them.
- **Customer record without an address** (`invoiceCustomer` on a single
  `SalesOrderView`; null on the list and when nothing is missing). A customer
  made when a website login is approved has no street, postal code or city,
  and the server refuses to issue an invoice until the record has them.
  `sales-customer-address.ts` (`customerAddressNotice`, pure, node-tested in
  `tests/sales-customer-address.test.mts`) words the block; the server alone
  decides whether it applies and whether a takeover is offered.
  `sales-customer-address-notice.ts` (`app-sales-customer-address-notice`,
  `variant="desk"` on the desk, banner on phone editor and read view) sits
  straight under the website-order banner: `Klantgegevens onvolledig · bij X
  ontbreken …`. With `takeover` it offers `Leveradres overnemen`, a sheet that
  shows the address as the record will read afterwards, one row per part:
  a field in `missing` carries the delivery's value and is marked `wordt
  ingevuld`, a field the record already has carries the record's own stored
  spelling and is marked `staat er al`; `Land` is shown only when
  `takeover.countryCode` is set (the record's own country, else null) and is
  **never written**. Then
  `SalesApi.takeCustomerAddressFromDelivery` (POST
  `/api/sales-orders/{id}/customer-address-from-delivery`, body = `{address,
  postalCode, city}` of that `takeover`, trimmed, all three also when only
  one is written - the server compares them with what it would offer now,
  ignoring capitals and outer spaces - never a `webOrderRevision`: it does
  not take a website order into processing). The server fills only empty
  street, postal code and city. The answer is
  a whole view, so the button is `blocked` while the host has unsaved edits
  (the reason stands beside it as a sentence, `TAKEOVER_BLOCKED_HINT`: a
  title never shows on a touch screen); the hosts adopt it in
  `customerAddressTaken` and read the cached customers again. When the host
  saved or reloaded while the call was under way, the answer may be older
  than the screen: `takeoverAnswerFor` then lays only `invoiceCustomer` and
  `delivery` over the view the host shows. After success the notice (and the
  button the sheet returns focus to) is gone; `focusPlaceAfterTakeover` moves
  the focus to the element straight above the host. The sheet names the same
  document as the lead (`de factuur` / `de creditnota`). A 409 shows the
  server's sentence and reloads the view, so the next
  confirmation shows the current delivery address. Without `takeover`
  (`takeoverBlockedBy` PICKUP, NO_DELIVERY, OTHER_COUNTRY, INCOMPLETE) it
  gives the reason and links to `/customers?q=<company>`. The host element
  is `display:none` when there is no notice. The refusal on issuing is the
  server's sentence in the usual error toast (`messageOf`): `De factuur kan
  niet uitgereikt worden: bij klant X ontbreken …`, and `kan niet verstuurd
  worden` when an invoice that is already issued is marked sent or mailed
  after its customer's address was emptied (409 without a code; such a
  document carries no `invoiceCustomer`, so no notice). Nothing here matches
  on those words.
- **Customer's quotation page without a quotation** (`offerte/:token`,
  `features/portal/portal-page.ts`). `load()` keeps why nothing is shown in
  `refusal` (`portal-refusal.ts`, `portalRefusalOf`, pure, node-tested in
  `tests/portal-refusal.test.mts`). The page route answers 409 with a
  `code` for two cases that are no dead link: `QUOTE_BEING_UPDATED` (title
  plus one sentence: being updated, visible again once Enrosed has sent it)
  and `QUOTE_CANCELLED` (title `Deze offerte is geannuleerd`, with
  `cancellationMessage`, what staff wrote, printed below exactly as typed,
  `white-space:pre-wrap`, never translated; the Dutch `message` is not
  read). A 404, no connection, or a 409 without a code (older backend) is
  the old `Offerte niet gevonden` text. These texts live in the page's own
  `PORTAL_FALLBACKS` in all nine languages (no quotation means no texts
  from the server). Language: the customer's remembered pick, else the
  `language` of the refusal (the customer file), else NL. The notices sit
  in the `error()` branch, which has no PDF link and no buttons. An action
  (accept, reject, propose, withdraw) refused with one of the two codes
  switches the open page to the same notice in the language the customer is
  reading in (`run()` / `showRefusal()`: sheets closed, the old quotation
  dropped); any other refusal stays a toast. Picking a
  language while a notice is shown changes its words, remembers the pick
  and loads the link once more.
- **List.** Badge `Websitebestelling` on every web order, with one pill
  under it: `Door klant geannuleerd`, `Door klant gewijzigd`, `Klant kan nog
  wijzigen`, `Opnieuw versturen` / `Gewijzigd na akkoord`, `Wacht op klant`
  or `In verwerking` (`webOrderListPill`). The chip `Website` counts and filters what
  waits for a first look (`countsAsNewWebsiteItem`: legacy requests and web
  orders not yet in processing); the chip `In verwerking te nemen`
  (`toTakeOnly`) shows when a row has `customerCanStillChange`. A row offers
  no delete unless `webOrderDeletable` and no archive (swipe or menu) while
  the customer can still change: one swipe would take the order and mail
  the customer. The list endpoint leaves `orderedTotalExclVat` null and
  `differences` empty; only the document itself has them.
- **Home.** The home counts customers from the notification feed only
  ("Klanten wachten", the bell's number); it no longer has a rule of its own.
- Members of `SalesDesk`, `SalesEditor`, `SalesView` and `SalesList.todo`
  are run in isolation by node tests with a fixed set of globals; a new free
  function on such a path breaks them, so those members read `view.webOrder`
  inline. `tests/sales-web-order-screens.test.mts` runs the guards, the
  revision on every call and the conflict handling of all four screens.

### Purchasing
- List rows swipe left (iOS pattern) to a confirm-guarded delete.
- List → **read-only view first** (on a phone: the summary card over five
  tabs, see "Phone purchase order" below; the desk reads and edits in
  PurchaseDesk), edit behind a button. New orders open straight in the
  editor.
- Editor: rates on one row (RMB→USD, USD→EUR goods/transport), costs
  section, product picker that can **quick-create** a product (name,
  supplier currency price, pieces/carton, carton size) without leaving,
  per-line EXW currency, status advance button at the bottom, apply
  landed costs with confirm dialog.
- Purchase figures are always shown to staff (no privacy mode since
  fd979b4); the PDF sheet picks the internal or supplier variant.
- Receipt date (2026-09-29, F2): both 'Container ontvangen' sheets open with
  an 'Ontvangen op' date field (device-local today, `ReceiveDraft.receivedOn`)
  and send it as `receivedOn`; the server refuses a future date or one before
  the order date (409, shown as toast) and corrects `receivedOn` through the
  normal order PUT on a received order, so both edit forms show an editable
  'Ontvangen op' (a cleared field never patches null). The list puts the date
  under the 'Ontvangen' pill (`.po-row-date`, not in the ellipsed meta line)
  and in the row menu; the desk hero meta says 'ontvangen dd/mm/jjjj' instead
  of 'verwacht …' and the last KPI tile carries it; the phone read view shows
  it as the Ontvangen progress date and under Order › Ontvangen op.
- Status one step back (2026-10-14): a container set to Vertrokken
  (ONDERWEG) or Besteld by mistake goes back through 'Status terugzetten…',
  one place each, only on BESTELD/ONDERWEG: desk Afronden rail tab inside
  'Meer acties' above 'Calculatie verwijderen', phone editor 'Acties ⌄'
  (not on the list row menu, where 'Terugzetten' means un-archive, nor the
  phone read view). Pure helper `purchase-status-back.ts`
  (`statusBackOptions`: Vertrokken → Besteld (default) or Concept, Besteld →
  Concept, Concept/Ontvangen → none; Besteld is never blocked, Concept is
  blocked like the server's guard: payments not loaded, any payment or a
  non-zero legacy `paidTotalEur`, or a supplier credit) feeds
  `purchase-status-back-sheet.ts` (inputs/outputs only, radio rows, short
  consequences, 'Je openstaande wijzigingen worden mee opgeslagen.' when
  dirty). `PurchaseEditor.confirmStepBack(to)` (desk inherits) puts
  `{ status: to, shippedOn: null }` in the draft and calls
  `save({ stepBack: true })`, the same PUT with `?stepBack=true` (the server
  refuses an earlier status without it, so a screen loaded before a
  departure elsewhere never undoes it; no 'Opgeslagen' toast for that save);
  a refused save restores both fields so the screen
  never keeps a status the server refused; success closes the sheet and
  toasts 'Status teruggezet naar …' with no celebration or first-instalment
  prompt. The sheet binds to `stepBackSheet()`, which holds the status,
  options and dirty flag from the tap until the save returns (the draft
  carries the target meanwhile), so it never reads 'Nu: Besteld' early and a
  refused save keeps the choice made instead of moving it to Concept. The
  server clears `shippedOn`, sends no push and logs 'Status teruggezet van
  … naar …'; Ontvangen never goes back. Tests:
  `tests/purchase-status-back.test.mts`.

### Phone purchase order (2026-10-15)
- The read view (`purchase-view.ts`) and the editor (`purchase-editor.ts`)
  render only below 680px (`PurchaseScreen` picks `PurchaseDesk` from 680px
  up); both are one white summary card (`app-ios-nav` with `customLarge`,
  the card as [hero]) over five sticky stacked tabs Overzicht · Producten ·
  Kosten · Betalingen · Dossier on the beige page, grouped inset lists and
  host-level sheets. Classes `mpo-*`, styles in `styles/purchase-phone.scss`
  (global, phone-only, every rule scoped to a purchase host). The editor's
  component styles keep only the receive, issue and document sheets.
- Tab model in `purchase-phone-model.ts` (pure, node-tested): `?tab=`
  producten|kosten|betalingen|dossier (Overzicht is absent), written in place
  by `replaceTabInUrl` (Location.replaceState: no history entry, no scroll to
  the top; drops a used section/payee/due). `PurchaseScreen.tab` feeds both;
  Back from a product or a sheet route lands on the same tab. Section ids map
  to tabs (`tabOfSection`: purchase-overview/order/receipt/actions →
  Overzicht; products/capacity → Producten; costs/summary/result/
  payment-result → Kosten; payments/partner/partner-payments/advance-invoices
  → Betalingen; files/notes/reports → Dossier), so `?section=` deep links,
  `jumpToSection` and `scrollToCard` switch the tab first. A switch with the
  bar stuck starts the new pane at its top under it; tapping the open tab
  goes back to its top (`purchase-phone-scroll.ts`; the stick point puts
  the nav's 1px sentinel wholly above the nav, so the nav has condensed on
  arrival). The root's scroll-padding (nav + tabs above, dock or save bar
  below) keeps a focused field and scrollIntoView clear of the bars; the
  purchase-* sections keep no scroll-margin of their own. The nav's buttons
  and the tabs once stuck (nav condensed) move their scroll area down past
  that padding (negative top, equal positive bottom scroll-margin), so focus
  on them, by keyboard or a sheet handing it back, never scrolls the page
  or unsticks the bar. Warn dots: Producten
  after damage/shortage/reports on a received order, Betalingen when
  something is due now; the dot is aria-hidden, so the tab's aria-label
  says it. A `?tab=` change never reloads the read view (`load` runs
  untracked), and a `?section=` deep link in the same navigation wins over
  `?tab=` (the view gets `section` and skips its tab effect).
- Read view: card with status pill, route, name (`containerName`), PO ·
  supplier, creator, the four progress steps with their days (verwacht
  arrival), tiles Totaal geland and the payment headline; Overzicht has the
  figures, Actie vereist, Ontvangstcontrole, the Nacalculatie headline
  (`app-purchase-nacalc-glance`), Volgende stap, Order, Route en container,
  the partner panel; Producten models/variants with a line sheet; Kosten the
  three cost groups and the complete Nacalculatie (never collapsed);
  Betalingen and Dossier re-host the unchanged components (`.mpo-host`
  gives them their 16px gutter). The ⋯ menu: offer/advance invoices,
  Documenten & media, Ontvangstanalyse. Dock: Bewerken + the next step.
- Next step, always confirmed (`app-purchase-step-confirm-sheet`,
  `stepConfirm` texts: Bestellen? / Container vertrokken? (track & trace
  field) / Container ontvangen? (Ontvangst tellen) / Voorraad bijboeken?;
  'Je openstaande wijzigingen worden mee opgeslagen.' when a draft goes
  along). On the read view the confirm offers
  a `StepHandoff` to `PurchaseStepHandoff` (memory only, 30 s, never the
  URL: a link or reload changes no status) and opens the editor on the same
  tab; `PurchaseScreen.runHandedStep` runs it there once the payments are in
  (`PurchaseEditor.runStep`; a step that no longer applies toasts 'De
  container staat al verder; er is niets gewijzigd.') and `returnFromStep`
  goes back to the view once `stepFlowBusy` clears (history stays [list,
  view]); 'Track & trace invullen' (`keepAfterStep`) and a refused save
  keep the editor. The editor counts as `handedFromView` as soon as a
  handoff waits for it (back then leads to the view, even while loading);
  an edit screen that goes away before its editor took the step discards
  it, so a later editor never runs it unasked. KOSTPRIJZEN asks nothing on
  the view (`AskedStep` leaves it out of `stepConfirm`): the view hands it
  over at once and `runStep` calls `apply()`, which opens the cost-history
  round's `app-purchase-apply-costs-sheet` (every product's cost now and
  next); `stepFlowBusy` covers that sheet (`applyFor`, `applyBusy`), so the
  screen returns to the view once it closes (merge rule, release
  2026-10-16; `applyCostsNow` is gone). `readNextStep` skips it when a newer
  container's costs sit on the products.
- Editor: header 'Container bewerken' + pill + tiles Lading (fill %, the
  pieces below) and Totaal geland, 'Acties ⌄' (next status, Voorraad bijboeken, Kostprijzen (opnieuw)
  toepassen, offer/advance invoices, copy, PDF, Status terugzetten… on
  Besteld/Vertrokken, Calculatie verwijderen); the save bar says 'Niet
  opgeslagen' with what changed (`unsavedSummary`) and Opslaan, or 'Alles
  opgeslagen' with the next step. Rows with the field on the right
  (`mpo-field-row`, `--stack` for long fields, `--pick` for pop-up selects),
  line rows with an inline count and swipe to Verwijder (a row states the
  order's own price 'afgesproken', else the product card's 'kaartprijs' in
  the card's currency, never the converted, levelled goods figure), sheets
  Regel bewerken and Verdeelsleutels. Status terugzetten lives under Acties on the
  phone and in the desk's Afronden tab only, never on the read view.
- The Nacalculatie's 'Kostprijzen toepassen ›' (the phone has no Afronden
  tab) opens the apply sheet like the dock: the read view hands the step to
  the editor, the editor calls `apply()`. Its 'Hoe is dit berekend?' names
  just 'Kostprijzen toepassen' too (`nacalcPhoneNotes`); the desk's note
  keeps '(Afronden)'. Focusing a tab never moves the page, also just before
  the bar sticks (where the tabs sit in the root's scroll padding without
  the stuck rule): `keepPhoneTabFocusInPlace`
  (`purchase-phone-scroll.ts`, a field of the view and the editor) sets each tab's
  lift (`liftPhoneTabs`: its scroll area moves down by as much as it sits
  inside that padding, and as much at the bottom) on every Tab/arrow/Home/
  End keydown and a frame after every scroll; lower down the lift is 0.
  Tests: purchase-phone-model, purchase-phone-step, purchase-phone-templates,
  purchase-phone-scroll, purchase-nacalc-metrics.

### Kostprijshistoriek and Kostprijzen toepassen (2026-10-16)
- Backend `product_cost_history` (migration 2026-10-16/product-cost-history-basis:
  twelve nullable columns, a guarded one-time backfill): every row keeps the
  basis the cost was applied on (`salesUnit` PIECE|DISPLAY, `piecesPerUnit`,
  `unitKey`, as `ProductCostBasis.of` stores it), its `kind` and what one unit
  was made of (`goodsEur`, `originEur`, `freightEur`, `dutyEur`,
  `destinationEur`, `enrosedEur`, `separateEur`: the line's part / its
  quantity at 4 decimals; `extraUnitCost` in the EXW currency). Kinds: APPLY;
  REAPPLY (the same container at another cost - at the same cost no row is
  written); SEED (the first-start seed's 'system' rows); COPY (a copied
  product's taken-over cost, with the source's container and parts while
  they still match; the copy's first real apply from that container is an
  APPLY). GET /api/products/{id}/cost-history adds `containerName`
  (Herkenbare naam, else number) and `containerGone` (trash or purged). An
  older server sends none of it: `costKind` reads 'system' as SEED, else
  APPLY, and a row without a basis reads on the product's basis today.
- POST /api/purchase-orders/{id}/apply (no body) skips a line that received
  nothing (quantity 0): no cost change, no history row - its piece price of
  € 0 would wipe the cost and understate the stock value. The diary counts
  only the written products: 'Kostprijzen toegepast <dag>: N product(en)
  bijgewerkt in de catalogus, k overgeslagen (niets ontvangen).' (a comma;
  the activity log 'Kostprijzen op N product(en) toegepast, k overgeslagen
  (niets ontvangen)'; only the ERP toast writes '· k overgeslagen …').
- `product-cost-basis.ts`: the basis and its words ('per display van 12',
  'per diamant', never set); `sameCostBasis` compares only per piece / per
  display and the pieces in a display, never the unit name; `otherSideCost`
  is the price on the other side of a display. `product-cost-history-model.ts`
  (pure, node-tested through the transpiler): rows newest first in their own
  basis with the kind chip Toegepast / Opnieuw / Start / Kopie, the change
  against the container before (a re-apply against this same container
  before), the parts (Opbouw, with Afronding); the sums and the chart cover
  the rows on the newest row's basis, one per container ('andere basis' rows
  and a re-applied container's earlier rows stay listed with a note);
  `emptyCostHistory` names the source of a cost set before the history.
- `app-product-cost-history-sheet` is the one way into the history: the desk
  Kostprijs KPI and Prijs & marge 'Kostprijshistoriek ›', the phone Kostprijs
  and Bron tiles, the editor's Inkoop row (only with a cost) and every row of
  the apply sheet (stacked on top; Escape closes only the top). A row links
  to its container unless it is the one the sheet came from or it is gone
  ('PO-… verwijderd', no link). The Opbouw (Catalogusprijs KPI, Opbouw tonen,
  phone Marge tile) keeps its own Historiek tab.
- Kostprijzen toepassen (`purchase-apply-costs.ts`, pure, +
  `app-purchase-apply-costs-sheet`, hosted once by PurchaseEditor and
  PurchaseDesk, which extends it): `apply()` saves a dirty draft first,
  fetches the supplier's products again (plus GET /api/products/{id} for a
  line of another supplier; one that cannot be loaded stays 'unknown': 'niet
  geladen', no unit words) and opens the sheet: per product Nu (cost and its
  source), Nieuw and Verschil (up, down, new, same 'zelfde kostprijs · nieuwe
  bron', unchanged, skipped 'niets ontvangen · blijft …', unknown). The button
  'Toepassen (n producten)' / 'Opnieuw toepassen (n …)' counts every row but
  the skipped; Annuleren writes nothing; `confirmApply` posts once and toasts
  the sheet's counts (`applyCostsToast`: gewijzigd only for new/up/down,
  ongewijzigd, an unknown row 'niet vergeleken'); a failed apply keeps the
  sheet with the server's message. Tests: product-cost-history,
  purchase-apply-costs.

### Products
- List (search, skeletons) → view first: price and margin (intern) in
  the title line, snap carousel with corner expand icon, lightbox with
  download (originals are print quality), bento tiles, barcode placement:
  piece EAN with the product, outer ITF-14 with the carton.
- Editor behind Bewerken; EXW price with currency select; CSV
  master-data and translations import/export live in Settings.
- Photos (editor section "Foto's", rebuilt 2026-10-12): a product saved
  in a series uses `product-photos-panel.ts`. The server resolves what
  every place really shows: `GET /api/products/{id}/photo-overview`
  carries `places` (eight: `websiteColour`, `websiteOpening`, `documents`,
  `websiteQuote`, `catalogueColour`, `catalogueDetail`, `catalogueOverview`,
  `catalogueCompactRow`; each with `shownKey`, `chosenKey`, `state`
  CHOSEN / AUTOMATIC / CHOSEN_NOT_SHOWN / NONE and a `reason`), plus
  `otherPhotos`, `photos[].chosenFor`, `seriesLiveOnWebsite`,
  `colourOnWebsite`, `websitePageUrl` and `catalogueAssumption` (the pdf
  the catalogue places are computed for: a Handelscatalogus with every
  non-demo colour, inactive ones included). The screen never guesses: it
  draws the answer and nothing before it. Every new field is optional in
  `models.ts`; against an older server `resolvedPlaces()` builds the
  places from the old fields (`legacyPlaces`, weaker cards, no error).
  - Screen, top to bottom: "Waar zien klanten {kleur}?" with three fixed
    cards **Website**, **Catalogus**, **Offertes en facturen** (the photo
    each place shows now, also when it is automatic; "Wijzig" on the
    first two), standing notes, "Voor de hele reeks" (Productpagina,
    Bestelpagina, Grote / Kleine catalogusfoto), "Andere kleuren van deze
    reeks" (`product-photo-colours.ts`, looking and jumping only), then
    "Alle foto's" where a tile says in words where the photo is used. The
    status pill in the section head is the only place that speaks about
    the live site (shared `WebsiteSyncStore`).
  - The other colours are never kept: `loadOthers()` asks each colour's
    own overview when the list opens, after every save while it is open
    (`afterSave` -> `refreshOthers`), after the editor's own save (the
    `revision` input) and when "Bekijk groot" opens in the Catalogus
    picker (the strip "Zo staat hij naast de andere kleuren"). Another
    colour's id goes to `productPhotoOverview` and to nothing else; a
    test walks every saving road to hold that.
  - Picker `product-photo-picker.ts` (presentational, one for all five
    choosable places): bar "Nieuwe foto uploaden" (upload and use in one
    flow, the panel's `uploadAndUse`), then the candidates; a tap chooses
    and saves (`PUT …/photo-roles`), "Laat automatisch kiezen" clears,
    "Bekijk groot" compares. Photo sheet `product-photo-sheet.ts`: the
    photo next to what customers see, one row per place ("Gebruik
    hier"), everything rare under the folds "Voor de hele reeks" and
    "Meer instellingen". One step of undo ("Ongedaan maken").
  - Every change saves at once; the editor then refreshes product and
    family (`refreshPhotoState`) without making the form dirty. A
    product without a saved series, or an unsaved one, keeps
    `PhotoManager`.
  - Deep link `/products/:id/edit?tab=media&kies=website|catalogus`: the
    editor hands `kies` to the panel (`photoPick()` -> input `pick`), the
    panel opens that card's picker once the overview is there and emits
    `pickHandled`, and `clearPhotoPick()` removes the parameter with
    `replaceUrl`, so a reload or the back button never reopens it.
    Ignored (parameter still removed) without a saved series or when the
    card has no "Wijzig" (inactive or demo colour). Two screens link
    here: the product page and the Catalogusstudio.
  - Product page (`product-view.ts`, `product-desk.ts`): button "Foto's
    beheren", slide badges "Website" / "Catalogus" / "Bestelpagina" read
    from the places (`tileUses`), and for a server with `places` the
    line "Dit zien klanten bij {kleur}" (`product-places-line.ts`: three
    56 px pictures; Website and Catalogus link to their picker).
    "Documenten & media" (`product-media-card.ts`) is for documents: a
    file added there never becomes a product photo, the card says so
    and points to Foto's.
  - Catalogusstudio: every colour row has "Catalogusfoto wijzigen"
    (`cataloguePhotoLink` in `catalog-studio.ts`, also in the row menu).
    The open cards and the row left from are kept in `sessionStorage`
    (`erp.catalog-studio.open-cards`, parsed defensively), so the back
    button returns to the same series card and row. Its photo block
    edits the two series photos in the same words ("Kleine catalogusfoto
    (overzicht)", "Grote catalogusfoto").
  - Vocabulary, one name per concept (ui-spec of the round): Website,
    Catalogus, Offertes en facturen, Productpagina, Bestelpagina, Grote /
    Kleine catalogusfoto, Handelscatalogus / Compact overzicht, "Zelf
    gekozen" / "Automatisch gekozen", "Je keuze wordt niet getoond",
    reeks. Never on screen: Hoofdfoto, kleurfoto, brochure, export,
    kanaal, assortiment, reeksfoto as a title, dot-joined place names.
    The rules and every sentence live import-free in
    `product-photos-state.ts`; `tests/product-photos-state.test.mts`
    scans what it can return for the banned words. The panel, editor and
    product page tests pick class members by name (update the name list
    with the member).
  - Every ERP thumbnail still follows the rule of `shared/sales-photo.ts`
    (website choice → first series projection → first photo), never
    photos[0]; the product page carousel opens on that photo.
- Unit (2026-09-22): `packaging.unitKey` names what one piece is called on
  documents ("stuk", "bowl", "stolp", …; list from the cached
  `CatalogApi.unitNames()` = `GET /api/products/unit-names`, Dutch). Set in
  the sales card ("Eén stuk heet", below).
  `product-sales-unit.ts` resolves it (a module signal filled by
  `unitNames()`, fallback "stuk"), so product, sales and purchase screens,
  the picker and carton notices say "bowls" for a piece basis; a display
  basis says "display" and names the pieces inside with the unit.
- Price labels (2026-10-15, after DIAM-D-RD read "2.95 per set · € 2,95 per
  diamant vóór korting"): the word under a price names what that price is
  for (`productSalesUnit().singular`: "per diamant", "per display"); the
  other side of a display of 2+ goes on the line below via
  `otherBasisPrice(product, price)`: "= € 35,40 per display van 12" under a
  price per diamant, "≈ € 4,16 per roos" under a price per display ("≈" only
  when it does not split to the cent). ", vóór korting" only on a line with
  a staffel or extra korting. ERP screens lead with the stored price
  (Aantal × Eenheidsprijs = Netto); customer channels (portal, website, PDF)
  lead with the display price on purpose. The word "set" is gone from the
  sales and product screens (`primarySalesPrice`/`secondarySalesPrice`
  removed; a test scans the helpers for it). The price field says "Prijs per
  display" / "Prijs per diamant" / "Stukprijs" (`priceLabel`), and the phone
  Controleren list adds the display side as the desk does: "12 diamanten ×
  € 2,95 per diamant · = € 35,40 per display van 12 · op voorraad".
- Sales card "Hoe verkoop je dit product?" (2026-10-15,
  `features/products/product-sales-setup.ts`, styles global in
  `styles/product-sales-setup.scss` because the editor's component styles
  sit at their budget): first block of Verkoopprijs (desk 05, phone Prijs).
  A live sentence ("Je verkoopt diamanten, per 12 in een display. Je prijs
  geldt per diamant; de klant bestelt per display.") and four rows in its
  order: Eén stuk heet (unitKey), Verpakking Los/Geschenkdoosje/Display +
  "{Diamanten} in één display" (kind, piecesPerUnit; required, missing-field
  tab `sales`), Prijs geldt per (salesUnit; only with a display; the option
  you are not on shows today's price there in orange), Klant bestelt per
  (orderStep, small to large). Previews "Zo leest de klant het" and "Zo rekent
  het ERP". Same stored fields as before, no backend change. Switching the
  basis of a saved product (or leaving Display while priced per display)
  shows a warning naming what is not converted, a "Prijs × 12 = € 35,40
  invullen" button (fixed price only; fills the draft price, never stock,
  carton count or cost) and Terugzetten; Opslaan then asks "Prijsbasis
  wijzigen?" (`save(basisConfirmed)`). A "per display" step the draft can
  no longer give is announced (`orderStepFellBack`). Phone: a complete saved
  product folds the card to the sentence. Pill "Alleen Red · Ook voor 3
  andere kleuren" opens Naar de reeks kopiëren with only PACKAGING ticked
  (settings stay per colour). Basisgegevens keeps one line
  (`packagingSummary`) plus the display's size, weight and barcode. Product
  view and desk show the sentence as a "Verkoop" fact. The texts live
  import-free in `product-sales-unit.ts` / `product-order-step.ts`;
  `tests/product-editor-order-step.test.mts` runs the card's members.
  Screens that print units call `catalog.unitNames()` once. The portal uses
  the localized `line.unit` / `item.unit` (UnitDto) when present, else the
  old `stuks` keys.
- Klant bestelt per ("Verkocht per" until 2026-10-15; order step, 2026-10-14): `packaging.orderStep` CARTON |
  PACKAGE | UNIT says what a sales quantity is rounded up to - a full outer
  carton (absent/null/unknown, so every older product), a display of N
  pieces, or one sales unit (per stolp, per box, per display for a display
  basis). One setting for quotes, invoices, the portal, the website quote
  request and website ordering; the unit price never changes, and freight
  still counts a part carton as one full carton (`line.cartons`). Stored
  quantities stay in the sales unit; nothing converts them. Rule, mirrored
  from the backend `OrderSteps`: units per step = CARTON `max(1,
  piecesPerCarton)`, PACKAGE `piecesPerUnit` only for kind DISPLAY + PIECE
  basis + at least 2 pieces (else 1), UNIT 1; rounding `ceil(q/step)*step`,
  0 stays 0. `features/products/product-order-step.ts` holds it plus the
  Dutch wording (`orderStepOf`, `unitsPerOrderStep` - the server's
  `Product.unitsPerOrderStep` first, `roundToOrderStep`, `orderStepChoices`,
  `orderStepLabel` "Volle omdoos (12 stolpen)" / "Per display (8 bowls)" /
  "Per stolp", `orderStepNotice`, `orderStepMultiple`). Only Angular
  components import it at runtime; node-tested modules inline the rule or
  take the step as data (`analysis-metrics.ts`, `sales-split-state.ts`
  `salesSplitStep`, `product-picker-family-groups.ts` gets a
  `defaultQuantity` callback, the portal has `portalUnitsPerStep` in
  `portal-sales-unit.ts`, `product-family-shared-fields.ts` words it inline).
  - Product editor: row "Klant bestelt per" of the sales card, small to
    large: "Stolp · Elk aantal", "Display · Per 8 bowls" only while the
    draft's display qualifies, "Omdoos · Per 12 stolpen" (or "Doosinhoud
    ontbreekt"), with a live example ("13 diamanten op een offerte worden
    24 (2 displays)"); counted from the draft, never the saved product. Another packaging kind (no display any more) rewrites
    PACKAGE to UNIT in the draft at once (the server refuses PACKAGE without
    packaging). Retyping the display contents (8 → "1" → 12) or switching
    the basis keeps the stored PACKAGE: meanwhile `effectiveOrderStep` shows
    it as per unit, and `save()` calls `settleOrderStep()` so a PACKAGE that
    still does not qualify is stored as UNIT - what the card shows is what
    is saved. `blankProduct()` starts on CARTON. Product view and desk
    show it in the "Verkoop" sentence, the desk price step reads "Klant
    bestelt per stolp" (`orderStepSentence`, wraps); the family PACKAGING
    bundle carries the setting and says so.
  - Server-owned figures are never sent back: `CatalogApi` strips
    `Product.unitsPerOrderStep`, `SalesApi.previewOrder/updateOrder` strip
    the line stamp `SalesOrderLine.unitsPerOrderStep` (the step the server
    last rounded that line to, so a step change never re-prices a sent or
    paid document).
  - Sales editor/desk: `unitsPerStep(productId)` (was `piecesPerCarton`) is
    what the next save rounds to: the priced line's `unitsPerOrderStep` when
    it is 1 (the server does not round: partner deal, CONTAINER_COST, credit
    note, split allocation), otherwise the product's step of today - a
    loaded line carries the step it was stamped with, and a save or preview
    re-stamps with today's. A line not priced yet takes the product's step;
    an older server sends none and the product step is a full carton. The hint
    shows only when `roundToOrderStep(wanted, step) !== wanted` and the step
    is above 1: "Volle doos: wordt 24" / "Per display van 8: wordt 16"; per
    unit never. The 5 s typing pause and `flushPreview` are untouched. After
    a preview answer and after a save, `syncQuantityFields` (after render,
    `sales-quantity-fields.ts`) writes the priced quantity into every
    `data-quantity-line` field that is not focused: [ngModel] skips an
    unchanged value, so 13 rounded back to the bound 24 stayed 13. The
    focused field catches up on blur unless a newer number waits. Desk:
    the quantity detail and rounding hint wrap to the width of the other meta,
    so they no longer run under the quantity. Save
    toast "aantal afgerond op het bestelveelvoud"; the website review says
    "Aantallen volgen per product het bestelveelvoud (doos, display of
    stuk)". Restore sheet (`[unitsPerStep]`, `[multiple]`, `[units]`) and
    split sheet/state (`salesSplitStep`: `unitsPerOrderStep ??
    piecesPerCarton`; "in displays van 8 stuks") use the same step.
  - Product picker, selling (`enforceCartons()` true): a pick starts on one
    order step (`defaultQuantity`, also for a whole family), single mode
    snaps to it, and the carton notices and "Een halve doos mag bij inkoop"
    show only for CARTON products. Purchasing is unchanged.
  - Analyses "Minder dan één outer carton" lists CARTON products only.
  - Rollout: no production product leaves CARTON before the website build
    that sends `quantity` items is live - the older site drops or inflates
    a non-carton line when a customer changes an order.

### Translation workspace (Codex, 2026-08-21)
- Settings → translation workspace (`content-translation-workspace.ts`):
  site copy, legal pages and category texts per language, 8 languages,
  saved through the revisioned content-translation endpoints. The
  `website-sync-status.ts` badge shows the rebuild outbox state
  (NOT_CONFIGURED / QUEUED / TRIGGERED / LIVE / FAILED_OR_STALE) and keeps
  polling while Vercel builds.
- Products: `product-translation-editor.ts` (+ adapter) edits a product's
  name/colour per language against the strict-language contract;
  the publication editor lists every missing path before a family may go
  READY/PUBLISHED. Exports can be made per locale, strictly.
- Maat is not translated (owner, 2026-09-28): one `variantSize` for every
  language, edited only in the product editor (hint "Geldt voor alle
  talen"). No translation screen, gap, publish-fix row or AI brief asks for
  it (the website brief gives it as "maat (niet vertalen, ...)"), and a
  variant reads "Rood · 4.8*4.8cm". `texts[].variantSize` is never shown or
  edited but goes back as loaded on every write: the size-neutral backend
  returns null and ignores it, an older one keeps its rows.
  Deploy order: the backend size-neutral change (with the 2026-09-28
  migration) goes live first on Railway test and production; an older
  backend still demands a per-language size that no ERP screen fills in.
  Against it a `.variants.<v>.<lang>.size` issue reads "Maat van ... geldt
  voor alle talen ...; een oudere server vraagt die nog in FR" and a stray
  `products.<id>.size` export path offers "Maat aanpassen" (product editor),
  never "Vertaling aanvullen".
- Category saves carry the server `revision`; a stale one is refused
  with "Categorie is intussen gewijzigd" - reload, do not retry blindly.
- `unsaved-changes.guard.ts` protects the workspace from navigating away
  with dirty edits; `desktop-viewport.ts` keeps the workspace desktop-only.

### Portal (customer-facing, calm colours)
Quote view in the customer's language (texts from the backend bundle),
order-step rounding parity with the backend (`portalUnitsPerStep`: the
catalogue item's `unitsPerOrderStep` - the step the proposal is rounded
to, also for products already on the quote - else the quote line's (the
step it was last priced with), the carton content from an older server; a step of 1 never snaps or announces; an addition starts on
ten cartons for a CARTON product, one display or unit otherwise; the notice
names a display step with the existing `salesUnitsPerDisplay` key), the
per-line "{n} dozen" stays (logistics), digital signing, change
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

## Jaarinventaris (2026-10-09)

The yearly stock count and the year-end closing stock with its value for the
accountant, under "Producten & voorraad". The backend computes every figure
(FIFO per receipt lot at acquisition value, never the Enrosed kost); these
screens show them, collect decisions with a reason and build the writes.

- **Routes** (all under `/stock`, so the Producten group and tab light up):
  `/stock/inventaris` (hub, query `jaar`), `/stock/inventaris/telling/:id`
  (count session, query `boeken=1` opens the booking sheet) and
  `/stock/inventaris/afsluiting/:id` (closing, query `stap` =
  `tellen|datum|waarde|apart|afsluiten`, fragment = the row a notice names).
  The Voorraad sidebar link matches its path exactly so it does not light
  together with Jaarinventaris.
- **Files.** `core/api/inventory-models.ts` (the server's types, verbatim)
  and `inventory-api.ts` (`refusalCode` / `refusalDetails` read the `code`
  and `details` of a 409). In `features/inventory/`: the pure modules
  `inventory-count.ts`, `inventory-closing.ts` (node-tested) and
  `inventory-unit.ts` (the one adapter to `productSalesUnit`; no screen
  builds its own unit word); `inventory-page.ts` (hub); `stock-count-page.ts`
  with its three sheets; `stock-closing-page.ts` (shell) with the five
  `closing-step-*` components and their sheets. Area CSS: `styles/
  inventory-count.scss` and `inventory-closing.scss` (`inv-*`); the hub and
  the shell keep their own layout classes (`inv-hub`, `inv-shell`) in the
  component.
- **Count.** Nothing touches stock until "Telling boeken". Every line save
  carries the line's `revision`; a 409 `REGEL_GEWIJZIGD` becomes the conflict
  dialog and "Vervang" resends with the server line's revision. The session
  reloads every 20 s and on focus while open; per line the higher revision
  wins. A difference an unshipped invoice or an unbooked container explains
  is solved in that document, not with a reason. A correction counts only
  the products added to it.
- **Closing shell.** It owns every API call. A CONCEPT is opened with
  `recompute` (after the plain read that tells the status), a final closing
  is read. The steps take `view` and `busy` and only emit; every server
  answer is a NEW `ClosingView`, which is also what closes their sheets, so
  after a refused save the view stays untouched and the sheet stays open.
  After `saveOpeningLayers` and `retireOpeningLayer` the shell recomputes
  (the server computes nothing there). Finalize sends the `dataSha256` of
  the view on screen; `CIJFERS_GEWIJZIGD` and `GEBLOKKEERD` toast and
  recompute, `DEFINITIEF` reads the stored rows. "Corrigeren (nieuwe versie)"
  navigates to the new concept.
- Do not make an ancestor of a step a size container or transform it: the
  steps render their own sheets (trap rule).
- **Wording** (owner rules): Aanschafwaarde (never Kostprijs), Waarde per
  stuk, Waardevermindering (never Afwaardering as a label), Product, Excel,
  Concept / Definitief, "Volgens systeem", "gewijzigd", "de
  voorraadgeschiedenis", Afspraak, and "Bank- en betalingskosten
  ('Bijkomende kosten')" where it names what stays out of the value.
- A phone gets the hub, the count and a summary of the closing (totals, Nog
  te doen, Aandachtspunten, the two files); valuing and finalising need a
  desk (`DesktopViewport.active()`).
- Rollout: backend first. A new ERP on an old backend shows the hub with a
  load error.

## Account-led banking and manual invoices (2026-10-13)

- Superseded on 2026-10-16 (see "Bank cockpit and Kasprognose"): Bank opens
  the cockpit, and Transacties without `account` is one stream over every
  active account (each row names its account, the Saldo column is the total
  of the active accounts). The old `tab=movements&account=...` URLs still
  open one account's register.
- Allocation starts with local documents (costs, sales invoices, purchase terms),
  then existing recorded payments, then missing documents (manual or Odoo/Peppol).
  Purchase terms are expected budgets, not invented invoices; original currency
  is explicit, and commercial invoice attachments can be opened for reference.
- New local costs using a bank transaction call the atomic `cost-registration`
  endpoint with a stable UUID and exact request body. Unknown outcomes keep that
  operation for replay; conflicts reload the existing registration. Files upload
  after a confirmed cost. Never fall back to separate create+payment calls.
- Preserve signed amounts, source authority, existing payments and the aggregate
  two-cent matching tolerance. Only unlinked transactions may acquire a new link.
- Focused validation: `tests/bank*.test.mts`, `tests/cost*.test.mts`,
  `tests/finance*.test.mts`, payment-preference and receipt-account tests.

### Linked document navigation and phone finance (2026-10-13)

- Bank rows open their linked cost, sales document or purchase detail directly;
  more actions have a separate button. Resolve actual saved relationships from
  all cost/purchase payments, deduplicating by document. Multiple documents
  offer a chooser. Imported references never imply a link. On missing/failed
  sources, refresh and check sourceErrors; ignore late responses after leaving.
- Phone bank registers use compact account summaries and document-labelled rows;
  period filters and selection totals remain available. Odoo errors stay visible
  through the connection disclosure. Cost detail has an explicit return trail,
  and editing/payment sheets temporarily replace its phone overlay.
- Mobile navigation uses full subsection labels. Negative supplier credits use
  signed settlement status; do not label an unpaid credit as paid.

### Allocation readiness and paid-cost reuse (2026-10-14)

- Selecting a local document replaces the picker with its preview and focuses
  the heading. The persistent footer explains every blocked action and exposes
  source retry on both local-document and existing-payment tabs.
- A fully paid ordinary cost with exactly one free, same-direction matching
  payment offers “Bestaande betaling koppelen” directly. Submit uses existing
  payment IDs through `linkPayments`; it never creates another payment. Multiple
  matches require explicit selection; historical bank links must first be detached.
- `canLinkLocal` remains the new-payment guard. `allocationReady` composes the
  established routes with source, busy and current-bank checks. Reuse keeps the
  original payment amount and the aggregate two-cent tolerance.

- Settled-cost allocation previews use actual recorded payment amounts even when
  they do not match the bank. Never substitute the bank amount as an existing
  payment: that hides registration mistakes behind a false zero difference.
  Ambiguous/missing payments show no assumed amount; show each recorded payment
  and bank-link status. The original matching guard remains unchanged.
- Bank transaction rows omit the repetitive Odoo badge; source metadata, sync
  controls and the detailed provenance remain available.

## Bank cockpit and Kasprognose (2026-10-16)

Kosten & bank now opens on the bank, every bank transaction has its own
detail, and Analyses gained a cash forecast (Kasprognose). Both pages draw
the expected balance per day from one pure module. Owner choices: Bank
replaces the Overzicht and keeps every figure it had; the forecast lives in
Analyses, with only a short Kaslijn in Kosten & bank; a payment follows the
bank when it is linked, and the screen says what changes first. Backend
counterpart: "Kasprognose en bank (2026-10-16)" in the backend AI-CONTEXT.

### Places and addresses
- `FINANCE_NAV` (finance-sections.ts) drives the desk sidebar, the phone tab
  bar (Bank · Transacties · Betalen · Ontvangen · Kosten; Rapportage behind
  `⋯`) and the keys 1-6. Bank = `view=bank` (`tab=accounts`, the default, so
  `/costs` is the cockpit); Transacties = `view=bank&tab=movements`, with
  `account=<key>` for one account. `financeNavOf` picks the active place.
  Counts (`FinanceShell`): `bank` = accounts without a reading plus stale
  readings, `transactions` = lines to link on active accounts (both
  directions, booked lines excluded). Under Transacties the desk sidebar
  lists every active account (`FinanceShell.accounts`: balance, "{n} d oud",
  its own count) when there are two or more. With exactly one active
  account Transacties is that account (Emre, 2026-10-16): no account row,
  its balance and age stand under Transacties (warn after 14 d), Transacties
  without `account=` shows its card and the phone sub line names it, and a
  transaction's sub line leaves the account out (an archived account's line
  still names its own).
- `line=<id>` (finance-url.ts) opens a transaction on every section: the desk
  inspector (424 px for a line, other kinds keep 360) or the phone sheet. It
  wins the inspector over `cost`/`container`; closing removes it; links and
  toast actions push it, so Back returns. `weeks=4|13` is the Kaslijn's span
  (8 is the default and never written).
- Keys `s` Splitsen…, `c` Boeken als…, `u` Koppeling losmaken, `o` gekoppeld
  document openen work on Transacties and the detail only; `Enter` opens the
  detail, `l` links the best match.
- Analyses: `/analyses` redirects to `/analyses/cash`; Kasprognose is the
  first tab, Website reads "Bezoekers", the desk sidebar shows a "nieuw" pill
  until the end of 2026, Meer lists it first.

### Bank cockpit (`bank-cockpit.ts`, `bank-panel.ts`)
- Desk: the total tile "Op de bank" (all active accounts, "Vandaag · Deze
  week"), one card per active account (`bank-account-card.ts`: IBAN, 30-day
  sparkline, source, "{n} te koppelen", "telt niet mee in de kasprognose",
  `⋯` with the four account actions plus "Telt mee in de kasprognose"), the
  Geld strip (the old Overzicht tiles Te betalen / Te ontvangen / Uitgegeven
  deze maand / Btw dit kwartaal with every sub-line), the Kaslijn, and
  Transacties beside the rail. The rail starts with "Vooruitblik" (the
  equation, `vooruitblik-equation.ts`; moved there so the first transactions
  stay above the 1440×900 fold), then "Vraagt aandacht" and "Laatst geboekt".
  The phone Bank tab shows the same as hero, account carousel, 2×2 widgets,
  Kaslijn card, "Te koppelen", attention, recent and a Rapportage cell.
- `OdooSyncState` (odoo-sync-state.ts, provided by CostsPage beside
  FinanceState) owns the Odoo import: status, `syncBank()`, the result toast
  ("Import afgerond · {n} nieuw · …", warn with "Details" when incomplete) and
  `attention`, which adds the warn link "Odoo: controle nodig ›". The
  toolbar button, the phone `⋯`, the status bar and the Odoo-verbinding
  sheet all read it, so an import still refreshes the bank after the sheet
  closed.

### Transacties and the transaction detail
- One stream over every active account (newest first), day groups with
  "Saldo einde dag", a Saldo column (`FinanceState.running` =
  `runningBalances`: the total of the active accounts, or the account's own
  with `account=`; "Saldo onbekend vóór {dd/mm}" before a manual account's
  first reading). Status chips Gekoppeld / the booked label / Suggestie /
  Te koppelen, "In € · Uit €" without internal transfers, a first row
  "Betalingen zonder transactie ({n})" whose "Transactie zoeken" prefills
  dir, ±5 days and the amount.
- `bank-suggestions.ts` (pure, node-tested; the caller hands in
  `bankAllocationTargets` per line): candidates are documents, terms and
  free payments in the line's direction; score amount ±€0,02 +40, PO /
  invoice / reference in the text +30, name +20, still open +10, existing
  payment within 10 days +10. Suggestie from 70 with a matching amount;
  exact = one text signal and no other candidate at 50 or more (only exact
  ones go into "{k} exacte suggesties koppelen", `bank-sheets.ts`, linked one
  by one in booking order, stopping at the first refusal). An outgoing line
  whose counterparty went to costs of one category at least twice in a year
  suggests "Kost · {categorie} · zoals de vorige {n} keer" (never exact).
- `transaction-detail.ts` is a BankMovementPanel, so the old allocation
  state machine and its tests carry over. By status: Suggestie (Beste match
  with "Wat verandert", the old preview under "Details", other candidates,
  Splitsen, Boeken als), Te koppelen (the three steps: Zoek in ENROSED,
  Bestaande betaling, Nog te registreren), Gekoppeld (every part on the line,
  invoice, container, proof, history, "Koppeling losmaken"), Geboekt als
  (label, other leg or quarter, "Ongedaan maken").
- "Wat verandert" (`bank-change-preview.ts`, pure, node-tested) compares
  "Betaling nu" with "Na koppelen" (Bedrag, Betaald/Ontvangen op, Rekening,
  In USD/CNY and Koers for foreign purchase payments, Bewijs). The switch
  "Betaling volgt de bank" is on by default: the payment takes the line's
  amount, day and account, the button reads "Koppelen en aanpassen" and the
  toast "Bedrag en datum gevolgd van de transactie: … (was …)" with
  "Ongedaan maken" (unlinks and deletes payments the link created; it never
  restores old amounts). A smaller line on a purchase payment carves its
  part out ("Rest … blijft open als tweede transactie"); a larger line offers
  "Bedrag aanpassen" or "Rest als inspectie via leverancier"; with follow off
  only a purchase payment under a larger line (and no other payment on it)
  may keep its amount and book the difference as Bankkosten or
  Koersverschil. The recorded amount is always
  shown as "Betaling nu", so a registration mistake stays visible before it
  follows the bank.
- `bank-link-actions.ts` holds one call per target kind; `followPurchaseLink`
  is the only caller of round 2's bank-part follow (R2-2).
- "Boeken als…" (`book-as-sheet.ts`): Bankkosten and Rente are costs (the
  cost registration, prefilled); Interne overboeking (the other leg: another
  active account, exact opposite amount, within 5 days, or "Andere kant staat
  niet in Enrosed"), Btw (quarter, stored `YYYY-Qn`), Lening, Kapitaal, Privé
  and Andere (note required) are classifications on the line itself
  (`classify`/`unclassify`); a booked line counts as allocated and leaves
  every "Te koppelen". `bank-markers.ts` never guesses a booked line as a
  payment.
- "Verdelen over containers" (`container-split.ts`) and Inkoop's "Deze
  transactie dekt ook andere containers" (`purchase-also-containers.ts`): one
  transfer for a term of several containers, one POST `/purchase-payment`
  whose parts each carry their own `purchaseOrderId`; the line reads
  "Inkoop · 3 containers (PO-…, …)", each container's payments "zelfde
  transactie als PO-… en PO-…". Since 2026-10-16 a container whose
  instalment is noted but not on the bank is listed too and starts on that
  payment ('Bestaand: € x', `container-split-rows.ts` picks each row's
  payee and term); with any such row Koppelen sends POST `/purchase-share`
  (the payment follows its part, the others are new payments), the toast
  'Verdeeld over n containers: …' has no 'Ongedaan maken' (undo would delete
  the linked payments); 'Koppeling losmaken' on the line stays. The
  detail's 'Transactie is € x hoger' question offers 'Verdelen over
  containers' first and chooses nothing beforehand.
- Op de bank (Inkoop & kosten › Containers and the container inspector):
  strip "Betaald, op de bank" / "Betaald, nog niet op de bank", column "{k}
  van {n} betalingen · {m} zonder transactie" or "aanbetaling verwacht {d}",
  payment nodes link to their line ("op de bank · {account} · {d} ›") and
  show "aangepast aan de bank (was € x op dd/mm)" from the payment's
  `bankAdjustedFromEur`/`bankAdjustedFromOn`. The cost inspector and Te
  ontvangen › Ontvangen link payments to their line too.
- Cost sheet "Vervalt op" (`dueDate`): sent in the POST of a new cost and
  through PUT `/costs/{id}/due-date` after the PUT of an existing one (the
  server owns the field); empty = the cost date counts in the Kaslijn.

### Kaslijn (`kaslijn-card.ts`)
- `FinanceState.kaslijn` = `buildCashForecast(cashInput(), { scenario: false,
  pastDays: 28, horizonEnd: today + weeks × 7, … })`: the counted accounts 4
  weeks back and 4 / 8 / 13 weeks ahead, base items only (no sales), buffer,
  "Laagste" and "Verwacht" markers, three facts (lowest point, under the
  buffer, largest outflow) and "Per dag in Kasprognose ›". Kosten & bank
  loads complete statements (`statementsFrom: null`) and no products.
- Double-count banner: an unlinked line that likely already paid an open
  item ("{€} telt mogelijk dubbel …") with Koppelen (`line=`, the item as
  Beste match) and "Niet deze" (`cash-dismissed.ts`, per browser in
  `localStorage['enrosed.cash.dismissed']`; nothing else touches that key).
- The buffer ("buffer € x · aanpassen") is one company amount
  (PUT `/api/cash-forecast/settings`), shared with the Kasprognose.
- "Telt mee in de kasprognose" (account `⋯`, PUT
  `/api/bank-accounts/{key}/cash`): an account that does not count stays on
  Bank and in every bank total, but leaves the Kaslijn and Kasprognose start.

### Kasprognose (Analyses, `features/analyses/cash-*.ts`)
- `CashData` (cash-sources.ts, root; `CashSources` is its old name, kept
  for one release) is shared by Analyses and the home's Kas card. It loads
  lazily: `ensure(today)` fetches when nothing is loaded, when the last
  round was for another day, is older than 2 minutes
  (`CASH_DATA_MAX_AGE_MS`) or left something out (a warning, the bank
  missing: `cashDataStale`), else does nothing; `reload(today)` ("Opnieuw",
  "Vernieuwen") always fetches, and returns at once while a round runs
  (read `state()`, `refreshing()`, `generation()`, `loadedAt()`). It
  fetches the bank first, then statements from `statementsFromOf` = the
  first day of the month three months back, earlier when an active
  account's latest reading is older (`banking.list(from)`), recurring
  costs, purchase payments, advance schedules (`loadSchedules(financings,
  round)`, once per round; call it only after the partner financings
  loaded), company, stored choices and settings; purchase orders, sales,
  products and costs come from the page's own load. Each source fails on
  its own, keeps its last good data and names itself in "Niet alle actuele
  cijfers konden laden: …". `CashState` (cash-state.ts, scoped to
  AnalysesPage) holds the address, the forecast, the PO sheet and the
  order-date hint; the Overzicht card ("Op de bank … · laagste stand … ·
  Kasprognose ›") shares it, so nothing loads twice. `cash-options.ts`
  `cashOptionsOf(location, today, dismissed)` is the one ForecastOptions
  builder (`pastDays: 42`); the home uses it with `DEFAULT_CASH_LOCATION`
  so its lowest point equals Analyses'. `features/dashboard/home-cash.ts`
  (pure) turns a forecast into the home's Kas headline and sparkline.
  `cash-view.ts` builds every text and grouping (node-tested through a
  transpile harness).
- Address (`cash-url.ts`, pure): `h` 3/6/12 (default 6), `po` (the open
  container sheet; opening and closing push, everything else replaces),
  link defaults `prijs` opslag|stuk|lijst|historisch, `opslag`, `stuk`,
  `basis` ext|enr, `weken`, `verloop` vlak|seizoen, `termijn`,
  `voorraad=0`, `uit` (comma list facturen, offertes, partner, containers,
  kosten, btw) and `open=1`. Invalid values fall back to the default. The
  buffer is never in the link; "Link kopiëren" copies the address.
- Desk: header with horizon, Buffer and Link kopiëren; krap banner ("Toon
  die dagen" filters the register); five figures; "Saldo per dag" with pins,
  the month strip (fixed 104 px columns in their own scroller) and "Per
  maand ›"; "Komende bewegingen" (past bank rows, the black today bar, month
  groups, filters, CSV); the scenario column (360 px, sticky; the container
  sheet replaces it while `po` is set); "Wat telt mee" and "Aansluiting met
  de Vooruitblik" with data-quality lines. Below 1120 px of page (a container
  query on `.cf`) the scenario stays beside the chart and scrolls in the
  chart's height, and the register takes the full width; a container sheet
  opened from the register is scrolled into view after the router's scroll to
  the top (only scenario sales rows open the sheet; other container rows go
  to `/costs?container=`). Under 760 px everything stacks. Texts wrap;
  nothing ends in "…".
- Phone: one `ios-page` with its own nav and the Analyses tabs as chips (the
  page renders neither its header nor its tab row then): hero, banner,
  compact chart (short marker labels "Laagste € x", "Onder nul · 3 jan"),
  four figures, scenario cells with their sheets, result, order-date card,
  movements (8, then "Alle {n} bewegingen") and cells for Per maand, Wat telt
  mee and Aansluiting.
- Container sheet (`cash-po-sheet.ts`): net and "Terugverdiend op …", the
  lane chart, Betaald / Nog uit / Terug, price (Opslag % chips, € / stuk,
  Lijst, Historisch), cost basis, weeks, payment days, season, "In het
  scenario", Vertrek (BESTELD) or "Bestellen op" (CONCEPT), the money flow
  with "Lijkt al betaald" (Koppelen / Niet deze) and per product. Every
  control writes the order's full `PurchaseOrderForecastWrite`
  (PUT `/api/purchase-order-forecasts/{id}`) 600 ms after the last change,
  last write wins, a refusal shows inline and reverts; "Terug naar
  standaard" deletes the row. A stored choice wins over the link default,
  which wins over history.

### `cash-forecast.ts` and its input (shared by both pages)
- Both pages compute every forecast figure as
  `buildCashForecast(cashForecastInput(sources), options)`; nothing else
  computes one. `cash-forecast.ts` is pure and node-tested (only `import
  type`, local helpers, integer cents inside, euros out).
  `cash-forecast-input.ts` builds the input from the API data with the
  helpers Kosten & bank already trusts (reconciledBank, containerPayables,
  receivableTotals, vatReturn, …) and exports `vooruitblikOf`, the one
  Vooruitblik formula (`FinanceState.outlook` uses it), so Bank, Kaslijn and
  Kasprognose never disagree. Its test (tests/cash-forecast-input.test.mts)
  is a transpile harness that rewrites the imports of the modules it pulls
  in: a new runtime import there breaks it.
- `statementsFrom` (Analyses only): movements before it are dropped, an
  account's opening is the balance before its first kept movement, day ends
  before it are null; older unlinked lines stay in `bankLines` for the
  double-count check. An older server ignores `?from=`; the builder
  truncates itself.
- Start = Σ current balance of active accounts that count and have a
  reading or a line; any of them without a balance → relative mode
  (differences from today, no buffer or krap). Constants: buffer € 10.000,
  transit 38 d, lead time 35 d, inspection 7 d before departure, logistics
  2 d after arrival, slow band +28 d, krap runs merge within 3 days,
  likely-paid window 90 d, pins from € 5.000 (4 largest groups).
- Date rules (a date before today becomes today with " · nu"):

  | Source | Day | Certainty |
  |---|---|---|
  | open cost | `dueDate`, else the cost date | Vast / Verwacht |
  | recurring cost | each occurrence (domiciliëring noted) | Vast |
  | container term ORDERED | today (CONCEPT: the order day) | Vast (Scenario) |
  | term SHIPPED / FREIGHT | departure: shipped, stored `expectedShipOn`, ETA − transit, or order day + lead time | that rule's |
  | term ARRIVED | arrival: received, ETA, or departure + transit | that rule's |
  | logistics / inspection / other streams | arrival + 2 d / departure − 7 d / arrival | that rule's |
  | import VAT (BE customs, not deferred, not already a cost) | arrival | that rule's |
  | open invoice | due date + the customer's usual delay (mean of ≥ 2 paid invoices) | Vast / Geschat |
  | partner advance row | its due date | Vast |
  | accepted quote | delivery (week) + payment terms; prepay today; split p % today, rest at delivery | Geschat |
  | open quote (off by default) | valid until + 30 d, value × conversion % | Geschat |
  | VAT return | the 25th after the quarter (§ below) | Vast / Geschat |
  | scenario sales | sale day + payment days, weekend → Monday | Scenario |

- `likelyPaid`: an open container, cost, invoice or advance item and an
  unlinked, unbooked line of the same sign within € 0,02 and 90 days, backed
  by the order / invoice / reference in the bank text (beats) or the party's
  name; ties match nothing, each line once; a paid VAT return is matched to
  a line after its quarter naming FOD Financiën or btw. A match leaves the
  forecast (`excludedItems`) and shows as "Lijkt al betaald"; "Niet deze"
  dismisses it.
- VAT rows: the previous quarter (unless its deadline passed or a line is
  booked as that quarter's VAT), the current one, then later quarters up to
  the horizon: known return − output VAT of expected receipts + deductible
  import VAT, a credit carried forward. Only a payable return is an item;
  scenario sales add a "btw op scenarioverkoop" item.
- Scenario: sources are the current stock and every non-archived BESTELD,
  ONDERWEG or CONCEPT order (partner orders listed, locked, never selling;
  CONCEPT off by default, its terms and import VAT scenario items when
  included). `resolveChoice`: stored → link → history (realised markup or
  50 %, external cost, `defaultSellWeeks` from pace 2..52, customers' mean
  payment days or 30, season when 12 months of revenue exist). Sales start
  7 days after arrival (stock: today), one item per week, cents spread with
  `distributeCents`; the slow band shifts them 28 days.
- Reconciliation (asserted by a node test): from the Vooruitblik "als alles
  betaald en ontvangen is" through named lines (rekeningen die niet
  meetellen, vaste kosten na 30 dagen, btw, btw bij invoer, offertes,
  partnervoorschotten, "Na {horizon}", "Lijkt al betaald", "Uitgezet in Wat
  telt mee") to "Wat vastligt op {horizon}", which must equal the base
  series' last day; otherwise the page says "De aansluiting klopt niet; meld
  dit."
- `poSheet` and `suggestOrderDate` (the first Monday from which ordering a
  CONCEPT keeps the lowest point above the buffer, or no lower than now).
  A sales window that runs into another year names both years.
- The chart (`shared/cash-chart.ts`, `app-cash-chart`; `full` on the
  Kasprognose desk, `compact` on the phone and the Kaslijn, `lane` in the
  container sheet): past, base, with and slow series, the slow band, buffer,
  krap columns, pins, markers and a tooltip (touch-and-hold on a phone).
  Where the labels go is `shared/chart-labels.ts` (pure, node-tested in
  `tests/cash-chart-labels.test.mts`): "Vandaag", then the markers' labels
  on the free spot nearest their point, then the buffer's along its line.
  A label never covers another label, a dot, a flag or any drawn line (each
  piece of every series, dashed ones too, the buffer, today's line, the
  lane's zero); with no free place on the plot it is listed under the chart
  (`.cc-notes`) instead. A change to the chart shows on both pages: check
  the Kaslijn's compact look too.

### Ownership and module rules
- Shared (one change serves both pages, so check both): `cash-forecast.ts`,
  `cash-forecast-input.ts`, `cash-format.ts` (nl-BE money and day words for
  the Kasprognose), `cash-dismissed.ts`, `shared/cash-chart.ts`,
  `shared/chart-labels.ts`,
  `core/api/cash-forecast-api.ts` and the round's additions to
  `banking-api.ts`, `finance-api.ts` and `models.ts`.
- Kosten & bank: the rest of `features/finance/` and
  `shared/bank-transaction-picker.ts`; styles `bank-cockpit.scss`,
  `finance-workspace.scss`, `finance-bank.scss`, `finance-phone.scss`.
  Analyses: `features/analyses/cash-*.ts`, the routes and tabs; styles only
  `styles/cash-forecast.scss`. `finance-format.ts` stays Kosten & bank's.
- Node-tested with only `import type`: cash-forecast.ts, cash-url.ts,
  bank-change-preview.ts, bank-suggestions.ts, finance-sections.ts,
  finance-url.ts, finance-shortcuts.ts. cash-forecast-input.ts and
  cash-view.ts have runtime imports and are loaded through transpile
  harnesses.
- The desk page `.cf` is a size container: never put an `app-sheet`, a
  context menu or another `position: fixed` layer inside it (trap rule).

### Older-server guards (a new ERP on an old backend)
- Kosten & bank: `FinanceState.cashRound` = GET `/api/cash-forecast/settings`
  answered (404 → null → false). False hides or disables: Boeken als beyond
  Bankkosten and Rente (with a hint), "Telt mee in de kasprognose", "Vervalt
  op", the buffer link, "Verdelen over containers" and Inkoop's "dekt ook
  andere containers" ("Kan zodra de server bijgewerkt is.": an older server
  books every part on the request's order). `followBank` and
  `keepDifferenceAs` are sent only with `cashRound`; without it an existing
  cost or sales payment must match within € 0,02, and a purchase payment
  still follows through round 2's bank-part.
- Analyses: `CashSources.cashRound` needs the stored choices and the
  settings to have answered at least once (a 404 counts) and settings to
  exist; `choicesFailed` (a load finished without both) blocks every write,
  because a write is the order's full row and would wipe what is stored.
  Without the round the container controls work on the link defaults,
  "In het scenario" and the dates last for the visit, the sheet's foot reads
  "Bewaren bij de container kan zodra de server bijgewerkt is." and the
  buffer is disabled.
- `?from=` on an older server returns every line; the payments round's own
  guard (`paymentRoundOnServer`) is unchanged.

## Website beheren (2026-10-17)

The `/website*` workspace moved onto the workspace kit (contract: scratchpad `redesign/website/design.md` + `critique.md`; the critique wins).

**Frame.**
- `app-website-admin-nav` (rendered by app.ts, unchanged) is a tiny entry that `@defer`s `website-nav-panel.ts`: the side, the phone tab bar, `WebsiteStore` and the workspace CSS load with `/website`, not with every ERP screen (the initial bundle stays under its 1 MB error budget).
- Desk (≥680): the kit's dark `wk-side` (`.ws-side`): brand + env pill + "Website bekijken ↗", Overzicht · Inhoud (Homepage, Producten, Categorieën, Teksten, SEO) · Publiceren (Publicatie) · Elders in het ERP (Prijzen op de website, Afhalen & locaties), `app-wk-side-foot`. Counts only where work is: Producten = Aandacht, Categorieën = categories with missing languages, Teksten = empty required fields, SEO = live reeksen with an SEO point, "concept" on Homepage, "bezig" / "!" on Publicatie. No Overzicht count.
- Phone (<680): one website tab bar (`website-tabbar.ts`: Overzicht, Homepage, Producten, Teksten; tabs carry `info: { nav: 'tab' }`, `IosTab.info` is new and additive) plus the "…" sheet "Website" (SEO, Categorieën, Publicatie, Prijzen, Afhalen, the site, "Terug naar …"). Rendered outside `.main` for every website page, converted or not. Tab roots use `WebsitePhoneBack` (screenLabel of `WorkspaceReturn.phoneUrl()`).
- `/website` is in `isWorkspaceUrl()`, so "Terug naar …" names the screen the workspace was opened from.
- Every converted desk screen is `.wk-page.ws-page` with `app-website-status-bar` (sync pill · the page's line · keys or environment; keys hidden below a 1000 px main). Long/short text pairs use `.ws-long` / `.ws-short` (short below a 1100 px main = viewport < 1348).
- CSS: no load-css line in styles.scss. Each page attaches its partials with `encapsulation: ViewEncapsulation.None` + `styleUrls`: `styles/website-workspace.scss` (shared), `website-overview.scss`, `website-products.scss`, `website-homepage.scss`, `website-texts.scss` (the workspace's split/inline markup), `website-texts-page.scss`, `website-publication.scss`, `website-categories.scss`. All selectors are `ws-*` or `app-website-*` hosts; kit classes are used, never restyled bare. Keep each partial under the 16 kB component budget.

**Data.**
- `WebsiteStore` (root): `families`, `categories`, `content` (the 654 WEBSITE text groups, ~700 kB), `homepage`; `ensure()` loads what is missing or older than 60 s (one request per part), `refresh()` forces, `refreshStale()` runs when the workspace is entered; writes patch it (`patchFamily`, `setHomepage`, `setContent`, `patchContentGroup`, `removeContentGroup`). `familiesVersion` moves on full loads only.
- Pure helpers (node-tested, `import type` only): `website-attention.ts` (attention rule, Te doen rows, SEO check `seoAttention`/`looksDutch`, category gaps, counts), `website-text-areas.ts` (area = first key segment, site order, homepage sub-areas, `displayLabel`), `website-preview-url.ts`, `website-homepage.ts` (`normalizeSections`, summary, differences, `differenceLine`), `website-products-view.ts` (filters and groups of Producten), `website-categories-view.ts` (category codes, save payload, order moves, menu line, reeksen count, deep link), `settings/website-sync-copy.ts` (status words for every variant, `shortMoment`, `rebuildTimeline`).
- **The attention rule equals the dashboard's**: "Nog niet publicatieklaar" = active reeksen with publication points (home-data.ts), so the home's "n niet publicatieklaar" equals the Producten group. Aandacht = inactive-but-live + those + ready concepts + live reeksen with text/SEO below 9.

**Screens.**
- Overzicht: figures strip (5 links), Te doen (one row per reeks/category/text group; the Codex brief format is unchanged, Codex parses it), Recent gewijzigd (logbook `PRODUCT_FAMILY`), Live op de website (state only when not live), texts per language. "Recent" moves right once when the left column would end 240 px lower.
- Producten: opens on Aandacht (`?filter=`, `?reeks=`, both `replaceUrl`); a reeks fixed after the load keeps its place until the next load; switching off a live reeks asks and offers "Ongedaan maken" only when switching on can succeed; a server notice that the site is not updated stays as a banner.
- Homepage: list · inspector · preview (three columns from a 1100 px main, else "Indeling · Voorbeeld"). The inspector lists the block's texts from the store; the inline editor (`ContentTranslationWorkspace layout="inline"`) mounts per block on demand. The preview always loads the Dutch root (`/nl/?builderPreview=n#anchor`), only while visible, and reloads after a publish once the site is live on a newer revision. `HOMEPAGE_SITE_GAPS` and the `siteGap` row lines describe where the live site differs (16 Oct 2026): delete them when the website follows the builder again. Phone: list, block view `?blok=`, preview sheet, save bar.
- Teksten / SEO: `ContentTranslationWorkspace` has `layout = card | split | inline`; card stays for Cataloguslabels (`/catalog/texts`). split/inline take the WEBSITE groups from the store when younger than 60 s, emit the saved group (`contentSaved`), keep rows enabled while dirty (toast), save on ⌘S, switch language on `[` `]`. SEO: Productpagina's table (live first) and Algemene pagina's (split locked to `meta`). Phone texts: parts, `?gebied=` area, `?key=` editor (stays mounted so its save bar survives a step back; `returnTo` leads back to e.g. a homepage block).
- Publicatie: update state + four moments of the current cycle, concept next to live with differences, recent changes.
- Categorieën: `website-categories-page.ts` (route `/website/categories`, off `SettingsPage`): kit table (Volgorde with ↑ ↓ on hover/focus, photo, name + code, menu names as one 2-line text, Uitgelicht or "—", Reeksen by category id else name, Talen x/9), the form (`website-category-form.ts`, no Volgorde field; `CategoryTranslationEditor` unchanged in behaviour) in a docked inspector or a drawer; phone list with a Volgorde mode and an iOS sheet (foot "Opslaan"). Deep links `?code=` (Te doen) and `?category=` (older links, Instellingen) plus `?language=` / `?focus=`; the open category is written back as `?code=` with `replaceUrl`. Keys: ↑↓ rows, ⌥↑/⌥↓ move (refused while the form has changes), Enter opens, Esc closes (asks when changed), ⌘S saves. Writes go through `WebsiteStore.setCategories`. The rules are copied by name from settings-page.ts into the pure `website-categories-view.ts`; settings-page's `websiteCategoryMode` branch is now unused (company round removes it).

**Words.** Opslaan (never "Bewaren"), Herstellen for reverting unsaved edits, Live · Concept · Verborgen · Niet actief in ERP, webadres, uitgelicht product, blok, "je", real plurals, "Update geaccepteerd".

**Keys (desk).** Lists are one tab stop with roving focus. Homepage block list: ↑↓ choose, ⌥↑/⌥↓ move (the Hoger/Lager rules), Space shows or hides (not on fixed blocks), Enter goes to the inspector's switch. Teksten / SEO › Algemene pagina's and the Homepage inline editor: ↑↓ / Home / End through the visible rows (the editor follows; refused with a toast while the text is not saved), Enter goes to the text field, `[` `]` change the language, ⌘S saves. The Sneltoetsen rows (`PAGE_SHORTCUTS`) and the status-bar hints say the same.

**Open for Emre (not in this round).**
- Backend W11: `WebsiteRebuildService.updateLiveRevision()` moves `liveAt` on every poll while LIVE, so "sinds" is the last check. One-line guard `if (state.status != WebsiteRebuildStatus.LIVE) applyLive(state, now);` + test; needs his go for the Railway test environment.
- Website repo (Codex): G1/G6 skip the language dialog when `builderPreview` is in the URL (then the preview can offer other languages again, EN without a redirect); G2 decide block "Offerte aanvragen"; G3 "Beurzen" and the FAQ in the footer; G4 which section uses `home.catalog` / `home.tradeFlow`; G5 handle typos and Dutch handles, the active "TEST PRODUCT".
