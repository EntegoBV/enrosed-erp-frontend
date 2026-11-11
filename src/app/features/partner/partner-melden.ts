import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Auth } from '../../core/api/auth';
import { messageOf } from '../../core/api/errors';
import { PartnerPortalApi, PartnerReportRequest, PartnerReportResult } from '../../core/api/partner-portal-api';
import type { HasUnsavedChanges } from '../../core/guards/unsaved-changes.guard';
import { Icon } from '../../shared/icon';
import { LOAD_ERROR_FALLBACK, LoadError } from '../../shared/load-error';
import { Skeleton } from '../../shared/skeleton';
import { Ui } from '../../shared/ui';
import { PartnerData } from './partner-data';
import { MeldingDraft } from './partner-draft';
import { PartnerEntry } from './partner-entry';
import {
  KIND_LABEL, PartnerKind, addDays, count, euro, longDate, parseKind, productTitle, reportKind, units,
} from './partner-format';
import { GridProduct, PartnerGrid } from './partner-grid';
import { PartnerHead } from './partner-head';

type Step = 1 | 2 | 3;

/** How far back a melding may be dated (the server's rule). */
const DAYS_BACK = 90;

/**
 * Melden, in one screen with three steps in the address (?soort=…&stap=…),
 * so a swipe back goes a step back and keeps what was typed:
 * 1 Kies de producten (the stock, or for Terugkoop the recent sales),
 * 2 the form (app-partner-entry), 3 Gemeld with the summary.
 * A stock tile on the home comes in at step 2 with ?product=<id>.
 */
