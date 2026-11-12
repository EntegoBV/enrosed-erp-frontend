import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Auth } from '../../core/api/auth';
import { messageOf } from '../../core/api/errors';
import {
  PARTNER_API_VERSION, PartnerBuyerRequest, PartnerPortalApi, PartnerReport, PartnerReportBuyback, PartnerReportEntry,
  PartnerReportRequest, PartnerReportResult, PartnerReportSale,
} from '../../core/api/partner-portal-api';
import type { HasUnsavedChanges } from '../../core/guards/unsaved-changes.guard';
import { Icon } from '../../shared/icon';
import { LOAD_ERROR_FALLBACK, LoadError } from '../../shared/load-error';
import { Skeleton } from '../../shared/skeleton';
import { Ui } from '../../shared/ui';
import { PartnerData } from './partner-data';
import { MeldingDraft } from './partner-draft';
import { PartnerEntry } from './partner-entry';
import { KIND_LABEL, PartnerKind, addDays, euro, longDate, parseKind, priceEuro, productTitle, reportKind } from './partner-format';
import { PartnerHead } from './partner-head';
import { canEditReport, partCount, partPiecePrice, partnerStatus, pieceNoun } from './partner-report-format';
import { twinTitle } from './partner-twins';

/** How far back a melding may be dated (the server's rule). */
const DAYS_BACK = 90;

/** Said when the server is still round 1 (the deploy window): nothing round-2 is sent to it. */
export const SERVER_UPDATING = 'De server wordt bijgewerkt; probeer het zo opnieuw.';

/**
 * Melden: one page (desk first) with the product choice, the products as an
 * entry table and the side column; ?soort=veiling|direct|terugkoop picks the
 * kind, ?product=<id> (Melden on a stock row) puts that product on the form,
 * ?bewerk=<id> loads a saved melding to change it (while Enrosed has not
 * confirmed it). A new melding ends on "Opgeslagen" with its summary; an edit
 * goes back to the Meldingen.
 */
