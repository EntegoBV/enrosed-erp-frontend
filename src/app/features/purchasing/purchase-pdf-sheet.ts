import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { saveBlob } from '../../core/api/download';
import { messageOf } from '../../core/api/errors';
import { PurchasePdfLayout, SourcingApi } from '../../core/api/sourcing-api';
import { Sheet, Ui } from '../../shared/ui';

/** One shared orientation choice for the purchase read and edit screens. */
@Component({
  selector: 'app-purchase-pdf-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet],
  template: `
    <app-sheet title="Inkooporder exporteren" (closed)="close()">
      <div body>
        <p class="intro">
          Kies A4 verticaal of horizontaal. Beide versies tonen dezelfde duidelijke
          productregels en afgesproken inkoopprijzen; alleen de bladindeling verschilt.
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

        <div class="choices">
          <button class="pdf-choice pdf-choice--portrait" type="button"
                  [disabled]="dirty() || busyLayout() !== null"
                  (click)="download('PORTRAIT')">
            <span class="paper paper--portrait" aria-hidden="true">
              <span></span><span></span><span></span>
            </span>
            <span class="choice-copy">
              <span class="choice-kicker">A4 verticaal</span>
              <strong>Inkooporder · staand</strong>
              <span>Compacte productregels met foto, SKU, maat, stuks per karton, aantallen en inkoopprijs.</span>
              <small>Handig om te controleren, af te drukken of door te sturen.</small>
            </span>
            <span class="choice-action">
              {{ busyLayout() === 'PORTRAIT' ? 'Maken…' : 'Download' }}
            </span>
          </button>

          <button class="pdf-choice pdf-choice--landscape" type="button"
                  [disabled]="dirty() || busyLayout() !== null"
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
              {{ busyLayout() === 'LANDSCAPE' ? 'Maken…' : 'Download' }}
            </span>
          </button>
        </div>

        <p class="read-copy-note">
          Beide exports komen uit het actuele dossier. Controleer ze voor verzending;
          product-, karton- en leveranciersgegevens zijn nog niet historisch vastgezet.
        </p>
      </div>

      <div foot class="sheet-actions">
        <button class="btn" type="button" [disabled]="busyLayout() !== null" (click)="close()">
          Sluiten
        </button>
        @if (dirty()) {
          <button class="btn btn--primary" type="button" [disabled]="saving()" (click)="saveRequested.emit()">
            {{ saving() ? 'Opslaan…' : 'Wijzigingen opslaan' }}
          </button>
        }
      </div>
    </app-sheet>
  `,
  styles: [`
    :host{display:contents}.intro{margin:0;color:var(--muted);font-size:15px;line-height:1.55}
    .choices{display:grid;gap:12px;margin-top:18px}.pdf-choice{display:grid;min-height:108px;grid-template-columns:64px minmax(0,1fr) auto;align-items:center;gap:15px;width:100%;padding:16px;border:1px solid var(--line);border-radius:16px;background:var(--surface);color:var(--ink);text-align:left;cursor:pointer;transition:border-color .16s ease,transform .16s ease,box-shadow .16s ease}.pdf-choice:hover:not(:disabled){transform:translateY(-1px);border-color:var(--gold);box-shadow:0 12px 28px rgb(45 31 23/.09)}.pdf-choice:focus-visible{outline:3px solid color-mix(in srgb,var(--gold) 38%,transparent);outline-offset:2px}.pdf-choice:disabled{cursor:not-allowed;opacity:.55}.paper{display:grid;align-content:center;gap:5px;justify-self:center;border:1px solid color-mix(in srgb,var(--gold) 64%,var(--line));border-radius:5px;background:#fff8ef;box-shadow:0 7px 15px rgb(45 31 23/.1);padding:8px}.paper--portrait{width:38px;height:52px}.paper--landscape{width:52px;height:38px}.paper span{display:block;height:2px;border-radius:2px;background:color-mix(in srgb,var(--ink) 18%,transparent)}.paper span:first-child{width:64%;background:var(--rose)}.choice-copy{display:flex;min-width:0;flex-direction:column;gap:4px}.choice-kicker{color:var(--rose);font-size:12.5px;font-weight:780;letter-spacing:.06em;text-transform:uppercase}.choice-copy strong{font-size:17px}.choice-copy>span:not(.choice-kicker){color:var(--ink-2);font-size:14px;line-height:1.45}.choice-copy small{color:var(--muted);font-size:12.5px;line-height:1.4}.choice-action{align-self:center;color:var(--rose);font-size:13px;font-weight:780}.save-warning,.download-error{display:flex;gap:10px;margin-top:14px;padding:13px;border-radius:12px;font-size:14px;line-height:1.5}.save-warning{border:1px solid var(--warn);background:var(--warn-soft)}.save-warning>span{display:grid;width:26px;height:26px;flex:none;place-items:center;border-radius:50%;background:var(--warn);color:#fff;font-weight:800}.save-warning b{display:block}.download-error{flex-direction:column;border:1px solid var(--danger);background:var(--danger-soft);color:var(--danger)}.read-copy-note{margin:14px 2px 0;color:var(--muted);font-size:13px;line-height:1.5}.sheet-actions{display:contents}@media(max-width:560px){.pdf-choice{min-height:104px;grid-template-columns:52px minmax(0,1fr);gap:12px;padding:13px}.choice-action{grid-column:2;justify-self:start}.paper--portrait{width:32px;height:44px}.paper--landscape{width:44px;height:32px}.choice-kicker{font-size:12px}.choice-copy strong{font-size:16px}.choice-copy>span:not(.choice-kicker){font-size:13.5px}}
  `],
})
export class PurchasePdfSheet {
  private readonly sourcing = inject(SourcingApi);
  private readonly ui = inject(Ui);

  readonly orderId = input.required<number>();
  readonly orderNumber = input.required<string>();
  readonly dirty = input(false);
  readonly saving = input(false);
  readonly closed = output<void>();
  readonly saveRequested = output<void>();

  readonly busyLayout = signal<PurchasePdfLayout | null>(null);
  readonly error = signal<string | null>(null);

  close(): void {
    if (this.busyLayout() === null) this.closed.emit();
  }

  async download(layout: PurchasePdfLayout): Promise<void> {
    if (this.dirty() || this.busyLayout() !== null) return;
    this.error.set(null);
    this.busyLayout.set(layout);
    try {
      const blob = await this.sourcing.purchasePdf(this.orderId(), false, layout);
      const stem = this.safeFilename(this.orderNumber());
      saveBlob(blob, layout === 'PORTRAIT'
        ? `${stem}-inkooporder-verticaal.pdf`
        : `${stem}-inkooporder-horizontaal.pdf`);
      this.ui.toast(layout === 'PORTRAIT'
        ? 'Verticale inkooporder gedownload'
        : 'Horizontale inkooporder gedownload');
      this.closed.emit();
    } catch (failure: unknown) {
      const detail = messageOf(failure, 'Probeer het opnieuw of controleer de productgegevens.');
      this.error.set(detail);
      this.ui.toast('PDF maken mislukt', 'err');
    } finally {
      this.busyLayout.set(null);
    }
  }

  private safeFilename(value: string): string {
    return value.trim().replace(/[\\/:*?"<>|]+/g, '-') || 'inkooporder';
  }
}
