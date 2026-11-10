import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type {
  PartnerRecentSale, PartnerReportRequest, PartnerReportResult, PartnerStockTile,
} from '../../core/api/partner-portal-api';
import { messageOf } from '../../core/api/errors';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { DecimalInput } from '../../shared/decimal-input';
import { Icon } from '../../shared/icon';
import { Segmented, SegmentOption } from '../../shared/segmented';
import { Sheet, Ui } from '../../shared/ui';
import { DraftEntry, MeldingDraft } from './partner-draft';
import { PartnerEntryCard } from './partner-entry-card';
import { PartnerGrid, GridProduct } from './partner-grid';
import {
  KIND_SHORT, PARTNER_KINDS, PartnerKind, dayLabel, escapeHtml, euro, minusEuro, parseKind, percent, productTitle,
} from './partner-format';
import { averageOf } from './partner-money';
import { PhotoUrlFn, partnerPhoto } from './partner-photo';

/** How far the average may rise above the partner's last one before Melden asks "Klopt de prijs?". */
const PRICE_JUMP = 5;

/**
 * Step 2 of a melding, the form itself: Veiling | Direct | Terugkoop on top,
 * one card per product, "+ Product", the date, the costs with their euros and
 * Netto, and Melden. Everything it shows comes from its inputs and the draft,
 * and it sends through `submit`, so a staff screen reuses it as it is (its own
 * products, photo route and POST /api/partner-sales/reports).
 *
 *   <app-partner-entry [draft]="draft" [stock]="stock" [recent]="recent" [today]="today"
 *                      [submit]="send" (done)="shown($event)" (kindChanged)="…" />
 */
