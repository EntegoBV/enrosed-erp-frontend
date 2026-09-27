import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthImage } from '../../core/api/auth-image';
import { messageOf } from '../../core/api/errors';
import type { CreditNoteProposal, CreditReason, Customer, PartnerCreditProposal, SalesOrderView } from '../../core/api/models';
import { SalesApi } from '../../core/api/sales-api';
import { SourcingApi } from '../../core/api/sourcing-api';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { EurPipe, NumPipe } from '../../shared/pipes';
import { Skeleton } from '../../shared/skeleton';
import { Sheet, Ui } from '../../shared/ui';
import { CREDIT_REASON_CHOICES, creditDraftTotals, creditReasonLabel, creditRequestFrom, euro } from './sales-credit-note';

interface SheetLine {
  productId: number;
  productName: string;
  sku: string | null;
  photoUrl: string | null;
  unitLabel: string;
  invoicedQuantity: number;
  alreadyCreditedQuantity: number;
  suggestedQuantity: number;
  netUnitPriceEur: number;
  /** invoiced − already credited on other live credit notes. */
  max: number;
  quantity: number;
  unitPriceEur: number;
  amountEur: number;
}

/** amountText is the prefilled two-decimal text ('991.10'); it is dropped the moment the owner types, so the field never fights the keyboard. */
interface AmountRow { description: string; amountEur: number | null; amountText?: string }

const round2 = (value: number): number => Math.round(value * 100) / 100;
const round4 = (value: number): number => Math.round(value * 10000) / 10000;

/**
 * 'Creditnota maken': from an issued invoice (its lines prefilled with the
 * container's receipt shortage) or from a received partner container (one
 * amount on the over-financed advance). The server prices and numbers the
 * document; this sheet only previews the cents. Selector, inputs and outputs
 * are the lead's seam: purchase-desk and purchase-view mount it in partner
 * mode, sales-desk and sales-view in invoice mode.
 */
