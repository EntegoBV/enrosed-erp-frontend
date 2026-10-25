import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import type { PurchaseDocument, PurchaseInvoice, PurchaseInvoiceFile, PurchasePayment } from '../../core/api/models';
import { ContextMenu, type ContextMenuItem } from '../../shared/context-menu';
import type { MenuPoint } from '../../shared/context-menu-position';
import { Icon } from '../../shared/icon';
import { MenuTrigger } from '../../shared/menu-trigger';
import { CurPipe, DateNlPipe, EurPipe } from '../../shared/pipes';
import { Sheet } from '../../shared/ui';
import {
  DUE_MOMENT, SUPPLIER_GOODS_CIF, differenceLines, type Due, type LedgerCredit, type LedgerRow, type LedgerTerm, type PayeeLedger, type PurchasePaymentAction, type PurchaseSettleRequest,
  type SupplierCreditAction,
} from './purchase-payment-ledger';
import {
  bankProofSub, creditMenuItems, dayOf, monthOf, paymentMenuItems, settleWith, termHasMenu, termMenuItems, termOpen, termPayment, toneClass,
} from './purchase-payment-menus';
import { invoiceCoverage, invoiceFileKind, invoiceSub, invoiceTermsLine, payeeInvoiceComparison } from './purchase-invoices';
import type { InvoiceRequest } from './purchase-payment-workbench';

/**
 * One payee on the phone: its agreement as a receipt, its invoices, its terms
 * or what the agreement is made of, and its own payments. Every action closes
 * this sheet before it is reported, so sheets never stack; only a menu opens
 * on top.
 */
