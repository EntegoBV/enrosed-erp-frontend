import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type {
  PartnerProductTile, PartnerRecentSale, PartnerReportRequest, PartnerReportResult, PartnerStockTile,
} from '../../core/api/partner-portal-api';
import { messageOf } from '../../core/api/errors';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { Icon } from '../../shared/icon';
import { Segmented, SegmentOption } from '../../shared/segmented';
import { Ui } from '../../shared/ui';
import { BuyerCreateFn, BuyerSearchFn, PartnerBuyerField } from './partner-buyer-field';
import { DraftExtraLine, MAX_EXTRA_LINES, MeldingDraft } from './partner-draft';
import { PartnerEntryCard } from './partner-entry-card';
import { PartnerEntryTable } from './partner-entry-table';
import {
  KIND_SHORT, PARTNER_KINDS, PartnerKind, dayLabel, escapeHtml, euro, minusEuro, parseKind, percent,
} from './partner-format';
import { piecePriceOf } from './partner-money';
import { PartnerMoneyField } from './partner-money-field';
import { PhotoUrlFn, partnerPhoto } from './partner-photo';
import { PartnerProductTable, TableProduct } from './partner-product-table';
import { twinKeys, twinTitle } from './partner-twins';
import { pieceUnit, piecesPerSalesUnit } from './partner-units';

/** A message the screen puts in place of a refusal, with one way on (a newer version of the melding to load). */
export interface EntryNotice {
  text: string;
  action: string;
}

/** How far the piece price may rise above the partner's last one before Opslaan asks "Klopt de prijs?". */
const PRICE_JUMP = 5;

/**
 * The melding form, desk first: the product choice (a grouped table with
 * ticks that folds away), the products as an entry table (cards on the
 * phone), and a side column of about 300 px with the kind (Veiling | Direct |
 * Terugkoop), the date, the buyer (Direct), the costs with extra kost lines,
 * Terugkoopkost and Netto, and Opslaan. Everything it shows comes from its
 * inputs and the draft, and it sends through `submit`, so a staff screen
 * reuses it as it is (its own products, photo route, buyer search and POST or
 * PUT); it never calls an API itself.
 *
 *   <app-partner-entry [draft]="draft" [stock]="stock" [recent]="recent" [today]="today"
 *                      [submit]="send" [buyerSearch]="find" [buyerCreate]="add" (done)="shown($event)" />
 */