@Component({
  selector: 'app-sales-credit-note-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Sheet, AuthImage, EurPipe, NumPipe, Skeleton],
  template: `
    <app-sheet title="Creditnota maken" [wide]="desktop.active()" [variant]="desktop.active() ? 'default' : 'ios'" (closed)="closed.emit()">
      <div body class="cn-sheet" [class.cn-sheet--ios]="!desktop.active()">
        @if (loading()) {
          <app-skeleton kind="lines" />
        } @else {
          @if (proposal(); as p) {
          <header class="cn-head">
            <h3>{{ advanceMode() ? 'Creditnota op voorschot ' + p.invoiceNumber : 'Creditnota op ' + p.invoiceNumber }}</h3>
            @if (customerName()) { <p class="cn-head__who">{{ customerName() }}</p> }
            <p class="cn-head__cap">Gefactureerd {{ p.invoiceTotalInclVatEur | eur }} incl. btw · nog te crediteren {{ p.maxCreditInclVatEur | eur }}</p>
          </header>
          }

          <!-- The partner block stays on screen when one advance's proposal fails to load: another advance can be picked, or the same one retried. -->
          @if (partnerProposal(); as pp) {
            <section class="cn-block cn-block--partner" aria-label="Voorschotfactuur">
              @if (pp.advances.length > 1) {
                <label class="field"><span>Voorschotfactuur</span>
                  <select class="select" [ngModel]="advanceId()" (ngModelChange)="pickAdvance(+$event)" [disabled]="busy()">
                    @for (advance of pp.advances; track advance.invoiceId) {
                      <option [ngValue]="advance.invoiceId">{{ advance.number }} · nog {{ advance.maxCreditInclVatEur | eur }} te crediteren</option>
                    }
                  </select>
                </label>
              }
              <p class="cn-partner__explain">Gefinancierd {{ pp.issuedAdvanceEur - pp.creditedAdvanceEur | eur }} · afgesproken deel na ontvangst {{ pp.agreedShareEur | eur }} ({{ pp.financingPct | num }} % van {{ pp.actualBasisEur | eur }}) · verschil {{ pp.overFinancingEur | eur }}@if (pp.missingPieces + pp.damagedPieces > 0) { · {{ pp.missingPieces + pp.damagedPieces | num }} stuks minder ontvangen ({{ pp.missingPieces | num }} ontbreken · {{ pp.damagedPieces | num }} beschadigd) }</p>
              @if (proposal(); as p) { <p class="cn-hint">hoogstens {{ p.maxCreditInclVatEur | eur }} incl. btw op deze voorschotfactuur</p> }
              @if (pp.settlementExists) { <p class="cn-hint cn-hint--warn">De afrekening verrekent het voorschot al; het voorstel is daarom nul. Maak een creditnota op de afrekening vanuit die factuur.</p> }
              @else if (!pp.received) { <p class="cn-hint cn-hint--warn">Tekorten worden pas na ontvangst berekend; vul het bedrag zelf in.</p> }
              <p class="cn-hint">Werkelijke externe kost volgens nacalculatie {{ pp.forecastExternalEur | eur }} · alleen ter informatie</p>
              @if (loadError()) {
                <div class="cn-error cn-error--retry" role="alert"><span>{{ loadError() }}</span>@if (retryAdvanceId() !== null) { <button class="btn btn--sm" type="button" [disabled]="busy()" (click)="retryAdvance()">Opnieuw proberen</button> }</div>
              }
            </section>
          } @else if (loadError()) {
            <p class="cn-error" role="alert">{{ loadError() }}</p>
          }

          @if (proposal(); as p) {
          <section class="cn-block" aria-label="Reden">
            <h4>Reden</h4>
            @if (advanceMode()) {
              <p class="cn-reason-fixed">{{ reasonLabel('PARTNER_SHORTFALL') }}</p>
            } @else {
              <div class="cn-chips" role="radiogroup" aria-label="Reden van de creditnota" (keydown)="chipKey($event)">
                @for (choice of reasons; track choice) {
                  <button class="cn-chip" type="button" role="radio" [attr.aria-checked]="reason() === choice" [tabindex]="reason() === choice ? 0 : -1" [class.cn-chip--on]="reason() === choice" (click)="reason.set(choice)">{{ reasonLabel(choice) }}</button>
                }
              </div>
              @if (settlementMode()) { <p class="cn-hint">Aantallen op de afrekening blijven afgerekend; deze creditnota corrigeert alleen het bedrag.</p> }
            }
          </section>

          @if (!advanceMode() && lines().length) {
            <section class="cn-block" aria-label="Regels van de factuur">
              <h4>Regels van de factuur</h4>
              <div class="cn-lines" role="table" aria-label="Factuurregels">
                <div class="cn-lines__head" role="row"><span role="columnheader">Product</span><span role="columnheader">Gefactureerd</span><span role="columnheader">Crediteren</span><span role="columnheader">Prijs/st</span><span role="columnheader">Bedrag</span></div>
                @for (line of lines(); track line.productId) {
                  <div class="cn-line" role="row" [class.cn-line--on]="line.quantity > 0" [class.cn-line--full]="line.max <= 0">
                    <div class="cn-line__product" role="cell">
                      @if (line.photoUrl) { <img class="cn-line__photo" [appAuthSrc]="line.photoUrl" alt="" /> } @else { <span class="cn-line__photo cn-line__photo--empty" aria-hidden="true">◈</span> }
                      <span class="cn-line__copy"><strong>{{ line.productName }}</strong>@if (line.sku) { <small>{{ line.sku }}</small> }
                        @if (line.suggestedQuantity > 0 && p.container) { <em class="cn-tag cn-tag--warn">{{ line.suggestedQuantity | num }} te weinig ontvangen ({{ p.container.number }})</em> }
                        @if (line.alreadyCreditedQuantity > 0) { <em class="cn-tag">{{ line.alreadyCreditedQuantity | num }} al gecrediteerd{{ line.suggestedQuantity > 0 && line.alreadyCreditedQuantity >= line.suggestedQuantity ? ' voor dit tekort' : '' }}{{ creditedBy() ? ' (' + creditedBy() + ')' : '' }}</em> }
                      </span>
                    </div>
                    <div class="cn-line__invoiced" role="cell"><small>gefactureerd</small><b>{{ line.invoicedQuantity | num }} {{ line.unitLabel }} · {{ line.netUnitPriceEur | eur: 4 }}</b></div>
                    <div class="cn-line__qty" role="cell">
                      <div class="cn-stepper">
                        <button type="button" class="cn-stepper__btn" [disabled]="busy() || line.quantity <= 0" [attr.aria-label]="line.productName + ' één minder'"
                                (click)="step(line.productId, -1)" (pointerdown)="holdStart(line.productId, -1)" (pointerup)="holdStop()" (pointerleave)="holdStop()" (pointercancel)="holdStop()">−</button>
                        <input class="input cn-stepper__input" type="number" inputmode="numeric" min="0" [max]="line.max" step="1" [attr.aria-label]="'Crediteren ' + line.productName"
                               [disabled]="busy() || line.max <= 0" [ngModel]="line.quantity" (ngModelChange)="setQuantity(line.productId, $event)" />
                        <button type="button" class="cn-stepper__btn" [disabled]="busy() || line.quantity >= line.max" [attr.aria-label]="line.productName + ' één meer'"
                                (click)="step(line.productId, 1)" (pointerdown)="holdStart(line.productId, 1)" (pointerup)="holdStop()" (pointerleave)="holdStop()" (pointercancel)="holdStop()">+</button>
                      </div>
                      <button type="button" class="cn-all" [disabled]="busy() || line.max <= 0 || line.quantity >= line.max" (click)="setQuantity(line.productId, line.max)">{{ line.max <= 0 ? 'volledig gecrediteerd' : 'alles' }}</button>
                    </div>
                    <div class="cn-line__price" role="cell">
                      <small>prijs/st</small>
                      @if (priceEditable()) {
                        <input class="input cn-price" type="number" inputmode="decimal" min="0.0001" [max]="line.netUnitPriceEur" step="0.0001" [attr.aria-label]="'Creditprijs per stuk ' + line.productName"
                               [disabled]="busy()" [ngModel]="line.unitPriceEur" (ngModelChange)="setPrice(line.productId, $event)" (blur)="priceBlur(line.productId, $event)" />
                        @if (priceOver()[line.productId] !== undefined) { <em class="cn-line__error" role="alert">Hoogstens {{ line.netUnitPriceEur | eur: 4 }} per stuk, de gefactureerde prijs · gerekend met {{ line.unitPriceEur | eur: 4 }}</em> }
                      } @else { <b>{{ line.unitPriceEur | eur: 4 }}</b> }
                    </div>
                    <div class="cn-line__amount" role="cell"><small>bedrag</small><b>{{ line.amountEur | eur }}</b></div>
                  </div>
                }
              </div>
              @if (p.freightEur > 0) {
                <label class="cn-toggle" [class.cn-toggle--off]="p.freightAlreadyCredited">
                  <input type="checkbox" [disabled]="busy() || p.freightAlreadyCredited" [checked]="creditFreight()" (change)="creditFreight.set($any($event.target).checked)" />
                  <span><b>Vracht en handling ook crediteren · {{ p.freightEur | eur }}</b>@if (p.freightAlreadyCredited) { <small>De vracht van {{ p.invoiceNumber }} is al gecrediteerd.</small> }</span>
                </label>
              }
            </section>
          }

          <section class="cn-block" aria-label="Bedragen zonder product">
            <h4>{{ advanceMode() ? 'Bedrag' : 'Bedrag zonder product' }}</h4>
            @for (amount of amounts(); track $index; let i = $index) {
              <div class="cn-amount">
                <input class="input cn-amount__what" type="text" maxlength="120" placeholder="Omschrijving" [attr.aria-label]="'Omschrijving bedrag ' + (i + 1)"
                       [disabled]="busy()" [ngModel]="amount.description" (ngModelChange)="setAmount(i, { description: $event })" />
                <div class="input-affix cn-amount__eur">
                  <input class="input num" type="number" inputmode="decimal" min="0.01" step="0.01" placeholder="0,00" [attr.aria-label]="'Bedrag ' + (i + 1) + ' excl. btw'"
                         [disabled]="busy()" [ngModel]="amount.amountText ?? amount.amountEur" (ngModelChange)="setAmount(i, { amountEur: $event === '' || $event === null ? null : +$event, amountText: undefined })" />
                  <span class="input-affix__suffix">€</span>
                </div>
                @if (!advanceMode()) { <button type="button" class="cn-remove" [disabled]="busy()" [attr.aria-label]="'Bedrag ' + (i + 1) + ' verwijderen'" (click)="removeAmount(i)">×</button> }
              </div>
            }
            @if (!advanceMode()) { <button type="button" class="cn-add" [disabled]="busy()" (click)="addAmount()"><span aria-hidden="true">＋</span> Bedrag zonder product</button> }
            @if (amounts().length) { <p class="cn-hint">Bedragen excl. btw; de btw volgt de factuur.</p> }
          </section>

          <section class="cn-block" aria-label="Notitie voor de klant">
            <h4>Notitie voor de klant <span class="cn-opt">optioneel</span></h4>
            <textarea class="textarea" rows="2" maxlength="1000" placeholder="Staat onder de reden op de creditnota." aria-label="Notitie voor de klant"
                      [disabled]="busy()" [ngModel]="note()" (ngModelChange)="note.set($event)"></textarea>
          </section>
          }
        }
      </div>
      <div foot style="display:contents">
        <!-- The server's refusal and the local checks land in the sticky foot, next to the button that was pressed. -->
        @if (submitError()) { <p class="cn-error cn-foot__error" role="alert">{{ submitError() }}</p> }
        <div class="cn-foot__preview">
          @if (proposal(); as p) {
            <b>Creditnota {{ totals().exclEur | eur }} excl. btw</b>
            <small>{{ totals().inclEur | eur }} incl. btw{{ p.vatExempt || !(p.vatRatePct > 0) ? ' · btw vrijgesteld' : ' (' + (p.vatRatePct | num) + ' %)' }}</small>
            @if (totals().count === 0) { <small class="cn-foot__need" id="cn-need-one">Kies minstens één regel of bedrag.</small> }
          }
        </div>
        <button class="btn" type="button" [disabled]="busy()" (click)="closed.emit()">Annuleren</button>
        <button class="btn btn--primary" type="button" [disabled]="!canSubmit()" [attr.aria-describedby]="proposal() && totals().count === 0 ? 'cn-need-one' : null" (click)="create()">{{ busy() ? 'Bezig…' : 'Conceptcreditnota maken' }}</button>
      </div>
    </app-sheet>
  `,
})
export class SalesCreditNoteSheet {
  readonly invoiceId = input<number | null>(null);
  readonly purchaseOrderId = input<number | null>(null);
  readonly closed = output<void>();
  readonly created = output<SalesOrderView>();

