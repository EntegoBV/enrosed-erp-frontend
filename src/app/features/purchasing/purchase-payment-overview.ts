import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import type { PurchaseDocument, PurchasePayment } from '../../core/api/models';
import { ContextMenu, type ContextMenuItem } from '../../shared/context-menu';
import type { MenuPoint } from '../../shared/context-menu-position';
import { Icon } from '../../shared/icon';
import { MenuTrigger } from '../../shared/menu-trigger';
import { CurPipe, DateNlPipe, EurPipe } from '../../shared/pipes';
import { Segmented, type SegmentOption } from '../../shared/segmented';
import { Skeleton } from '../../shared/skeleton';
import { Sheet } from '../../shared/ui';
import {
  PAYEE_ICON, PAYEE_LABEL, PAYEE_TONE, type Due, type LedgerRow, type LedgerTodo, type PayeeLedger, type PaymentLedger,
  type PurchasePaymentAction, type PurchaseSettleRequest,
} from './purchase-payment-ledger';
import { dayOf, formatEur, monthOf, payeeMenuItems, paymentMenuItems, proofLine, settleWith, todoCopy, toneClass } from './purchase-payment-menus';
import { PurchasePayeeSheet } from './purchase-payee-sheet';
import type { PurchaseNacalcSummary } from './purchase-payment-result-metrics';

export type { PurchasePaymentAction } from './purchase-payment-ledger';

/**
 * Betalingen on the phone, in the read view and in step 4 of the editor: what
 * has to be paid now, what to do, the payees and one chronological list of
 * payments, as iOS grouped lists. Styles live in styles/purchase-payments.scss.
 */
