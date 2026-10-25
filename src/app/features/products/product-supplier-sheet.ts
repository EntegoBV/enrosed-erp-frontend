import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CatalogApi } from '../../core/api/catalog-api';
import { messageOf } from '../../core/api/errors';
import type { Currency, Supplier } from '../../core/api/models';
import type { ProductSupplierChange, ProductSupplierRow } from '../../core/api/product-supplier-models';
import { DecimalInput } from '../../shared/decimal-input';
import { Sheet, Ui, escapeHtml } from '../../shared/ui';
import {
  blankRowForm, canDeactivate, canDeleteRow, canMakePreferred, rowFormError, rowFormOf, rowWrite, type SupplierRowForm,
} from './product-suppliers';

/** "600", "1.200" or "1 200" as a whole number; '' as null; anything else as NaN (refused before sending). */
function wholeNumber(text: string): number | null {
  const plain = text.trim().replace(/[\s.]/g, '');
  if (!plain) return null;
  return /^\d+$/.test(plain) ? Number(plain) : Number.NaN;
}

/**
 * One supplier of one product (several suppliers, 2026-10-25): add a supplier
 * or edit its row (Versie, their reference, EXW price, extra cost, MOQ, lead
 * time), and the row actions Voorkeur, inactief and delete. Every write answers
 * with the rows and the product's mirror; the host takes both.
 */