  readonly desktop = inject(DesktopViewport);
  private readonly sales = inject(SalesApi);
  private readonly sourcing = inject(SourcingApi);
  private readonly router = inject(Router);
  private readonly ui = inject(Ui);

  readonly reasons = CREDIT_REASON_CHOICES;
  readonly reasonLabel = creditReasonLabel;
  readonly loading = signal(true);
  readonly loadError = signal('');
  readonly submitError = signal('');
  readonly busy = signal(false);
  readonly proposal = signal<CreditNoteProposal | null>(null);
  readonly partnerProposal = signal<PartnerCreditProposal | null>(null);
  /** The invoice the credit note is created on: the invoice itself, or the chosen advance. */
  readonly advanceId = signal<number | null>(null);
  readonly customers = signal<Customer[]>([]);
  /** The invoice's other live credit notes, so the muted tag can name them. */
  readonly existingNotes = signal<string[]>([]);
  readonly reason = signal<CreditReason>('OTHER');
  readonly quantities = signal<Record<number, number>>({});
  readonly prices = signal<Record<number, number>>({});
  /** Prices typed above the invoiced price, by product: the draft keeps the cap, the field says so until it is left. */
  readonly priceOver = signal<Record<number, number>>({});
  /** The advance whose proposal failed to load, so 'Opnieuw proberen' knows what to fetch. */
  readonly retryAdvanceId = signal<number | null>(null);
  readonly creditFreight = signal(false);
  readonly amounts = signal<AmountRow[]>([]);
  readonly note = signal('');
  private version = 0;
  private hold: { timer: ReturnType<typeof setTimeout> | null; interval: ReturnType<typeof setInterval> | null; fired: boolean } = { timer: null, interval: null, fired: false };