@Component({
  selector: 'app-partner-melden',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, LoadError, Skeleton, PartnerEntry, PartnerGrid, PartnerHead],
  template: `
    @let o = data.overview();
    @if (step() === 3 && result(); as done) {
      @let r = done.report;
      <section class="done" aria-live="polite">
        <span class="done__check" aria-hidden="true"><app-icon name="tick" [size]="40" /></span>
        <h1 class="done__title">Gemeld</h1>
        <p class="done__sub">{{ r.number }} · {{ kindLabel(r) }} · {{ date(r.soldOn) }}</p>
        @if (done.existing) { <p class="done__note">Deze melding was al binnen; er is niets dubbel geboekt.</p> }
        <div class="done__list">
          @for (entry of r.entries; track entry.productId) {
            <div class="done__row">
              <span class="done__name">{{ title(entry) }}</span>
              <span class="done__fact">
                @if (entry.sale; as sale) { {{ unitsOf(entry, sale.quantity) }} · gem. {{ eur(sale.unitPriceEur) }} }
                @if (entry.sale && entry.buyback) { · }
                @if (entry.buyback; as buyback) { {{ unitsOf(entry, buyback.quantity) }} terug }
              </span>
            </div>
          }
          <div class="done__total"><span>Netto</span><b>{{ eur(r.totals.netEur) }}</b></div>
        </div>
        <div class="done__actions">
          <button class="ios-capsule ios-capsule--tinted ios-capsule--block" type="button" (click)="another()">Nog een melding</button>
          <button class="ios-capsule ios-capsule--accent ios-capsule--block" type="button" (click)="home()">Naar overzicht</button>
        </div>
      </section>
    } @else if (!o) {
      <app-partner-head [title]="kindTitle()" backLabel="Terug naar overzicht" (back)="home()" />
      @if (data.failure()) {
        <app-load-error [message]="failureText()" [busy]="data.loading()" (retry)="reload()" />
      } @else {
        <app-skeleton kind="card" [rows]="3" />
      }
    } @else if (step() === 1) {
      <app-partner-head title="Kies de producten" [sub]="kindTitle()" backLabel="Terug naar overzicht" (back)="home()" />
      <app-partner-grid [items]="pickList()" [selectable]="true" [selected]="selectedIds()"
                        [emptyText]="kind() === 'terugkoop' ? 'Geen verkopen van de laatste 60 dagen. Meld eerst de verkoop op de veiling.' : 'Er ligt nu geen voorraad.'"
                        (picked)="draft.toggle($event)" />
      <div class="bar">
        <span class="bar__count">{{ chosen() }} gekozen</span>
        <button class="ios-capsule ios-capsule--accent bar__next" type="button" [disabled]="!chosen()" (click)="next()">Verder</button>
      </div>
    } @else {
      <app-partner-head title="Melden" backLabel="Terug" (back)="back()" />
      <app-partner-entry [draft]="draft" [stock]="o.stock" [recent]="o.recentSales" [today]="o.serverDate"
                         [submit]="send" (done)="sent($event)" (kindChanged)="kindChanged($event)" />
    }
  `,
  styles: `
    /* The page fills the screen, so a bottom bar stands at the bottom also under a short list. */
    :host{display:flex;flex-direction:column;min-height:calc(100dvh - var(--pp-head-h,60px) - 8px)}
    app-partner-entry{flex:1}
    .bar{position:sticky;bottom:0;z-index:20;display:flex;align-items:center;gap:12px;margin:auto calc(-1 * var(--pp-gutter,16px)) 0;padding:10px var(--pp-gutter,16px) calc(10px + var(--safe-b,0px));background:var(--ios-glass,rgb(242 239 235/90%));box-shadow:0 -1px 0 rgb(26 22 20/8%)}
    .bar::before{content:'';position:absolute;inset:0;z-index:-1;backdrop-filter:var(--ios-glass-filter,blur(20px));-webkit-backdrop-filter:var(--ios-glass-filter,blur(20px))}
    .bar__count{flex:1;font-size:17px;font-weight:700}
    app-partner-grid{margin-bottom:16px}
    .bar__next{min-width:150px;min-height:52px;font-size:17px;font-weight:700}
    .bar__next::before{inset:0}
    .done{display:grid;justify-items:center;gap:6px;max-width:560px;margin:12px auto 0;padding-bottom:calc(24px + var(--safe-b,0px));text-align:center}
    .done__check{display:grid;place-items:center;width:84px;height:84px;margin-bottom:6px;border-radius:50%;background:var(--rose);color:#fff;box-shadow:0 10px 26px color-mix(in srgb,var(--rose) 35%,transparent)}
    .done__title{margin:0;font-size:30px;font-weight:800;letter-spacing:-.03em}
    .done__sub{margin:0;color:var(--muted);font-size:15px}
    .done__note{margin:4px 0 0;color:var(--ink-2);font-size:14px}
    .done__list{display:grid;width:100%;margin-top:14px;padding:6px 16px 10px;border-radius:20px;background:var(--surface);text-align:left}
    .done__row{display:grid;gap:2px;padding:10px 0;box-shadow:inset 0 -.5px 0 var(--ios-sep,rgb(60 50 45/16%))}
    .done__name{font-size:15.5px;font-weight:650}
    .done__fact{color:var(--muted);font-size:14px}
    .done__total{display:flex;align-items:baseline;justify-content:space-between;padding-top:12px;font-size:17px;font-weight:700}
    .done__total b{font-size:22px;font-weight:800}
    .done__actions{display:grid;gap:10px;width:100%;margin-top:16px}
    @media (min-width: 1024px), (min-width: 680px) and (hover: hover){.done__actions{grid-template-columns:1fr 1fr}}
  `,
})
export class PartnerMelden implements HasUnsavedChanges {
  readonly data = inject(PartnerData);
  private readonly api = inject(PartnerPortalApi);
  private readonly auth = inject(Auth);
  private readonly ui = inject(Ui);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly location = inject(Location);

  /** Query parameters (withComponentInputBinding). */
  readonly soort = input<string | undefined>();
  readonly stap = input<string | undefined>();
  readonly product = input<string | undefined>();

  readonly draft = new MeldingDraft();
  readonly result = signal<PartnerReportResult | null>(null);
  readonly kind = computed<PartnerKind>(() => parseKind(this.soort()));
  readonly step = computed<Step>(() => (this.stap() === '3' ? 3 : this.stap() === '2' ? 2 : 1));
  readonly kindTitle = computed(() => KIND_LABEL[this.kind()]);
  readonly failureText = computed(() => messageOf(this.data.failure(), LOAD_ERROR_FALLBACK));

  readonly pickList = computed<readonly GridProduct[]>(() =>
    this.kind() === 'terugkoop' ? this.data.recentSales() : this.data.stock());
  readonly selectedIds = computed(() => new Set(this.draft.entries().map((entry) => entry.product.productId)));
  readonly chosen = computed(() => this.draft.entries().length);

  /** The product of a stock tap, added once the overview is there. */
  private pendingProduct: number | null = null;
  private productTaken = false;

  /** Sends the partner's melding (the entry component calls this, and shows a refusal in place). */
  readonly send = (body: PartnerReportRequest): Promise<PartnerReportResult> => this.api.createReport(body);