@Component({
  selector: 'app-purchase-payee-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, Sheet, ContextMenu, Icon, MenuTrigger, EurPipe, CurPipe, DateNlPipe],
  template: `
    @let item = payee();
    <app-sheet [title]="item.label" variant="ios" (closed)="closed.emit()">
      <div body class="payee-sheet">
        <p class="payee-sheet__lead"><b [class]="tone(item.status.tone)">{{ item.status.label }}</b> · {{ basis() }}</p>
        <div class="ios-card payee-sheet__receipt">
          @if (item.payee === 'OTHER') {
            <dl class="wk-equation"><div class="is-total"><dt>Betaald</dt><dd>{{ item.paidEur | eur }}</dd></div></dl>
          } @else {
            <dl class="wk-equation">
              <div><dt>Afspraak</dt><dd>{{ item.agreedEur | eur }}</dd></div>
              <div><dt><span class="wk-equation__op" aria-hidden="true">−</span>Betaald</dt><dd>{{ item.paidEur | eur }}</dd></div>
              @for (line of differenceLines(item); track line.label) { <div><dt><span class="wk-equation__op" aria-hidden="true">{{ line.op }}</span>{{ line.label }}</dt><dd>{{ line.eur | eur }}</dd></div> }
              <div class="is-total"><dt>Open</dt><dd>{{ item.openEur | eur }}</dd></div>
            </dl>
            @if (item.openEur > 0) {
              <p class="payee-sheet__split">@if (item.dueNowEur > 0) { Nu te betalen {{ item.dueNowEur | eur }}@if (item.laterEur > 0) { · Later {{ item.laterEur | eur }}@if (item.laterDue) { ({{ moment(item.laterDue) }}) } } } @else { Later {{ item.laterEur | eur }}@if (item.laterDue) { ({{ moment(item.laterDue) }}) } }</p>
            }
          }
        </div>

        @if (showInvoices()) {
          <section class="ios-section">
            <div class="ios-section__head"><h2>Factuur</h2></div>
            @if (item.invoices.length || item.invoiceFiles.length || (mode() === 'edit' && roundOnServer())) {
              <div class="ios-group">
                @for (invoice of item.invoices; track invoice.id; let first = $first) {
                  @let cover = coverage(invoice);
                  <button class="ios-cell payee-sheet__invoice" type="button" [disabled]="mode() !== 'edit' && invoice.documentId == null" (click)="tapInvoice(invoice)">
                    <span class="ios-cell__body"><span class="ios-cell__title">{{ invoice.number }}@if (!first) { · extra factuur }</span>
                      <span class="ios-cell__sub">{{ invoiceText(invoice, first) }}</span>
                      <!-- What the invoice covers belongs to the invoice: its payments, and for the supplier's main invoice its terms. -->
                      <span class="ios-cell__sub">{{ cover.text }}</span>
                      @if (first && termsLine(); as line) { <span class="ios-cell__sub">{{ line }}</span> }</span>
                    @if (mode() === 'edit' || invoice.documentId != null) { <app-icon class="ios-cell__chev" [name]="mode() === 'edit' ? 'chevron-right' : 'download'" [size]="16" /> }
                  </button>
                  @if (mode() === 'edit' && roundOnServer() && !cover.all) {
                    <button class="ios-cell ios-cell--action payee-sheet__assign" type="button" [disabled]="busy()" (click)="close(assignAll(invoice))">Toewijzen aan alle betalingen</button>
                  }
                } @empty {
                  @if (mode() === 'edit' && roundOnServer()) {
                    <button class="ios-cell ios-cell--action" type="button" [disabled]="busy()" (click)="close(addInvoice)">Factuur toevoegen</button>
                  }
                }
                @if (item.invoiceFiles.length > 3 && !filesOpen()) {
                  <button class="ios-cell ios-cell--action" type="button" (click)="filesOpen.set(true)">{{ item.invoiceFiles.length }} factuurbestanden zonder gegevens ›</button>
                } @else {
                  @for (file of item.invoiceFiles; track file.documentId) {
                    <!-- The name and its words get the whole width; 'Gegevens invullen' goes on its own line under them. -->
                    <div class="ios-cell payee-sheet__filecell">
                      <button class="ios-cell__body payee-sheet__file" type="button" (click)="invoiceFile.emit({ documentId: file.documentId, name: file.originalFilename })">
                        <span class="ios-cell__title">{{ file.originalFilename }}</span><span class="ios-cell__sub">{{ fileKind(file) }}</span></button>
                      @if (mode() === 'edit') { <button class="ios-capsule ios-capsule--tinted payee-sheet__fill" type="button" [disabled]="busy()" (click)="fillIn(file)">Gegevens invullen</button> }
                    </div>
                  }
                }
              </div>
            }
            @if (item.viaSupplier && !item.invoices.length) {
              <p class="ios-section__foot">{{ item.supplierInvoice ? 'Factuur via leverancier · ' + item.supplierInvoice.number : 'Factuur van de leverancier nog niet ingevoerd' }}</p>
            }
          </section>
        }

        @if (item.payee === 'SUPPLIER' && item.terms.length) {
          <section class="ios-section">
            <div class="ios-section__head"><h2>Termijnen</h2></div>
            <div class="ios-group">
              @for (term of item.terms; track term.due) {
                <button class="ios-cell payee-sheet__term" type="button" [class.payee-sheet__term--done]="!termTappable(term)" (click)="tapTerm(term, $event)">
                  <span class="ios-cell__body"><span class="ios-cell__title">{{ term.label }}</span><span class="ios-cell__sub">{{ term.paidEur | eur }} van {{ term.fullEur | eur }}@if (term.differenceEur) { · {{ abs(term.differenceEur) | eur }} {{ term.differenceEur < 0 ? 'minder' : 'meer' }} }</span>
                    @if (term.statusNote) { <span class="ios-cell__sub">{{ term.statusNote }}</span> }</span>
                  <span class="ios-cell__trail">
                    @if (termActionable(term) || term.status.tone === 'warn') { <span class="ios-cell__meta" [class]="tone(term.status.tone)">{{ term.status.label }}</span> }
                    @else { <span class="ios-cell__meta wk-amount--in"><app-icon name="tick" [size]="12" /> {{ term.status.label }}</span> }
                  </span>
                  @if (termTappable(term)) { <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" /> }
                </button>
              }
            </div>
          </section>
        } @else if (item.composition.length) {
          <section class="ios-section">
            <div class="ios-section__head"><h2>Opbouw van de afspraak</h2></div>
            <div class="ios-group">
              @for (line of item.composition; track line.label) {
                <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">{{ line.label }}</span>@if (line.hint) { <span class="ios-cell__sub">{{ line.hint }}</span> }</span>
                  <span class="ios-cell__trail"><span class="ios-cell__value">{{ line.amountEur | eur }}</span></span></div>
              }
            </div>
            <p class="ios-section__foot">{{ item.compositionConsistent ? 'Betalingen worden per ontvanger bijgehouden, niet per kostenregel.' : 'Opbouw uit Kosten; wijkt af van de afspraak.' }}</p>
          </section>
        }

        @if (item.payee === 'SUPPLIER' && item.credits.length) {
          <section class="ios-section">
            <div class="ios-section__head"><h2>Tegoed leverancier</h2><span class="ios-section__trail">{{ item.creditEur | eur }}</span></div>
            <div class="ios-group">
              @for (credit of item.credits; track credit.id) {
                <ng-template #creditCell>
                  <span class="ios-cell__body"><span class="ios-cell__title">{{ credit.reasonLabel }}</span>
                    <span class="ios-cell__sub">genoteerd {{ credit.notedOn | dateNl }}@if (credit.note) { · {{ credit.note }} }</span></span>
                  <span class="ios-cell__trail">
                    <span class="ios-cell__value ios-cell__value--strong wk-amount--in">− {{ credit.amountEur | eur }}</span>
                    <span class="ios-cell__meta" [class]="tone(credit.tone)">{{ credit.statusLabel }}</span>
                  </span>
                </ng-template>
                @if (mode() === 'edit' && creditItems(credit).length) {
                  <button class="ios-cell" type="button" (click)="tapCredit(credit, $event)">
                    <ng-container [ngTemplateOutlet]="creditCell" /><app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
                  </button>
                } @else {
                  <div class="ios-cell"><ng-container [ngTemplateOutlet]="creditCell" /></div>
                }
              }
            </div>
            <p class="ios-section__foot">@if (item.creditOpenEur > 0) { Nog {{ item.creditOpenEur | eur }} te ontvangen. }Een tegoed verlaagt de eindkost; Betaald en Open blijven gelijk.</p>
          </section>
        }

        <section class="ios-section">
          <div class="ios-section__head"><h2>Betalingen</h2>@if (item.proof; as proof) { <span class="ios-section__trail">Betaalbewijs: {{ proof.withProof }} van {{ proof.total }}</span> }</div>
          @if (item.rows.length) {
            <div class="ios-group">
              @for (row of item.rows; track row.id) {
                <button class="ios-cell pp-row" type="button" appMenuTrigger [appMenuTriggerDisabled]="mode() !== 'edit'"
                        (menuTrigger)="rowMenu.set({ row, point: $event })" (click)="$event.defaultPrevented || act('edit', row.payment)">
                  <span class="pp-row__date" aria-hidden="true"><b>{{ day(row.paidOn) }}</b><small>{{ month(row.paidOn) }}</small></span>
                  <span class="ios-cell__body"><span class="ios-cell__title">{{ row.title }}</span>
                    <span class="ios-cell__sub">{{ row.termLabel || row.payeeShort }}@if (row.parts.length > 1) { · {{ row.parts.length }} transacties · eerste {{ dayShort(row.firstPaidOn) }} }@if (row.settlesLabel) { · {{ row.settlesLabel }} }</span>
                    @if (proofText(row); as text) { <span class="ios-cell__sub" [class.pp-row__bank]="row.bank.linked > 0" [class.pp-row__proof]="!row.bank.linked">@if (!row.creditOffset) { <app-icon [name]="row.bank.linked ? 'bank' : 'clip'" [size]="12" /> } {{ text }}</span> }</span>
                  <span class="ios-cell__trail">
                    <span class="ios-cell__value ios-cell__value--strong">@if (finite(row.amountEur)) { {{ row.amountEur | eur }} } @else { — }</span>
                    @if (row.foreign) { <span class="ios-cell__meta">{{ row.amount | cur: row.currency }}</span> }
                    @if (row.proven === false) { <span class="ios-cell__meta wk-amount--warn">geen betaalbewijs</span> }
                  </span>
                </button>
              }
            </div>
          } @else {
            <p class="ios-section__foot">Nog geen betalingen aan {{ item.label }}.</p>
          }
        </section>

        @if (mode() === 'edit' && (item.payee === 'SUPPLIER' || item.canUndoSettle || invoiceLink() || (roundOnServer() && item.payee === 'SEPARATE'))) {
          <div class="payee-sheet__links">
            @if (item.payee === 'SUPPLIER') { <button class="ios-section__link" type="button" [disabled]="busy()" (click)="act('plan')">Betaalplan wijzigen</button> }
            @if (item.payee === 'SUPPLIER') { <button class="ios-section__link" type="button" [disabled]="busy()" (click)="close(creditAdd)">Tegoed noteren…</button> }
            @if (invoiceLink()) { <button class="ios-section__link" type="button" [disabled]="busy()" (click)="close(addInvoice)">Factuur toevoegen…</button> }
            @if (roundOnServer() && item.payee === 'SEPARATE') {
              <button class="ios-section__link" type="button" [disabled]="busy()" (click)="close(toggleVia)">Inspectie via leverancier: {{ item.viaSupplier ? 'aan' : 'uit' }}</button>
            }
            @if (item.canUndoSettle) { <button class="ios-section__link" type="button" [disabled]="busy()" (click)="act('undo')">Afrekening ongedaan maken</button> }
          </div>
        }
      </div>
      <div foot style="display:contents">
        @if (item.dueNowEur > 0) {
          <button class="btn btn--primary" type="button" [disabled]="busy()" (click)="act('add')">Noteer {{ item.dueNowEur | eur }}</button>
          @if (mode() === 'edit' && item.canSettle) { <button class="btn" type="button" [disabled]="busy()" (click)="act('settle')">Afrekenen…</button> }
        } @else if (mode() === 'edit' && item.canSettle) {
          <button class="btn btn--primary" type="button" [disabled]="busy()" (click)="act('settle')">
            @if (item.smallDifference) { Verschil van {{ item.openEur | eur }} afrekenen } @else { Afrekenen… }
          </button>
          <button class="btn" type="button" [disabled]="busy()" (click)="act('add')">Extra betaling noteren</button>
        } @else {
          <button class="btn" type="button" [disabled]="busy()" (click)="act('add')">{{ item.openEur > 0 ? 'Betaling noteren' : 'Extra betaling noteren' }}</button>
        }
      </div>
    </app-sheet>
    @if (termMenu(); as open) {
      <app-context-menu [title]="open.term.label" variant="ios" cancelLabel="Annuleren" [anchor]="open.point"
                        [items]="termItems(open.term)" (pick)="pickTerm(open.term, $event)" (closed)="termMenu.set(null)" />
    }
    @if (creditMenu(); as open) {
      <app-context-menu [title]="'Tegoed · ' + open.credit.reasonLabel" variant="ios" cancelLabel="Annuleren" [anchor]="open.point"
                        [items]="creditItems(open.credit)" (pick)="pickCredit(open.credit, $event)" (closed)="creditMenu.set(null)" />
    }
    @if (rowMenu(); as open) {
      <app-context-menu [title]="open.row.title" variant="ios" cancelLabel="Annuleren" [anchor]="open.point"
                        [items]="rowItems(open.row)" (pick)="pickRow(open.row, $event)" (closed)="rowMenu.set(null)" />
    }
  `,
})
export class PurchasePayeeSheet {
  readonly payee = input.required<PayeeLedger>();
  readonly mode = input<'read' | 'edit'>('read');
  readonly busy = input(false);
  readonly dirty = input(false);
  readonly supplierName = input('');
  readonly planLabel = input('');
  /** The server knows invoices (paymentRoundOnServer); false hides adding them and the inspection switch. */
  readonly roundOnServer = input(false);
  /** The supplier's ledger, for the terms its invoice covers. */
  readonly supplier = input<PayeeLedger | null>(null);
  readonly add = output<PurchasePaymentAction>();
  readonly edit = output<PurchasePayment>();
  /** 'Transactie toevoegen…' on a payment fully on the bank. */
  readonly addTransfer = output<PurchasePayment>();
  readonly download = output<PurchaseDocument>();
  /** Editor only: add or correct an invoice, or fill in an invoice file. */
  readonly invoice = output<InvoiceRequest>();
  readonly invoiceFile = output<{ documentId: number; name: string | null }>();
  /** Editor only: 'Inspectie via leverancier' on (true) or off. */
  readonly inspectionVia = output<boolean>();
  /** Editor only: 'Toewijzen aan alle betalingen' of an invoice. */
  readonly assignInvoice = output<PurchaseInvoice>();
  readonly settle = output<PurchaseSettleRequest>();
  readonly undoSettle = output<{ payee: PayeeLedger['payee']; due?: Due | null }>();
  readonly planChange = output<void>();
  readonly remove = output<PurchasePayment>();
  readonly closed = output<void>();
  /** Tegoed leverancier: note one, or act on an existing one (editor only). */
  readonly credit = output<SupplierCreditAction>();