  /** A credit on an advance carries one amount, no products; the reason is fixed. */
  readonly advanceMode = computed(() => this.proposal()?.purpose === 'PARTNER_ADVANCE');
  readonly settlementMode = computed(() => this.proposal()?.purpose === 'PARTNER_SETTLEMENT');
  readonly customerName = computed(() => this.customers().find((customer) => customer.id === this.proposal()?.customerId)?.company ?? '');
  readonly priceEditable = computed(() => this.reason() === 'PRICE_CORRECTION');
  readonly lines = computed<SheetLine[]>(() => (this.proposal()?.lines ?? []).map((line) => {
    const max = Math.max(0, line.invoicedQuantity - line.alreadyCreditedQuantity);
    const quantity = Math.min(max, Math.max(0, this.quantities()[line.productId] ?? 0));
    const unitPriceEur = this.priceEditable() ? (this.prices()[line.productId] ?? line.netUnitPriceEur) : line.netUnitPriceEur;
    return { ...line, max, quantity, unitPriceEur, amountEur: round2(quantity * unitPriceEur) };
  }));
  readonly totals = computed(() => {
    const p = this.proposal();
    const freight = this.creditFreight() && p && !p.freightAlreadyCredited ? p.freightEur : 0;
    return creditDraftTotals(this.advanceMode() ? [] : this.lines(), this.amounts().map((row) => ({ amountEur: row.amountEur ?? 0 })), freight, p?.vatRatePct ?? 0, p?.vatExempt ?? true);
  });
  readonly canSubmit = computed(() => !!this.proposal() && !this.busy() && !this.loading() && this.totals().count > 0);
  /** 'CN-2026-0001' when other credit notes already took pieces, for the muted tag. */
  readonly creditedBy = computed(() => {
    const names = this.existingNotes();
    if (names.length) return names.join(', ');
    const p = this.proposal();
    return p && p.alreadyCreditedInclVatEur > 0 ? 'eerdere creditnota' : '';
  });