@Component({
  selector: 'app-purchase-payment-overview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet, ContextMenu, Icon, MenuTrigger, Segmented, Skeleton, PurchasePayeeSheet, EurPipe, CurPipe, DateNlPipe],
  template: `
    <header class="pp-head">
      <div>
        <h2 class="ios-title2" id="purchase-payments-title">{{ state() === 'loading' ? 'Betalingen laden…' : state() === 'error' ? 'Betalingen niet actueel' : 'Betalingen' }}</h2>
        <p class="ios-caption">Afgesproken, betaald en open per ontvanger</p>
      </div>
      <button class="ios-circle" type="button" aria-label="Betaling noteren" [disabled]="!ready() || busy()" (click)="payeeMenu.set(true)"><app-icon name="plus" [size]="20" /></button>
    </header>

    @switch (state()) {
      @case ('loading') {
        <app-skeleton kind="stats" [rows]="2" /><app-skeleton kind="list" [rows]="3" />
        <p class="ios-section__foot pp-late">Blijft dit laden? <button class="ios-section__link" type="button" (click)="refresh.emit()">Opnieuw laden</button></p>
      }
      @case ('error') {
        <div class="ios-banner ios-banner--danger" role="alert"><span>{{ error() || 'Het betalingsoverzicht kon niet worden geladen.' }}</span>
          <button class="ios-capsule" type="button" (click)="refresh.emit()">Opnieuw laden</button></div>
      }
      @default {
        @if (ledger(); as book) {
          <div class="pp-content" [class.is-loading]="state() === 'refreshing'" [attr.inert]="state() === 'refreshing' ? '' : null" [attr.aria-busy]="state() === 'refreshing'">
            @if (mode() === 'edit' && dirty()) {
              <div class="ios-banner" role="status"><span>Niet-opgeslagen wijzigingen aan de order</span>
                <button class="ios-capsule ios-capsule--tinted" type="button" (click)="save.emit()">Opslaan</button></div>
            }

            @let sum = book.summary;
            <section class="ios-card pp-summary" aria-label="Samenvatting">
              <div class="ios-headline">
                @switch (sum.headline.kind) {
                  @case ('due') {
                    <div class="ios-headline__label">Nu te betalen</div><div class="ios-headline__value">{{ sum.dueNowEur | eur }}</div>
                    @if (sum.next; as next) { <div class="ios-headline__sub">Volgende: {{ next.label }}@if (next.due) { · {{ label(next.payee) }} }</div> }
                  }
                  @case ('later') {
                    <div class="ios-headline__label">Niets nu te betalen</div><div class="ios-headline__value">{{ sum.openEur | eur }}</div>
                    @if (sum.next; as next) { <div class="ios-headline__sub">Volgende: {{ next.label }} · {{ next.when }}</div> }
                  }
                  @case ('review') {
                    <div class="ios-headline__label">Nakijken</div>
                    @if (review(); as check) {
                      @if (check.amountEur !== null) { <div class="ios-headline__value">{{ check.amountEur | eur }}</div> }
                      <div class="ios-headline__sub wk-amount--warn">{{ check.text }}</div>
                    }
                  }
                  @case ('done') { <div class="ios-headline__label">Alles betaald</div><div class="ios-headline__value">{{ sum.paidTotalEur | eur }}</div> }
                  @case ('concept') {
                    <div class="ios-headline__label">Nog niet besteld</div><div class="ios-headline__value">{{ sum.agreedEur | eur }}</div>
                    <div class="ios-headline__sub">{{ planLabel() }}</div>
                  }
                  @case ('empty') { <div class="ios-headline__label">Nog geen bedragen</div><div class="ios-headline__sub">Voeg producten en kosten toe.</div> }
                }
              </div>
              @if (sum.headline.kind === 'due' && sum.next; as next) {
                <button class="ios-capsule ios-capsule--accent ios-capsule--block" type="button" [disabled]="busy()"
                        (click)="add.emit({ payee: next.payee, amount: next.amountEur, label: next.label, due: next.due })">Noteer {{ next.label }}</button>
              }
              @if (sum.agreedEur > 0) {
                <div class="wk-meter pp-summary__meter" role="meter" aria-label="Betaald op de afspraak" aria-valuemin="0" aria-valuemax="100"
                     [attr.aria-valuenow]="round(sum.progress * 100)"><i class="tone-ok" [style.width.%]="sum.progress * 100"></i></div>
                <dl class="wk-equation">
                  <div><dt>Afspraak</dt><dd>{{ sum.agreedEur | eur }}</dd></div>
                  <div><dt><span class="wk-equation__op" aria-hidden="true">−</span>Betaald</dt><dd>{{ sum.paidOnAgreementEur | eur }}</dd></div>
                  @if (sum.lowerEur > 0) { <div><dt><span class="wk-equation__op" aria-hidden="true">−</span>Minder betaald · afgerekend</dt><dd>{{ sum.lowerEur | eur }}</dd></div> }
                  @if (sum.higherEur > 0) { <div><dt><span class="wk-equation__op" aria-hidden="true">+</span>Meer betaald{{ reviewHigher() ? ' · nakijken' : '' }}</dt><dd>{{ sum.higherEur | eur }}</dd></div> }
                  <div class="is-total"><dt><span class="wk-equation__op" aria-hidden="true">=</span>Open</dt><dd>{{ sum.openEur | eur }}</dd></div>
                  @if (sum.dueNowEur > 0 && sum.laterEur > 0) { <div class="is-sub"><dt>waarvan nu te betalen</dt><dd>{{ sum.dueNowEur | eur }}</dd></div> }
                  @if (sum.laterEur > 0) { <div class="is-sub"><dt>waarvan later</dt><dd>{{ sum.laterEur | eur }}</dd></div> }
                </dl>
              }
              @if (sum.additionalEur > 0) {
                <dl class="wk-equation pp-summary__extra">
                  <div><dt>Bijkomende kosten</dt><dd>{{ sum.additionalEur | eur }}</dd></div>
                  <div><dt>Totaal betaald</dt><dd>{{ sum.paidTotalEur | eur }}</dd></div>
                </dl>
              }
              @if (!sum.known) { <p class="ios-caption">Voorlopige cijfers</p> }
              @if (!sum.balanced) { <p class="ios-caption wk-amount--warn">Bedragen sluiten niet: een betaling mist de eurowaarde. Controleer de betalingen.</p> }
              <details class="ios-disclosure pp-bridge">
                <summary>Hoe is dit opgebouwd?<app-icon class="ios-cell__chev" name="chevron-right" [size]="16" /></summary>
                <dl class="wk-equation">
                  @for (row of book.bridge.rows; track row.key) {
                    <div><dt>{{ row.label }}@if (row.note) { <small> · {{ row.note }}</small> }</dt><dd>{{ row.amountEur | eur }}</dd></div>
                  }
                  <div class="is-total"><dt>{{ book.bridge.totalLabel }}</dt><dd>{{ book.bridge.totalEur | eur }}</dd></div>
                </dl>
                @if (!book.bridge.consistent) { <p class="ios-caption">De onderdelen sluiten niet exact aan op het totaal; controleer de kosten.</p> }
              </details>
            </section>

            @if (todos().length) {
              <section class="ios-section">
                <div class="ios-section__head"><h2>Te doen</h2></div>
                <div class="ios-group ios-group--icons">
                  @for (todo of todos(); track todo.key) {
                    <div class="ios-cell">
                      <span class="ios-cell__lead"><span class="ios-tile ios-tile--soft" [class]="todoTone(todo)"><app-icon [name]="todoIcon(todo)" [size]="17" /></span></span>
                      <span class="ios-cell__body"><span class="ios-cell__title">{{ todoTitle(todo) }}</span><span class="ios-cell__sub">{{ todoDetail(todo) }}</span></span>
                      <button class="ios-capsule ios-capsule--tinted" type="button" [disabled]="busy() && todo.kind !== 'proof' && todo.kind !== 'incomplete'" (click)="runTodo(todo)">{{ todoAction(todo) }}</button>
                    </div>
                  }
                </div>
              </section>
            }

            <section class="ios-section">
              <div class="ios-section__head"><h2>Ontvangers</h2></div>
              <div class="ios-group ios-group--icons">
                @for (item of book.visible; track item.payee) {
                  <button class="ios-cell ios-cell--tall pp-payee" type="button" [attr.aria-label]="payeeName(item)" (click)="openPayee.set(item.payee)">
                    <span class="ios-cell__lead"><span class="ios-tile" [class]="item.tone"><app-icon [name]="item.icon" [size]="17" /></span></span>
                    <span class="ios-cell__body"><span class="ios-cell__title">{{ item.label }}</span><span class="ios-cell__sub">{{ payeeSub(item) }}</span></span>
                    <span class="ios-cell__trail pp-payee__trail">
                      @if (item.payee !== 'OTHER' && item.openEur === 0) {
                        <span class="ios-cell__value">{{ item.paidEur | eur }}</span>
                      } @else {
                        <span class="ios-cell__value ios-cell__value--strong">{{ (item.payee === 'OTHER' ? item.paidEur : item.openEur) | eur }}</span>
                      }
                      <span class="ios-cell__meta" [class]="tone(item.status.tone)">{{ item.status.label }}</span>
                    </span>
                    <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
                  </button>
                  @if (item.payee === 'SUPPLIER') {
                    @for (term of item.terms; track term.due) {
                      <button class="ios-cell pp-term" type="button" (click)="openPayee.set('SUPPLIER')">
                        <span class="ios-cell__lead"></span>
                        <span class="ios-cell__body"><span class="ios-cell__title">{{ term.label }}</span><span class="ios-cell__sub">{{ term.paidEur | eur }} van {{ term.fullEur | eur }}</span></span>
                        <span class="ios-cell__trail"><span class="ios-cell__meta" [class]="tone(term.status.tone)">{{ term.status.label }}</span></span>
                      </button>
                    }
                  }
                }
              </div>
            </section>

            <section class="ios-section">
              <div class="ios-section__head"><h2>Alle betalingen · {{ book.rows.length }}</h2></div>
              @if (sum.missingProofCount) {
                <div class="pp-filter"><app-segmented variant="ios" label="Betalingen tonen" [options]="filterOptions()" [value]="filter()" (changed)="setFilter($event)" /></div>
              }
              @if (!book.rows.length) {
                <div class="ios-empty">
                  <span class="ios-empty__icon"><app-icon name="receipt" [size]="26" /></span>
                  <p class="ios-empty__title">Nog geen betalingen</p>
                  <p class="ios-empty__text">Noteer de eerste betaling zodra het geld vertrokken is.</p>
                  <button class="ios-capsule ios-capsule--tinted" type="button" [disabled]="busy()" (click)="payeeMenu.set(true)">Betaling noteren</button>
                </div>
              } @else if (!filtered().length) {
                <p class="ios-section__foot">Geen betalingen voor dit filter. <button class="ios-section__link" type="button" (click)="setFilter('ALL')">Alle tonen</button></p>
              } @else {
                <div class="ios-group">
                  @for (row of shownRows(); track row.id) {
                    <button class="ios-cell pp-row" type="button" appMenuTrigger [appMenuTriggerDisabled]="mode() !== 'edit'"
                            (menuTrigger)="rowMenu.set({ row, point: $event })" (click)="$event.defaultPrevented || tapRow(row)">
                      <span class="pp-row__date" aria-hidden="true"><b>{{ day(row.paidOn) }}</b><small>{{ month(row.paidOn) }}</small></span>
                      <span class="ios-cell__body"><span class="ios-cell__title">{{ row.title }}</span>
                        <span class="ios-cell__sub">{{ row.termLabel || row.payeeShort }}@if (row.settlesLabel) { · {{ row.settlesLabel }} }</span>
                        @if (row.hasProof === true) { <span class="ios-cell__sub pp-row__proof"><app-icon name="clip" [size]="12" /> {{ proofLine(row) }}</span> }</span>
                      <span class="ios-cell__trail">
                        <span class="ios-cell__value ios-cell__value--strong">@if (finite(row.amountEur)) { {{ row.amountEur | eur }} } @else { — }</span>
                        @if (row.foreign) { <span class="ios-cell__meta">{{ row.amount | cur: row.currency }}</span> }
                        @if (row.hasProof === false) { <span class="ios-cell__meta wk-amount--warn">geen bewijs</span> }
                      </span>
                    </button>
                  }
                  @if (filtered().length > 5 && !showAll()) {
                    <button class="ios-cell ios-cell--action" type="button" (click)="showAll.set(true)">Toon alle {{ filtered().length }} betalingen</button>
                  }
                </div>
              }
            </section>

            <div class="ios-group pp-costs">
              <button class="ios-cell" type="button" (click)="openCosts.emit()">
                <span class="ios-cell__body"><span class="ios-cell__title">Nacalculatie en kostprijs</span><span class="ios-cell__sub">{{ nacalcSub() }}</span></span>
                <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
              </button>
            </div>
          </div>
        }
      }
    }

    @if (payeeOpen(); as item) {
      <app-purchase-payee-sheet [payee]="item" [mode]="mode()" [busy]="busy()" [dirty]="dirty()" [supplierName]="supplierName()" [planLabel]="planLabel()"
        (closed)="openPayee.set(null)" (add)="afterPayeeSheet(add, $event)" (edit)="tapAfterPayeeSheet($event)" (proof)="afterPayeeSheet(proof, $event)"
        (download)="download.emit($event)" (settle)="afterPayeeSheet(settle, $event)" (undoSettle)="afterPayeeSheet(undoSettle, $event)"
        (planChange)="afterPayeeSheet(planChange, undefined)" (remove)="afterPayeeSheet(remove, $event)" />
    }
    @if (detail(); as row) {
      <app-sheet title="Betaling" variant="ios" (closed)="detail.set(null)">
        <div body>
          <div class="ios-group pp-detail">
            <div class="ios-cell"><span class="ios-cell__body">Bedrag</span><span class="ios-cell__value ios-cell__value--strong">{{ row.amount | cur: row.currency }}</span></div>
            @if (row.foreign) { <div class="ios-cell"><span class="ios-cell__body">In euro</span><span class="ios-cell__value">@if (finite(row.amountEur)) { {{ row.amountEur | eur }} } @else { — }</span></div> }
            <div class="ios-cell"><span class="ios-cell__body">Betaald op</span><span class="ios-cell__value">{{ row.paidOn | dateNl }}</span></div>
            <div class="ios-cell"><span class="ios-cell__body">Ontvanger</span><span class="ios-cell__value">{{ row.payeeLabel }}</span></div>
            @if (row.termLabel) { <div class="ios-cell"><span class="ios-cell__body">Termijn</span><span class="ios-cell__value">{{ row.termLabel }}</span></div> }
            <div class="ios-cell"><span class="ios-cell__body">Afrekening</span><span class="ios-cell__value">{{ row.settlesLabel || 'Niet afgerekend' }}</span></div>
            @if (row.label) { <div class="ios-cell"><span class="ios-cell__body">Omschrijving</span><span class="ios-cell__value">{{ row.label }}</span></div> }
          </div>
          @if (row.actor) { <p class="ios-section__foot">Genoteerd door {{ actor(row.actor) }}</p> }
          <section class="ios-section pp-detail__proofs">
            <div class="ios-section__head"><h2>Bewijzen</h2></div>
            @if (row.proofs?.length) {
              <div class="ios-group ios-group--icons">
                @for (document of row.proofs; track document.id) {
                  <button class="ios-cell" type="button" (click)="download.emit(document)">
                    <span class="ios-cell__lead"><span class="ios-tile ios-tile--soft tone-grey"><app-icon name="document" [size]="17" /></span></span>
                    <span class="ios-cell__body"><span class="ios-cell__title">{{ document.originalFilename }}</span></span>
                    <app-icon class="ios-cell__chev" name="download" [size]="18" />
                  </button>
                }
              </div>
            } @else { <p class="ios-section__foot">Geen bewijs toegevoegd</p> }
          </section>
        </div>
        <div foot style="display:contents"><button class="btn" type="button" (click)="detail.set(null)">Sluiten</button></div>
      </app-sheet>
    }
    @if (payeeMenu()) {
      <app-context-menu title="Betaling aan…" variant="ios" cancelLabel="Annuleren" [items]="payeeItems()"
                        (pick)="payeeMenu.set(false); add.emit({ payee: $any($event.id) })" (closed)="payeeMenu.set(false)" />
    }
    @if (rowMenu(); as open) {
      <app-context-menu [title]="open.row.title" variant="ios" cancelLabel="Annuleren" [anchor]="open.point"
                        [items]="rowItems(open.row)" (pick)="pickRow(open.row, $event)" (closed)="rowMenu.set(null)" />
    }
  `,
  styles: `:host { display: block; min-width: 0; }`,
})
export class PurchasePaymentOverview {
  readonly ledger = input<PaymentLedger | null>(null);
  readonly mode = input<'read' | 'edit'>('read');
  readonly state = input<'loading' | 'refreshing' | 'error' | 'ready'>('ready');
  readonly error = input<string | null>(null);
  readonly busy = input(false);
  readonly dirty = input(false);
  readonly planLabel = input('');
  readonly supplierName = input('');
  /** The Nacalculatie in four lines, for the live sub of the closing cell. */
  readonly nacalc = input<PurchaseNacalcSummary | null>(null);
  readonly add = output<PurchasePaymentAction>();
  readonly edit = output<PurchasePayment>();
  readonly proof = output<PurchasePayment>();
  readonly download = output<PurchaseDocument>();
  readonly settle = output<PurchaseSettleRequest>();
  readonly undoSettle = output<{ payee: PayeeLedger['payee']; due?: Due | null }>();
  readonly planChange = output<void>();
  readonly remove = output<PurchasePayment>();
  readonly save = output<void>();
  readonly refresh = output<void>();
  readonly openCosts = output<void>();