@Component({
  selector: 'app-partner-entry',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DecimalInput, Icon, Segmented, Sheet, PartnerEntryCard, PartnerGrid],
  template: `
    @let d = draft();
    @let kind = d.kind();
    @let money = d.money();
    @let t = money.totals;
    <app-segmented class="kinds" variant="ios" label="Soort melding" [options]="kindOptions" [value]="kind"
                   (changed)="pickKind($event)" />

    <div class="layout">
      <div class="layout__main">
        @for (entry of d.entries(); track entry.product.productId; let i = $index) {
          <app-partner-entry-card [draft]="d" [entry]="entry" [money]="money.entries[i] ?? null"
                                  [max]="limitOf(entry)" [lastSoldOn]="lastSoldOf(entry)" [photoUrl]="photoUrl()" />
        } @empty {
          <p class="none">Nog geen product gekozen.</p>
        }
        <button class="add-product" type="button" (click)="pickerOpen.set(true)">
          <app-icon name="plus" [size]="20" />Product
        </button>
      </div>

      <aside class="layout__side">
        <label class="date">
          <span class="date__label">{{ kind === 'terugkoop' ? 'Teruggekocht op' : 'Verkocht op' }}</span>
          <span class="date__value">
            <b>{{ day(d.soldOn()) }}</b><app-icon name="chevron-down" [size]="16" />
            <input class="date__input" type="date" [min]="d.earliest()" [max]="d.latest()" [value]="d.soldOn()"
                   [attr.aria-label]="kind === 'terugkoop' ? 'Teruggekocht op' : 'Verkocht op'"
                   (click)="openPicker($event)" (change)="pickDate($any($event.target).value)" />
          </span>
        </label>
        @if (d.dateProblem(); as problem) { <p class="bad" role="alert">{{ problem }}</p> }

        <section class="cost" aria-label="Kosten en netto">
          @if (kind !== 'terugkoop') {
            <div class="line"><span>Bruto</span><span class="fig">{{ eur(t.grossEur) }}</span></div>
            @if (kind === 'veiling') {
              <div class="line"><span>Veilingcommissie {{ pct(d.costs().auctionCommissionPct) }}</span><span class="fig">{{ minus(t.commissionEur) }}</span></div>
              <div class="line"><span>Transport {{ pct(d.costs().auctionTransportPct) }}</span><span class="fig">{{ minus(t.transportEur) }}</span></div>
            }
            @if (d.extra(); as extra) {
              <div class="extra">
                <div class="line line--head">
                  <span>Extra kost</span>
                  <button class="x" type="button" aria-label="Extra kost weghalen" (click)="d.extra.set(null)"><app-icon name="close" [size]="16" /></button>
                </div>
                <div class="extra__row">
                  <app-segmented class="extra__mode" variant="ios" label="Extra kost als" [options]="extraModes" [value]="extra.mode"
                                 (changed)="d.extra.set({ mode: $event === 'PCT' ? 'PCT' : 'AMOUNT', value: extra.value })" />
                  <label class="extra__field">
                    @if (extra.mode === 'AMOUNT') { <span aria-hidden="true">€</span> }
                    <input appDecimal placeholder="0" [attr.aria-label]="extra.mode === 'PCT' ? 'Extra kost in procent' : 'Extra kost in euro'"
                           [ngModel]="extra.value" (ngModelChange)="d.extra.set({ mode: extra.mode, value: $event })" />
                    @if (extra.mode === 'PCT') { <span aria-hidden="true">%</span> }
                  </label>
                  <span class="fig">{{ minus(t.extraCostEur) }}</span>
                </div>
                @if (d.extraProblem(); as problem) { <p class="bad">{{ problem }}</p> }
              </div>
            } @else {
              <button class="link" type="button" (click)="d.extra.set({ mode: 'AMOUNT', value: null })">
                <app-icon name="plus" [size]="16" />Extra kost toevoegen
              </button>
            }
          }
          @if (hasBuyback()) {
            <div class="line"><span>Terugkoopkost <small>· komt terug op voorraad</small></span><span class="fig">{{ minus(t.buybackEur) }}</span></div>
          }
          <div class="line line--total"><span>Netto</span><b class="fig" [class.is-neg]="t.netEur < 0">{{ eur(t.netEur) }}</b></div>
          @if (money.costsExceedGross) { <p class="bad" role="alert">De kosten zijn hoger dan de opbrengst</p> }
        </section>

        @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
        @if (desk.active()) {
          <button class="ios-capsule ios-capsule--accent ios-capsule--block send" type="button" [disabled]="!d.complete() || busy()" (click)="send()">
            {{ busy() ? 'Bezig…' : submitLabel() }}
          </button>
        }
        @if (hint()) { <p class="hint">{{ hint() }}</p> }
      </aside>
    </div>

    @if (!desk.active()) {
      <div class="bar">
        <div class="bar__sum"><small>Netto</small><b [class.is-neg]="t.netEur < 0">{{ eur(t.netEur) }}</b></div>
        <button class="ios-capsule ios-capsule--accent bar__send" type="button" [disabled]="!d.complete() || busy()" (click)="send()">
          {{ busy() ? 'Bezig…' : submitLabel() }}
        </button>
      </div>
    }

    @if (pickerOpen()) {
      <app-sheet variant="ios" title="Product toevoegen" (closed)="pickerOpen.set(false)">
        <div body>
          <app-partner-grid [items]="pickable()" [photoUrl]="photoUrl()" [emptyText]="kind === 'terugkoop' ? 'Geen andere verkopen van de laatste 60 dagen.' : 'Geen andere producten op voorraad.'"
                            (picked)="addPicked($event)" />
        </div>
      </app-sheet>
    }
  `,
  styles: `
    :host{display:block;padding-bottom:8px}
    .kinds{display:grid;height:44px;margin:0 0 14px}
    .layout{display:grid;gap:14px}
    .layout__main{display:grid;align-content:start;gap:12px;min-width:0}
    .layout__side{display:grid;align-content:start;gap:12px;min-width:0}
    @media (min-width: 1024px), (min-width: 680px) and (hover: hover){
      .layout{grid-template-columns:minmax(0,1fr) 340px;gap:20px;align-items:start}
      .layout__side{position:sticky;top:calc(var(--pp-head-h,60px) + 12px)}
    }
    .none{margin:0;padding:24px;border-radius:20px;background:var(--surface);color:var(--muted);text-align:center}
    .add-product{display:flex;align-items:center;justify-content:center;gap:8px;min-height:52px;border:1.5px dashed var(--line-strong);border-radius:18px;background:transparent;color:var(--rose-dark);font:inherit;font-size:16px;font-weight:650;cursor:pointer}
    .add-product:hover{background:color-mix(in srgb,var(--rose) 6%,transparent)}
    .date{position:relative;display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:52px;padding:0 16px;border-radius:18px;background:var(--surface);cursor:pointer}
    .date__label{color:var(--ink-2);font-size:15px;font-weight:600}
    .date__value{position:relative;display:flex;align-items:center;gap:4px;min-height:44px;color:var(--rose-dark);font-size:16px}
    .date__value b{font-weight:700}
    .date__input{position:absolute;inset:0;width:100%;height:100%;margin:0;padding:0;border:0;opacity:0;cursor:pointer;font-size:16px}
    .date:focus-within{box-shadow:0 0 0 2px color-mix(in srgb,var(--rose) 45%,transparent)}
    .cost{display:grid;gap:2px;padding:10px 16px 12px;border-radius:18px;background:var(--surface)}
    .line{display:flex;align-items:baseline;justify-content:space-between;gap:10px;min-height:34px;padding:6px 0;color:var(--ink-2);font-size:15px}
    .line small{color:var(--muted);font-size:13px}
    .line--head{align-items:center;padding:0}
    .line--total{margin-top:4px;padding-top:10px;border-top:1px solid var(--line);color:var(--ink);font-size:17px;font-weight:700}
    .line--total .fig{font-size:22px;font-weight:800;letter-spacing:-.02em}
    .fig{color:var(--ink);font-variant-numeric:tabular-nums;white-space:nowrap}
    .is-neg{color:var(--danger)}
    .x{display:grid;place-items:center;width:44px;height:44px;margin-right:-12px;padding:0;border:0;border-radius:50%;background:transparent;color:var(--muted);cursor:pointer}
    .extra{display:grid;gap:6px;padding-bottom:6px}
    .extra__row{display:grid;grid-template-columns:120px minmax(0,1fr) auto;align-items:center;gap:8px}
    .extra__mode{height:44px}
    .extra__field{display:flex;align-items:center;gap:4px;min-height:44px;padding:0 10px;border-radius:12px;background:color-mix(in srgb,var(--ink) 6%,var(--surface));color:var(--muted);font-weight:600}
    .extra__field input{flex:1;min-width:0;height:44px;border:0;background:transparent;color:var(--ink);font:inherit;font-size:17px;font-weight:700;outline:none}
    .extra__field:focus-within{box-shadow:0 0 0 2px color-mix(in srgb,var(--rose) 45%,transparent)}
    .link{display:flex;align-items:center;gap:6px;min-height:44px;padding:0;border:0;background:none;color:var(--rose-dark);font:inherit;font-size:15px;font-weight:650;cursor:pointer}
    .bad{margin:0;color:var(--danger);font-size:14px;font-weight:600}
    .error{padding:12px 14px;border-radius:16px;background:var(--danger-soft);color:#83261e;font-size:15px;font-weight:500;line-height:1.4}
    .send{min-height:54px;font-size:17px}
    .hint{margin:0;color:var(--muted);font-size:13.5px;text-align:center}
    .bar{position:sticky;bottom:0;z-index:20;display:flex;align-items:center;gap:12px;margin:16px calc(-1 * var(--pp-gutter,16px)) 0;padding:10px var(--pp-gutter,16px) calc(10px + var(--safe-b,0px));background:var(--ios-glass,rgb(242 239 235/90%));box-shadow:0 -1px 0 rgb(26 22 20/8%)}
    .bar::before{content:'';position:absolute;inset:0;z-index:-1;backdrop-filter:var(--ios-glass-filter,blur(20px));-webkit-backdrop-filter:var(--ios-glass-filter,blur(20px))}
    .bar__sum{display:grid;flex:1;min-width:0}
    .bar__sum small{color:var(--muted);font-size:12.5px;font-weight:600}
    .bar__sum b{font-size:21px;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums;white-space:nowrap}
    .bar__send{flex:none;min-width:150px;min-height:52px;font-size:17px;font-weight:700}
    .bar__send::before{inset:0}
  `,
})
export class PartnerEntry {
  private readonly ui = inject(Ui);
  readonly desk = inject(DesktopViewport);

