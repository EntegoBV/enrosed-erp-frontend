import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LANGUAGES, LanguageCode } from '../../core/api/models';
import { SalesApi } from '../../core/api/sales-api';
import {
  NormalizedSalesPdfOptions, SalesPdfOptions, normalizeSalesPdfOptions,
} from '../../core/api/sales-pdf-options';
import { saveBlob } from '../../core/api/download';
import { messageOf } from '../../core/api/errors';
import { Sheet, Ui } from '../../shared/ui';

/** Shared, explicit export choices for both sales quotes and invoices. */
@Component({
  selector: 'app-sales-pdf-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Sheet],
  template: `
    <app-sheet [title]="invoice() ? 'Factuur exporteren' : 'Offerte exporteren'"
               (closed)="close()">
      <div body>
        <p class="intro">
          @if (invoice()) {
            Maak een verzorgde klantkopie. Bedragen, BTW, vervaldatum en betaalgegevens blijven
            altijd zichtbaar; hieronder kies je alleen de aanvullende productinformatie.
          } @else {
            Kies de taal en hoeveel productinformatie de klant op deze offerte ziet.
          }
        </p>

        @if (dirty()) {
          <div class="save-warning" role="status">
            <span aria-hidden="true">!</span>
            <div><b>Sla eerst je wijzigingen op.</b> De PDF wordt op de server gemaakt en moet dezelfde aantallen en prijzen bevatten als het scherm.</div>
          </div>
        }
        @if (error()) {
          <div class="download-error" role="alert"><b>Downloaden lukte niet.</b><span>{{ error() }}</span></div>
        }

        <div class="document-fields">
          <div class="field">
            <label for="sales-pdf-name">Bestandsnaam</label>
            <div class="input-affix">
              <input class="input" id="sales-pdf-name" [ngModel]="filename()"
                     (ngModelChange)="filename.set($event)" />
              <span class="input-affix__suffix">.pdf</span>
            </div>
          </div>
          <div class="field">
            <label for="sales-pdf-language">Taal van het document</label>
            <select class="select" id="sales-pdf-language" [ngModel]="options().language"
                    (ngModelChange)="patchOptions({ language: $event })">
              @for (language of languages; track language.code) {
                <option [value]="language.code">
                  {{ language.label }}@if (language.code === customerLanguage()) { — klanttaal }
                </option>
              }
            </select>
          </div>
        </div>

        <fieldset class="option-group">
          <legend>Inhoud van de PDF</legend>
          <label class="pdf-option">
            <input type="checkbox" [ngModel]="options().includePhotos"
                   (ngModelChange)="patchOptions({ includePhotos: $event })" />
            <span><b>Productfoto's</b><small>Een compacte foto naast iedere productregel, zonder lege ruimte als een foto ontbreekt.</small></span>
          </label>
          <label class="pdf-option">
            <input type="checkbox" [ngModel]="options().includeProductDetails"
                   (ngModelChange)="patchOptions({ includeProductDetails: $event })" />
            <span><b>Productdetails</b><small>Artikelcode, kleur of variant, productmaat, verpakking, omdoos en EAN.</small></span>
          </label>
          <label class="pdf-option">
            <input type="checkbox" [ngModel]="options().includeLogistics"
                   (ngModelChange)="patchOptions({ includeLogistics: $event })" />
            <span><b>Levering en logistiek</b><small>Dozen, pallet of volume en de afgesproken levertermijn per product.</small></span>
          </label>
          <label class="pdf-option">
            <input type="checkbox" [ngModel]="options().includeTerms"
                   (ngModelChange)="patchOptions({ includeTerms: $event })" />
            <span><b>Algemene voorwaarden bijvoegen</b><small>Voegt de volledige voorwaarden als laatste pagina toe.</small></span>
          </label>
        </fieldset>

        <button class="packing-slip" type="button" [disabled]="dirty() || busy()"
                (click)="downloadPackingSlip()">
          <span><b>Pakbon downloaden</b><small>Zonder prijzen, voor magazijn en transport.</small></span>
          <strong>{{ packingBusy() ? 'Maken…' : 'PDF' }}</strong>
        </button>
      </div>

      <div foot class="sheet-actions">
        <button class="btn" type="button" [disabled]="busy()" (click)="close()">Annuleren</button>
        <span class="spacer"></span>
        @if (dirty()) {
          <button class="btn btn--primary" type="button" [disabled]="saving()" (click)="saveRequested.emit()">
            {{ saving() ? 'Opslaan…' : 'Wijzigingen opslaan' }}
          </button>
        } @else {
          <button class="btn btn--primary" type="button" [disabled]="busy()" (click)="downloadPdf()">
            {{ pdfBusy() ? 'PDF maken…' : (invoice() ? 'Factuur downloaden' : 'Offerte downloaden') }}
          </button>
        }
      </div>
    </app-sheet>
  `,
  styles: [`
    :host{display:contents}.intro{margin:0;color:var(--muted);font-size:14px;line-height:1.55}.document-fields{display:grid;gap:12px;margin-top:17px}.option-group{display:grid;gap:6px;margin:16px 0 0;padding:8px;border:1px solid var(--line);border-radius:15px;background:var(--surface-2)}.option-group legend{padding:0 7px;color:var(--rose);font-size:11.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.pdf-option{display:flex;min-height:62px;align-items:flex-start;gap:11px;padding:11px 12px;border-radius:11px;background:var(--surface);cursor:pointer}.pdf-option input{width:22px;height:22px;flex:none;margin:0;accent-color:var(--rose)}.pdf-option>span{display:grid;gap:2px}.pdf-option b{font-size:14px}.pdf-option small{color:var(--muted);font-size:12.5px;line-height:1.4}.packing-slip{display:flex;width:100%;align-items:center;justify-content:space-between;gap:16px;margin-top:12px;padding:13px 14px;border:1px solid var(--line);border-radius:13px;background:var(--surface);color:var(--ink);font:inherit;text-align:left;cursor:pointer}.packing-slip>span{display:grid;gap:2px}.packing-slip b{font-size:14px}.packing-slip small{color:var(--muted);font-size:12px}.packing-slip strong{color:var(--rose);font-size:12px}.packing-slip:disabled{cursor:not-allowed;opacity:.5}.save-warning,.download-error{display:flex;gap:10px;margin-top:14px;padding:13px;border-radius:12px;font-size:13px;line-height:1.45}.save-warning{border:1px solid var(--warn);background:var(--warn-soft)}.save-warning>span{display:grid;width:25px;height:25px;flex:none;place-items:center;border-radius:50%;background:var(--warn);color:#fff;font-weight:800}.save-warning b{display:block}.download-error{flex-direction:column;border:1px solid var(--danger);background:var(--danger-soft);color:var(--danger)}.sheet-actions{display:contents}@media(min-width:620px){.document-fields{grid-template-columns:minmax(0,1.25fr) minmax(190px,.75fr)}}
  `],
})
export class SalesPdfSheet implements OnInit {
  private readonly sales = inject(SalesApi);
  private readonly ui = inject(Ui);