  readonly termMenu = signal<{ term: LedgerTerm; point: MenuPoint } | null>(null);
  readonly rowMenu = signal<{ row: LedgerRow; point: MenuPoint } | null>(null);
  readonly creditMenu = signal<{ credit: LedgerCredit; point: MenuPoint } | null>(null);
  readonly creditAdd = () => this.credit.emit({ kind: 'add' });
  readonly addInvoice = () => this.invoice.emit({ payee: this.payee().payee });
  readonly toggleVia = () => this.inspectionVia.emit(!this.payee().viaSupplier);
  readonly assignAll = (invoice: PurchaseInvoice) => () => this.assignInvoice.emit(invoice);
  readonly filesOpen = signal(false);
  readonly tone = toneClass;
  readonly day = dayOf;
  readonly month = monthOf;
  readonly abs = Math.abs;
  readonly differenceLines = differenceLines;
  readonly proofText = bankProofSub;
  /** Leverancier, Transport and Inspectie always; Bijkomende kosten only once it has invoices or invoice files. */
  readonly showInvoices = computed(() => {
    const item = this.payee();
    if (item.payee !== 'OTHER') return item.invoices.length > 0 || item.invoiceFiles.length > 0 || item.viaSupplier || (this.mode() === 'edit' && this.roundOnServer());
    return item.invoices.length > 0 || item.invoiceFiles.length > 0;
  });
  /**
   * 'Factuur toevoegen…' among the links: for an extra invoice, or for
   * Bijkomende kosten while it shows no Factuur section. An empty Factuur
   * section already offers 'Factuur toevoegen', so it is never there twice.
   */
  readonly invoiceLink = computed(() => this.roundOnServer() && (!this.showInvoices() || this.payee().invoices.length > 0));
  /** 'dekt 30% bij bestelling + 70% bij vertrek' under the supplier's invoice. */
  readonly termsLine = computed(() => {
    const item = this.payee();
    return item.payee === 'SUPPLIER' && item.invoices.length ? invoiceTermsLine(item.terms) : '';
  });
  readonly basis = computed(() => {
    const payee = this.payee();
    switch (payee.payee) {
      case 'SUPPLIER': return [this.supplierName(), payee.basis.startsWith(SUPPLIER_GOODS_CIF) ? 'goederen + zeevracht (CIF)' : '',
        payee.terms.length ? this.planLabel() : 'geen betaalplan'].filter(Boolean).join(' · ');
      case 'OTHER': return 'Bankkosten, koerier, wisselkoers · zonder afspraak';
      case 'LOGISTICS': return payee.basis.endsWith('(CIF)') ? 'Afspraak uit Kosten · zeevracht via de leverancier (CIF)' : 'Afspraak uit Kosten';
      // 'Afspraak inspectie € 300,00 · via leverancier': the owner's word, with what it is made of.
      case 'SEPARATE': return payee.basis;
      default: return 'Afspraak uit Kosten';
    }
  });

