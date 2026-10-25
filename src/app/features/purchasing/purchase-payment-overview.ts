import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import type { PurchaseDocument, PurchaseInvoice, PurchasePayment } from '../../core/api/models';
import { ContextMenu, type ContextMenuItem } from '../../shared/context-menu';
import type { MenuPoint } from '../../shared/context-menu-position';
import { Icon } from '../../shared/icon';
import { MenuTrigger } from '../../shared/menu-trigger';
import { CurPipe, DateNlPipe, EurPipe } from '../../shared/pipes';
import { Segmented, type SegmentOption } from '../../shared/segmented';
import { Skeleton } from '../../shared/skeleton';
import { Sheet } from '../../shared/ui';
import {
  PAYEE_ICON, PAYEE_LABEL, PAYEE_TONE, ledgerDifferenceNote, type Due, type LedgerRow, type LedgerSummary, type LedgerTodo, type PayeeLedger, type PaymentLedger,
  type PurchasePaymentAction, type PurchaseSettleRequest, type SupplierCreditAction,
} from './purchase-payment-ledger';
import { bankProofSub, dayOf, formatEur, monthOf, payeeMenuItems, paymentMenuItems, settleWith, todoCopy, toneClass } from './purchase-payment-menus';
import { PurchasePayeeSheet } from './purchase-payee-sheet';
import { invoiceFileText } from './purchase-invoices';
import {
  differenceByPayee, landedChain, payeeFigures, payeeWord, paymentLine, proofMark, settledMeter, verschilText, type PhoneAmount, type PhoneTone,
} from './purchase-phone-money';
import type { InvoiceRequest } from './purchase-payment-workbench';
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
            @if (notice(); as text) {
              <div class="ios-banner pp-notice" role="status"><span>{{ text }}</span>
                <button class="ios-capsule" type="button" aria-label="Melding sluiten" (click)="dismissNotice.emit()">Sluiten</button></div>
            }
            @if (mode() === 'edit' && dirty()) {
              <div class="ios-banner" role="status"><span>Niet-opgeslagen wijzigingen aan de order</span>
                <button class="ios-capsule ios-capsule--tinted" type="button" (click)="save.emit()">Opslaan</button></div>
            }

            @let sum = book.summary;
            <section class="ios-card pp-summary" aria-label="Samenvatting">
              @if (sum.headline.kind === 'done') {
                <!-- Paid, or settled for less: the figures are in the rows below, so the status stands alone. -->
                <div class="pp-summary__status wk-amount--in"><app-icon name="tick" [size]="14" /> Alles betaald</div>
              } @else {
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
                    @case ('concept') {
                      <div class="ios-headline__label">Nog niet besteld</div><div class="ios-headline__value">{{ sum.agreedEur | eur }}</div>
                      <div class="ios-headline__sub">{{ planLabel() }}</div>
                    }
                    @case ('empty') { <div class="ios-headline__label">Nog geen bedragen</div><div class="ios-headline__sub">Voeg producten en kosten toe.</div> }
                  }
                </div>
              }
              @if (sum.headline.kind === 'due' && sum.next; as next) {
                <button class="ios-capsule ios-capsule--accent ios-capsule--block" type="button" [disabled]="busy()"
                        (click)="add.emit({ payee: next.payee, amount: next.amountEur, label: next.label, due: next.due })">Noteer {{ next.label }}</button>
              }
              @if (sum.agreedEur > 0) {
                @let meter = meterOf(sum);
                <!-- A settled difference counts as done: the bar is paid over paid plus open. -->
                <div class="wk-meter pp-summary__meter" role="meter" aria-label="Betaald of afgerekend" aria-valuemin="0" aria-valuemax="100"
                     [attr.aria-valuenow]="round(meter.paidPct)"><i class="tone-ok" [style.width.%]="meter.paidPct"></i><i class="tone-warn" [style.width.%]="meter.duePct"></i><i class="is-rest" [style.width.%]="meter.laterPct"></i></div>
                <!-- As the desk strip reads: Afspraak · Betaald · Verschil x minder · Open; one net Verschil, never a gross − and + pair. -->
                <dl class="wk-equation">
                  <div><dt>Afspraak</dt><dd>{{ sum.agreedEur | eur }}</dd></div>
                  <div><dt>Betaald</dt><dd>{{ sum.paidOnAgreementEur | eur }}</dd></div>
                  @if (hasVerschil(sum)) {
                    @let verschil = verschilOf(sum);
                    <div class="pp-summary__verschil"><dt>Verschil@if (verschilNote(sum, verschil); as note) { <small> · {{ note }}</small> }</dt>
                      <dd [class]="amountTone(sum.reviewEur > 0 ? 'warn' : verschil.tone)">{{ verschil.text }}</dd></div>
                    @for (line of byPayee(); track line.payee) {
                      <div class="is-sub"><dt>{{ line.label }}</dt><dd [class.wk-amount--warn]="line.tone === 'warn'">{{ line.text }}</dd></div>
                    }
                    @if (sum.reviewEur > 0) { <div class="is-sub"><dt>waarvan te veel betaald · nakijken</dt><dd class="wk-amount--warn">{{ sum.reviewEur | eur }}</dd></div> }
                  }
                  <div class="is-total"><dt>Open</dt><dd>{{ sum.openEur | eur }}</dd></div>
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
                <!-- The payees add up to the Afspraak; with the Enrosed kost that is the Totaal geland of the header. -->
                <dl class="wk-equation">
                  @for (row of bridgeRows(); track row.key) {
                    <div [class.is-sum]="row.sum"><dt>{{ row.label }}@if (row.note) { <small> · {{ row.note }}</small> }</dt><dd>{{ row.amountEur | eur }}</dd></div>
                  }
                  <div class="is-total"><dt>{{ book.bridge.totalLabel }}</dt><dd>{{ book.bridge.totalEur | eur }}</dd></div>
                </dl>
                @if (!book.bridge.consistent) { <p class="ios-caption">De onderdelen sluiten niet exact aan op het totaal; controleer de kosten.</p> }
              </details>
            </section>

            @if (todos().length || sum.fxEur > 0) {
              <section class="ios-section">
                <div class="ios-section__head"><h2>Te doen</h2></div>
                <div class="ios-group ios-group--icons">
                  @for (todo of todos(); track todo.key) {
                    <div class="ios-cell">
                      <span class="ios-cell__lead"><span class="ios-tile ios-tile--soft" [class]="todoTone(todo)"><app-icon [name]="todoIcon(todo)" [size]="17" /></span></span>
                      <span class="ios-cell__body"><span class="ios-cell__title ios-cell__title--2">{{ todoTitle(todo) }}</span><span class="ios-cell__sub">{{ todoDetail(todo) }}</span></span>
                      <button class="ios-capsule ios-capsule--tinted" type="button" [disabled]="busy() && todo.kind !== 'proof' && todo.kind !== 'incomplete'" (click)="runTodo(todo)">{{ todoAction(todo) }}</button>
                    </div>
                  }
                  @if (sum.fxEur > 0) {
                    <!-- The bank's exchange rate on a foreign amount paid as agreed: neutral, no button, never a 'nakijken' to-do. -->
                    <div class="ios-cell pp-fx" role="note">
                      <span class="ios-cell__lead"><span class="ios-tile ios-tile--soft tone-grey"><app-icon name="info" [size]="17" /></span></span>
                      <span class="ios-cell__body"><span class="ios-cell__title ios-cell__title--2">Koersverschil {{ sum.fxEur | eur }} (bank)</span><span class="ios-cell__sub">Bankkoers t.o.v. de orderkoers · in vreemde munt betaald zoals afgesproken</span></span>
                    </div>
                  }
                </div>
              </section>
            }

            <section class="ios-section">
              <div class="ios-section__head"><h2>Ontvangers</h2></div>
              <div class="ios-group ios-group--icons">
                @for (item of book.visible; track item.payee) {
                  <!-- Two lines: the payee and one status word, then its figures. Terms, invoices and credits are in its sheet. -->
                  @let word = wordOf(item);
                  <button class="ios-cell ios-cell--tall pp-payee" type="button" [attr.aria-label]="payeeName(item)" (click)="openPayee.set(item.payee)">
                    <span class="ios-cell__lead"><span class="ios-tile" [class]="item.tone"><app-icon [name]="item.icon" [size]="17" /></span></span>
                    <span class="ios-cell__body"><span class="pp-payee__top"><span class="ios-cell__title">{{ item.label }}</span><span class="ios-cell__meta" [class]="tone(word.tone)">{{ word.word }}</span></span>
                      <span class="ios-cell__sub">{{ figures(item) }}</span></span>
                    <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
                  </button>
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
                    <!-- Two lines: the title, then the term or payee with the bank mark; Afrekening and the first transfer are in its detail. -->
                    <button class="ios-cell pp-row pp-row2" type="button" appMenuTrigger [appMenuTriggerDisabled]="mode() !== 'edit'"
                            (menuTrigger)="rowMenu.set({ row, point: $event })" (click)="$event.defaultPrevented || tapRow(row)">
                      <span class="pp-row__date" aria-hidden="true"><b>{{ day(row.paidOn) }}</b><small>{{ month(row.paidOn) }}</small></span>
                      <span class="ios-cell__body"><span class="ios-cell__title">{{ row.title }}</span>
                        <span class="ios-cell__sub">{{ line(row) }}@if (mark(row); as proof) { · @if (proof.icon) { <span class="pp-row__mark" [class.pp-row__mark--bank]="proof.icon === 'bank'" role="img" [attr.aria-label]="proof.label"><app-icon [name]="proof.icon" [size]="12" /></span> }@if (proof.text) { {{ proof.text }} } }</span></span>
                      <span class="ios-cell__trail">
                        <span class="ios-cell__value ios-cell__value--strong">@if (finite(row.amountEur)) { {{ row.amountEur | eur }} } @else { — }</span>
                        @if (row.foreign) { <span class="ios-cell__meta">{{ row.amount | cur: row.currency }}</span> }
                        @if (row.proven === false) { <span class="ios-cell__meta wk-amount--warn">geen betaalbewijs</span> }
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
              <!-- The Eindkost and the Verschil are on Kosten, where the Nacalculatie opens; here only its state. -->
              <button class="ios-cell" type="button" (click)="openCosts.emit()">
                <span class="ios-cell__body"><span class="ios-cell__title">Nacalculatie</span></span>
                @if (nacalc(); as n) { <span class="ios-cell__trail"><span class="ios-cell__meta" [class]="pillTone(n.pill.tone)">{{ n.pill.label }}</span></span> }
                <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
              </button>
            </div>
          </div>
        }
      }
    }

    @if (payeeOpen(); as item) {
      <app-purchase-payee-sheet [payee]="item" [mode]="mode()" [busy]="busy()" [dirty]="dirty()" [supplierName]="supplierName()" [planLabel]="planLabel()"
        [roundOnServer]="roundOnServer()" [supplier]="supplierPayee()"
        (closed)="openPayee.set(null)" (add)="afterPayeeSheet(add, $event)" (edit)="tapAfterPayeeSheet($event)" (addTransfer)="afterPayeeSheet(addTransfer, $event)"
        (download)="download.emit($event)" (settle)="afterPayeeSheet(settle, $event)" (undoSettle)="afterPayeeSheet(undoSettle, $event)"
        (planChange)="afterPayeeSheet(planChange, undefined)" (remove)="afterPayeeSheet(remove, $event)" (credit)="afterPayeeSheet(credit, $event)"
        (invoice)="afterPayeeSheet(invoice, $event)" (invoiceFile)="invoiceFile.emit($event)" (inspectionVia)="afterPayeeSheet(inspectionVia, $event)"
        (assignInvoice)="afterPayeeSheet(assignInvoice, $event)" />
    }
    @if (detail(); as row) {
      <app-sheet title="Betaling" variant="ios" (closed)="detail.set(null)">
        <div body>
          <div class="ios-group pp-detail">
            <div class="ios-cell"><span class="ios-cell__body">Bedrag</span><span class="ios-cell__value ios-cell__value--strong">{{ row.amount | cur: row.currency }}</span></div>
            @if (row.foreign) { <div class="ios-cell"><span class="ios-cell__body">In euro</span><span class="ios-cell__value">@if (finite(row.amountEur)) { {{ row.amountEur | eur }} } @else { — }</span></div> }
            <div class="ios-cell"><span class="ios-cell__body">Betaald op</span><span class="ios-cell__value">{{ row.paidOn | dateNl }}@if (row.parts.length > 1) { · eerste {{ dayShort(row.firstPaidOn) }} }</span></div>
            <div class="ios-cell"><span class="ios-cell__body">Ontvanger</span><span class="ios-cell__value">{{ row.payeeLabel }}</span></div>
            @if (row.termLabel) { <div class="ios-cell"><span class="ios-cell__body">Termijn</span><span class="ios-cell__value">{{ row.termLabel }}</span></div> }
            <div class="ios-cell"><span class="ios-cell__body">Afrekening</span><span class="ios-cell__value">{{ row.settlesLabel || 'Niet afgerekend' }}</span></div>
            @if (row.label) { <div class="ios-cell"><span class="ios-cell__body">Omschrijving</span><span class="ios-cell__value">{{ row.label }}</span></div> }
          </div>
          @if (row.actor) { <p class="ios-section__foot pp-detail__actor">Genoteerd door {{ actor(row.actor) }}</p> }
          <section class="ios-section pp-detail__proofs">
            <div class="ios-section__head"><h2>Betaalbewijs</h2></div>
            @if (row.creditOffset) {
              <p class="ios-section__foot">Verrekend tegoed: geen bankbetaling, geen betaalbewijs nodig.</p>
            } @else if (row.bank.linked || row.parts.length > 1 || row.proofs?.length) {
              <div class="ios-group ios-group--icons">
                @for (part of row.parts; track part.id) {
                  @if (part.onBank || row.parts.length > 1) {
                    <div class="ios-cell">
                      <span class="ios-cell__lead"><span class="ios-tile ios-tile--soft" [class]="part.onBank ? 'tone-ok' : 'tone-grey'"><app-icon name="bank" [size]="17" /></span></span>
                      <span class="ios-cell__body"><span class="ios-cell__title">{{ partTitle(part) }}</span></span>
                      <span class="ios-cell__trail"><span class="ios-cell__meta" [class.wk-amount--warn]="!part.onBank">{{ partBank(part) }}</span></span>
                    </div>
                  }
                }
                @for (document of row.proofs ?? []; track document.id) {
                  <button class="ios-cell" type="button" (click)="download.emit(document)">
                    <span class="ios-cell__lead"><span class="ios-tile ios-tile--soft tone-grey"><app-icon name="document" [size]="17" /></span></span>
                    <span class="ios-cell__body"><span class="ios-cell__title">{{ document.originalFilename }}</span></span>
                    <app-icon class="ios-cell__chev" name="download" [size]="18" />
                  </button>
                }
              </div>
            } @else { <p class="ios-section__foot">Nog geen betaalbewijs</p> }
          </section>
          @if (row.invoice || row.invoiceFiles.length) {
            <section class="ios-section">
              <div class="ios-section__head"><h2>Factuur</h2></div>
              <div class="ios-group ios-group--icons">
                @if (row.invoice; as invoice) {
                  <button class="ios-cell" type="button" [disabled]="invoice.documentId == null" (click)="invoice.documentId != null && invoiceFile.emit({ documentId: invoice.documentId, name: invoice.number })">
                    <span class="ios-cell__lead"><span class="ios-tile ios-tile--soft tone-grey"><app-icon name="document" [size]="17" /></span></span>
                    <span class="ios-cell__body"><span class="ios-cell__title">{{ invoice.number }}</span>@if (invoice.viaSupplier) { <span class="ios-cell__sub">via de leverancier</span> }</span>
                    @if (invoice.documentId != null) { <app-icon class="ios-cell__chev" name="download" [size]="18" /> }
                  </button>
                }
                @for (document of row.invoiceFiles; track document.id) {
                  <button class="ios-cell" type="button" (click)="download.emit(document)">
                    <span class="ios-cell__lead"><span class="ios-tile ios-tile--soft tone-grey"><app-icon name="document" [size]="17" /></span></span>
                    <span class="ios-cell__body"><span class="ios-cell__title">{{ fileText(document) }}</span></span>
                    <app-icon class="ios-cell__chev" name="download" [size]="18" />
                  </button>
                }
              </div>
            </section>
          }
          @if (mode() === 'read') { <p class="ios-section__foot">Aanpassen of afrekenen kan in Bewerken.</p> }
        </div>
        <div foot style="display:contents">
          <button class="btn" type="button" (click)="detail.set(null)">Sluiten</button>
          @if (mode() === 'read') { <button class="btn btn--primary" type="button" (click)="detail.set(null); openEditor.emit()">Bewerken</button> }
        </div>
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
  /** The server knows invoices and payments in parts (paymentRoundOnServer); false hides every new action. */
  readonly roundOnServer = input(false);
  /** '{account label} · {dd/MM}' of a bank line the host has loaded; null shows plain 'op de bank'. */
  readonly bankLineLabel = input<(lineId: number) => string | null>(() => null);
  /** What the last link changed, until it is closed (editor). */
  readonly notice = input<string | null>(null);
  readonly dismissNotice = output<void>();
  /** Editor only: 'Toewijzen aan alle betalingen' of an invoice. */
  readonly assignInvoice = output<PurchaseInvoice>();
  readonly add = output<PurchasePaymentAction>();
  readonly edit = output<PurchasePayment>();
  /** 'Transactie toevoegen…' on a payment fully on the bank: its sheet opens with the bank picker. */
  readonly addTransfer = output<PurchasePayment>();
  readonly download = output<PurchaseDocument>();
  /** Editor only: add or correct an invoice, or 'Gegevens invullen' on an invoice file. */
  readonly invoice = output<InvoiceRequest>();
  /** Open the file of an invoice or of an invoice file without data (read view too). */
  readonly invoiceFile = output<{ documentId: number; name: string | null }>();
  /** Editor only: 'Inspectie via leverancier' on (true) or off. */
  readonly inspectionVia = output<boolean>();
  readonly settle = output<PurchaseSettleRequest>();
  readonly undoSettle = output<{ payee: PayeeLedger['payee']; due?: Due | null }>();
  readonly planChange = output<void>();
  readonly remove = output<PurchasePayment>();
  readonly save = output<void>();
  readonly refresh = output<void>();
  readonly openCosts = output<void>();
  /** Read view: 'Bewerken' on a payment's detail opens the editor on Betalingen. */
  readonly openEditor = output<void>();
  /** Tegoed leverancier (editor): note one, or act on an existing one. */
  readonly credit = output<SupplierCreditAction>();

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
  readonly meterOf = settledMeter;
  readonly figures = payeeFigures;
  readonly line = paymentLine;

  readonly ready = computed(() => !!this.ledger() && this.state() === 'ready');
  readonly payeeOpen = computed(() => this.ledger()?.payees.find(item => item.payee === this.openPayee()) ?? null);
  readonly payeeItems = computed(() => payeeMenuItems(this.ledger()));
  readonly supplierPayee = computed(() => this.ledger()?.payees.find(item => item.payee === 'SUPPLIER') ?? null);
  /** The supplier's terms: a payment of a netted term is settled with the whole supplier (settleWith). */
  readonly supplierTerms = computed(() => this.ledger()?.payees.find(item => item.payee === 'SUPPLIER')?.terms ?? []);
  /** What the review headline points at: overpaid, without an agreement or incomplete. */
  readonly review = computed(() => {
    const payee = this.ledger()?.summary.headline.payee;
    if (!payee) return null;
    const kind = payee.status.kind;
    return {
      amountEur: kind === 'UNBUDGETED' ? payee.paidEur : kind === 'OVERPAID' ? (payee.reviewEur > 0 ? payee.reviewEur : payee.higherEur) : null,
      text: `${payee.label}: ${kind === 'UNBUDGETED' ? 'betaald zonder afspraak' : kind === 'INCOMPLETE' ? 'bedragen onvolledig' : 'te veel betaald'}`,
    };
  });
  /** Under the card's Verschil: the payees it comes from, each with its own net figure. */
  readonly byPayee = computed(() => differenceByPayee(this.ledger()?.visible ?? []));
  /** Hoe is dit opgebouwd?: the payees, the Afspraak they add up to, then the Enrosed kost. */
  readonly bridgeRows = computed(() => {
    const book = this.ledger();
    return book ? landedChain(book.bridge, book.summary.agreedEur) : [];
  });
  readonly filterOptions = computed<SegmentOption[]>(() => [
    { id: 'ALL', label: 'Alle' }, { id: 'NO_PROOF', label: `Zonder betaalbewijs (${this.ledger()?.summary.missingProofCount ?? 0})` },
  ]);
  readonly filtered = computed(() => {
    const rows = this.ledger()?.rows ?? [];
    return this.filter() === 'NO_PROOF' && this.ledger()?.summary.missingProofCount ? rows.filter(row => row.proven === false) : rows;
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

  /** 'Proforma (PI) · PI CULINAN.xlsx', else '{file} · zonder gegevens'. */
  fileText(file: Pick<PurchaseDocument, 'kind' | 'originalFilename'>): string { return invoiceFileText(file); }
  dayShort(iso: string): string { return iso.slice(8, 10) + '/' + iso.slice(5, 7); }

  /** The one status word of a payee row; the desk keeps the ledger's longer label. */
  wordOf(item: PayeeLedger): { word: string; tone: PhoneTone } { return payeeWord(item.status); }
  /** The bank mark of a payment row, with the words a mark alone does not say. */
  mark(row: LedgerRow): ReturnType<typeof proofMark> { return proofMark(bankProofSub(row), { linked: row.bank.linked, creditOffset: !!row.creditOffset }); }
  /** A Verschil row only once the payees differ from the Afspraak, or an overpayment waits for a review. */
  hasVerschil(sum: LedgerSummary): boolean { return Math.round(sum.differenceEur * 100) !== 0 || sum.reviewEur > 0; }
  verschilOf(sum: LedgerSummary): PhoneAmount { return verschilText(sum); }
  /** 'na afrekening', 'nog na te kijken' or the koersverschil, unless the amount's own word already says it. */
  verschilNote(sum: LedgerSummary, verschil: PhoneAmount): string {
    const note = ledgerDifferenceNote(sum);
    return verschil.text.endsWith(note) ? '' : note;
  }
  amountTone(tone: PhoneAmount['tone']): string { return tone === 'in' ? 'wk-amount--in' : tone === 'warn' ? 'wk-amount--warn' : ''; }
  pillTone(tone: string): string { return tone === 'ok' ? 'wk-amount--in' : tone === 'warn' ? 'wk-amount--warn' : 'wk-amount--muted'; }

  /** '10/09 · € 10.000,00' of one transfer. */
  partTitle(part: LedgerRow['parts'][number]): string {
    return `${part.paidOn.slice(8, 10)}/${part.paidOn.slice(5, 7)} · ${Number.isFinite(part.amountEur) ? formatEur(part.amountEur) : '—'}`;
  }

  /** 'op de bank · KBC' or 'niet op de bank'. */
  partBank(part: LedgerRow['parts'][number]): string {
    if (!part.onBank) return 'niet op de bank';
    const label = part.bankStatementLineId != null ? this.bankLineLabel()(part.bankStatementLineId) : null;
    return 'op de bank' + (label ? ' · ' + label.split(' · ')[0] : '');
  }
  finite(value: number): boolean { return Number.isFinite(value); }
  actor(value: string): string { return value.replace(/^.*[\\/]/, '').split('@')[0]; }

  /** 'Leverancier, Afgerekend, € 50.723,90 van € 52.021,07 betaald': the row as it reads. */
  payeeName(item: PayeeLedger): string {
    return `${item.label}, ${payeeWord(item.status).word}, ${payeeFigures(item)}`;
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
    const row = this.ledger()?.rows.find(item => item.parts.some(part => part.id === payment.id));
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

  rowItems(row: LedgerRow): ContextMenuItem[] { return paymentMenuItems(row, { move: false, busy: this.busy(), addTransfer: this.mode() === 'edit' && this.roundOnServer() }); }

  pickRow(row: LedgerRow, item: ContextMenuItem): void {
    this.rowMenu.set(null);
    if (item.id.startsWith('open:')) {
      const document = row.proofs?.find(proof => 'open:' + proof.id === item.id);
      if (document) this.download.emit(document);
      return;
    }
    if (item.id.startsWith('invoice-file:')) {
      const document = row.invoiceFiles.find(file => 'invoice-file:' + file.id === item.id);
      if (document) this.download.emit(document);
      return;
    }
    switch (item.id) {
      case 'edit': this.edit.emit(row.payment); break;
      case 'add-transfer': this.addTransfer.emit(row.payment); break;
      case 'invoice-file': if (row.invoice?.documentId != null) this.invoiceFile.emit({ documentId: row.invoice.documentId, name: row.invoice.number }); break;
      case 'settle': this.settle.emit(settleWith(row, this.supplierTerms())); break;
      case 'remove': if (row.parts.length < 2) this.remove.emit(row.payment); break;
    }
  }

  todoIcon(todo: LedgerTodo): string {
    switch (todo.kind) {
      case 'pay': return PAYEE_ICON[todo.payee];
      case 'settle': return 'tick';
      case 'credit': return 'receipt';
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
      case 'incomplete': case 'credit': this.openPayee.set(todo.payee); break;
      case 'proof': this.setFilter('NO_PROOF'); break;
    }
  }

}