  readonly draft = input.required<MeldingDraft>();
  /** The stock there: the most a sale can take, and the products "+ Product" offers on Veiling and Direct. */
  readonly stock = input<readonly PartnerStockTile[]>([]);
  /** Recent sales: "+ Product" on Terugkoop, and the last average the price check compares with. */
  readonly recent = input<readonly PartnerRecentSale[]>([]);
  /** Today (yyyy-mm-dd, the server's): the date row's "Vandaag". */
  readonly today = input('');
  readonly photoUrl = input<PhotoUrlFn>(partnerPhoto);
  readonly submitLabel = input('Melden');
  /** Sends the body; a refusal's message is shown in place, the draft stays for a retry (same clientRef). */
  readonly submit = input.required<(body: PartnerReportRequest) => Promise<PartnerReportResult>>();
  readonly done = output<PartnerReportResult>();
  readonly kindChanged = output<PartnerKind>();

  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly pickerOpen = signal(false);

  readonly kindOptions: SegmentOption[] = PARTNER_KINDS.map((kind) => ({ id: kind, label: KIND_SHORT[kind] }));
  readonly extraModes: SegmentOption[] = [{ id: 'AMOUNT', label: '€' }, { id: 'PCT', label: '%' }];

  private readonly stockById = computed(() => new Map(this.stock().map((tile) => [tile.productId, tile])));
  private readonly recentById = computed(() => new Map(this.recent().map((tile) => [tile.productId, tile])));