  moment(due: Due): string { return DUE_MOMENT[due]; }
  dayShort(iso: string): string { return iso.slice(8, 10) + '/' + iso.slice(5, 7); }

  /** 'Geldt voor alle betalingen van Leverancier (3)' or 'Geldt voor 2 van 3 betalingen van Leverancier'. */
  coverage(invoice: PurchaseInvoice): { all: boolean; text: string } { return invoiceCoverage(invoice, this.payee().rows, this.payee().label); }

  /** '20/08/2026 · € 31.048,04 · gelijk aan de afspraak' (the comparison on the primary only). */
  invoiceText(invoice: PurchaseInvoice, primary: boolean): string {
    return invoiceSub(invoice, primary ? payeeInvoiceComparison(this.payee())?.text ?? null : null);
  }

  /** The editor corrects the invoice; the read view opens its file. */
  tapInvoice(invoice: PurchaseInvoice): void {
    if (this.mode() === 'edit') { this.close(() => this.invoice.emit({ payee: this.payee().payee, invoice })); return; }
    if (invoice.documentId != null) this.invoiceFile.emit({ documentId: invoice.documentId, name: invoice.documentName });
  }

  /** 'Proforma (PI)' or 'Factuurbestand zonder gegevens' under the file's name. */
  fileKind(file: PurchaseInvoiceFile): string { return invoiceFileKind(file); }
  fillIn(file: PurchaseInvoiceFile): void {
    this.close(() => this.invoice.emit({ payee: this.payee().payee, file }));
  }
  finite(value: number): boolean { return Number.isFinite(value); }
  termActionable(term: LedgerTerm): boolean { return termOpen(term); }
  /** The read view only records what is open; the editor also opens a paid term's menu (settle, undo, correct its payment). */
  termTappable(term: LedgerTerm): boolean { return this.mode() === 'edit' ? termHasMenu(term) : termOpen(term); }