@Component({
  selector: 'app-partner-entry',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Icon, PartnerBuyerField, PartnerEntryCard, PartnerEntryTable, PartnerMoneyField, PartnerProductTable, Segmented],
  template: `
    @let d = draft();
    @let kind = d.kind();
    @let money = d.money();
    @let t = money.totals;
    @let costs = d.effectiveCosts();
    @if (!desk.active()) {
      <app-segmented class="kinds" variant="ios" label="Soort melding" [options]="kindOptions" [value]="kind" (changed)="pickKind($event)" />
    }

    <div class="layout">
      <div class="layout__main">
        <section class="pick" [class.is-open]="pickerOpen()" aria-label="Producten kiezen">
          <header class="pick__head">
            <button class="pick__toggle" type="button" [attr.aria-expanded]="pickerOpen()" (click)="pickerState.set(!pickerOpen())">
              <app-icon name="chevron-down" [size]="16" />
              <span class="pick__title">{{ kind === 'terugkoop' ? 'Verkochte producten' : 'Producten' }}</span>
              <span class="pick__count">{{ chosenLine() }}</span>
            </button>
            @if (pickerOpen() && d.entries().length) {
              <button class="pick__done" type="button" (click)="pickerState.set(false)">Klaar</button>
            }
          </header>
          @if (pickerOpen()) {
            <div class="pick__body">
              <app-partner-product-table mode="pick" [items]="pickList()" [selected]="selectedIds()" [blocked]="blockedIds()"
                                         [photoUrl]="photoUrl()" [stockFilter]="kind !== 'terugkoop'"
                                         [figureLabel]="kind === 'terugkoop' ? 'Laatst verkocht' : (d.editing() ? 'Beschikbaar' : 'Op voorraad')"
                                         [emptyText]="kind === 'terugkoop' ? 'Geen verkopen van de laatste 60 dagen.' : 'Er ligt nu geen voorraad.'"
                                         caption="Producten kiezen" (picked)="d.toggle($event)" />
            </div>
          }
        </section>

        @if (desk.active()) {
          <app-partner-entry-table [draft]="d" [recent]="recent()" [photoUrl]="photoUrl()" [twins]="twins()" (addProducts)="pickerState.set(true)" />
        } @else {
          @for (entry of d.entries(); track entry.product.productId; let i = $index) {
            <app-partner-entry-card [draft]="d" [entry]="entry" [money]="money.entries[i] ?? null" [twins]="twins()"
                                    [lastSoldOn]="lastSoldOf(entry.product.productId)" [photoUrl]="photoUrl()" />
          }
        }
      </div>

      <aside class="layout__side">
        @if (desk.active()) {
          <app-segmented class="kinds kinds--desk" label="Soort melding" [options]="kindOptions" [value]="kind" (changed)="pickKind($event)" />
        }
        <label class="date">
          <span class="date__label">{{ kind === 'terugkoop' ? 'Teruggekocht op' : 'Verkocht op' }}</span>
          <span class="date__value">
            <b>{{ day(d.soldOn()) }}</b><app-icon name="chevron-down" [size]="15" />
            <input class="date__input" type="date" [min]="d.earliest()" [max]="d.latest()" [value]="d.soldOn()"
                   [attr.aria-label]="kind === 'terugkoop' ? 'Teruggekocht op' : 'Verkocht op'"
                   (click)="openPicker($event)" (change)="pickDate($any($event.target).value)" />
          </span>
        </label>
        @if (d.dateProblem(); as problem) { <p class="bad" role="alert">{{ problem }}</p> }

        @if (kind === 'direct' && buyerSearch(); as search) {
          <section class="box" aria-label="Klant">
            <span class="box__label">Klant</span>
            <app-partner-buyer-field [value]="d.buyer()" [search]="search" [create]="buyerCreate()" [askVat]="buyerVat()" (changed)="d.buyer.set($event)" />
          </section>
        }

        <section class="box cost" aria-label="Kosten en netto">
          @if (kind !== 'terugkoop') {
            <div class="line"><span>Bruto</span><span class="fig">{{ eur(t.grossEur) }}</span></div>
            @if (kind === 'veiling') {
              <div class="line"><span>Veilingcommissie {{ pct(costs.auctionCommissionPct) }}</span><span class="fig">{{ minus(t.commissionEur) }}</span></div>
              <div class="line"><span>Transport {{ pct(costs.auctionTransportPct) }}</span><span class="fig">{{ minus(t.transportEur) }}</span></div>
            }
            @for (line of d.extraCosts(); track line.key; let i = $index) {
              <div class="extra">
                <div class="extra__top">
                  <input class="extra__desc" type="text" maxlength="80" placeholder="Omschrijving" [attr.aria-label]="'Extra kost ' + (i + 1) + ': omschrijving'"
                         [ngModel]="line.description" (ngModelChange)="d.updateExtra(line.key, { description: $event })" />
                  <button class="x" type="button" [attr.aria-label]="'Extra kost ' + (i + 1) + ' weghalen'" (click)="d.removeExtra(line.key)"><app-icon name="close" [size]="15" /></button>
                </div>
                <div class="extra__row">
                  <app-segmented class="extra__mode" [variant]="desk.active() ? 'desk' : 'ios'" [label]="'Extra kost ' + (i + 1) + ' als'"
                                 [options]="extraModes" [value]="line.mode" (changed)="setMode(line, $event)" />
                  <label class="extra__field">
                    @if (line.mode === 'AMOUNT') { <span aria-hidden="true">€</span> }
                    <input appPartnerMoney #extraField="partnerMoney" [decimals]="line.mode === 'PCT' ? 0 : 2" placeholder="0"
                           [attr.aria-label]="'Extra kost ' + (i + 1) + (line.mode === 'PCT' ? ' in procent' : ' in euro')"
                           [ngModel]="line.value" (ngModelChange)="d.updateExtra(line.key, { value: $event })" />
                    @if (line.mode === 'PCT') { <span aria-hidden="true">%</span> }
                  </label>
                  <span class="fig">{{ minus(money.extraLines[i] ?? 0) }}</span>
                </div>
                @if (extraField.unreadable()) { <p class="bad">Geen getal: typ het als 12,50</p> }
                @else if (d.extraProblemOf(line); as problem) { <p class="bad">{{ problem }}</p> }
              </div>
            }
            @if (d.extraCosts().length < maxExtra) {
              <button class="link" type="button" (click)="d.addExtra()"><app-icon name="plus" [size]="15" />Extra kost</button>
            }
          }
          @if (hasBuyback()) {
            <div class="line"><span>Terugkoopkost<small>incl. commissie en transport</small></span><span class="fig">{{ minus(t.buybackEur) }}</span></div>
          }
          <div class="line line--total"><span>Netto</span><b class="fig" [class.is-neg]="t.netEur < 0">{{ eur(t.netEur) }}</b></div>
          @if (money.costsExceedGross) { <p class="bad" role="alert">De kosten zijn hoger dan de opbrengst</p> }
        </section>

        @if (desk.active()) {
          @if (notice(); as n) {
            <div class="error notice" role="alert"><span>{{ n.text }}</span><button class="notice__btn" type="button" (click)="noticeAction.emit()">{{ n.action }}</button></div>
          } @else if (error()) { <div class="error" role="alert">{{ error() }}</div> }
          <button class="ios-capsule ios-capsule--accent ios-capsule--block send" type="button" [disabled]="!canSend() || busy()" (click)="send()">
            {{ busy() ? 'Bezig…' : submitLabel() }}
          </button>
        }
        @if (hint()) { <p class="hint">{{ hint() }}</p> }
      </aside>
    </div>

    @if (!desk.active()) {
      <div class="bar">
        <!-- A refusal stands right above Opslaan: on the phone the side column is far below the cards. -->
        @if (notice(); as n) {
          <div class="bar__error notice" role="alert"><span>{{ n.text }}</span><button class="notice__btn" type="button" (click)="noticeAction.emit()">{{ n.action }}</button></div>
        } @else if (error()) { <p class="bar__error" role="alert">{{ error() }}</p> }
        <div class="bar__sum"><small>Netto</small><b [class.is-neg]="t.netEur < 0">{{ eur(t.netEur) }}</b></div>
        <button class="ios-capsule ios-capsule--accent bar__send" type="button" [disabled]="!canSend() || busy()" (click)="send()">
          {{ busy() ? 'Bezig…' : submitLabel() }}
        </button>
      </div>
    }
  `,
  styles: `
    /* The two columns follow the form's own width, not the screen's: beside the ERP sidebar a 1070 px screen leaves
       too little for the entry table and the side column together (it then stacks, as on the phone). */
    :host{display:flex;flex-direction:column;min-width:0;container:pe/inline-size}
    .kinds{display:grid;height:44px;margin:0 0 12px}
    .kinds--desk{height:34px;margin:0}
    .layout{display:grid;grid-template-columns:minmax(0,1fr);gap:14px;margin-bottom:16px}
    .layout__main{display:grid;grid-template-columns:minmax(0,1fr);align-content:start;gap:12px;min-width:0;--wk-sticky-top:var(--pp-sticky-top,0px)}
    .layout__side{display:grid;grid-template-columns:minmax(0,1fr);align-content:start;gap:10px;min-width:0}
    /* Stacked on a desk: the side column sits under the table on the right, as a document's totals. */
    @container pe (min-width: 640px) and (max-width: 1007.98px){.layout__side{width:min(100%,420px);justify-self:end}}
    @container pe (min-width: 1008px){
      .layout{grid-template-columns:minmax(0,1fr) 272px;gap:20px;align-items:start}
      .layout__side{position:sticky;top:calc(var(--pp-sticky-top,60px) + 12px)}
    }
    @container pe (min-width: 1120px){.layout{grid-template-columns:minmax(0,1fr) 300px}}
    .pick{border:1px solid var(--line);border-radius:14px;background:var(--surface)}
    .pick__head{display:flex;align-items:center;gap:8px;min-height:44px;padding:0 8px 0 4px}
    .pick__toggle{display:flex;flex:1;align-items:center;gap:8px;min-width:0;min-height:44px;padding:0 8px;border:0;background:none;color:var(--ink);font:inherit;text-align:left;cursor:pointer}
    .pick__toggle[aria-expanded=false] app-icon{transform:rotate(-90deg)}
    .pick__title{font-size:14.5px;font-weight:700}
    .pick__count{overflow:hidden;color:var(--muted);font-size:13px;text-overflow:ellipsis;white-space:nowrap}
    .pick__done{min-height:32px;padding:0 12px;border:1px solid var(--line-strong);border-radius:9px;background:var(--surface);color:var(--ink);font:inherit;font-size:13px;font-weight:650;cursor:pointer}
    .pick__body{max-height:min(440px,52vh);padding:0 12px 12px;overflow:auto;overscroll-behavior:contain;--wk-sticky-top:0px}
    .date{position:relative;display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:44px;padding:0 12px;border:1px solid var(--line);border-radius:12px;background:var(--surface);cursor:pointer}
    .date__label{color:var(--ink-2);font-size:14px;font-weight:600}
    .date__value{position:relative;display:flex;align-items:center;gap:4px;min-height:40px;color:var(--rose-dark);font-size:14.5px}
    .date__value b{font-weight:700}
    .date__input{position:absolute;inset:0;width:100%;height:100%;margin:0;padding:0;border:0;opacity:0;cursor:pointer;font-size:16px}
    .date:focus-within{box-shadow:var(--wk-focus)}
    .box{display:grid;gap:6px;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--surface)}
    .box__label{color:var(--ink-2);font-size:13px;font-weight:700}
    .cost{gap:0;padding:6px 12px 10px}
    .line{display:flex;align-items:baseline;justify-content:space-between;gap:10px;min-height:32px;padding:6px 0;color:var(--ink-2);font-size:13.5px}
    .line small{display:block;color:var(--muted);font-size:11.5px}
    .line--total{margin-top:4px;padding-top:10px;border-top:1px solid var(--line);color:var(--ink);font-size:15px;font-weight:700}
    .line--total .fig{font-size:20px;font-weight:800;letter-spacing:-.02em}
    .fig{color:var(--ink);font-variant-numeric:tabular-nums;white-space:nowrap}
    .is-neg{color:var(--danger)}
    .extra{display:grid;gap:4px;padding:6px 0;border-top:1px dashed var(--line)}
    .extra__top{display:flex;align-items:center;gap:4px}
    .extra__desc{flex:1;min-width:0;height:30px;padding:0 8px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink);font:inherit;font-size:13px;outline:none}
    .extra__desc:focus,.extra__field:focus-within{border-color:var(--rose);box-shadow:var(--wk-focus)}
    .extra__row{display:grid;grid-template-columns:72px minmax(0,1fr) auto;align-items:center;gap:6px}
    .extra__mode{height:30px}
    .extra__field{display:flex;align-items:center;gap:3px;height:30px;padding:0 8px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--muted);font-size:12.5px;font-weight:600}
    .extra__field input{flex:1;min-width:0;height:28px;border:0;background:transparent;color:var(--ink);font:inherit;font-size:13.5px;font-weight:650;outline:none}
    .x{display:grid;flex:none;place-items:center;width:30px;height:30px;padding:0;border:0;border-radius:8px;background:transparent;color:var(--muted);cursor:pointer}
    .x:hover{background:var(--surface-2);color:var(--ink)}
    .link{display:flex;align-items:center;gap:5px;min-height:34px;padding:0;border:0;background:none;color:var(--rose-dark);font:inherit;font-size:13.5px;font-weight:650;cursor:pointer}
    .bad{margin:0;color:var(--danger);font-size:12.5px;font-weight:600}
    .error{padding:10px 12px;border-radius:12px;background:var(--danger-soft);color:#83261e;font-size:13.5px;font-weight:500;line-height:1.4}
    .notice{display:grid;justify-items:start;gap:8px}
    .notice__btn{min-height:34px;padding:0 14px;border:1px solid color-mix(in srgb,#83261e 30%,transparent);border-radius:9px;background:var(--surface);color:#83261e;font:inherit;font-size:13.5px;font-weight:700;cursor:pointer}
    .send{min-height:48px;font-size:16px}
    .hint{margin:0;color:var(--muted);font-size:12.5px;text-align:center}
    .bar{position:sticky;bottom:var(--pp-bar-bottom,0px);z-index:20;display:flex;flex-wrap:wrap;align-items:center;gap:10px 12px;margin:auto calc(-1 * var(--pp-gutter,16px)) 0;padding:10px var(--pp-gutter,16px) calc(10px + var(--pp-bar-safe,var(--safe-b,0px)));border-radius:var(--pp-bar-radius,0);background:var(--ios-glass,rgb(242 239 235/90%));box-shadow:0 -1px 0 rgb(26 22 20/8%)}
    .bar::before{content:'';position:absolute;inset:0;z-index:-1;backdrop-filter:var(--ios-glass-filter,blur(20px));-webkit-backdrop-filter:var(--ios-glass-filter,blur(20px))}
    .bar__error{flex:1 0 100%;max-height:30dvh;margin:0;overflow-y:auto;padding:10px 12px;border-radius:14px;background:var(--danger-soft);color:#83261e;font-size:14.5px;font-weight:500;line-height:1.4}
    .bar__sum{display:grid;flex:1;min-width:0}
    .bar__sum small{color:var(--muted);font-size:12.5px;font-weight:600}
    .bar__sum b{font-size:21px;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums;white-space:nowrap}
    .bar__send{flex:none;min-width:150px;min-height:52px;font-size:17px;font-weight:700}
    .bar__send::before{inset:0}
    @media (max-width: 679.98px), (hover: none) and (max-width: 1023.98px){
      .pick{border:0;border-radius:20px}
      .pick__head{min-height:52px}
      .pick__title{font-size:16px}
      .pick__done{min-height:40px;font-size:15px}
      .pick__body{max-height:none;padding:0 0 8px;overflow:visible;--wk-sticky-top:var(--pp-sticky-top,0px)}
      .date{min-height:52px;padding:0 16px;border:0;border-radius:18px}
      .date__label{font-size:15px}
      .date__value{min-height:44px;font-size:16px}
      .box{padding:12px 16px;border:0;border-radius:18px}
      .box__label{font-size:14px}
      .cost{padding:8px 16px 12px}
      .line{min-height:36px;font-size:15px}
      .line--total .fig{font-size:22px}
      .extra__desc,.extra__field{height:44px;font-size:16px;border-radius:12px}
      .extra__field input{height:42px;font-size:17px}
      .extra__row{grid-template-columns:104px minmax(0,1fr) auto}
      .extra__mode{height:44px}
      .x{width:44px;height:44px}
      .link{min-height:44px;font-size:15px}
      .hint{font-size:13.5px}
      .notice__btn{min-height:44px;font-size:15px}
    }
  `,
})
export class PartnerEntry implements OnInit {
  private readonly ui = inject(Ui);
  readonly desk = inject(DesktopViewport);