  readonly hasBuyback = computed(() => {
    const draft = this.draft();
    return draft.kind() === 'terugkoop' || (draft.kind() === 'veiling' && draft.entries().some((entry) => entry.buybackOpen));
  });

  /** What "+ Product" offers: the kind's list, without the products already on the form. */
  readonly pickable = computed<GridProduct[]>(() => {
    const draft = this.draft();
    const source: readonly GridProduct[] = draft.kind() === 'terugkoop' ? this.recent() : this.stock();
    return source.filter((tile) => !draft.has(tile.productId));
  });

  /** Why Melden waits, in one line (only once something is on the form). */
  readonly hint = computed<string | null>(() => {
    const draft = this.draft();
    if (!draft.entries().length || draft.complete()) return null;
    return draft.kind() === 'terugkoop'
      ? 'Vul bij elk product het aantal en de klokprijs in.'
      : 'Vul bij elk product het aantal en de prijs in.';
  });

  limitOf(entry: DraftEntry): number | null {
    if (this.draft().kind() === 'terugkoop') return null;
    return this.draft().saleLimit(entry.product.productId);
  }

  lastSoldOf(entry: DraftEntry): string | null {
    return this.recentById().get(entry.product.productId)?.lastSoldOn ?? null;
  }

  pickKind(value: string): void {
    const kind = parseKind(value);
    if (kind === this.draft().kind()) return;
    this.draft().kind.set(kind);
    this.error.set(null);
    this.kindChanged.emit(kind);
  }

  addPicked(product: GridProduct): void {
    this.draft().add(product);
    this.pickerOpen.set(false);
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
    if (this.busy() || !draft.complete()) return;
    const jump = this.priceJump();
    if (jump) {
      this.ui.confirm({ title: 'Klopt de prijs?', message: jump, confirmLabel: 'Ja, melden' }, () => void this.post());
      return;
    }
    await this.post();
  }

  /** The first average more than 5x the partner's last one for that product, as the question to ask. */
  private priceJump(): string | null {
    const draft = this.draft();
    if (draft.kind() === 'terugkoop') return null;
    for (const entry of draft.entries()) {
      const last = this.recentById().get(entry.product.productId)?.lastAverageEur ?? null;
      const average = averageOf(entry.sale);
      if (last != null && last > 0 && average != null && average > PRICE_JUMP * last) {
        return `${escapeHtml(productTitle(entry.product))}: gemiddeld ${euro(average)} per ${escapeHtml(entry.product.unitOne)}. `
          + `De vorige keer was dat ${euro(last)}.`;
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
      this.error.set(messageOf(failure, 'Melden lukt nu niet. Probeer het opnieuw.'));
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