  readonly orderId = input.required<number>();
  readonly orderNumber = input.required<string>();
  readonly customerName = input('');
  readonly customerLanguage = input<LanguageCode>('NL');
  readonly invoice = input(false);
  readonly dirty = input(false);
  readonly saving = input(false);
  readonly closed = output<void>();
  readonly saveRequested = output<void>();

  readonly languages = LANGUAGES;
  readonly filename = signal('');
  readonly options = signal<NormalizedSalesPdfOptions>(normalizeSalesPdfOptions());
  readonly pdfBusy = signal(false);
  readonly packingBusy = signal(false);
  readonly busy = computed(() => this.pdfBusy() || this.packingBusy());
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.filename.set(`${this.orderNumber()} - ${this.customerName() || 'klant'}`.trim());
    this.options.set(normalizeSalesPdfOptions({ language: this.customerLanguage() }));
  }

  patchOptions(patch: SalesPdfOptions): void {
    this.options.update((current) => normalizeSalesPdfOptions({ ...current, ...patch }));
  }

  close(): void {
    if (!this.busy()) this.closed.emit();
  }

  async downloadPdf(): Promise<void> {
    if (this.dirty() || this.busy()) return;
    this.error.set(null);
    this.pdfBusy.set(true);
    try {
      const blob = await this.sales.quotePdf(this.orderId(), this.options());
      saveBlob(blob, `${this.safeFilename(this.filename()) || this.orderNumber()}.pdf`);
      this.ui.toast(this.invoice() ? 'Factuur gedownload' : 'Offerte gedownload');
      this.closed.emit();
    } catch (failure: unknown) {
      this.error.set(messageOf(failure, 'Controleer de order en probeer opnieuw.'));
      this.ui.toast('PDF maken mislukt', 'err');
    } finally {
      this.pdfBusy.set(false);
    }
  }

  async downloadPackingSlip(): Promise<void> {
    if (this.dirty() || this.busy()) return;
    this.error.set(null);
    this.packingBusy.set(true);
    try {
      const blob = await this.sales.packingSlip(this.orderId());
      saveBlob(blob, `${this.safeFilename(this.orderNumber())}-pakbon.pdf`);
      this.ui.toast('Pakbon gedownload — zonder prijzen');
      this.closed.emit();
    } catch (failure: unknown) {
      this.error.set(messageOf(failure, 'De pakbon kon niet worden gemaakt.'));
      this.ui.toast('Pakbon maken mislukt', 'err');
    } finally {
      this.packingBusy.set(false);
    }
  }

  private safeFilename(value: string): string {
    return value.trim().replace(/[\\/:*?"<>|]+/g, '-');
  }
}
