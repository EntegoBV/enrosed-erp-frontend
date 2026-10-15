import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, output, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { Currency, Payee, PurchaseInvoice, PurchaseInvoiceFile, PurchaseInvoiceWrite } from '../../core/api/models';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { DateField } from '../../shared/date-field';
import { Segmented, type SegmentOption } from '../../shared/segmented';
import { Sheet } from '../../shared/ui';
import { parsePurchasePaymentAmount } from './purchase-payment-amount';
import { PAYEE_LABEL, PAYEE_ORDER, PAYEE_SHORT } from './purchase-payment-ledger';
import { invoiceComparison, primaryInvoice } from './purchase-invoices';

/**
 * What opens the invoice sheet: a new invoice for a payee, an existing one to
 * correct, or 'Gegevens invullen' on an invoice file that has no data yet.
 * `documentId` holds a file the host already uploaded on an earlier try, so a
 * retry never uploads it twice.
 */
export interface InvoiceSheetAction {
  payee: Payee;
  invoice?: PurchaseInvoice;
  file?: PurchaseInvoiceFile;
  documentId?: number | null;
  documentName?: string | null;
}

/** What the host writes once the sheet is confirmed: upload the new file (if any), then POST or PUT. */
export interface InvoiceSheetSubmit {
  invoiceId: number | null;
  body: PurchaseInvoiceWrite;
  file: File | null;
}

interface InvoiceForm {
  payee: Payee;
  number: string;
  invoiceDate: string;
  amountInput: string;
  currency: Currency;
  amountEurInput: string;
  notes: string;
  file: File | null;
  /** The stored file stays unless 'Ander bestand' was chosen. */
  replaceFile: boolean;
}