  readonly openPayee = signal<PayeeLedger['payee'] | null>(null);
  readonly detail = signal<LedgerRow | null>(null);
  readonly payeeMenu = signal(false);
  readonly rowMenu = signal<{ row: LedgerRow; point: MenuPoint } | null>(null);
  readonly filter = signal<'ALL' | 'NO_PROOF'>('ALL');
  readonly showAll = signal(false);
  readonly tone = toneClass;
  readonly day = dayOf;
  readonly month = monthOf;
  readonly round = Math.round;
  readonly proofLine = proofLine;

  readonly ready = computed(() => !!this.ledger() && this.state() === 'ready');
  readonly payeeOpen = computed(() => this.ledger()?.payees.find(item => item.payee === this.openPayee()) ?? null);
  readonly payeeItems = computed(() => payeeMenuItems(this.ledger()));
  /** What the review headline points at: overpaid, without an agreement or incomplete. */
  readonly review = computed(() => {
    const payee = this.ledger()?.summary.headline.payee;
    if (!payee) return null;
    const kind = payee.status.kind;
    return {
      amountEur: kind === 'UNBUDGETED' ? payee.paidEur : kind === 'OVERPAID' ? payee.higherEur : null,
      text: `${payee.label}: ${kind === 'UNBUDGETED' ? 'betaald zonder afspraak' : kind === 'INCOMPLETE' ? 'bedragen onvolledig' : 'te veel betaald'}`,
    };
  });
  readonly reviewHigher = computed(() => this.ledger()?.payees.some(item => item.higherEur > 0 && !item.finalized) ?? false);
  /** 'Verwachte eindkost € 70.204,31 · geen verschil', or where the Nacalculatie lives while it is not loaded. */
  readonly nacalcSub = computed(() => {
    const n = this.nacalc();
    if (!n) return 'Bij Kosten';
    const variance = n.varianceEur === 0 ? 'geen verschil' : (n.varianceEur > 0 ? '+ ' : '− ') + formatEur(Math.abs(n.varianceEur));
    return `${n.label} ${formatEur(n.forecastEur)} · ${n.kind === 'concept' ? 'nog niet besteld' : variance}`;
  });
  readonly filterOptions = computed<SegmentOption[]>(() => [
    { id: 'ALL', label: 'Alle' }, { id: 'NO_PROOF', label: `Zonder bewijs (${this.ledger()?.summary.missingProofCount ?? 0})` },
  ]);
  readonly filtered = computed(() => {
    const rows = this.ledger()?.rows ?? [];
    return this.filter() === 'NO_PROOF' && this.ledger()?.summary.missingProofCount ? rows.filter(row => row.hasProof === false) : rows;
  });
  readonly shownRows = computed(() => this.showAll() ? this.filtered() : this.filtered().slice(0, 5));
  /** The card already offers the first payment that is due; read mode only pays and shows proofs. */
  readonly todos = computed(() => {
    const todos = this.ledger()?.todos ?? [];
    const first = todos.findIndex(todo => todo.kind === 'pay');
    return todos.filter((todo, index) => index !== first
      && (this.mode() === 'edit' || todo.kind === 'pay' || todo.kind === 'proof'));
  });

