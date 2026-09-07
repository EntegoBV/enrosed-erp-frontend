import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { Router } from '@angular/router';
import { messageOf } from '../../core/api/errors';
import { SalesOrder } from '../../core/api/models';
import { SalesApi } from '../../core/api/sales-api';
import { SourcingApi } from '../../core/api/sourcing-api';
import { EurPipe } from '../../shared/pipes';
import { Sheet, Ui } from '../../shared/ui';
import { settlementSplit } from './partner-settlement';

/**
 * The closing invoice of a partner deal. The partner reports what the
 * container's goods fetched at auction; the profit above the cost basis
 * they paid us is split by the agreed share, and our part opens as a new
 * invoice with one line.
 */
@Component({
  selector: 'app-partner-settlement-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet, EurPipe],
  template: `
    <app-sheet title="Slotfactuur maken" (closed)="closed.emit()">
      <div body class="ps">
        <p class="ps__intro">De partner betaalde de kostbasis van {{ order().number }}@if (reference()) { voor container {{ reference() }} }.
          Vul in wat de goederen op de veiling opbrachten; de winst daarboven wordt gedeeld en ons deel wordt één regel op een nieuwe factuur.</p>
        <div class="desk-form__duo">
          <div class="field">
            <label class="req" for="ps-proceeds">Veilingopbrengst, excl. btw</label>
            <span class="ps__money"><i>€</i><input class="input num right" id="ps-proceeds" type="number" min="0" step="0.01" inputmode="decimal" autofocus
                   [value]="proceeds() || ''" (input)="setProceeds($any($event.target).value)" /></span>
          </div>
          <div class="field">
            <label for="ps-share">Ons deel van de winst</label>
            <span class="ps__money"><input class="input num right" id="ps-share" type="number" min="1" max="100" step="0.5" inputmode="decimal"
                   [value]="sharePct()" (input)="setShare($any($event.target).value)" /><i>%</i></span>
          </div>
        </div>
        <div class="field">
          <label for="ps-note">Notitie op de factuur <span class="opt"></span></label>
          <input class="input" id="ps-note" type="text" maxlength="200" placeholder="bijv. veiling Aalsmeer, week 38"
                 [value]="note()" (input)="note.set($any($event.target).value)" />
        </div>
        <dl class="ps__sums">
          <div><dt>Veilingopbrengst</dt><dd>{{ split().proceeds | eur }}</dd></div>
          <div><dt>Kostbasis, betaald door de partner</dt><dd>− {{ split().costBasis | eur }}</dd></div>
          <div class="ps__sums-profit" [class.is-bad]="proceeds() > 0 && split().profit <= 0"><dt>Winst op de veiling</dt><dd>{{ proceeds() > 0 ? (split().profit | eur) : '—' }}</dd></div>
          <div><dt>Deel van de partner · {{ 100 - sharePct() }} %</dt><dd>{{ proceeds() > 0 ? (split().theirs | eur) : '—' }}</dd></div>
          <div class="ps__sums-ours"><dt>Ons deel · {{ sharePct() }} %, de slotfactuur</dt><dd>{{ proceeds() > 0 ? (split().ours | eur) : '—' }}</dd></div>
        </dl>
        @if (proceeds() > 0 && split().profit <= 0) {
          <p class="ps__warn">De opbrengst ligt niet boven de kostbasis; er is geen winst te delen.</p>
        }
      </div>
      <div foot style="display:contents">
        <span class="spacer"></span>
        <button class="btn" type="button" [disabled]="busy()" (click)="closed.emit()">Annuleren</button>
        <button class="btn btn--primary" type="button" [disabled]="busy() || split().ours <= 0" (click)="create()">{{ busy() ? 'Bezig…' : 'Slotfactuur maken' }}</button>
      </div>
    </app-sheet>
  `,
  styles: `
    :host { display: contents; }
    .ps { display: grid; gap: 14px; }
    .ps__intro { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.5; }
    .ps__money { display: flex; align-items: center; gap: 6px; }
    .ps__money .input { flex: 1; min-width: 0; }
    .ps__money i { color: var(--muted); font-style: normal; font-size: 13px; }
    .ps__sums { display: grid; gap: 0; margin: 0; border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
    .ps__sums > div { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 9px 12px; font-size: 13px; }
    .ps__sums > div + div { border-top: 1px solid var(--line); }
    .ps__sums dt { margin: 0; color: var(--muted); }
    .ps__sums dd { margin: 0; font-variant-numeric: tabular-nums; font-weight: 600; }
    .ps__sums-profit dd { font-weight: 750; }
    .ps__sums-profit.is-bad dd { color: var(--danger); }
    .ps__sums-ours { background: var(--rose-soft); }
    .ps__sums-ours dt { color: var(--rose-dark); font-weight: 650; }
    .ps__sums-ours dd { color: var(--rose-dark); font-size: 15px; font-weight: 800; }
    .ps__warn { margin: 0; color: var(--danger); font-size: 12.5px; }
  `,
})
export class PartnerSettlementSheet {
  private readonly sales = inject(SalesApi);
  private readonly sourcing = inject(SourcingApi);
  private readonly router = inject(Router);
  private readonly ui = inject(Ui);

  readonly order = input.required<SalesOrder>();
  /** Goods plus extra lines of the source document, excluding freight and VAT. */
  readonly costBasis = input.required<number>();
  readonly closed = output<void>();

  readonly proceeds = signal(0);
  readonly sharePct = signal(50);
  readonly note = signal('');
  readonly reference = signal<string | null>(null);
  readonly busy = signal(false);

  readonly split = computed(() => settlementSplit(this.proceeds(), this.costBasis(), this.sharePct()));

  constructor() {
    queueMicrotask(() => {
      const share = this.order().partnerSharePct;
      if (share !== null && share !== undefined && share > 0) this.sharePct.set(share);
      const purchaseOrderId = this.order().partnerPurchaseOrderId;
      if (purchaseOrderId) {
        this.sourcing.purchaseOrder(purchaseOrderId)
          .then((view) => this.reference.set(view.order.number))
          .catch(() => this.reference.set(null));
      }
    });
  }

  setProceeds(raw: string): void {
    const value = Number(String(raw).replace(',', '.'));
    this.proceeds.set(Number.isFinite(value) && value > 0 ? value : 0);
  }

  setShare(raw: string): void {
    const value = Number(String(raw).replace(',', '.'));
    this.sharePct.set(Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0);
  }

  async create(): Promise<void> {
    if (this.busy() || this.split().ours <= 0) return;
    this.busy.set(true);
    try {
      const created = await this.sales.createSettlement(this.order().id, {
        proceedsEur: this.proceeds(), sharePct: this.sharePct(),
        reference: this.reference(), note: this.note().trim() || null,
      });
      this.ui.toast(`Slotfactuur ${created.order.number} gemaakt: ons deel ${this.split().ours.toLocaleString('nl-BE', { style: 'currency', currency: 'EUR' })}`, 'ok');
      this.closed.emit();
      await this.router.navigate(['/sales', created.order.id, 'edit']);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Slotfactuur maken mislukt'), 'err');
    } finally {
      this.busy.set(false);
    }
  }
}