@Component({
  selector: 'app-product-supplier-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet, FormsModule, DecimalInput],
  template: `
    <app-sheet [title]="title()" [variant]="variant()" (closed)="closed.emit()">
      <div body class="psh" [class.psh--ios]="variant() === 'ios'">
        @if (row(); as current) {
          @if (current.purchaseLineCount > 0) {
            <p class="psh-line">Staat op {{ current.purchaseLineCount }} inkooporder{{ current.purchaseLineCount === 1 ? '' : 's' }} · verwijderen kan niet meer</p>
          }
        }
        <div class="psh-fields">
          @if (adding()) {
            <label class="psh-field psh-field--wide">
              <span class="psh-field__label">Leverancier</span>
              <select class="select psh-field__control" id="psh-supplier" [ngModel]="form().supplierId" (ngModelChange)="pickSupplier($event)">
                <option [ngValue]="null" disabled>Kies een leverancier</option>
                @for (supplier of choices(); track supplier.id) {
                  <option [ngValue]="supplier.id">{{ supplier.name }}</option>
                }
              </select>
            </label>
          }
          <label class="psh-field">
            <span class="psh-field__label">Versie</span>
            <input class="input psh-field__control" id="psh-version" maxlength="60" autocomplete="off" placeholder="bv. B · dikker glas"
                   [ngModel]="form().versionLabel" (ngModelChange)="set({ versionLabel: $event })" />
          </label>
          <label class="psh-field">
            <span class="psh-field__label">Referentie leverancier</span>
            <input class="input psh-field__control" id="psh-reference" maxlength="120" autocomplete="off" placeholder="hun artikelcode"
                   [ngModel]="form().supplierReference" (ngModelChange)="set({ supplierReference: $event })" />
          </label>
          <label class="psh-field">
            <span class="psh-field__label req">EXW-prijs</span>
            <input class="input psh-field__control psh-num" id="psh-exw" appDecimal
                   [ngModel]="form().exwPrice" (ngModelChange)="set({ exwPrice: $event })" />
          </label>
          <label class="psh-field">
            <span class="psh-field__label">Munt</span>
            <select class="select psh-field__control" id="psh-currency" [ngModel]="form().exwCurrency" (ngModelChange)="set({ exwCurrency: $event })">
              @for (currency of currencies; track currency) { <option [ngValue]="currency">{{ currency }}</option> }
            </select>
          </label>
          <label class="psh-field">
            <span class="psh-field__label">Extra kost per {{ unitSingular() }}</span>
            <input class="input psh-field__control psh-num" id="psh-extra" appDecimal
                   [ngModel]="form().extraUnitCost" (ngModelChange)="set({ extraUnitCost: $event })" />
          </label>
          <label class="psh-field">
            <span class="psh-field__label">MOQ (stuks)</span>
            <input class="input psh-field__control psh-num" id="psh-moq" type="text" inputmode="numeric" autocomplete="off"
                   [value]="moqText()" (input)="moqText.set($any($event.target).value)" />
          </label>
          <label class="psh-field">
            <span class="psh-field__label">Levertijd (dagen)</span>
            <input class="input psh-field__control psh-num" id="psh-lead" type="text" inputmode="numeric" autocomplete="off"
                   [placeholder]="leadPlaceholder()" [value]="leadText()" (input)="leadText.set($any($event.target).value)" />
          </label>
        </div>
        @if (row(); as current) {
          @if (canMakePreferred(current) || !current.preferred || canDeleteRow(current)) {
            <div class="psh-actions" role="group" aria-label="Leverancier">
              @if (canMakePreferred(current)) {
                <button class="btn btn--sm" type="button" [disabled]="busy() || formDirty()" [attr.title]="formDirty() ? 'Eerst opslaan' : null"
                        (click)="makePreferred(current)">Maak voorkeur</button>
              }
              @if (canDeactivate(current)) {
                <button class="btn btn--sm" type="button" [disabled]="busy() || formDirty()" [attr.title]="formDirty() ? 'Eerst opslaan' : null"
                        (click)="setActive(current, false)">Zet op inactief</button>
              } @else if (!current.active) {
                <button class="btn btn--sm" type="button" [disabled]="busy() || formDirty()" [attr.title]="formDirty() ? 'Eerst opslaan' : null"
                        (click)="setActive(current, true)">Weer actief</button>
              }
              @if (canDeleteRow(current)) {
                <button class="btn btn--sm btn--danger" type="button" [disabled]="busy()" (click)="confirmDelete(current)">Verwijderen</button>
              }
            </div>
          }
        }
      </div>
      <div foot style="display:contents">
        @if (variant() === 'ios') {
          <button class="ios-capsule ios-capsule--accent ios-capsule--block" type="button" [disabled]="busy()" (click)="submit()">
            {{ busy() ? 'Bezig…' : adding() ? 'Toevoegen' : 'Opslaan' }}
          </button>
        } @else {
          <span class="spacer"></span>
          <button class="btn" type="button" (click)="closed.emit()">Annuleren</button>
          <button class="btn btn--primary" type="button" [disabled]="busy()" (click)="submit()">{{ busy() ? 'Bezig…' : adding() ? 'Toevoegen' : 'Opslaan' }}</button>
        }
      </div>
    </app-sheet>
  `,
  styles: `
    .psh { display: grid; gap: 12px; min-width: 0; }
    .psh-line { margin: -2px 0 0; color: var(--muted); font-size: 12.5px; line-height: 1.4; }
    .psh-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 12px; }
    .psh-field { display: grid; gap: 5px; min-width: 0; align-content: start; }
    .psh-field--wide { grid-column: 1 / -1; }
    .psh-field__label { color: var(--ink-2); font-size: 12.5px; font-weight: 650; }
    .psh-field__control { width: 100%; min-width: 0; }
    .psh-num { font-variant-numeric: tabular-nums; text-align: right; }
    .psh-actions { display: flex; flex-wrap: wrap; gap: 8px; padding-top: 2px; }

    /* Phone: one field per row, inset like the iOS sheets (label left, control right). */
    .psh--ios { gap: 14px; padding: 0 16px; }
    .psh--ios .psh-line { text-align: center; }
    .psh--ios .psh-fields { grid-template-columns: minmax(0, 1fr); gap: 0; overflow: hidden; border-radius: 16px; background: var(--surface); }
    .psh--ios .psh-field { position: relative; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 4px 12px; min-height: 50px; padding: 4px 16px; }
    .psh--ios .psh-field + .psh-field::before { content: ''; position: absolute; top: 0; right: 0; left: 16px; height: .5px; background: var(--ios-sep, var(--line)); }
    .psh--ios .psh-field__label { font-size: 15px; font-weight: 500; color: var(--ink); white-space: nowrap; }
    .psh--ios .psh-field__control { min-height: 42px; border: 0; background-color: transparent; box-shadow: none; text-align: right; }
    .psh--ios select.psh-field__control { padding-right: 22px; background-position: right 0 center; text-align-last: right; }
    .psh--ios .psh-actions { justify-content: center; }
  `,
})
export class ProductSupplierSheet implements OnInit {
  private readonly catalog = inject(CatalogApi);
  private readonly ui = inject(Ui);

  readonly productId = input.required<number>();
  /** Null adds a supplier. */
  readonly row = input<ProductSupplierRow | null>(null);
  /** Every supplier; the add choice leaves out the ones already on the product. */
  readonly suppliers = input<Supplier[]>([]);
  /** Supplier ids already on the product (inactive rows included). */
  readonly taken = input<number[]>([]);
  readonly unitSingular = input('stuk');
  readonly variant = input<'default' | 'ios'>('default');
  readonly changed = output<ProductSupplierChange>();
  /** The row changed elsewhere (409): the host reloads the rows; closed follows. */
  readonly stale = output<void>();
  readonly closed = output<void>();