  readonly draft = input.required<MeldingDraft>();
  /** The stock there: what a sale can take, and the products offered on Veiling and Direct. */
  readonly stock = input<readonly PartnerStockTile[]>([]);
  /** Recent sales: the products offered on Terugkoop, and the last average the price check compares with. */
  readonly recent = input<readonly PartnerRecentSale[]>([]);
  /** Today (yyyy-mm-dd, the server's): the date row's "Vandaag". */
  readonly today = input('');
  readonly photoUrl = input<PhotoUrlFn>(partnerPhoto);
  readonly submitLabel = input('Opslaan');
  /** Whether the product choice starts open; null: open while no product is on the form. */
  readonly startPicking = input<boolean | null>(null);
  /** Sends the body; a refusal's message is shown in place, the draft stays for a retry (same clientRef). */
  readonly submit = input.required<(body: PartnerReportRequest) => Promise<PartnerReportResult>>();
  /** Klant of a direct sale: the screen's customer search; without it the field is not shown. */
  readonly buyerSearch = input<BuyerSearchFn | null>(null);
  /** "Niet gevonden? Nieuwe klant": the screen's customer creation; without it only the search shows. */
  readonly buyerCreate = input<BuyerCreateFn | null>(null);
  /** Staff: the new-customer form asks the VAT number too. */
  readonly buyerVat = input(false);
  /** Shown instead of a refusal, with its action (e.g. the melding changed meanwhile: load the new version); Opslaan waits. */
  readonly notice = input<EntryNotice | null>(null);
  readonly noticeAction = output<void>();
  readonly done = output<PartnerReportResult>();
  /** Opslaan was refused (shown in place): the screen may read the stock again, the rows then say which is too many. */
  readonly refused = output<void>();
  readonly kindChanged = output<PartnerKind>();

  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  /** The product choice open or folded; null until the form is shown. */
  readonly pickerState = signal<boolean | null>(null);
  readonly pickerOpen = computed(() => this.pickerState() ?? this.draft().entries().length === 0);