  tapTerm(term: LedgerTerm, event: MouseEvent): void {
    if (!this.termTappable(term) || this.busy()) return;
    if (this.mode() === 'edit') { this.termMenu.set({ term, point: { x: event.clientX, y: event.clientY } }); return; }
    this.close(() => this.add.emit({ payee: 'SUPPLIER', amount: term.openEur, label: term.label, due: term.due }));
  }

  termItems(term: LedgerTerm): ContextMenuItem[] { return termMenuItems(term, this.busy()); }

  pickTerm(term: LedgerTerm, item: ContextMenuItem): void {
    this.termMenu.set(null);
    switch (item.id) {
      case 'add': this.close(() => this.add.emit({ payee: 'SUPPLIER', amount: term.openEur, label: term.label, due: term.due })); break;
      case 'undo': this.close(() => this.undoSettle.emit({ payee: 'SUPPLIER', due: term.due })); break;
      case 'edit': {
        const row = termPayment(term, this.payee().rows);
        if (row) this.act('edit', row.payment);
        break;
      }
      default: this.close(() => this.settle.emit({ payee: 'SUPPLIER', scope: 'TERM', due: term.due }));
    }
  }

  creditItems(credit: LedgerCredit): ContextMenuItem[] { return creditMenuItems(credit, this.busy()); }