  readonly currencies: Currency[] = ['USD', 'CNY', 'EUR'];
  readonly canMakePreferred = canMakePreferred;
  readonly canDeactivate = canDeactivate;
  readonly canDeleteRow = canDeleteRow;

  readonly form = signal<SupplierRowForm>(blankRowForm(null));
  readonly moqText = signal('');
  readonly leadText = signal('');
  private readonly loaded = signal('');
  readonly busy = signal(false);

  readonly adding = computed(() => this.row() === null);
  readonly title = computed(() => this.row()?.supplierName ?? 'Leverancier toevoegen');
  readonly choices = computed(() => {
    const taken = new Set(this.taken());
    return this.suppliers().filter((supplier) => supplier.id !== null && !taken.has(supplier.id));
  });
  /** The supplier's own lead time as the hint; the row's figure only when it differs. */
  readonly leadPlaceholder = computed(() => {
    const row = this.row();
    const days = row ? row.supplierLeadTimeDays : this.suppliers().find((supplier) => supplier.id === this.form().supplierId)?.leadTimeDays;
    return days == null ? '' : String(days);
  });
  /** Unsaved edits: the row actions wait for Opslaan, so nothing typed is dropped by them. */
  readonly formDirty = computed(() => this.snapshot() !== this.loaded());

  ngOnInit(): void {
    const row = this.row();
    this.form.set(row ? rowFormOf(row) : blankRowForm(null));
    this.moqText.set(row?.moq == null ? '' : String(row.moq));
    this.leadText.set(row?.leadTimeDays == null ? '' : String(row.leadTimeDays));
    this.loaded.set(this.snapshot());
  }

  set(changes: Partial<SupplierRowForm>): void {
    this.form.update((form) => ({ ...form, ...changes }));
  }

  /** A chosen supplier brings its currency. */
  pickSupplier(id: number | null): void {
    const supplier = this.suppliers().find((item) => item.id === id) ?? null;
    this.set({ supplierId: id, ...(supplier ? { exwCurrency: supplier.currency } : {}) });
  }

  async submit(): Promise<void> {
    if (this.busy()) return;
    const moq = wholeNumber(this.moqText());
    const lead = wholeNumber(this.leadText());
    if (Number.isNaN(moq) || Number.isNaN(lead)) {
      this.ui.toast('Vul een heel aantal in', 'err');
      return;
    }
    const form = { ...this.form(), moq, leadTimeDays: lead };
    const row = this.row();
    const error = rowFormError(form, row === null);
    if (error) {
      this.ui.toast(error, 'err');
      return;
    }
    await this.write(
      () => row
        ? this.catalog.updateProductSupplier(this.productId(), row.id, rowWrite(form, row))
        : this.catalog.addProductSupplier(this.productId(), rowWrite(form, null)),
      row ? 'Leverancier bijgewerkt' : 'Leverancier toegevoegd',
    );
  }

  makePreferred(row: ProductSupplierRow): void {
    void this.write(() => this.catalog.setPreferredProductSupplier(this.productId(), row.id), `${row.supplierName} is nu voorkeur`);
  }

  setActive(row: ProductSupplierRow, active: boolean): void {
    void this.write(() => this.catalog.setProductSupplierActive(this.productId(), row.id, active),
      active ? `${row.supplierName} weer actief` : `${row.supplierName} op inactief`);
  }

  confirmDelete(row: ProductSupplierRow): void {
    this.ui.confirm({
      title: 'Leverancier verwijderen?',
      message: `<b>${escapeHtml(row.supplierName)}</b> verdwijnt van dit product, met zijn afspraakfoto's.`,
      confirmLabel: 'Verwijderen',
      danger: true,
    }, () => void this.write(() => this.catalog.deleteProductSupplier(this.productId(), row.id), 'Leverancier verwijderd'));
  }

  private snapshot(): string {
    return JSON.stringify([this.form(), this.moqText().trim(), this.leadText().trim()]);
  }

  private async write(call: () => Promise<ProductSupplierChange>, done: string): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const change = await call();
      this.changed.emit(change);
      this.ui.toast(done);
      this.closed.emit();
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Opslaan mislukt'), 'err');
      if ((failure as { status?: number } | null)?.status === 409) {
        this.stale.emit();
        this.closed.emit();
      }
    } finally {
      this.busy.set(false);
    }
  }
}