  readonly kindOptions: SegmentOption[] = PARTNER_KINDS.map((kind) => ({ id: kind, label: KIND_SHORT[kind] }));
  readonly extraModes: SegmentOption[] = [{ id: 'AMOUNT', label: '€' }, { id: 'PCT', label: '%' }];
  readonly maxExtra = MAX_EXTRA_LINES;

  constructor() {
    /* A refusal is about what was sent: once the form changes it goes (a row still too many says so itself). */
    effect(() => {
      const draft = this.draft();
      draft.entries(); draft.soldOn(); draft.extraCosts(); draft.buyer(); draft.kind();
      untracked(() => this.error.set(null));
    });
  }

  ngOnInit(): void {
    const start = this.startPicking();
    this.pickerState.set(start ?? this.draft().entries().length === 0);
  }

  private readonly recentById = computed(() => new Map(this.recent().map((tile) => [tile.productId, tile])));

  readonly hasBuyback = computed(() => {
    const draft = this.draft();
    return draft.kind() === 'terugkoop' || (draft.kind() === 'veiling' && draft.entries().some((entry) => entry.buybackOpen));
  });

  /**
   * What the product choice lists: the stock (plus the products sold recently that have none left, behind "Alleen
   * met voorraad"), or for Terugkoop the recent sales; the products already on the form always stay listed.
   */
  readonly pickList = computed<TableProduct[]>(() => {
    const draft = this.draft();
    const terugkoop = draft.kind() === 'terugkoop';
    const list: TableProduct[] = [];
    const seen = new Set<number>();
    const push = (tile: TableProduct) => { if (!seen.has(tile.productId)) { seen.add(tile.productId); list.push(tile); } };
    const stockById = new Map(this.stock().map((tile) => [tile.productId, tile]));
    if (terugkoop) {
      for (const tile of this.recent()) push({ ...tile, quantity: undefined, lastSoldOn: tile.lastSoldOn });
    } else {
      for (const tile of this.stock()) push({ ...tile, quantity: this.limitOf(tile.productId) ?? tile.quantity });
      for (const tile of this.recent()) push({ ...tile, quantity: this.limitOf(tile.productId) ?? 0, lastSoldOn: tile.lastSoldOn });
    }
    for (const entry of draft.entries()) {
      const product: PartnerProductTile = entry.product;
      push(terugkoop ? { ...product } : { ...product, quantity: this.limitOf(product.productId) ?? stockById.get(product.productId)?.quantity ?? 0 });
    }
    return list;
  });