  constructor() {
    effect(() => {
      const invoiceId = this.invoiceId();
      const purchaseOrderId = this.purchaseOrderId();
      untracked(() => { void this.load(invoiceId, purchaseOrderId); });
    });
  }

  private async load(invoiceId: number | null, purchaseOrderId: number | null): Promise<void> {
    const version = ++this.version;
    this.loading.set(true); this.loadError.set(''); this.submitError.set('');
    try {
      const customers = this.sales.customers().catch(() => [] as Customer[]);
      if (purchaseOrderId != null) {
        const partner = await this.sourcing.partnerCreditProposal(purchaseOrderId);
        if (version !== this.version) return;
        this.partnerProposal.set(partner);
        const advance = partner.suggestedAdvanceInvoiceId ?? partner.advances[0]?.invoiceId ?? null;
        if (advance == null) { this.loadError.set('Er is nog geen uitgereikte voorschotfactuur op deze container om te crediteren.'); return; }
        this.retryAdvanceId.set(advance);
        await this.loadProposal(advance, version);
      } else if (invoiceId != null) {
        await this.loadProposal(invoiceId, version);
      } else {
        this.loadError.set('Geen factuur gekozen.');
      }
      const list = await customers;
      if (version === this.version) this.customers.set(list);
    } catch (failure: unknown) {
      if (version === this.version) this.loadError.set(messageOf(failure, 'Het creditvoorstel kon niet worden geladen.'));
    } finally {
      if (version === this.version) this.loading.set(false);
    }
  }