let nextSheetId = 0;
const amountText = (value: number | null | undefined): string =>
  value != null && value > 0 ? value.toLocaleString('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false }) : '';

/** Today on this device as yyyy-mm-dd. */
function localIsoDay(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Factuur toevoegen / aanpassen, on the desk and the phone: the number, date
 * and amount of a container's invoice, with its file. Invoices of one payee
 * add up against its Afspraak (a second one is extra on top; a correction is
 * made on the first). The sheet only shows and reports; the host uploads,
 * writes and refreshes.
 */
@Component({
  selector: 'app-purchase-invoice-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Sheet, Segmented, DateField],
  template: `
    @let form = state();
    <app-sheet [title]="action().invoice ? 'Factuur aanpassen' : 'Factuur toevoegen'" variant="ios" [wide]="true" (closed)="cancel.emit()">
      <div body class="pay-sheet invoice-sheet" [attr.inert]="busy() ? '' : null">
        <div class="pay-sheet__who">
          <span class="pay-sheet__label">Bij wie?</span>
          <app-segmented label="Bij wie?" [variant]="desk() ? 'desk' : 'ios'" [options]="payees" [value]="form.payee" (changed)="patch({ payee: $any($event) })" />
        </div>
        <div class="form-grid pay-sheet__grid">
          <div class="field">
            <label [for]="ids + '-number'">Factuurnummer</label>
            <input class="input" [id]="ids + '-number'" maxlength="64" autocomplete="off" placeholder="Bijv. CI-2026-118"
                   [ngModel]="form.number" (ngModelChange)="patch({ number: $event })" />
          </div>
          <div class="field">
            <label [for]="ids + '-date'">Factuurdatum</label>
            <app-date-field [fieldId]="ids + '-date'" [value]="form.invoiceDate" (valueChange)="patch({ invoiceDate: $event })" />
            @if (form.invoiceDate > today) { <span class="hint hint--warn" role="alert">De factuurdatum kan niet in de toekomst liggen.</span> }
          </div>
          <div class="field span-2 pay-sheet__amount">
            <label [for]="ids + '-amount'">Bedrag</label>
            <div class="input-affix">
              <input class="input num right" [id]="ids + '-amount'" type="text" inputmode="decimal" autocomplete="off"
                     [ngModel]="form.amountInput" (ngModelChange)="setAmount($event)" />
              <select class="input-affix__suffix" aria-label="Munt" [ngModel]="form.currency" (ngModelChange)="patch({ currency: $event, amountEurInput: '' })">
                <option value="EUR">EUR</option><option value="USD">USD</option><option value="CNY">CNY</option>
              </select>
            </div>
            @if (form.amountInput && amount() === null) { <span class="hint hint--warn" role="alert">Vul een positief bedrag in, bijvoorbeeld 31.048,04.</span> }
            @if (agreedLine(); as line) { <span class="hint" [class.hint--warn]="line.warn">{{ line.text }}</span> }
            @if (extraHint(); as hint) { <span class="hint">{{ hint }}</span> }
          </div>
          @if (form.currency !== 'EUR') {
            <div class="field span-2">
              <label [for]="ids + '-eur'">In euro <span class="opt"></span></label>
              <div class="input-affix">
                <input class="input num right" [id]="ids + '-eur'" type="text" inputmode="decimal" autocomplete="off"
                       [ngModel]="form.amountEurInput" (ngModelChange)="patch({ amountEurInput: $event })" />
                <span class="input-affix__suffix">EUR</span>
              </div>
              @if (form.amountEurInput && amountEur() === null) { <span class="hint hint--warn" role="alert">Vul een positief bedrag in, of laat het leeg.</span> }
              @else { <span class="hint">Leeg laten = orderkoers</span> }
            </div>
          }
          <div class="field span-2">
            <span class="label">Bestand <span class="opt"></span></span>
            @if (storedFile() && !form.replaceFile) {
              <div class="invoice-sheet__file">
                <span>{{ storedFile()!.name }}</span>
                <button class="btn btn--sm" type="button" (click)="openFile.emit(storedFile()!.documentId)">Openen</button>
                <button class="btn btn--sm" type="button" (click)="patch({ replaceFile: true })">Ander bestand</button>
              </div>
            } @else {
              <input class="input" [id]="ids + '-file'" type="file" accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.doc,.docx"
                     [attr.aria-label]="'Bestand van de factuur'" (change)="patch({ file: $any($event.target).files?.[0] ?? null })" />
              <span class="hint">{{ form.file ? form.file.name + ' · ' : '' }}PDF, foto of Office-bestand, tot 25 MB.</span>
              @if (storedFile() && form.replaceFile) { <span class="hint">Het vorige bestand blijft bij de container als factuurbestand zonder gegevens; na het bewaren kun je het verwijderen.</span> }
            }
          </div>
          <div class="field span-2">
            <label [for]="ids + '-notes'">Notitie <span class="opt"></span></label>
            <textarea class="textarea" [id]="ids + '-notes'" rows="2" maxlength="500" placeholder="Bijv. extra factuur voor meerlevering"
                      [ngModel]="form.notes" (ngModelChange)="patch({ notes: $event })"></textarea>
          </div>
        </div>
        @if (action().invoice; as invoice) {
          <button class="pay-sheet__delete" type="button" [disabled]="busy()" (click)="remove.emit(invoice)">Verwijderen</button>
        }
      </div>
      <div foot style="display:contents">
        <button class="btn" type="button" (click)="cancel.emit()">Annuleren</button>
        <button class="btn btn--primary" type="button" [disabled]="busy() || !submission()" (click)="confirm()">{{ busy() ? 'Bezig…' : 'Factuur bewaren' }}</button>
      </div>
    </app-sheet>
  `,
  styles: `.invoice-sheet__file { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; } .invoice-sheet__file span { flex: 1 1 160px; min-width: 0; overflow-wrap: anywhere; }`,
})
export class PurchaseInvoiceSheet {
  private readonly viewport = inject(DesktopViewport);
  readonly action = input.required<InvoiceSheetAction>();
  /** Every invoice of the container, for the comparison and the 'Telt op bij' hint. */
  readonly invoices = input<readonly PurchaseInvoice[]>([]);
  /** The Afspraak per payee in euro (null: no agreement, e.g. Bijkomende kosten). */
  readonly agreed = input<Partial<Record<Payee, number | null>>>({});
  /** The inspection's own Afspraak, for 'gelijk aan de afspraak + inspectie'. */
  readonly inspectionAgreedEur = input(0);
  /** The order rate, for the live comparison of a USD/CNY invoice without its euro. */
  readonly eurOf = input<(amount: number, currency: Currency, payee: Payee) => number>((amount) => amount);
  readonly busy = input(false);
  readonly submit = output<InvoiceSheetSubmit>();
  readonly remove = output<PurchaseInvoice>();
  readonly openFile = output<number>();
  readonly cancel = output<void>();

  readonly ids = `invoice-sheet-${++nextSheetId}`;
  readonly today = localIsoDay();
  readonly desk = computed(() => this.viewport.active());
  readonly payees: SegmentOption[] = PAYEE_ORDER.map(payee => ({ id: payee, label: PAYEE_SHORT[payee], ariaLabel: PAYEE_LABEL[payee] }));

  readonly state = linkedSignal<InvoiceSheetAction, InvoiceForm>({
    source: () => this.action(),
    // Only a new action resets the form: the host's retry state (an uploaded file) does not wipe what was typed.
    computation: (action, previous) => untracked(() => {
      if (previous && previous.source.invoice?.id === action.invoice?.id && previous.source.file?.documentId === action.file?.documentId
        && previous.source.payee === action.payee) {
        return action.documentId != null ? { ...previous.value, file: null } : previous.value;
      }
      const invoice = action.invoice;
      if (invoice) {
        return { payee: invoice.payee, number: invoice.number, invoiceDate: invoice.invoiceDate, amountInput: amountText(invoice.amount),
          currency: invoice.currency, amountEurInput: invoice.currency === 'EUR' ? '' : amountText(invoice.amountEur), notes: invoice.notes ?? '',
          file: null, replaceFile: false };
      }
      return { payee: action.payee, number: '', invoiceDate: localIsoDay(), amountInput: '', currency: 'EUR', amountEurInput: '', notes: '',
        file: null, replaceFile: false };
    }),
  });

  readonly amount = computed(() => parsePurchasePaymentAmount(this.state().amountInput));
  readonly amountEur = computed(() => parsePurchasePaymentAmount(this.state().amountEurInput));
  /** The file the invoice already has: its own, the one 'Gegevens invullen' started from, or one uploaded on an earlier try. */
  readonly storedFile = computed(() => {
    const action = this.action();
    if (action.documentId != null) return { documentId: action.documentId, name: action.documentName || 'Opgeladen bestand' };
    if (action.invoice?.documentId != null) return { documentId: action.invoice.documentId, name: action.invoice.documentName ?? 'Bestand' };
    if (action.file) return { documentId: action.file.documentId, name: action.file.originalFilename };
    return null;
  });
  /** The draft's euro: as typed; else the stored euro while amount and currency are unchanged (the server keeps it); else the order rate. */
  private readonly draftEur = computed(() => {
    const form = this.state();
    const amount = this.amount();
    if (amount === null) return null;
    if (form.currency === 'EUR') return amount;
    const typed = this.amountEur();
    if (typed !== null) return typed;
    const stored = this.action().invoice;
    if (stored && stored.currency === form.currency && Math.round(stored.amount * 100) === Math.round(amount * 100)) return stored.amountEur;
    return Math.round(this.eurOf()(amount, form.currency, form.payee) * 100) / 100;
  });
  /** 'Afspraak Leverancier: € 31.048,04 · gelijk aan de afspraak', live while typing. */
  readonly agreedLine = computed(() => {
    const form = this.state();
    const agreed = this.agreed()[form.payee];
    if (agreed == null) return null;
    const eur = this.draftEur();
    const others = this.invoices().filter(invoice => invoice.payee === form.payee && invoice.id !== this.action().invoice?.id);
    const draft = eur === null ? [] : [{ ...(this.action().invoice ?? { id: Number.MAX_SAFE_INTEGER, coversInspection: false }), payee: form.payee, amountEur: eur } as PurchaseInvoice];
    const comparison = invoiceComparison([...others, ...draft], form.payee, agreed, this.inspectionAgreedEur());
    const money = agreed.toLocaleString('nl-BE', { style: 'currency', currency: 'EUR' });
    return { text: `Afspraak ${PAYEE_LABEL[form.payee]}: ${money}${comparison ? ' · ' + comparison.text : ''}`, warn: comparison?.tone === 'warn' };
  });
  /** A second invoice of the payee adds up: say so, and where a correction or a credit note goes instead. */
  readonly extraHint = computed(() => {
    const form = this.state();
    const primary = primaryInvoice(this.invoices(), form.payee);
    const editing = this.action().invoice;
    if (!primary || (editing && editing.id === primary.id)) return null;
    return `Telt op bij ${primary.number}. Gecorrigeerde factuur? Pas ${primary.number} aan. Creditnota? Noteer een tegoed.`;
  });

  /** The write, or null while something is missing. */
  readonly submission = computed<InvoiceSheetSubmit | null>(() => {
    const form = this.state();
    const amount = this.amount();
    const number = form.number.trim();
    if (!number || number.length > 64 || !form.invoiceDate || form.invoiceDate > this.today || amount === null) return null;
    if (form.currency !== 'EUR' && form.amountEurInput.trim() && this.amountEur() === null) return null;
    const stored = this.storedFile();
    // 'Ander bestand' without a new file keeps the stored one.
    const keepFile = !!stored && (!form.replaceFile || !form.file);
    return {
      invoiceId: this.action().invoice?.id ?? null,
      body: {
        payee: form.payee, number, invoiceDate: form.invoiceDate, amount, currency: form.currency,
        amountEur: form.currency === 'EUR' ? null : this.amountEur(),
        documentId: keepFile ? stored!.documentId : null,
        notes: form.notes.trim() || null,
      },
      file: keepFile ? null : form.file,
    };
  });

  /** A changed USD/CNY amount drops the euro that belonged to the old one (as the payment sheet does): empty means the order rate. */
  setAmount(raw: string): void {
    this.state.update(form => {
      const changed = parsePurchasePaymentAmount(raw) !== parsePurchasePaymentAmount(form.amountInput);
      return { ...form, amountInput: raw, ...(changed && form.currency !== 'EUR' ? { amountEurInput: '' } : {}) };
    });
  }

  patch(changes: Partial<InvoiceForm>): void {
    this.state.update(form => ({ ...form, ...changes }));
  }

  confirm(): void {
    const submission = this.submission();
    if (submission && !this.busy()) this.submit.emit(submission);
  }
}