  readonly selectedIds = computed(() => new Set(this.draft().entries().map((entry) => entry.product.productId)));

  /** Names and colours more than one product shares, over everything the form can show. */
  readonly twins = computed(() => twinKeys([...this.stock(), ...this.recent(), ...this.draft().entries().map((entry) => entry.product)]));

  /** A sale cannot pick a product with nothing there to sell. */
  readonly blockedIds = computed<ReadonlySet<number>>(() => {
    if (this.draft().kind() === 'terugkoop') return new Set();
    return new Set(this.pickList().filter((item) => !(item.quantity && item.quantity > 0)).map((item) => item.productId));
  });

  readonly chosenLine = computed(() => {
    const entries = this.draft().entries();
    if (!entries.length) return 'kies wat je verkocht';
    const twins = this.twins();
    const names = entries.slice(0, 2).map((entry) => twinTitle(entry.product, twins)).join(', ');
    return `${entries.length} gekozen · ${names}${entries.length > 2 ? ' …' : ''}`;
  });

  /** One line of what still stops Opslaan, once products are on the form. */
  readonly hint = computed<string | null>(() => {
    const draft = this.draft();
    if (!draft.entries().length) return draft.kind() === 'terugkoop' ? 'Kies wat je terugkocht.' : 'Kies de producten die je verkocht.';
    if (!draft.filled()) {
      return draft.kind() === 'terugkoop' ? 'Vul bij elk product het aantal en de klokprijs in.' : 'Vul bij elk product het aantal en de prijs in.';
    }
    if (draft.buyerProblem()) return draft.buyerProblem();
    return draft.editing() && !draft.dirty() && !this.notice() ? 'Nog niets gewijzigd.' : null;
  });

