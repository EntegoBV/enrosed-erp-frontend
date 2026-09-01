import {
  ChangeDetectionStrategy, Component, ElementRef, Injector, ViewChild, afterNextRender, inject,
  input, output, signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { saveBlob } from '../../core/api/download';
import { messageOf } from '../../core/api/errors';
import {
  NormalizedPurchasePdfOptions, PurchasePdfOptions, normalizePurchasePdfOptions,
} from '../../core/api/purchase-pdf-options';
import { PurchasePdfLayout, SourcingApi } from '../../core/api/sourcing-api';
import { Sheet, Ui } from '../../shared/ui';

type PurchasePdfChoice = PurchasePdfLayout | 'SUPPLIER';

/** One shared orientation choice for the purchase read and edit screens. */
@Component({
  selector: 'app-purchase-pdf-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Sheet],
  template: `
    <app-sheet [title]="portraitOpen() ? 'Staande PDF instellen' : 'Inkooporder exporteren'"
               (closed)="close()">
      <div body>
        <p class="intro">
          @if (portraitOpen()) {
            Kies precies wat er op de staande inkooporder komt. Deze instellingen gelden
            alleen voor deze download en wijzigen de order niet.
          } @else {
            Kies eerst voor wie de PDF bedoeld is. De leveranciersversie bevat alleen
            de afgesproken gegevens; de twee interne versies verschillen in bladindeling.
          }
        </p>

        @if (dirty()) {
          <div class="save-warning" role="status">
            <span aria-hidden="true">!</span>
            <div>
              <b>Sla eerst je wijzigingen op.</b>
              Een PDF wordt op de server gemaakt en zou anders nog de vorige aantallen of prijzen tonen.
            </div>
          </div>
        }

        @if (error()) {
          <div class="download-error" role="alert">
            <b>PDF maken lukte niet.</b>
            <span>{{ error() }}</span>
            <span>Controleer de order en probeer daarna dezelfde keuze opnieuw.</span>
          </div>
        }

        @if (portraitOpen()) {
          <div class="portrait-summary">
            <span class="paper paper--portrait" aria-hidden="true">
              <span></span><span></span><span></span>
            </span>
            <span class="choice-copy">
              <span class="choice-kicker">A4 verticaal</span>
              <strong>Inkooporder · staand</strong>
              <span>Compact, aanpasbaar en geschikt om af te drukken of door te sturen.</span>
            </span>
          </div>

          <div class="pdf-options" role="group" aria-label="Inhoud van de staande PDF">
            <label class="pdf-option">
              <input #portraitFirstOption type="checkbox" [ngModel]="portraitOptions().showSupplier"
                     [disabled]="busyChoice() !== null"
                     (ngModelChange)="patchPortraitOptions({ showSupplier: $event })" />
              <span><b>Leverancier tonen</b><small>Naam, adres en contactgegevens boven de productregels.</small></span>
            </label>

            <label class="pdf-option">
              <input type="checkbox" [ngModel]="portraitOptions().showPrices"
                     [disabled]="busyChoice() !== null"
                     (ngModelChange)="patchPortraitOptions({ showPrices: $event })" />
              <span><b>Productprijzen tonen</b><small>Stukprijs, regeltotaal en het ordertotaal per valuta.</small></span>
            </label>

            <label class="pdf-option pdf-option--nested"
                   [class.pdf-option--disabled]="!portraitOptions().showPrices">
              <input type="checkbox" [ngModel]="portraitOptions().showEur"
                     [disabled]="!portraitOptions().showPrices || busyChoice() !== null"
                     (ngModelChange)="patchPortraitOptions({ showEur: $event })" />
              <span><b>Euro onder de prijs</b><small>Subtiele EUR-omrekening onder USD of CNY met de koers van deze order.</small></span>
            </label>

            <label class="pdf-option">
              <input type="checkbox" [ngModel]="portraitOptions().includeEnrosedCost"
                     [disabled]="busyChoice() !== null"
                     (ngModelChange)="patchPortraitOptions({ includeEnrosedCost: $event })" />
              <span>
                <b>ENROSED-kost inclusief verzending</b>
                <small>Toont per productregel één all-in EUR-kost. Product, verzending, invoer en overige toegerekende kosten worden niet apart uitgesplitst.</small>
              </span>
            </label>
          </div>
        } @else {
          <div class="choices">
            <button class="pdf-choice pdf-choice--supplier" type="button"
                    [disabled]="dirty() || busyChoice() !== null"
                    (click)="download('SUPPLIER')">
              <span class="paper paper--portrait paper--supplier" aria-hidden="true">
                <span></span><span></span><span></span>
              </span>
              <span class="choice-copy">
                <span class="choice-kicker">A4 verticaal · extern</span>
                <strong>Leverancier</strong>
                <span>Afgesproken stukprijs en prijsbasis, aantallen, karton-CBM, EAN en de leveranciersnotitie per product.</span>
                <small>Geen interne kosten, marges, omzet, betaalinformatie of verkoopprijzen.</small>
              </span>
              <span class="choice-action">
                {{ busyChoice() === 'SUPPLIER' ? 'Maken…' : 'Download' }}
              </span>
            </button>

            <button #portraitChoice class="pdf-choice pdf-choice--portrait" type="button"
                    [disabled]="dirty() || busyChoice() !== null"
                    (click)="openPortraitOptions()">
              <span class="paper paper--portrait" aria-hidden="true">
                <span></span><span></span><span></span>
              </span>
              <span class="choice-copy">
                <span class="choice-kicker">A4 verticaal</span>
                <strong>Inkooporder · staand</strong>
                <span>Compacte productregels met foto, SKU, maat, stuks per karton, aantallen en inkoopprijs.</span>
                <small>Kies hierna leverancier, prijzen, EUR-omrekening en de all-in ENROSED-kost.</small>
              </span>
              <span class="choice-action">Instellen</span>
            </button>

            <button class="pdf-choice pdf-choice--landscape" type="button"
                    [disabled]="dirty() || busyChoice() !== null"
                    (click)="download('LANDSCAPE')">
              <span class="paper paper--landscape" aria-hidden="true">
                <span></span><span></span><span></span>
              </span>
              <span class="choice-copy">
                <span class="choice-kicker">A4 horizontaal</span>
                <strong>Inkooporder · liggend</strong>
                <span>Dezelfde productfoto's en kartoninfo, met extra breedte voor lange namen en specificaties.</span>
                <small>Geen vracht-, douane- of andere interne tussenprijzen.</small>
              </span>
              <span class="choice-action">
                {{ busyChoice() === 'LANDSCAPE' ? 'Maken…' : 'Download' }}
              </span>
            </button>
          </div>
        }

      </div>

      <div foot class="sheet-actions">
        @if (portraitOpen()) {
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
            <button class="btn btn--primary" type="button" [disabled]="saving()" (click)="saveRequested.emit()">
              {{ saving() ? 'Opslaan…' : 'Wijzigingen opslaan' }}
            </button>
          }
        }
      </div>
    </app-sheet>
  `,
  styles: [`
    :host{display:contents}.intro{margin:0;color:var(--muted);font-size:15px;line-height:1.55}
    .choices{display:grid;gap:12px;margin-top:18px}.pdf-choice{display:grid;min-height:108px;grid-template-columns:64px minmax(0,1fr) auto;align-items:center;gap:15px;width:100%;padding:16px;border:1px solid var(--line);border-radius:16px;background:var(--surface);color:var(--ink);text-align:left;cursor:pointer;transition:border-color .16s ease,transform .16s ease,box-shadow .16s ease}.pdf-choice--supplier{border-color:#ddc08a;background:linear-gradient(135deg,#fffaf1,var(--surface))}.pdf-choice:hover:not(:disabled){transform:translateY(-1px);border-color:var(--gold);box-shadow:0 12px 28px rgb(45 31 23/.09)}.pdf-choice:focus-visible{outline:3px solid color-mix(in srgb,var(--gold) 38%,transparent);outline-offset:2px}.pdf-choice:disabled{cursor:not-allowed;opacity:.55}.paper{display:grid;align-content:center;gap:5px;justify-self:center;border:1px solid color-mix(in srgb,var(--gold) 64%,var(--line));border-radius:5px;background:#fff8ef;box-shadow:0 7px 15px rgb(45 31 23/.1);padding:8px}.paper--portrait{width:38px;height:52px}.paper--landscape{width:52px;height:38px}.paper--supplier{border-color:var(--gold);background:#fff}.paper span{display:block;height:2px;border-radius:2px;background:color-mix(in srgb,var(--ink) 18%,transparent)}.paper span:first-child{width:64%;background:var(--rose)}.choice-copy{display:flex;min-width:0;flex-direction:column;gap:4px}.choice-kicker{color:var(--rose);font-size:12.5px;font-weight:780;letter-spacing:.06em;text-transform:uppercase}.choice-copy strong{font-size:17px}.choice-copy>span:not(.choice-kicker){color:var(--ink-2);font-size:14px;line-height:1.45}.choice-copy small{color:var(--muted);font-size:12.5px;line-height:1.4}.choice-action{align-self:center;color:var(--rose);font-size:13px;font-weight:780}
    .portrait-summary{display:grid;grid-template-columns:64px minmax(0,1fr);align-items:center;gap:15px;margin-top:16px;padding:14px 16px;border:1px solid var(--rose-line);border-radius:16px;background:var(--rose-soft)}.pdf-options{display:grid;gap:8px;margin-top:12px}.pdf-option{display:flex;min-height:66px;align-items:flex-start;gap:11px;padding:12px 13px;border:1px solid var(--line);border-radius:12px;background:var(--surface);cursor:pointer}.pdf-option input{width:22px;height:22px;flex:none;margin:0;accent-color:var(--rose)}.pdf-option>span{display:grid;min-width:0;gap:2px}.pdf-option b{font-size:14px}.pdf-option small{color:var(--muted);font-size:12.5px;line-height:1.4}.pdf-option--nested{margin-left:22px;border-left:3px solid var(--rose-line)}.pdf-option--disabled{cursor:not-allowed;opacity:.5}
    .save-warning,.download-error{display:flex;gap:10px;margin-top:14px;padding:13px;border-radius:12px;font-size:14px;line-height:1.5}.save-warning{border:1px solid var(--warn);background:var(--warn-soft)}.save-warning>span{display:grid;width:26px;height:26px;flex:none;place-items:center;border-radius:50%;background:var(--warn);color:#fff;font-weight:800}.save-warning b{display:block}.download-error{flex-direction:column;border:1px solid var(--danger);background:var(--danger-soft);color:var(--danger)}.sheet-actions{display:contents}@media(max-width:560px){.pdf-choice{min-height:104px;grid-template-columns:52px minmax(0,1fr);gap:12px;padding:13px}.choice-action{grid-column:2;justify-self:start}.paper--portrait{width:32px;height:44px}.paper--landscape{width:44px;height:32px}.choice-kicker{font-size:12px}.choice-copy strong{font-size:16px}.choice-copy>span:not(.choice-kicker){font-size:13.5px}.portrait-summary{grid-template-columns:52px minmax(0,1fr);gap:12px;padding:12px 13px}.pdf-option--nested{margin-left:10px}}
  `],
})
export class PurchasePdfSheet {
  private readonly sourcing = inject(SourcingApi);
  private readonly ui = inject(Ui);
  private readonly injector = inject(Injector);
  @ViewChild('portraitFirstOption') private portraitFirstOption?: ElementRef<HTMLInputElement>;
  @ViewChild('portraitChoice') private portraitChoice?: ElementRef<HTMLButtonElement>;

  readonly orderId = input.required<number>();
  readonly orderNumber = input.required<string>();
  readonly dirty = input(false);
  readonly saving = input(false);
  readonly closed = output<void>();
  readonly saveRequested = output<void>();

  readonly busyChoice = signal<PurchasePdfChoice | null>(null);
  readonly error = signal<string | null>(null);
  readonly portraitOpen = signal(false);
  readonly portraitOptions = signal<NormalizedPurchasePdfOptions>(normalizePurchasePdfOptions({
    layout: 'PORTRAIT',
    audience: 'STANDARD',
    showSupplier: true,
    showPrices: true,
    showEur: false,
    includeEnrosedCost: false,
  }));

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
    this.error.set(null);
    this.portraitOpen.set(false);
    afterNextRender({
      write: () => this.portraitChoice?.nativeElement.focus(),
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
      : { layout: 'LANDSCAPE', audience: 'STANDARD' });
  }

  private async downloadPdf(choice: PurchasePdfChoice, options: PurchasePdfOptions): Promise<void> {
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
      const detail = messageOf(failure, 'Probeer het opnieuw of controleer de productgegevens.');
      this.error.set(detail);
      this.ui.toast('PDF maken mislukt', 'err');
    } finally {
      this.busyChoice.set(null);
    }
  }

  private safeFilename(value: string): string {
    return value.trim().replace(/[\\/:*?"<>|]+/g, '-') || 'inkooporder';
  }
}