  tapCredit(credit: LedgerCredit, event: MouseEvent): void {
    if (this.mode() !== 'edit' || this.busy() || !this.creditItems(credit).length) return;
    this.creditMenu.set({ credit, point: { x: event.clientX, y: event.clientY } });
  }

  pickCredit(credit: LedgerCredit, item: ContextMenuItem): void {
    this.creditMenu.set(null);
    const kind = item.id as 'refund' | 'offset' | 'edit' | 'remove' | 'undo-refund' | 'open-offset';
    this.close(() => this.credit.emit({ kind, credit: credit.credit }));
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
      case 'edit': this.act('edit', row.payment); break;
      case 'add-transfer': this.close(() => this.addTransfer.emit(row.payment)); break;
      case 'invoice-file': if (row.invoice?.documentId != null) this.invoiceFile.emit({ documentId: row.invoice.documentId, name: row.invoice.number }); break;
      case 'settle': this.close(() => this.settle.emit(settleWith(row, this.payee().terms))); break;
      case 'remove': if (row.parts.length < 2) this.close(() => this.remove.emit(row.payment)); break;
    }
  }

  act(action: 'add' | 'settle' | 'undo' | 'plan' | 'edit', payment?: PurchasePayment): void {
    const payee = this.payee();
    switch (action) {
      case 'add': this.close(() => this.add.emit(payee.next?.payee === payee.payee && payee.next.now
        ? { payee: payee.payee, amount: payee.next.amountEur, label: payee.next.label, due: payee.next.due } : { payee: payee.payee })); break;
      case 'settle': this.close(() => this.settle.emit(payee.settleDefault)); break;
      case 'undo': this.close(() => this.undoSettle.emit({ payee: payee.payee })); break;
      case 'plan': this.close(() => this.planChange.emit()); break;
      case 'edit': if (payment) this.close(() => this.edit.emit(payment)); break;
    }
  }

  /**
   * The sheet goes first, then the host acts, so the next sheet never opens on
   * top of this one. The overview defers the act by a task: outputs of this
   * sheet stop working once it is destroyed, so the delay cannot live here.
   */
  close(then: () => void): void {
    this.closed.emit();
    then();
  }
}