  constructor() {
    /* Every Melden reads the stock and today afresh (the portal may have stood open since yesterday); the last overview shows meanwhile. */
    void this.data.load();

    /* The address decides the kind and the step; a step that has nothing to show goes back one (in place). */
    effect(() => {
      const kind = this.kind();
      const step = this.step();
      const product = Number(this.product());
      untracked(() => {
        /* Once products are on the form its kind is what he chose last (on step 2): an older history entry (back to
           step 1) never puts the old kind back; the address follows the form instead. */
        if (step !== 3 && this.draft.entries().length && kind !== this.draft.kind()) this.followKind();
        else this.draft.kind.set(kind);
        if (!this.productTaken && Number.isSafeInteger(product) && product > 0) this.pendingProduct = product;
        this.productTaken = true;
        /* Back from Gemeld (or a fresh step 1/2 after it): a new melding. */
        if (step !== 3 && this.result()) { this.result.set(null); this.draft.reset(this.data.overview()?.serverDate); }
        if (step === 3 && !this.result()) this.go(this.draft.entries().length ? 2 : 1, true);
      });
    });

    /* With the overview: the costs, the stock limits, the date range, the tapped product; an empty step 2 goes to 1. */
    effect(() => {
      const overview = this.data.overview();
      const step = this.step();
      if (!overview) return;
      untracked(() => {
        this.draft.costs.set(overview.costs);
        this.draft.saleLimits.set(new Map(overview.stock.map((tile) => [tile.productId, tile.quantity])));
        this.draft.saleLimitOtherwise.set(0);
        this.draft.setToday(overview.serverDate, addDays(overview.serverDate, -DAYS_BACK));
        if (this.pendingProduct != null) {
          const id = this.pendingProduct;
          this.pendingProduct = null;
          const tile = overview.stock.find((item) => item.productId === id)
            ?? overview.recentSales.find((item) => item.productId === id);
          if (tile) this.draft.add(tile);
        }
        /* Not right after Melden: the draft is already empty while the way to Gemeld is under way. */
        if (step === 2 && !this.result() && !this.draft.entries().length) this.go(1, true);
      });
    });
  }

  canDeactivate(): boolean | Promise<boolean> {
    /* Signed out underneath (a 401): nothing can be sent any more, so nothing is kept back. */
    if (!this.draft.dirty() || !this.auth.isLoggedIn()) return true;
    return new Promise<boolean>((resolve) => {
      this.ui.confirm(
        { title: 'Melding nog niet verstuurd', message: 'Wat je invulde gaat verloren.', confirmLabel: 'Niet melden', danger: true },
        () => resolve(true), undefined, () => resolve(false),
      );
    });
  }

  next(): void {
    if (this.chosen()) this.go(2);
  }

  /** Step 2's back: to step 1 when it came from there, else where it came from (the home). */
  back(): void {
    if (this.route.snapshot.queryParamMap.get('product') === null) { this.location.back(); return; }
    void this.router.navigate(['/partner']);
  }

  kindChanged(kind: PartnerKind): void {
    void this.router.navigate([], {
      relativeTo: this.route, queryParams: { soort: kind }, queryParamsHandling: 'merge', replaceUrl: true,
    });
  }

  /** The address takes the form's kind (in place), so the step's title, its list and the next step agree with it. */
  private followKind(): void {
    void this.router.navigate([], {
      relativeTo: this.route, queryParams: { soort: this.draft.kind() }, queryParamsHandling: 'merge', replaceUrl: true,
    });
  }

  sent(result: PartnerReportResult): void {
    this.result.set(result);
    this.draft.reset(this.data.overview()?.serverDate);
    this.data.upsertReport(result.report);
    void this.data.load();
    this.go(3, true);
  }

  another(): void {
    this.result.set(null);
    this.draft.reset(this.data.overview()?.serverDate);
    void this.data.load();
    void this.router.navigate([], { relativeTo: this.route, queryParams: { soort: this.draft.kind(), stap: 1 }, replaceUrl: true });
  }

  home(): void {
    void this.router.navigate(['/partner']);
  }

  reload(): void {
    void this.data.load();
  }

  private go(step: Step, replace = false): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { soort: this.draft.kind(), stap: step, product: step === 2 ? this.route.snapshot.queryParamMap.get('product') : null },
      replaceUrl: replace,
    });
  }

  kindLabel(report: PartnerReportResult['report']): string { return KIND_LABEL[reportKind(report)]; }
  title(entry: { name: string; variant: string | null }): string { return productTitle(entry); }
  unitsOf(entry: { unitOne: string; unitOther: string }, quantity: number): string { return units(quantity, entry); }
  eur(value: number): string { return euro(value); }
  num(value: number): string { return count(value); }
  date(iso: string): string { return longDate(iso); }
}