@Component({
  selector: 'app-partner-melden',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, LoadError, Skeleton, PartnerEntry, PartnerHead],
  template: `
    @let o = data.overview();
    @if (result(); as done) {
      @let r = done.report;
      <section class="done" aria-live="polite">
        <span class="done__check" aria-hidden="true"><app-icon name="tick" [size]="36" /></span>
        <h1 class="done__title">Opgeslagen</h1>
        <p class="done__sub">{{ r.number }} · {{ kindLabel(r) }} · {{ date(r.soldOn) }}</p>
        @if (done.existing) { <p class="done__note">Deze melding was al binnen; er is niets dubbel geboekt.</p> }
        <div class="done__list">
          @for (entry of r.entries; track entry.productId) {
            <div class="done__row">
              <span class="done__name">{{ title(entry) }}</span>
              <span class="done__fact">
                @if (entry.sale; as sale) { {{ countOf(entry, sale) }} · {{ price(piecePrice(entry, sale)) }} per {{ noun(entry) }} }
                @if (entry.sale && entry.buyback) { · }
                @if (entry.buyback; as buyback) { {{ countOf(entry, buyback) }} terug }
              </span>
            </div>
          }
          <div class="done__total"><span>Netto</span><b>{{ eur(r.totals.netEur) }}</b></div>
        </div>
        <p class="done__hint">Je kunt ze wijzigen tot Enrosed ze bevestigt.</p>
        <div class="done__actions">
          <button class="ios-capsule ios-capsule--tinted ios-capsule--block" type="button" (click)="another()">Nog een melding</button>
          <button class="ios-capsule ios-capsule--accent ios-capsule--block" type="button" (click)="toList()">Naar meldingen</button>
        </div>
      </section>
    } @else {
      <app-partner-head [title]="headTitle()" [sub]="headSub()" />
      @if (!o || editLoading()) {
        @if (data.failure() && !o) {
          <app-load-error [message]="failureText()" [busy]="data.loading()" (retry)="reload()" />
        } @else {
          <app-skeleton kind="card" [rows]="3" />
        }
      } @else if (editFailure(); as failure) {
        <app-load-error [message]="failure" [busy]="editLoading()" (retry)="loadEdit()" />
      } @else if (locked(); as why) {
        <div class="locked">
          <p>{{ why }}</p>
          <button class="ios-capsule ios-capsule--tinted" type="button" (click)="toList()">Naar meldingen</button>
        </div>
      } @else {
        <app-partner-entry [draft]="draft" [stock]="o.stock" [recent]="o.recentSales" [today]="o.serverDate"
                           [startPicking]="startPicking" [submit]="send" [buyerSearch]="findBuyers" [buyerCreate]="addBuyer"
                           (done)="sent($event)" (refused)="reload()" (kindChanged)="kindChanged($event)" />
      }
    }
  `,
  styles: `
    :host{display:flex;flex-direction:column;min-height:calc(100dvh - var(--pp-sticky-top,60px) - 8px)}
    app-partner-entry{flex:1}
    .locked{display:grid;justify-items:start;gap:12px;max-width:560px;padding:18px 20px;border:1px solid var(--line);border-radius:14px;background:var(--surface)}
    .locked p{margin:0;color:var(--ink-2);font-size:15px;line-height:1.45}
    .done{display:grid;justify-items:center;gap:6px;max-width:560px;margin:16px auto 0;padding-bottom:calc(24px + var(--safe-b,0px));text-align:center}
    .done__check{display:grid;place-items:center;width:72px;height:72px;margin-bottom:6px;border-radius:50%;background:var(--rose);color:#fff;box-shadow:0 10px 26px color-mix(in srgb,var(--rose) 35%,transparent)}
    .done__title{margin:0;font-size:28px;font-weight:800;letter-spacing:-.03em}
    .done__sub{margin:0;color:var(--muted);font-size:15px}
    .done__note,.done__hint{margin:4px 0 0;color:var(--ink-2);font-size:14px}
    .done__list{display:grid;width:100%;margin-top:14px;padding:6px 16px 10px;border:1px solid var(--line);border-radius:16px;background:var(--surface);text-align:left}
    .done__row{display:grid;gap:2px;padding:10px 0;box-shadow:inset 0 -.5px 0 var(--ios-sep,rgb(60 50 45/16%))}
    .done__name{font-size:15px;font-weight:650}
    .done__fact{color:var(--muted);font-size:13.5px}
    .done__total{display:flex;align-items:baseline;justify-content:space-between;padding-top:12px;font-size:16px;font-weight:700}
    .done__total b{font-size:21px;font-weight:800}
    .done__actions{display:grid;gap:10px;width:100%;margin-top:14px}
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

  /** Query parameters (withComponentInputBinding). */
  readonly soort = input<string | undefined>();
  readonly product = input<string | undefined>();
  readonly bewerk = input<string | undefined>();

  readonly draft = new MeldingDraft();
  readonly result = signal<PartnerReportResult | null>(null);
  /** The melding being edited as the server answered it. */
  readonly editReport = signal<PartnerReport | null>(null);
  readonly editLoading = signal(false);
  readonly editFailure = signal<string | null>(null);
  readonly failureText = computed(() => messageOf(this.data.failure(), LOAD_ERROR_FALLBACK));
  /** A new melding opens the product choice; Melden on a stock row or an edit starts with the form. */
  readonly startPicking: boolean;

  readonly editId = computed(() => {
    const id = Number(this.bewerk());
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  });

  readonly headTitle = computed(() => {
    const report = this.editReport();
    return this.editId() !== null ? (report ? `${report.number} wijzigen` : 'Melding wijzigen') : 'Melden';
  });

  readonly headSub = computed(() => {
    const report = this.editReport();
    if (!report || this.editId() === null) return null;
    return `${partnerStatus(report).label} · ${KIND_LABEL[reportKind(report)].toLowerCase()} · ${longDate(report.soldOn)}`;
  });

  /** Why a loaded melding cannot be changed here (the server decides with canEdit). */
  readonly locked = computed<string | null>(() => {
    const report = this.editReport();
    if (this.editId() === null || !report) return null;
    if (canEditReport(report)) return null;
    if (report.status === 'VOIDED') return 'Deze melding is ingetrokken.';
    if (report.status !== 'OPEN') return 'Deze melding is al (deels) gefactureerd; vraag Enrosed om een wijziging.';
    if (report.confirmed) return 'Enrosed heeft deze melding al bevestigd; vraag Enrosed om een wijziging.';
    if (report.canEdit === undefined) return SERVER_UPDATING;
    return 'Een latere terugkoop hoort bij deze melding. Maak die eerst ongedaan.';
  });

  /** The product of a Melden on a stock row, added once the overview is there. */
  private pendingProduct: number | null = null;
  private loadedEdit: number | null = null;
  private editRun = 0;

  /** Sends the melding: new (POST) or the edit (PUT); never a round-2 body to a round-1 server. */
  readonly send = (body: PartnerReportRequest): Promise<PartnerReportResult> => {
    if ((this.data.overview()?.apiVersion ?? 1) < PARTNER_API_VERSION) return Promise.reject({ status: 503, error: { message: SERVER_UPDATING } });
    const editing = this.draft.editing();
    return editing ? this.api.updateReport(editing.id, body) : this.api.createReport(body);
  };

  readonly findBuyers = (query: string) => this.api.customers(query);
  readonly addBuyer = (body: PartnerBuyerRequest) => this.api.createCustomer(body);

  constructor() {
    this.draft.buyerRequired.set(true);
    const params = this.route.snapshot.queryParamMap;
    this.startPicking = !params.get('product') && !params.get('bewerk');
    /* Every Melden reads the stock and today afresh (the portal may have stood open since yesterday). */
    void this.data.load();

    /* The kind from the address (a new melding only: an edit takes the melding's own). */
    effect(() => {
      const kind = parseKind(this.soort());
      untracked(() => { if (!this.draft.editing() && this.editId() === null) this.draft.kind.set(kind); });
    });

    /* ?bewerk=<id>: load that melding; without it, a new melding (once an edit was shown). */
    effect(() => {
      const id = this.editId();
      untracked(() => {
        if (id === this.loadedEdit) return;
        this.loadedEdit = id;
        this.result.set(null);
        if (id === null) {
          this.editReport.set(null);
          this.editFailure.set(null);
          this.draft.reset(this.data.overview()?.serverDate);
          this.draft.kind.set(parseKind(this.soort()));
          this.applyOverview();
        } else {
          void this.loadEdit();
        }
      });
    });

    /* Melden on a stock row: that product, once. */
    const product = Number(params.get('product'));
    if (Number.isSafeInteger(product) && product > 0 && !params.get('bewerk')) this.pendingProduct = product;

    /* With every overview: the costs, the limits (an edit adds its own old quantities), the date range. */
    effect(() => {
      const overview = this.data.overview();
      if (!overview) return;
      untracked(() => this.applyOverview());
    });
  }

  private applyOverview(): void {
    const overview = this.data.overview();
    if (!overview) return;
    this.draft.costs.set(overview.costs);
    this.draft.applyStock(new Map(overview.stock.map((tile) => [tile.productId, tile.quantity])), 0);
    this.draft.setToday(overview.serverDate, addDays(overview.serverDate, -DAYS_BACK));
    if (this.pendingProduct != null) {
      const id = this.pendingProduct;
      this.pendingProduct = null;
      const tile = overview.stock.find((item) => item.productId === id) ?? overview.recentSales.find((item) => item.productId === id);
      if (tile) this.draft.add(tile);
    }
  }

  /** Reads the melding of ?bewerk and puts it on the form. */
  async loadEdit(): Promise<void> {
    const id = this.editId();
    if (id === null) return;
    const run = ++this.editRun;
    this.editLoading.set(true);
    this.editFailure.set(null);
    try {
      const report = await this.api.report(id);
      if (run !== this.editRun) return;
      this.editReport.set(report);
      this.draft.reset(this.data.overview()?.serverDate);
      this.draft.loadReport(report);
      this.applyOverview();
    } catch (failure: unknown) {
      if (run !== this.editRun) return;
      const status = (failure as { status?: number } | null)?.status;
      this.editFailure.set(status === 404 ? 'Deze melding bestaat niet (meer).' : messageOf(failure, 'De melding laden lukt nu niet.'));
    } finally {
      if (run === this.editRun) this.editLoading.set(false);
    }
  }

  canDeactivate(): boolean | Promise<boolean> {
    /* Signed out underneath (a 401): nothing can be sent any more, so nothing is kept back. */
    if (!this.draft.dirty() || !this.auth.isLoggedIn()) return true;
    const editing = this.draft.editing();
    return new Promise<boolean>((resolve) => {
      this.ui.confirm(
        editing
          ? { title: 'Wijziging nog niet opgeslagen', message: `Wat je in ${editing.number} wijzigde gaat verloren.`, confirmLabel: 'Niet opslaan', danger: true }
          : { title: 'Melding nog niet opgeslagen', message: 'Wat je invulde gaat verloren.', confirmLabel: 'Niet opslaan', danger: true },
        () => resolve(true), undefined, () => resolve(false),
      );
    });
  }

  kindChanged(kind: PartnerKind): void {
    if (this.draft.editing()) return;
    void this.router.navigate([], { relativeTo: this.route, queryParams: { soort: kind }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  sent(result: PartnerReportResult): void {
    const editing = this.draft.editing();
    this.data.upsertReport(result.report);
    void this.data.load();
    if (editing) {
      this.draft.markSaved();
      this.ui.toast(`${result.report.number} opgeslagen`);
      this.toList();
      return;
    }
    this.result.set(result);
    this.draft.reset(this.data.overview()?.serverDate);
  }

  another(): void {
    this.result.set(null);
    this.draft.reset(this.data.overview()?.serverDate);
    this.applyOverview();
    void this.data.load();
    void this.router.navigate([], { relativeTo: this.route, queryParams: { soort: this.draft.kind() }, replaceUrl: true });
  }

  toList(): void {
    void this.router.navigate(['/partner/meldingen']);
  }

  /** A retry of the overview, and after a refusal: the stock may have changed meanwhile (the rows then say where). */
  reload(): void {
    void this.data.load();
  }

  kindLabel(report: PartnerReport): string { return KIND_LABEL[reportKind(report)]; }
  title(entry: PartnerReportEntry): string { return twinTitle(entry, this.data.twins()); }
  countOf(entry: PartnerReportEntry, part: PartnerReportSale | PartnerReportBuyback): string { return partCount(entry, part); }
  piecePrice(entry: PartnerReportEntry, part: PartnerReportSale | PartnerReportBuyback): number { return partPiecePrice(entry, part); }
  noun(entry: PartnerReportEntry): string { return pieceNoun(entry); }
  eur(value: number): string { return euro(value); }
  price(value: number): string { return priceEuro(value); }
  date(iso: string): string { return longDate(iso); }
}
