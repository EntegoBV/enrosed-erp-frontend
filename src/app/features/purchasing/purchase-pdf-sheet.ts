import {
  ChangeDetectionStrategy, Component, ElementRef, Injector, ViewChild, afterNextRender, computed,
  inject, input, output, signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { saveBlob } from '../../core/api/download';
import { messageOf } from '../../core/api/errors';
import {
  NormalizedPurchasePdfOptions, PurchasePdfOptions, normalizePurchasePdfOptions,
} from '../../core/api/purchase-pdf-options';
import { PurchasePdfLayout, SourcingApi } from '../../core/api/sourcing-api';
import { PurchaseInspectionOptions } from '../../core/api/purchase-inspection-options';
import { Sheet, Ui } from '../../shared/ui';

type PurchasePdfChoice = PurchasePdfLayout | 'SUPPLIER' | 'INSPECTION';

/** Shared purchase-PDF chooser for both the read and edit screens. */
@Component({
  selector: 'app-purchase-pdf-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Sheet],
  template: `
    <app-sheet [title]="inspectionOpen() ? 'Inspectiedossier instellen' : portraitOpen() ? 'Staande PDF instellen' : 'Inkooporder exporteren'"
               (closed)="close()">
      <div body>
        @if (dirty()) {
          <div class="save-warning" role="status">
            <span aria-hidden="true">!</span>
            <div>
              <b>Sla eerst je wijzigingen op.</b>
              De PDF gebruikt de laatst opgeslagen aantallen, prijzen en afspraken.
            </div>
          </div>
        }

        @if (error()) {
          <div class="download-error" role="alert">
            <b>PDF maken lukte niet.</b>
            <span>{{ error() }}</span>
          </div>
        }

        @if (inspectionOpen()) {
          <div class="inspection-summary">
            <span class="inspection-symbol" aria-hidden="true">✓</span>
            <span class="choice-copy">
              <span class="choice-kicker">Voor de controleur · A4 verticaal</span>
              <strong>Alles klaar voor de inspectie</strong>
              <small>Producten en aantallen om te vergelijken, met invulruimte voor controles, afwijkingen en ondertekening.</small>
            </span>
          </div>
          <div class="inspection-includes">
            <b>In het dossier</b>
            <p>Order en leverancier, producten per kleur, SKU, bestelde aantallen, omdozen en beschikbare barcodes en afmetingen.</p>
            <span>Geen prijzen, marges of betalingsafspraken.</span>
          </div>
          <div class="pdf-options" aria-label="Inhoud van het inspectiedossier">
            <fieldset class="pdf-option-group">
              <legend>Documenttaal</legend>
              <label class="inspection-language" for="inspection-language">
                <span><b>Taal voor de controleur</b><small>De eigen leveranciersafspraken blijven in het Engels.</small></span>
                <select #inspectionFirstOption id="inspection-language"
                        [ngModel]="inspectionOptions().language" [disabled]="busyChoice() !== null"
                        (ngModelChange)="patchInspectionOptions({ language: $event })">
                  <option value="EN">English</option>
                  <option value="NL">Nederlands</option>
                </select>
              </label>
            </fieldset>
            <fieldset class="pdf-option-group">
              <legend>Referentiemateriaal</legend>
              <label class="pdf-option">
                <input type="checkbox" [ngModel]="inspectionOptions().includePhotos"
                       [disabled]="busyChoice() !== null"
                       (ngModelChange)="patchInspectionOptions({ includePhotos: $event })" />
                <span><b>Productfoto’s</b><small>De eigen foto bij elke bestelde variant als visuele referentie.</small></span>
              </label>
              <label class="pdf-option">
                <input type="checkbox" [ngModel]="inspectionOptions().includeSupplierAgreements"
                       [disabled]="busyChoice() !== null"
                       (ngModelChange)="patchInspectionOptions({ includeSupplierAgreements: $event })" />
                <span><b>Leveranciersafspraken en afspraakfoto’s</b><small>Gedeelde afspraken staan één keer in de bijlage, met de kleuren waarop ze van toepassing zijn.</small></span>
              </label>
            </fieldset>
          </div>
          <p class="inspection-note">De controleur vult de bevindingen tijdens de inspectie in. Het document bevat vooraf geen goedkeuring of meetresultaten.</p>
        } @else if (portraitOpen()) {
          <div class="portrait-summary">
            <span class="paper paper--portrait" aria-hidden="true">
              <span></span><span></span><span></span>
            </span>
            <span class="choice-copy">
              <span class="choice-kicker">A4 verticaal · intern</span>
              <strong>Staande inkooporder</strong>
              <small>
                {{ portraitOptionCount() === 0
                  ? 'Basisdocument zonder extra gegevens'
                  : portraitOptionCount() + ' extra ' + (portraitOptionCount() === 1 ? 'onderdeel' : 'onderdelen') }}
              </small>
            </span>
          </div>

          <div class="base-includes">
            <b>Altijd zichtbaar</b>
            <span>Ordernummer · productfoto, naam, kleur en SKU · aantallen · kartons · route</span>
          </div>

          <div class="options-heading">
            <strong>Kies wat je toevoegt</strong>
            <small>Pas de voorgeselecteerde onderdelen aan. Je keuze geldt alleen voor deze download.</small>
          </div>

          <div class="pdf-options" aria-label="Inhoud van de staande PDF">
            <fieldset class="pdf-option-group">
              <legend>Ordergegevens</legend>
              <label class="pdf-option">
                <input #portraitFirstOption type="checkbox"
                       [ngModel]="portraitOptions().showSupplier"
                       [disabled]="busyChoice() !== null"
                       (ngModelChange)="patchPortraitOptions({ showSupplier: $event })" />
                <span>
                  <b>Leverancier tonen</b>
                  <small>Naam, adres en contactgegevens boven de productregels.</small>
                </span>
              </label>
              <label class="pdf-option">
                <input type="checkbox"
                       [ngModel]="portraitOptions().showPaymentTerms"
                       [disabled]="busyChoice() !== null"
                       (ngModelChange)="patchPortraitOptions({ showPaymentTerms: $event })" />
                <span>
                  <b>Betalingsafspraak tonen</b>
                  <small>De betaaltermijn en afgesproken betalingsmomenten van deze order.</small>
                </span>
              </label>
            </fieldset>

            <fieldset class="pdf-option-group">
              <legend>Productinformatie</legend>
              <label class="pdf-option">
                <input type="checkbox"
                       [ngModel]="portraitOptions().showOuterCarton"
                       [disabled]="busyChoice() !== null"
                       (ngModelChange)="patchPortraitOptions({ showOuterCarton: $event })" />
                <span>
                  <b>Omdoos tonen</b>
                  <small>Afmetingen, inhoud en CBM van de omdoos per productregel.</small>
                </span>
              </label>
              <label class="pdf-option">
                <input type="checkbox"
                       [ngModel]="portraitOptions().showBarcode"
                       [disabled]="busyChoice() !== null"
                       (ngModelChange)="patchPortraitOptions({ showBarcode: $event })" />
                <span>
                  <b>Barcode tonen</b>
                  <small>Voegt de gekoppelde EAN toe aan iedere productregel.</small>
                </span>
              </label>
            </fieldset>

            <fieldset class="pdf-option-group">
              <legend>Afgesproken inkoopprijzen</legend>
              <label class="pdf-option pdf-option--master">
                <input type="checkbox"
                       [ngModel]="portraitOptions().showPrices"
                       [disabled]="busyChoice() !== null"
                       (ngModelChange)="patchPortraitOptions({ showPrices: $event })" />
                <span>
                  <b>Prijzen en totalen tonen</b>
                  <small>Toont de afgesproken inkoopprijzen, regeltotalen en het ordertotaal.</small>
                </span>
              </label>

              <div class="nested-options" [class.nested-options--disabled]="!portraitOptions().showPrices">
                <label class="pdf-option pdf-option--nested">
                  <input type="checkbox"
                         [ngModel]="portraitOptions().includeUnitPrice"
                         [disabled]="!portraitOptions().showPrices || busyChoice() !== null"
                         (ngModelChange)="patchPortraitOptions({ includeUnitPrice: $event })" />
                  <span><b>Prijs per stuk</b><small>Naast het regeltotaal.</small></span>
                </label>
                <label class="pdf-option pdf-option--nested">
                  <input type="checkbox"
                         [ngModel]="portraitOptions().showEur"
                         [disabled]="!portraitOptions().showPrices || busyChoice() !== null"
                         (ngModelChange)="patchPortraitOptions({ showEur: $event, eurOnly: false })" />
                  <span><b>EUR eronder</b><small>Subtiele omrekening onder USD of CNY.</small></span>
                </label>
                <label class="pdf-option pdf-option--nested">
                  <input type="checkbox"
                         [ngModel]="portraitOptions().eurOnly"
                         [disabled]="!portraitOptions().showPrices || busyChoice() !== null"
                         (ngModelChange)="patchPortraitOptions({ eurOnly: $event, showEur: false })" />
                  <span><b>Alleen EUR</b><small>Verbergt de oorspronkelijke valuta.</small></span>
                </label>
              </div>
            </fieldset>

            <fieldset class="pdf-option-group">
              <legend>Totale gelande kost</legend>
              <p class="group-note">
                Inclusief goederen, transport en toegerekende kosten tot levering. De losse
                kostenposten blijven verborgen.
              </p>
              <label class="pdf-option">
                <input type="checkbox"
                       [ngModel]="portraitOptions().includeEnrosedCost"
                       [disabled]="busyChoice() !== null"
                       (ngModelChange)="patchPortraitOptions({ includeEnrosedCost: $event })" />
                <span>
                  <b>Totale kost per regel</b>
                  <small>De volledige gelande kost van het gekozen aantal.</small>
                </span>
              </label>
              <label class="pdf-option">
                <input type="checkbox"
                       [ngModel]="portraitOptions().includeEnrosedUnitCost"
                       [disabled]="busyChoice() !== null"
                       (ngModelChange)="patchPortraitOptions({ includeEnrosedUnitCost: $event })" />
                <span>
                  <b>Totale kost per stuk</b>
                  <small>De gelande kost omgerekend naar één product.</small>
                </span>
              </label>
              @if (separateCosts()) {
                <label class="pdf-option">
                  <input type="checkbox"
                         [ngModel]="portraitOptions().showSeparateCosts"
                         [disabled]="!portraitOptions().includeEnrosedCost || busyChoice() !== null"
                         (ngModelChange)="patchPortraitOptions({ showSeparateCosts: $event })" />
                  <span>
                    <b>Inspectie en andere kosten</b>
                    <small>Als lijntjes onder de totale kost; in de stukprijs zitten ze al verdeeld. Hoort bij de totale kost per regel.</small>
                  </span>
                </label>
              }
            </fieldset>
          </div>
        } @else {
          <p class="intro">Kies de versie die past bij wat je ermee gaat doen.</p>

          <div class="choice-groups">
            <section class="choice-group" aria-labelledby="supplier-pdf-group">
              <div class="choice-group__head">
                <strong id="supplier-pdf-group">Delen met leverancier</strong>
                <small>Vaste leveranciersversie zonder interne kosten of marges.</small>
              </div>
              <button class="pdf-choice pdf-choice--supplier" type="button"
                      [disabled]="dirty() || busyChoice() !== null"
                      (click)="download('SUPPLIER')">
                <span class="paper paper--portrait paper--supplier" aria-hidden="true">
                  <span></span><span></span><span></span>
                </span>
                <span class="choice-copy">
                  <span class="choice-kicker">A4 verticaal · extern</span>
                  <strong>Leveranciersorder</strong>
                  <small>Afspraken, foto’s, aantallen, kartoninfo, EAN en afgesproken stukprijs.</small>
                </span>
                <span class="choice-action">
                  {{ busyChoice() === 'SUPPLIER' ? 'Maken…' : 'Download' }}
                </span>
              </button>
            </section>

            <section class="choice-group" aria-labelledby="inspection-pdf-group">
              <div class="choice-group__head">
                <strong id="inspection-pdf-group">Delen met de controleur</strong>
                <small>Een apart dossier voor controle vóór verzending.</small>
              </div>
              <button #inspectionChoice class="pdf-choice pdf-choice--inspection" type="button"
                      [disabled]="dirty() || busyChoice() !== null"
                      (click)="openInspectionOptions()">
                <span class="paper paper--portrait paper--inspection" aria-hidden="true">
                  <span></span><span></span><span></span>
                </span>
                <span class="choice-copy">
                  <span class="choice-kicker">A4 verticaal · Engels of Nederlands</span>
                  <strong>Inspectiedossier</strong>
                  <small>Producten, aantallen, verpakking, afspraken en controlelijsten om in te vullen. Zonder commerciële bedragen.</small>
                </span>
                <span class="choice-action">Instellen →</span>
              </button>
            </section>

            <section class="choice-group" aria-labelledby="internal-pdf-group">
              <div class="choice-group__head">
                <strong id="internal-pdf-group">Intern gebruiken</strong>
                <small>Staand met eigen inhoud, of het vaste brede overzicht.</small>
              </div>
              <div class="internal-choices">
                <button #portraitChoice class="pdf-choice" type="button"
                        [disabled]="dirty() || busyChoice() !== null"
                        (click)="openPortraitOptions()">
                  <span class="paper paper--portrait" aria-hidden="true">
                    <span></span><span></span><span></span>
                  </span>
                  <span class="choice-copy">
                    <span class="choice-kicker">A4 verticaal</span>
                    <strong>Staand instellen</strong>
                    <small>Kies zelf leverancier, prijzen, betaling en gelande kosten.</small>
                  </span>
                  <span class="choice-action">Instellen</span>
                </button>

                <button class="pdf-choice" type="button"
                        [disabled]="dirty() || busyChoice() !== null"
                        (click)="download('LANDSCAPE')">
                  <span class="paper paper--landscape" aria-hidden="true">
                    <span></span><span></span><span></span>
                  </span>
                  <span class="choice-copy">
                    <span class="choice-kicker">A4 horizontaal</span>
                    <strong>Interne calculatie</strong>
                    <small>Voor intern gebruik: per regel goederen, vracht, rechten, Enrosed kost, inspectie en geland per stuk.</small>
                  </span>
                  <span class="choice-action">
                    {{ busyChoice() === 'LANDSCAPE' ? 'Maken…' : 'Download' }}
                  </span>
                </button>
              </div>
            </section>
          </div>
        }
      </div>

      <div foot class="sheet-actions">
        @if (inspectionOpen()) {
          <button class="btn" type="button" [disabled]="busyChoice() !== null"
                  (click)="backToChoices()">Terug</button>
          <button class="btn btn--primary" type="button" [disabled]="dirty() || busyChoice() !== null"
                  (click)="downloadInspection()">
            {{ busyChoice() === 'INSPECTION' ? 'Maken…' : 'Inspectiedossier downloaden' }}
          </button>
        } @else if (portraitOpen()) {
          <button class="btn" type="button" [disabled]="busyChoice() !== null"
                  (click)="backToChoices()">Terug</button>
          <button class="btn btn--primary" type="button" [disabled]="busyChoice() !== null"
                  (click)="downloadPortrait()">
            {{ busyChoice() === 'PORTRAIT' ? 'Maken…' : 'PDF downloaden' }}
          </button>
        } @else {
          <button class="btn" type="button" [disabled]="busyChoice() !== null" (click)="close()">
            Sluiten
          </button>
          @if (dirty()) {
            <button class="btn btn--primary" type="button" [disabled]="saving()"
                    (click)="saveRequested.emit()">
              {{ saving() ? 'Opslaan…' : 'Wijzigingen opslaan' }}
            </button>
          }
        }
      </div>
    </app-sheet>
  `,
  styles: [`
    :host{display:contents}.intro{margin:0;color:var(--muted);font-size:14px;line-height:1.5}
    .pdf-choice--inspection{border-color:color-mix(in srgb,var(--rose) 24%,var(--line));background:linear-gradient(135deg,var(--rose-soft),var(--surface))}.paper--inspection{border-color:var(--rose)}.paper--inspection span{height:4px;border-left:3px solid var(--rose);background:var(--rose-soft)}.inspection-summary{display:flex;align-items:center;gap:12px;padding:16px;border:1px solid var(--rose-line);border-radius:16px;background:var(--rose-soft)}.inspection-symbol{display:grid;place-items:center;flex:none;width:40px;height:48px;border-radius:8px;border:1px solid var(--rose-line);background:var(--surface);color:var(--rose);font-size:24px}.inspection-summary strong{font-size:18px}.inspection-summary small{font-size:13px;line-height:1.5}.inspection-includes{padding:14px 3px 2px;font-size:13px;line-height:1.5}.inspection-includes p{margin:4px 0;color:var(--muted)}.inspection-includes>span{color:var(--rose);font-weight:650}.inspection-language{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:10px;background:var(--surface);border-radius:9px}.inspection-language>span{display:grid;gap:3px;font-size:13px}.inspection-language small{color:var(--muted);font-size:11.5px}.inspection-language select{min-height:44px;padding:8px 30px 8px 12px;border:1px solid var(--line);border-radius:10px;color:var(--ink);background:var(--surface);font:inherit;font-size:14px}.inspection-language select:focus-visible{outline:3px solid var(--rose-line);outline-offset:2px}.inspection-note{margin:14px 3px 0;font-size:12px;line-height:1.5;color:var(--muted)}@media(max-width:620px){.inspection-language{align-items:stretch;flex-direction:column;gap:10px}.inspection-language select{width:100%}.inspection-summary{padding:13px}.inspection-summary strong{font-size:16px}}
    .choice-groups{display:grid;gap:15px;margin-top:14px}.choice-group{display:grid;gap:7px}.choice-group__head{display:grid;gap:1px;padding:0 2px}.choice-group__head strong{font-size:13.5px}.choice-group__head small{color:var(--muted);font-size:12px}.internal-choices{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.pdf-choice{display:grid;min-height:82px;grid-template-columns:48px minmax(0,1fr) auto;align-items:center;gap:11px;width:100%;padding:12px 13px;border:1px solid var(--line);border-radius:14px;background:var(--surface);color:var(--ink);text-align:left;cursor:pointer;transition:border-color .16s ease,box-shadow .16s ease,transform .16s ease}.pdf-choice--supplier{border-color:#ddc08a;background:linear-gradient(135deg,#fffaf1,var(--surface))}.pdf-choice:hover:not(:disabled){transform:translateY(-1px);border-color:var(--gold);box-shadow:0 9px 22px rgb(45 31 23/.08)}.pdf-choice:focus-visible{outline:3px solid color-mix(in srgb,var(--gold) 38%,transparent);outline-offset:2px}.pdf-choice:disabled{cursor:not-allowed;opacity:.55}.paper{display:grid;align-content:center;gap:4px;justify-self:center;border:1px solid color-mix(in srgb,var(--gold) 64%,var(--line));border-radius:4px;background:#fff8ef;box-shadow:0 5px 12px rgb(45 31 23/.1);padding:6px}.paper--portrait{width:30px;height:42px}.paper--landscape{width:42px;height:30px}.paper--supplier{border-color:var(--gold);background:#fff}.paper span{display:block;height:2px;border-radius:2px;background:color-mix(in srgb,var(--ink) 18%,transparent)}.paper span:first-child{width:64%;background:var(--rose)}.choice-copy{display:flex;min-width:0;flex-direction:column;gap:2px}.choice-kicker{color:var(--rose);font-size:10.5px;font-weight:800;letter-spacing:.07em;text-transform:uppercase}.choice-copy strong{font-size:15px;line-height:1.25}.choice-copy small{color:var(--muted);font-size:11.5px;line-height:1.35}.choice-action{align-self:center;color:var(--rose);font-size:12px;font-weight:780}
    .portrait-summary{display:grid;grid-template-columns:48px minmax(0,1fr);align-items:center;gap:11px;padding:11px 13px;border:1px solid var(--rose-line);border-radius:14px 14px 0 0;background:var(--rose-soft)}.base-includes{display:flex;align-items:center;gap:8px;padding:8px 12px;border:1px solid var(--rose-line);border-top:0;border-radius:0 0 14px 14px;background:var(--surface);font-size:11.5px;line-height:1.35}.base-includes b{flex:none;color:var(--rose);font-size:10.5px;letter-spacing:.04em;text-transform:uppercase}.base-includes span{color:var(--muted)}.options-heading{display:grid;gap:1px;margin-top:14px}.options-heading strong{font-size:15px}.options-heading small{color:var(--muted);font-size:12px}.pdf-options{display:grid;gap:9px;margin-top:9px}.pdf-option-group{min-width:0;margin:0;padding:6px;border:1px solid var(--line);border-radius:13px;background:var(--surface-2)}.pdf-option-group legend{padding:0 6px;color:var(--rose);font-size:10.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.pdf-option{display:flex;min-height:52px;align-items:flex-start;gap:9px;padding:9px 10px;border-radius:9px;background:var(--surface);cursor:pointer}.pdf-option+.pdf-option{margin-top:5px}.pdf-option input{width:19px;height:19px;flex:none;margin:0;accent-color:var(--rose)}.pdf-option>span{display:grid;min-width:0;gap:1px}.pdf-option b{font-size:13px}.pdf-option small,.group-note{color:var(--muted);font-size:11.5px;line-height:1.35}.pdf-option--master{border:1px solid var(--rose-line)}.nested-options{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;margin-top:5px}.pdf-option--nested{min-height:58px}.nested-options .pdf-option+.pdf-option{margin-top:0}.nested-options--disabled{opacity:.5}.group-note{margin:0 4px 7px}.save-warning,.download-error{display:flex;gap:9px;margin-bottom:12px;padding:11px 12px;border-radius:11px;font-size:13px;line-height:1.45}.save-warning{border:1px solid var(--warn);background:var(--warn-soft)}.save-warning>span{display:grid;width:24px;height:24px;flex:none;place-items:center;border-radius:50%;background:var(--warn);color:#fff;font-weight:800}.save-warning b{display:block}.download-error{flex-direction:column;border:1px solid var(--danger);background:var(--danger-soft);color:var(--danger)}.sheet-actions{display:contents}
    @media(max-width:620px){.internal-choices{grid-template-columns:1fr}.nested-options{grid-template-columns:1fr}.pdf-choice{grid-template-columns:42px minmax(0,1fr);padding:11px}.choice-action{grid-column:2;justify-self:start}.portrait-summary{grid-template-columns:42px minmax(0,1fr)}.base-includes{align-items:flex-start;flex-direction:column;gap:2px}.pdf-option{padding:9px}.pdf-option--nested{min-height:50px}}
  `],
})
export class PurchasePdfSheet {
  private readonly sourcing = inject(SourcingApi);
  private readonly ui = inject(Ui);
  private readonly injector = inject(Injector);
  @ViewChild('portraitFirstOption') private portraitFirstOption?: ElementRef<HTMLInputElement>;
  @ViewChild('portraitChoice') private portraitChoice?: ElementRef<HTMLButtonElement>;
  @ViewChild('inspectionFirstOption') private inspectionFirstOption?: ElementRef<HTMLSelectElement>;
  @ViewChild('inspectionChoice') private inspectionChoice?: ElementRef<HTMLButtonElement>;

  readonly orderId = input.required<number>();
  readonly orderNumber = input.required<string>();
  readonly dirty = input(false);
  readonly saving = input(false);
  /** The order books an inspection or another named cost; only then is there a switch to show. */
  readonly separateCosts = input(false);
  readonly closed = output<void>();
  readonly saveRequested = output<void>();

  readonly busyChoice = signal<PurchasePdfChoice | null>(null);
  readonly error = signal<string | null>(null);
  readonly portraitOpen = signal(false);
  readonly inspectionOpen = signal(false);
  readonly inspectionOptions = signal<Required<PurchaseInspectionOptions>>({
    language: 'EN', includePhotos: true, includeSupplierAgreements: true,
  });
  /* The portrait order opens with what the buying desk reads first: the
     landed cost per piece and per line, and the packing facts of every
     product. Prices and the supplier block stay a deliberate choice. */
  readonly portraitOptions = signal<NormalizedPurchasePdfOptions>(normalizePurchasePdfOptions({
    layout: 'PORTRAIT',
    audience: 'STANDARD',
    includeEnrosedCost: true,
    includeEnrosedUnitCost: true,
    showOuterCarton: true,
    showBarcode: true,
  }));
  readonly portraitOptionCount = computed(() => {
    const options = this.portraitOptions();
    return [
      options.showSupplier,
      options.showPaymentTerms,
      options.showOuterCarton,
      options.showBarcode,
      options.showPrices,
      options.includeUnitPrice,
      options.showEur,
      options.eurOnly,
      options.includeEnrosedCost,
      options.includeEnrosedUnitCost,
    ].filter(Boolean).length;
  });

  close(): void {
    if (this.busyChoice() === null) this.closed.emit();
  }

  openPortraitOptions(): void {
    if (this.dirty() || this.busyChoice() !== null) return;
    this.error.set(null);
    this.portraitOpen.set(true);
    afterNextRender({
      write: () => this.portraitFirstOption?.nativeElement.focus(),
    }, { injector: this.injector });
  }

  backToChoices(): void {
    if (this.busyChoice() !== null) return;
    const fromInspection = this.inspectionOpen();
    this.error.set(null);
    this.portraitOpen.set(false);
    this.inspectionOpen.set(false);
    afterNextRender({
      write: () => (fromInspection ? this.inspectionChoice : this.portraitChoice)?.nativeElement.focus(),
    }, { injector: this.injector });
  }

  patchPortraitOptions(patch: PurchasePdfOptions): void {
    this.portraitOptions.update((current) => normalizePurchasePdfOptions({
      ...current,
      ...patch,
      layout: 'PORTRAIT',
      audience: 'STANDARD',
    }));
  }

  downloadPortrait(): Promise<void> {
    return this.downloadPdf('PORTRAIT', this.portraitOptions());
  }

  download(choice: 'SUPPLIER' | 'LANDSCAPE'): Promise<void> {
    return this.downloadPdf(choice, choice === 'SUPPLIER'
      ? { layout: 'PORTRAIT', audience: 'SUPPLIER' }
      : { layout: 'LANDSCAPE', audience: 'STANDARD', showRevenue: true });
  }

  openInspectionOptions(): void {
    if (this.dirty() || this.busyChoice() !== null) return;
    this.error.set(null);
    this.inspectionOpen.set(true);
    afterNextRender({
      write: () => this.inspectionFirstOption?.nativeElement.focus(),
    }, { injector: this.injector });
  }

  patchInspectionOptions(patch: PurchaseInspectionOptions): void {
    this.inspectionOptions.update(current => ({ ...current, ...patch }));
  }

  async downloadInspection(): Promise<void> {
    if (this.dirty() || this.busyChoice() !== null) return;
    this.error.set(null);
    this.busyChoice.set('INSPECTION');
    try {
      const options = this.inspectionOptions();
      const blob = await this.sourcing.purchaseInspectionPdf(this.orderId(), options);
      saveBlob(blob, `${this.safeFilename(this.orderNumber())}-inspectie-${options.language.toLowerCase()}.pdf`);
      this.ui.toast('Inspectiedossier gedownload');
      this.closed.emit();
    } catch (failure: unknown) {
      this.error.set(messageOf(failure, 'Controleer de order en probeer het opnieuw.'));
      this.ui.toast('Inspectiedossier maken mislukt', 'err');
    } finally {
      this.busyChoice.set(null);
    }
  }

  private async downloadPdf(choice: Exclude<PurchasePdfChoice, 'INSPECTION'>, options: PurchasePdfOptions): Promise<void> {
    if (this.dirty() || this.busyChoice() !== null) return;
    const supplierCopy = choice === 'SUPPLIER';
    const layout: PurchasePdfLayout = supplierCopy ? 'PORTRAIT' : choice;
    this.error.set(null);
    this.busyChoice.set(choice);
    try {
      const blob = await this.sourcing.purchasePdf(this.orderId(), options);
      const stem = this.safeFilename(this.orderNumber());
      saveBlob(blob, supplierCopy
        ? `${stem}-leverancier-verticaal.pdf`
        : layout === 'PORTRAIT'
          ? `${stem}-inkooporder-verticaal.pdf`
          : `${stem}-inkooporder-horizontaal.pdf`);
      this.ui.toast(supplierCopy
        ? 'Leveranciers-PDF gedownload'
        : layout === 'PORTRAIT'
          ? 'Verticale inkooporder gedownload'
          : 'Horizontale inkooporder gedownload');
      this.closed.emit();
    } catch (failure: unknown) {
      this.error.set(messageOf(failure, 'Controleer de order en probeer het opnieuw.'));
      this.ui.toast('PDF maken mislukt', 'err');
    } finally {
      this.busyChoice.set(null);
    }
  }

  private safeFilename(value: string): string {
    return value.trim().replace(/[\\/:*?"<>|]+/g, '-') || 'inkooporder';
  }
}