  label(payee: PayeeLedger['payee']): string { return PAYEE_LABEL[payee]; }
  finite(value: number): boolean { return Number.isFinite(value); }
  actor(value: string): string { return value.replace(/^.*[\\/]/, '').split('@')[0]; }

  /** 'Alles betaald' only when the agreement was paid to the cent; a settled difference keeps its two figures under the pill. */
  payeeSub(item: PayeeLedger): string {
    if (item.payee === 'OTHER') return `${formatEur(item.paidEur)} betaald · zonder afspraak`;
    if (item.openEur === 0 && item.paidEur > 0 && item.differenceEur === 0) return 'Alles betaald';
    return item.paidEur > 0 ? `${formatEur(item.paidEur)} van ${formatEur(item.agreedEur ?? 0)} betaald` : 'Nog niets betaald';
  }

  payeeName(item: PayeeLedger): string {
    return item.payee === 'OTHER'
      ? `${item.label}, ${formatEur(item.paidEur)} betaald, ${item.status.label}`
      : `${item.label}, ${formatEur(item.paidEur)} van ${formatEur(item.agreedEur ?? 0)} betaald, ${formatEur(item.openEur)} open, ${item.status.label}`;
  }

  setFilter(value: string): void {
    this.filter.set(value === 'NO_PROOF' ? 'NO_PROOF' : 'ALL');
    this.showAll.set(false);
  }

