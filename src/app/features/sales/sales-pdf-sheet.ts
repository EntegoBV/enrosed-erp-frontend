import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LANGUAGES, LanguageCode } from '../../core/api/models';
import { SalesApi } from '../../core/api/sales-api';
import {
  NormalizedPackingSlipPdfOptions,
  NormalizedSalesPdfOptions,
  PackingSlipPdfOptions,
  SalesPdfOptions,
  normalizePackingSlipPdfOptions,
  normalizeSalesPdfOptions,
} from '../../core/api/sales-pdf-options';
import { saveBlob } from '../../core/api/download';
import { messageOf } from '../../core/api/errors';
import { Sheet, Ui } from '../../shared/ui';

export type SalesPdfChoice = 'DOCUMENT' | 'PACKING_SLIP';

/** Shared, compact export settings for quotes, invoices and price-free packing slips. */
@Component({
  selector: 'app-sales-pdf-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Sheet],
  template: `
    <app-sheet [title]="sheetTitle()" (closed)="close()">
      <div body>
        @if (dirty()) {
          <div class="save-warning" role="status">
            <span aria-hidden="true">!</span>
            <div>
              <b>Sla eerst je wijzigingen op.</b> De PDF gebruikt de laatst opgeslagen aantallen,
              prijzen en afspraken.
            </div>
          </div>
        }
        @if (error()) {
          <div class="download-error" role="alert">
            <b>PDF maken lukte niet.</b><span>{{ error() }}</span>
          </div>
        }

        @if (choice() === null) {
          <p class="intro">
            Kies het document. Daarna zie je alleen de instellingen die daarop van toepassing zijn.
          </p>
          <div class="choice-groups">
            <section class="choice-group">
              <div class="choice-group__head">
                <strong>Voor de klant</strong
                ><small>
                  {{
                    invoice()
                      ? 'Bedragen, btw en betaalgegevens blijven altijd zichtbaar.'
                      : 'Prijzen en totalen blijven altijd zichtbaar.'
                  }}
                </small>
              </div>
              <button
                class="pdf-choice pdf-choice--primary"
                type="button"
                [disabled]="dirty() || busy()"
                (click)="open('DOCUMENT')"
              >
                <span class="paper" aria-hidden="true"
                  ><span></span><span></span><span></span
                ></span>
                <span class="choice-copy"
                  ><span class="choice-kicker">A4 · klantdocument</span>
                  <strong>{{ invoice() ? 'Factuur instellen' : 'Offerte instellen' }}</strong>
                  <small>Kies taal, presentatie, logistiek en voorwaarden.</small></span
                >
                <span class="choice-action">Instellen</span>
              </button>
            </section>
            <section class="choice-group">
              <div class="choice-group__head">
                <strong>Voor magazijn en transport</strong>
                <small>Operationele pakbon; prijzen kunnen hier nooit op verschijnen.</small>
              </div>
              <button
                class="pdf-choice"
                type="button"
                [disabled]="dirty() || busy()"
                (click)="open('PACKING_SLIP')"
              >
                <span class="paper paper--plain" aria-hidden="true"
                  ><span></span><span></span><span></span
                ></span>
                <span class="choice-copy"
                  ><span class="choice-kicker">A4 · prijsloos</span>
                  <strong>Pakbon instellen</strong
                  ><small>Voeg alleen indien nodig omdoos of barcode toe.</small></span
                >
                <span class="choice-action">Instellen</span>
              </button>
            </section>
          </div>
        } @else if (choice() === 'DOCUMENT') {
          <div class="document-summary">
            <span class="paper" aria-hidden="true"><span></span><span></span><span></span></span>
            <span class="choice-copy"
              ><span class="choice-kicker">A4 · klantdocument</span>
              <strong>{{ invoice() ? 'Factuur' : 'Offerte' }}</strong>
              <small>{{ documentOptionCount() }} aanvullende onderdelen gekozen</small></span
            >
          </div>
          <div class="base-includes">
            <b>Altijd zichtbaar</b
            ><span>{{
              invoice()
                ? 'Factuurnummer · klant · aantallen · prijzen · btw · totaal · vervaldatum en betaalgegevens'
                : 'Offertenummer · klant · aantallen · prijzen · kortingen · totalen en betalingsafspraak'
            }}</span>
          </div>

          <div class="document-fields">
            <div class="field">
              <label for="sales-pdf-name">Bestandsnaam</label>
              <div class="input-affix">
                <input
                  class="input"
                  id="sales-pdf-name"
                  [ngModel]="filename()"
                  [disabled]="busy()"
                  (ngModelChange)="filename.set($event)"
                /><span class="input-affix__suffix">.pdf</span>
              </div>
            </div>
            <div class="field">
              <label for="sales-pdf-language">Taal</label>
              <select
                class="select"
                id="sales-pdf-language"
                [ngModel]="documentOptions().language"
                [disabled]="busy()"
                (ngModelChange)="patchDocument({ language: $event })"
              >
                @for (language of languages; track language.code) {
                  <option [value]="language.code">
                    {{ language.label }}
                    @if (language.code === customerLanguage()) {
                      — klanttaal
                    }
                  </option>
                }
              </select>
            </div>
          </div>

          <div class="options-heading">
            <strong>Aanvullende inhoud</strong>
            <small
              >Omdoos en barcode staan standaard uit. De keuze geldt alleen voor deze
              download.</small
            >
          </div>
          <div class="pdf-options">
            <fieldset class="pdf-option-group">
              <legend>Productpresentatie</legend>
              <div class="option-grid">
                <label class="pdf-option"
                  ><input
                    type="checkbox"
                    [ngModel]="documentOptions().includePhotos"
                    [disabled]="busy()"
                    (ngModelChange)="patchDocument({ includePhotos: $event })"
                  />
                  <span
                    ><b>Productfoto's</b><small>Compacte foto naast de productregel.</small></span
                  ></label
                >
                <label class="pdf-option"
                  ><input
                    type="checkbox"
                    [ngModel]="documentOptions().includeProductDetails"
                    [disabled]="busy()"
                    (ngModelChange)="patchDocument({ includeProductDetails: $event })"
                  />
                  <span
                    ><b>Productdetails</b
                    ><small
                      >Artikelcode, kleur/variant, productmaat, verpakking en beschrijving.</small
                    ></span
                  ></label
                >
                <label class="pdf-option pdf-option--extra"
                  ><input
                    type="checkbox"
                    [ngModel]="documentOptions().showOuterCarton"
                    [disabled]="busy()"
                    (ngModelChange)="patchDocument({ showOuterCarton: $event })"
                  />
                  <span
                    ><b>Omdoos</b><small>Afmetingen en aantal stuks per omdoos.</small></span
                  ></label
                >
                <label class="pdf-option pdf-option--extra"
                  ><input
                    type="checkbox"
                    [ngModel]="documentOptions().showBarcode"
                    [disabled]="busy()"
                    (ngModelChange)="patchDocument({ showBarcode: $event })"
                  />
                  <span
                    ><b>Barcode</b
                    ><small>Product- en verpakkings-EAN waar beschikbaar.</small></span
                  ></label
                >
              </div>
            </fieldset>
            <fieldset class="pdf-option-group">
              <legend>Document</legend>
              <div class="option-grid">
                <label class="pdf-option"
                  ><input
                    type="checkbox"
                    [ngModel]="documentOptions().includeLogistics"
                    [disabled]="busy()"
                    (ngModelChange)="patchDocument({ includeLogistics: $event })"
                  />
                  <span
                    ><b>Levering en logistiek</b
                    ><small>Dozen, pallet of volume en levertermijn.</small></span
                  ></label
                >
                <label class="pdf-option"
                  ><input
                    type="checkbox"
                    [ngModel]="documentOptions().includeTerms"
                    [disabled]="busy()"
                    (ngModelChange)="patchDocument({ includeTerms: $event })"
                  />
                  <span
                    ><b>Voorwaarden bijvoegen</b
                    ><small>Volledige voorwaarden als laatste pagina.</small></span
                  ></label
                >
              </div>
            </fieldset>
          </div>
        } @else {
          <div class="document-summary">
            <span class="paper paper--plain" aria-hidden="true"
              ><span></span><span></span><span></span
            ></span>
            <span class="choice-copy"
              ><span class="choice-kicker">A4 · magazijn en transport</span><strong>Pakbon</strong>
              <small>{{
                packingOptionCount() === 0
                  ? 'Zonder extra productgegevens'
                  : packingOptionCount() +
                    ' extra ' +
                    (packingOptionCount() === 1 ? 'onderdeel' : 'onderdelen')
              }}</small></span
            >
          </div>
          <div class="base-includes base-includes--packing">
            <b>Altijd zichtbaar</b>
            <span
              >Afleveradres · productnamen · aantallen · kartons · palletindeling ·
              laadcontrole</span
            ><strong>Geen prijzen</strong>
          </div>
          <div class="options-heading">
            <strong>Extra productinformatie</strong>
            <small>Standaard uit; de pakbon gebruikt automatisch de klanttaal.</small>
          </div>
          <fieldset class="pdf-option-group packing-options">
            <div class="option-grid">
              <label class="pdf-option pdf-option--extra"
                ><input
                  type="checkbox"
                  [ngModel]="packingOptions().showOuterCarton"
                  [disabled]="busy()"
                  (ngModelChange)="patchPacking({ showOuterCarton: $event })"
                />
                <span
                  ><b>Omdoos</b><small>Afmetingen en aantal stuks per omdoos.</small></span
                ></label
              >
              <label class="pdf-option pdf-option--extra"
                ><input
                  type="checkbox"
                  [ngModel]="packingOptions().showBarcode"
                  [disabled]="busy()"
                  (ngModelChange)="patchPacking({ showBarcode: $event })"
                />
                <span><b>Barcode</b><small>EAN voor snelle magazijncontrole.</small></span></label
              >
            </div>
          </fieldset>
        }
      </div>

      <div foot class="sheet-actions">
        @if (choice() === null) {
          <button class="btn" type="button" [disabled]="busy()" (click)="close()">Sluiten</button>
          @if (dirty()) {
            <button
              class="btn btn--primary"
              type="button"
              [disabled]="saving()"
              (click)="saveRequested.emit()"
            >
              {{ saving() ? 'Opslaan…' : 'Wijzigingen opslaan' }}
            </button>
          }
        } @else {
          <button class="btn" type="button" [disabled]="busy()" (click)="back()">Terug</button>
          <button
            class="btn btn--primary"
            type="button"
            [disabled]="dirty() || busy()"
            (click)="downloadSelected()"
          >
            @if (choice() === 'PACKING_SLIP') {
              {{ packingBusy() ? 'Pakbon maken…' : 'Pakbon downloaden' }}
            } @else {
              {{
                documentBusy()
                  ? 'PDF maken…'
                  : invoice()
                    ? 'Factuur downloaden'
                    : 'Offerte downloaden'
              }}
            }
          </button>
        }
      </div>
    </app-sheet>
  `,
  styles: [
    `
      :host {
        display: contents;
      }
      .intro {
        margin: 0;
        color: var(--muted);
        font-size: 14px;
        line-height: 1.5;
      }
      .choice-groups {
        display: grid;
        gap: 15px;
        margin-top: 14px;
      }
      .choice-group {
        display: grid;
        gap: 7px;
      }
      .choice-group__head {
        display: grid;
        gap: 1px;
        padding: 0 2px;
      }
      .choice-group__head strong {
        font-size: 13.5px;
      }
      .choice-group__head small {
        color: var(--muted);
        font-size: 12px;
      }
      .pdf-choice {
        display: grid;
        min-height: 82px;
        grid-template-columns: 48px minmax(0, 1fr) auto;
        align-items: center;
        gap: 11px;
        width: 100%;
        padding: 12px 13px;
        border: 1px solid var(--line);
        border-radius: 14px;
        background: var(--surface);
        color: var(--ink);
        text-align: left;
        cursor: pointer;
      }
      .pdf-choice--primary {
        border-color: #ddc08a;
        background: linear-gradient(135deg, #fffaf1, var(--surface));
      }
      .pdf-choice:hover:not(:disabled) {
        border-color: var(--gold);
        box-shadow: 0 9px 22px rgb(45 31 23/0.08);
      }
      .pdf-choice:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }
      .paper {
        display: grid;
        align-content: center;
        gap: 4px;
        width: 30px;
        height: 42px;
        justify-self: center;
        padding: 6px;
        border: 1px solid color-mix(in srgb, var(--gold) 64%, var(--line));
        border-radius: 4px;
        background: #fff8ef;
        box-shadow: 0 5px 12px rgb(45 31 23/0.1);
      }
      .paper--plain {
        border-color: var(--line);
        background: var(--surface);
      }
      .paper span {
        display: block;
        height: 2px;
        border-radius: 2px;
        background: color-mix(in srgb, var(--ink) 18%, transparent);
      }
      .paper span:first-child {
        width: 64%;
        background: var(--rose);
      }
      .choice-copy {
        display: flex;
        min-width: 0;
        flex-direction: column;
        gap: 2px;
      }
      .choice-kicker {
        color: var(--rose);
        font-size: 10.5px;
        font-weight: 800;
        letter-spacing: 0.07em;
        text-transform: uppercase;
      }
      .choice-copy strong {
        font-size: 15px;
      }
      .choice-copy small {
        color: var(--muted);
        font-size: 11.5px;
        line-height: 1.35;
      }
      .choice-action {
        color: var(--rose);
        font-size: 12px;
        font-weight: 780;
      }
      .document-summary {
        display: grid;
        grid-template-columns: 48px minmax(0, 1fr);
        align-items: center;
        gap: 11px;
        padding: 11px 13px;
        border: 1px solid var(--rose-line);
        border-radius: 14px 14px 0 0;
        background: var(--rose-soft);
      }
      .base-includes {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border: 1px solid var(--rose-line);
        border-top: 0;
        border-radius: 0 0 14px 14px;
        background: var(--surface);
        font-size: 11.5px;
        line-height: 1.35;
      }
      .base-includes b {
        flex: none;
        color: var(--rose);
        font-size: 10.5px;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      .base-includes span {
        min-width: 0;
        color: var(--muted);
      }
      .base-includes strong {
        margin-left: auto;
        font-size: 10.5px;
        white-space: nowrap;
      }
      .document-fields {
        display: grid;
        gap: 9px;
        margin-top: 13px;
      }
      .options-heading {
        display: grid;
        gap: 1px;
        margin-top: 13px;
      }
      .options-heading strong {
        font-size: 15px;
      }
      .options-heading small {
        color: var(--muted);
        font-size: 12px;
      }
      .pdf-options {
        display: grid;
        gap: 9px;
        margin-top: 9px;
      }
      .pdf-option-group {
        min-width: 0;
        margin: 0;
        padding: 6px;
        border: 1px solid var(--line);
        border-radius: 13px;
        background: var(--surface-2);
      }
      .pdf-option-group legend {
        padding: 0 6px;
        color: var(--rose);
        font-size: 10.5px;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .option-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 5px;
      }
      .pdf-option {
        display: flex;
        min-height: 52px;
        align-items: flex-start;
        gap: 9px;
        padding: 9px 10px;
        border-radius: 9px;
        background: var(--surface);
        cursor: pointer;
      }
      .pdf-option--extra {
        border: 1px solid var(--rose-line);
      }
      .pdf-option input {
        width: 19px;
        height: 19px;
        flex: none;
        margin: 0;
        accent-color: var(--rose);
      }
      .pdf-option > span {
        display: grid;
        min-width: 0;
        gap: 1px;
      }
      .pdf-option b {
        font-size: 13px;
      }
      .pdf-option small {
        color: var(--muted);
        font-size: 11.5px;
        line-height: 1.35;
      }
      .packing-options {
        margin-top: 9px;
      }
      .save-warning,
      .download-error {
        display: flex;
        gap: 9px;
        margin-bottom: 12px;
        padding: 11px 12px;
        border-radius: 11px;
        font-size: 13px;
        line-height: 1.45;
      }
      .save-warning {
        border: 1px solid var(--warn);
        background: var(--warn-soft);
      }
      .save-warning > span {
        display: grid;
        width: 24px;
        height: 24px;
        flex: none;
        place-items: center;
        border-radius: 50%;
        background: var(--warn);
        color: #fff;
        font-weight: 800;
      }
      .save-warning b {
        display: block;
      }
      .download-error {
        flex-direction: column;
        border: 1px solid var(--danger);
        background: var(--danger-soft);
        color: var(--danger);
      }
      .sheet-actions {
        display: contents;
      }
      @media (min-width: 620px) {
        .document-fields {
          grid-template-columns: minmax(0, 1.25fr) minmax(190px, 0.75fr);
        }
      }
      @media (max-width: 620px) {
        .pdf-choice {
          grid-template-columns: 42px minmax(0, 1fr);
          padding: 11px;
        }
        .choice-action {
          grid-column: 2;
          justify-self: start;
        }
        .document-summary {
          grid-template-columns: 42px minmax(0, 1fr);
        }
        .base-includes {
          align-items: flex-start;
          flex-direction: column;
          gap: 2px;
        }
        .base-includes strong {
          margin-left: 0;
        }
        .option-grid {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
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
  readonly initialChoice = input<SalesPdfChoice | null>(null);
  readonly closed = output<void>();
  readonly saveRequested = output<void>();

  readonly languages = LANGUAGES;
  readonly filename = signal('');
  readonly choice = signal<SalesPdfChoice | null>(null);
  readonly documentOptions = signal<NormalizedSalesPdfOptions>(normalizeSalesPdfOptions());
  readonly packingOptions = signal<NormalizedPackingSlipPdfOptions>(
    normalizePackingSlipPdfOptions(),
  );
  readonly documentBusy = signal(false);
  readonly packingBusy = signal(false);
  readonly busy = computed(() => this.documentBusy() || this.packingBusy());
  readonly error = signal<string | null>(null);
  readonly documentOptionCount = computed(() => {
    const value = this.documentOptions();
    return [
      value.includePhotos,
      value.includeProductDetails,
      value.showOuterCarton,
      value.showBarcode,
      value.includeLogistics,
      value.includeTerms,
    ].filter(Boolean).length;
  });
  readonly packingOptionCount = computed(() => {
    const value = this.packingOptions();
    return [value.showOuterCarton, value.showBarcode].filter(Boolean).length;
  });
  readonly sheetTitle = computed(() =>
    this.choice() === 'PACKING_SLIP'
      ? 'Pakbon instellen'
      : this.choice() === 'DOCUMENT'
        ? `${this.invoice() ? 'Factuur' : 'Offerte'} instellen`
        : 'Document exporteren',
  );

  ngOnInit(): void {
    this.filename.set(`${this.orderNumber()} - ${this.customerName() || 'klant'}`.trim());
    this.documentOptions.set(normalizeSalesPdfOptions({ language: this.customerLanguage() }));
    if (!this.dirty() && this.initialChoice()) this.choice.set(this.initialChoice());
  }

  patchDocument(patch: SalesPdfOptions): void {
    this.documentOptions.update((current) => normalizeSalesPdfOptions({ ...current, ...patch }));
  }

  patchPacking(patch: PackingSlipPdfOptions): void {
    this.packingOptions.update((current) =>
      normalizePackingSlipPdfOptions({ ...current, ...patch }),
    );
  }

  open(choice: SalesPdfChoice): void {
    if (this.dirty() || this.busy()) return;
    this.error.set(null);
    this.choice.set(choice);
  }

  back(): void {
    if (this.busy()) return;
    this.error.set(null);
    this.choice.set(null);
  }

  close(): void {
    if (!this.busy()) this.closed.emit();
  }

  downloadSelected(): Promise<void> {
    return this.choice() === 'PACKING_SLIP' ? this.downloadPackingSlip() : this.downloadDocument();
  }

  private async downloadDocument(): Promise<void> {
    if (this.dirty() || this.busy()) return;
    this.error.set(null);
    this.documentBusy.set(true);
    try {
      const blob = await this.sales.quotePdf(this.orderId(), this.documentOptions());
      saveBlob(blob, `${this.safeFilename(this.filename()) || this.orderNumber()}.pdf`);
      this.ui.toast(this.invoice() ? 'Factuur gedownload' : 'Offerte gedownload');
      this.closed.emit();
    } catch (failure: unknown) {
      this.error.set(messageOf(failure, 'Controleer de order en probeer opnieuw.'));
      this.ui.toast('PDF maken mislukt', 'err');
    } finally {
      this.documentBusy.set(false);
    }
  }

  private async downloadPackingSlip(): Promise<void> {
    if (this.dirty() || this.busy()) return;
    this.error.set(null);
    this.packingBusy.set(true);
    try {
      const blob = await this.sales.packingSlip(this.orderId(), this.packingOptions());
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