  private async loadProposal(id: number, version: number): Promise<void> {
    const proposal = await this.sales.creditNoteProposal(id);
    if (version !== this.version) return;
    this.proposal.set(proposal);
    this.advanceId.set(id);
    this.retryAdvanceId.set(null);
    this.existingNotes.set([]);
    void this.sales.order(id).then((invoice) => { if (version === this.version) this.existingNotes.set((invoice.creditNotes ?? []).map((note) => note.number)); }).catch(() => undefined);
    if (proposal.purpose === 'PARTNER_ADVANCE' && !this.partnerProposal() && proposal.partnerShortfall) this.partnerProposal.set(proposal.partnerShortfall);
    this.prefill(proposal);
  }

  /**
   * The proposal's suggestions become the draft: reason, shortage quantities,
   * the partner amount. The suggested quantity is the receipt shortage as
   * such; what earlier credit notes already took for it is left out, so a
   * second sheet on the same invoice never proposes the same shortage twice.
   */
  private prefill(proposal: CreditNoteProposal): void {
    const advance = proposal.purpose === 'PARTNER_ADVANCE';
    this.reason.set(advance ? 'PARTNER_SHORTFALL' : proposal.suggestedReason);
    this.quantities.set(Object.fromEntries(proposal.lines.map((line) => [line.productId, Math.max(0, line.suggestedQuantity - line.alreadyCreditedQuantity)])));
    this.prices.set(Object.fromEntries(proposal.lines.map((line) => [line.productId, line.netUnitPriceEur])));
    this.priceOver.set({});
    this.creditFreight.set(false);
    this.note.set('');
    if (advance) {
      const partner = this.partnerProposal() ?? proposal.partnerShortfall;
      const short = (partner?.missingPieces ?? 0) + (partner?.damagedPieces ?? 0);
      const container = proposal.container?.number ?? `PO-${partner?.purchaseOrderId ?? ''}`;
      const over = partner?.overFinancingEur ?? 0;
      this.amounts.set([{ description: `Voorschot te veel gefinancierd · ${container} (${short} stuks minder ontvangen)`, amountEur: over > 0 ? round2(over) : null, amountText: over > 0 ? round2(over).toFixed(2) : undefined }]);
    } else {
      this.amounts.set([]);
    }
  }

  pickAdvance(id: number): void {
    if (!Number.isInteger(id) || id === this.advanceId() || this.busy()) return;
    const version = ++this.version;
    this.loading.set(true); this.loadError.set(''); this.retryAdvanceId.set(id);
    this.loadProposal(id, version)
      .catch((failure: unknown) => { if (version === this.version) this.loadError.set(messageOf(failure, 'Het creditvoorstel kon niet worden geladen.')); })
      .finally(() => { if (version === this.version) this.loading.set(false); });
  }

  retryAdvance(): void {
    const id = this.retryAdvanceId();
    if (id !== null) this.pickAdvance(id);
  }