  tapRow(row: LedgerRow): void {
    if (this.mode() === 'edit') this.edit.emit(row.payment);
    else this.detail.set(row);
  }

  /** From the payee sheet: edit in the editor, the read-only detail in the view. */
  tapPayment(payment: PurchasePayment): void {
    const row = this.ledger()?.rows.find(item => item.id === payment.id);
    if (this.mode() === 'edit') this.edit.emit(payment);
    else if (row) this.detail.set(row);
  }

  /**
   * The payee sheet closes before it reports an action. Acting in the same
   * turn would open the next sheet before the closing one hands focus back
   * to its row, leaving focus outside the new dialog; one task later the old
   * sheet is gone and the next one takes focus last.
   */
  afterPayeeSheet<T>(target: { emit(value: T): void }, value: T): void {
    setTimeout(() => target.emit(value));
  }

  tapAfterPayeeSheet(payment: PurchasePayment): void {
    setTimeout(() => this.tapPayment(payment));
  }

  rowItems(row: LedgerRow): ContextMenuItem[] { return paymentMenuItems(row, { move: false, busy: this.busy() }); }

  pickRow(row: LedgerRow, item: ContextMenuItem): void {
    this.rowMenu.set(null);
    if (item.id.startsWith('open:')) {
      const document = row.proofs?.find(proof => 'open:' + proof.id === item.id);
      if (document) this.download.emit(document);
      return;
    }
    switch (item.id) {
      case 'edit': this.edit.emit(row.payment); break;
      case 'proof': this.proof.emit(row.payment); break;
      case 'settle': this.settle.emit(settleWith(row)); break;
      case 'remove': this.remove.emit(row.payment); break;
    }
  }