  /** Complete, and an edit holds a change (an untouched edit has nothing to save); a notice waits for its action. */
  readonly canSend = computed(() => this.draft().complete() && (!this.draft().editing() || this.draft().dirty()) && !this.notice());

  private limitOf(productId: number): number | null {
    return this.draft().saleLimit(productId);
  }

  lastSoldOf(productId: number): string | null {
    return this.recentById().get(productId)?.lastSoldOn ?? null;
  }

  pickKind(value: string): void {
    const kind = parseKind(value);
    if (kind === this.draft().kind()) return;
    this.draft().kind.set(kind);
    this.error.set(null);
    this.kindChanged.emit(kind);
  }

  setMode(line: DraftExtraLine, mode: string): void {
    this.draft().updateExtra(line.key, { mode: mode === 'PCT' ? 'PCT' : 'AMOUNT' });
  }

  /** Desks open the calendar on a click anywhere on the row (a phone does on its own). */
  openPicker(event: Event): void {
    const field = event.target as HTMLInputElement & { showPicker?: () => void };
    try { field.showPicker?.(); } catch { /* already open, or not allowed here: the field itself still works */ }
  }

  pickDate(value: string): void {
    const draft = this.draft();
    if (!value) { draft.soldOn.set(draft.latest() || this.today()); return; }
    draft.soldOn.set(value);
  }