  /** Arrow keys walk the reason chips like a radio group. */
  chipKey(event: KeyboardEvent): void {
    const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const next = this.reasons[(this.reasons.indexOf(this.reason()) + delta + this.reasons.length) % this.reasons.length];
    this.reason.set(next);
    (event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('.cn-chip')[this.reasons.indexOf(next)]?.focus();
  }

  setQuantity(productId: number, raw: number | string | null): void {
    const line = this.lines().find((item) => item.productId === productId);
    if (!line) return;
    const wanted = raw === null || raw === '' ? 0 : Math.round(Number(raw));
    const quantity = Number.isFinite(wanted) ? Math.min(line.max, Math.max(0, wanted)) : 0;
    this.quantities.update((map) => ({ ...map, [productId]: quantity }));
    this.submitError.set('');
  }

  step(productId: number, delta: number): void {
    if (this.hold.fired) { this.hold.fired = false; return; }
    const line = this.lines().find((item) => item.productId === productId);
    if (line) this.setQuantity(productId, line.quantity + delta);
  }

  /** Holding − or + repeats after a short delay, like a keyboard key. */
  holdStart(productId: number, delta: number): void {
    this.holdStop();
    this.hold.fired = false;
    this.hold.timer = setTimeout(() => {
      this.hold.interval = setInterval(() => {
        this.hold.fired = true;
        const line = this.lines().find((item) => item.productId === productId);
        if (!line || (delta > 0 && line.quantity >= line.max) || (delta < 0 && line.quantity <= 0)) { this.holdStop(); return; }
        this.setQuantity(productId, line.quantity + delta);
      }, 110);
    }, 420);
  }

  holdStop(): void {
    if (this.hold.timer !== null) { clearTimeout(this.hold.timer); this.hold.timer = null; }
    if (this.hold.interval !== null) { clearInterval(this.hold.interval); this.hold.interval = null; }
  }

  setPrice(productId: number, raw: number | string | null): void {
    const line = this.proposal()?.lines.find((item) => item.productId === productId);
    if (!line) return;
    const wanted = raw === null || raw === '' ? Number.NaN : Number(raw);
    const over = Number.isFinite(wanted) && wanted > line.netUnitPriceEur + 0.00005;
    const price = Number.isFinite(wanted) && wanted > 0 ? round4(Math.min(line.netUnitPriceEur, wanted)) : line.netUnitPriceEur;
    this.prices.update((map) => ({ ...map, [productId]: price }));
    this.priceOver.update((map) => {
      if (over) return { ...map, [productId]: wanted };
      if (map[productId] === undefined) return map;
      const next = { ...map }; delete next[productId]; return next;
    });
    this.submitError.set('');
  }

  /** Leaving a capped field writes the price that counts back into it, so field and amount agree. */
  priceBlur(productId: number, event: FocusEvent): void {
    if (this.priceOver()[productId] === undefined) return;
    const line = this.lines().find((item) => item.productId === productId);
    const input = event.target as HTMLInputElement | null;
    if (line && input) input.value = String(line.unitPriceEur);
    this.priceOver.update((map) => { const next = { ...map }; delete next[productId]; return next; });
  }

  addAmount(): void { this.amounts.update((rows) => [...rows, { description: '', amountEur: null }]); }
  removeAmount(index: number): void { this.amounts.update((rows) => rows.filter((_, i) => i !== index)); this.submitError.set(''); }
  setAmount(index: number, change: Partial<AmountRow>): void {
    this.amounts.update((rows) => rows.map((row, i) => (i === index ? { ...row, ...change } : row)));
    this.submitError.set('');
  }

  async create(): Promise<void> {
    const proposal = this.proposal();
    const targetId = this.advanceId();
    if (!proposal || targetId == null || !this.canSubmit()) return;
    const amounts = this.amounts().filter((row) => (row.amountEur ?? 0) > 0);
    if (amounts.some((row) => !row.description.trim())) { this.submitError.set('Geef elk bedrag een omschrijving.'); return; }
    const request = creditRequestFrom({
      reason: this.reason(),
      lines: this.advanceMode() ? [] : this.lines().map((line) => ({ productId: line.productId, quantity: line.quantity, unitPriceEur: line.unitPriceEur, netUnitPriceEur: line.netUnitPriceEur })),
      amounts: amounts.map((row) => ({ description: row.description, amountEur: row.amountEur ?? 0 })),
      creditFreight: this.creditFreight() && !proposal.freightAlreadyCredited && proposal.freightEur > 0,
      note: this.note(),
    });
    this.busy.set(true); this.submitError.set('');
    try {
      const view = await this.sales.createCreditNote(targetId, request);
      this.ui.toast(`${view.order.number} aangemaakt · concept`, 'ok');
      /* Both outputs fire while the sheet is still alive; the navigation may unmount the host. */
      this.created.emit(view);
      this.closed.emit();
      await this.router.navigate(['/sales', view.order.id]);
    } catch (failure: unknown) {
      this.submitError.set(messageOf(failure, 'Creditnota maken mislukt'));
    } finally {
      this.busy.set(false);
    }
  }

  /** € 1.234,56 for messages. */
  euro(value: number): string { return euro(value); }
}
