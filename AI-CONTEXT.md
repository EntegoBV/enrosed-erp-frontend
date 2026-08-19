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
- Login: Basic auth (`enrosedadmin`); portal routes are public via token

## Standing conventions (agreed with the owner)

- **Code and code comments in English; UI texts in Dutch.** Commit
  messages in English, grouped per topic.
- Standalone components, signals, zoneless change detection, OnPush
  everywhere. Inline templates+styles in the component `.ts` files.
- No test suite (scaffolding was removed deliberately); verification is
  `ng build` plus visual checks at 375 px width.
- Errors surface via `messageOf(failure, fallback)` - the backend sends
  readable Dutch messages on 409s; show them.

## Design system ("iOS 26" look, owner-approved)

- Red theme is the default (internal mode); **green theme = customer-safe
  mode** toggled by double-tapping the brand mark: every purchase figure,
  margin and cost disappears (customers watch over shoulders at fairs).
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
  de klant" default and "Anders…"), lines (carton snap after 2 s pause,
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
- List → **read-only view first** (stepper without Onderweg, products
  with expandable per-line cost build-up, Totaal/Per stuk toggle,
  journey cost card, container fill bar, Gegevens above costs), edit
  behind a button. New orders open straight in the editor.
- Editor: rates on one row (RMB→USD, USD→EUR goods/transport), costs
  section, product picker that can **quick-create** a product (name,
  supplier currency price, pieces/carton, carton size) without leaving,
  per-line EXW currency, status advance button at the bottom, apply
  landed costs with confirm dialog.
- Purchase figures respect the privacy mode everywhere, PDF included
  (internal vs klantweergave toast explains which you got).

### Products
- List (search, skeletons) → view first: price and margin (intern) in
  the title line, snap carousel with corner expand icon, lightbox with
  download (originals are print quality), bento tiles, barcode placement:
  piece EAN with the product, outer ITF-14 with the carton.
- Editor behind Bewerken; EXW price with currency select; CSV
  master-data and translations import/export live in Settings.

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