  async send(): Promise<void> {
    const draft = this.draft();
    if (this.busy() || !this.canSend()) return;
    const jump = this.priceJump();
    if (jump) {
      this.ui.confirm({ title: 'Klopt de prijs?', message: jump, confirmLabel: 'Ja, opslaan' }, () => void this.post());
      return;
    }
    await this.post();
  }

  /** The first piece price more than 5x the partner's last average per piece for that product, as the question. */
  private priceJump(): string | null {
    const draft = this.draft();
    if (draft.kind() === 'terugkoop') return null;
    for (const entry of draft.entries()) {
      const last = this.recentById().get(entry.product.productId)?.lastAverageEur ?? null;
      const lastPiece = last == null ? null : last / piecesPerSalesUnit(entry.product);
      const price = piecePriceOf({ salesUnits: draft.salesUnits(entry, 'sale'), piecesPerSalesUnit: piecesPerSalesUnit(entry.product), piecePrice: entry.sale.price });
      if (lastPiece != null && lastPiece > 0 && price != null && price > PRICE_JUMP * lastPiece) {
        const noun = escapeHtml(pieceUnit(entry.product).one);
        return `${escapeHtml(twinTitle(entry.product, this.twins()))}: ${euro(price)} per ${noun}. De vorige keer was dat ${euro(lastPiece)}.`;
      }
    }
    return null;
  }

  private async post(): Promise<void> {
    const draft = this.draft();
    if (this.busy() || !draft.complete()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const result = await this.submit()(draft.request());
      this.done.emit(result);
    } catch (failure: unknown) {
      this.error.set(messageOf(failure, 'Opslaan lukt nu niet. Probeer het opnieuw.'));
      this.refused.emit();
    } finally {
      this.busy.set(false);
    }
  }

  day(iso: string): string {
    return dayLabel(iso, this.draft().latest() || this.today());
  }

  eur(value: number): string {
    return euro(value);
  }

  minus(value: number): string {
    return minusEuro(value);
  }

  pct(value: number): string {
    return percent(value);
  }
}