  todoIcon(todo: LedgerTodo): string {
    switch (todo.kind) {
      case 'pay': return PAYEE_ICON[todo.payee];
      case 'settle': return 'tick';
      case 'proof': return 'clip';
      default: return 'alert';
    }
  }

  todoTone(todo: LedgerTodo): string {
    switch (todo.kind) {
      case 'pay': return PAYEE_TONE[todo.payee];
      case 'proof': return 'tone-grey';
      case 'incomplete': return 'tone-danger';
      default: return 'tone-warn';
    }
  }

  todoTitle(todo: LedgerTodo): string { return todoCopy(todo, this.mode()).title; }
  todoDetail(todo: LedgerTodo): string { return todoCopy(todo, this.mode()).detail; }
  todoAction(todo: LedgerTodo): string { return todoCopy(todo, this.mode()).action; }

  runTodo(todo: LedgerTodo): void {
    switch (todo.kind) {
      case 'pay': this.add.emit({ payee: todo.payee, amount: todo.amountEur, label: todo.label, due: todo.due }); break;
      case 'settle': case 'review': case 'budget': this.settle.emit(todo.request); break;
      case 'incomplete': this.openPayee.set(todo.payee); break;
      case 'proof': this.setFilter('NO_PROOF'); break;
    }
  }

}
