import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { saveBlob } from '../../core/api/download';
import { PartnerPortalApi } from '../../core/api/partner-portal-api';
import { Icon } from '../../shared/icon';
import { Ui } from '../../shared/ui';

/**
 * "Pakbon": downloads one container's pakbon (GET /api/partner-portal/containers/{id}/pakbon.pdf, the products to
 * tick off when it is unloaded, never a price) as pakbon-PO-2026-011.pdf. A click inside a clickable row does not
 * also open the row. `compact` is the table's small button; without it the card's button with its word.
 */
@Component({
  selector: 'app-partner-pakbon-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <button class="pb" type="button" [class.pb--compact]="compact()" [disabled]="busy()" [attr.aria-busy]="busy()"
            [attr.aria-label]="'Pakbon van ' + name() + ' (PDF)'" [attr.title]="compact() ? 'Pakbon van ' + name() + ' (PDF)' : null"
            (click)="download($event)" (keydown.enter)="$event.stopPropagation()" (keydown.space)="$event.stopPropagation()">
      <app-icon [name]="busy() ? 'refresh' : 'pdf'" [size]="compact() ? 15 : 16" [class.pb__spin]="busy()" />
      <span>Pakbon</span>
    </button>
  `,
  styles: `
    :host{display:inline-flex}
    .pb{display:inline-flex;flex:1 1 auto;align-items:center;justify-content:center;gap:6px;min-height:36px;padding:0 13px;border:1px solid var(--line-strong);border-radius:10px;background:var(--surface);color:var(--ink);font:inherit;font-size:13.5px;font-weight:650;white-space:nowrap;cursor:pointer;-webkit-tap-highlight-color:transparent}
    .pb:hover:not(:disabled){border-color:var(--rose-line);background:var(--rose-soft);color:var(--rose-dark)}
    .pb:focus-visible{outline:2px solid var(--rose-dark);outline-offset:2px}
    .pb:disabled{cursor:progress;opacity:.7}
    .pb--compact{min-height:30px;padding:0 9px;border-radius:8px;font-size:12.5px;gap:5px}
    .pb__spin{animation:pb-spin .9s linear infinite}
    @keyframes pb-spin{to{transform:rotate(360deg)}}
    @media (prefers-reduced-motion: reduce){.pb__spin{animation:none}}
    @media (max-width: 679.98px), (hover: none) and (max-width: 1023.98px){
      .pb{min-height:44px;padding:0 16px;font-size:15px;border-radius:12px}
      .pb--compact{min-height:40px;padding:0 12px;font-size:14px}
    }
  `,
})
export class PartnerPakbonButton {
  private readonly api = inject(PartnerPortalApi);
  private readonly ui = inject(Ui);

  readonly containerId = input.required<number>();
  /** "PO-2026-011", for the file name and the button's name. */
  readonly name = input.required<string>();
  readonly compact = input(false);
  readonly busy = signal(false);

  async download(event: Event): Promise<void> {
    event.stopPropagation();
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const blob = await this.api.pakbon(this.containerId());
      saveBlob(blob, `pakbon-${this.name().replace(/[^A-Za-z0-9._-]+/g, '-')}.pdf`);
    } catch (failure: unknown) {
      const status = (failure as { status?: number } | null)?.status;
      this.ui.toast(status === 404 ? 'Deze container bestaat niet meer.' : 'De pakbon kon niet geladen worden. Probeer het opnieuw.', 'err');
    } finally {
      this.busy.set(false);
    }
  }
}
