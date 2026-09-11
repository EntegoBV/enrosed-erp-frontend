import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

export type SalesTab = 'OFFERTE' | 'FACTUUR' | 'ARCHIEF';
export type SalesScope = 'STANDARD' | 'PARTNER' | 'ALL';

/**
 * Two segmented controls, iOS-style: the documents (offertes, facturen,
 * archief) and the business scope (all, regular, partner). No card around
 * them and no explanatory prose: the labels carry the meaning, a title
 * attribute carries the rest. On invoices a third toggle narrows to what is
 * still to be received.
 */
@Component({
  selector: 'app-sales-document-navigation',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="docnav" aria-label="Verkoopdocumenten kiezen">
      <div class="seg seg--fill docnav__tabs" role="tablist" aria-label="Documenten" (keydown)="navigateTabs($event)">
        @for (item of tabs; track item.key) {
          <button type="button" role="tab" class="seg__item" [id]="'sales-tab-' + item.key" aria-controls="sales-document-results"
            [attr.aria-selected]="tab() === item.key" [attr.tabindex]="tab() === item.key ? 0 : -1"
            [class.on]="tab() === item.key" (click)="tabChange.emit(item.key)">
            <span>{{ item.label }}</span><b [class.zero]="counts()[item.key] === 0">{{ loading() ? '…' : counts()[item.key] }}</b>
          </button>
        }
      </div>
      <div class="seg seg--quiet docnav__scope" role="group" aria-label="Soort verkoop">
        @for (item of scopes; track item.key) {
          <button type="button" class="seg__item" [class.on]="scope() === item.key" [attr.aria-pressed]="scope() === item.key"
                  [title]="item.hint" (click)="scopeChange.emit(item.key)">{{ item.label }}</button>
        }
      </div>
      @if (tab() === 'FACTUUR') {
        <button type="button" class="docnav__toggle" [class.on]="outstandingOnly()" [attr.aria-pressed]="outstandingOnly()"
                title="Inclusief openstaande facturen in het archief" (click)="outstandingChange.emit(!outstandingOnly())">
          <i aria-hidden="true"></i>Alleen nog te ontvangen
        </button>
      }
    </div>
  `,
  styles: `
    :host{display:block;min-width:0}
    .docnav{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px;min-width:0}
    .docnav__tabs{flex:1 1 320px;max-width:440px}
    .docnav__tabs .seg__item{gap:7px}
    .docnav__scope{flex:0 0 auto}
    .docnav__toggle{display:inline-flex;align-items:center;gap:8px;min-height:38px;padding:0 13px;border:1px solid var(--line);border-radius:12px;background:var(--surface);color:var(--ink-2);font:inherit;font-size:12.5px;font-weight:650;cursor:pointer}
    .docnav__toggle i{width:14px;height:14px;border:1.5px solid var(--line-strong);border-radius:5px;background:var(--surface);transition:background .15s ease,border-color .15s ease}
    .docnav__toggle.on{border-color:var(--rose-line);background:var(--rose-soft);color:var(--rose-dark)}
    .docnav__toggle.on i{border-color:var(--rose-dark);background:var(--rose-dark);box-shadow:inset 0 0 0 3px var(--rose-soft)}
    @media(max-width:679px){
      .docnav{gap:8px}
      .docnav__tabs{flex-basis:100%;max-width:none}
      .docnav__tabs .seg__item{min-height:40px;padding:6px 6px;font-size:13px;gap:5px}
      .docnav__scope{flex:1 1 auto}
      .docnav__scope .seg__item{flex:1;min-height:34px;padding:4px 8px;font-size:12px}
      .docnav__toggle{flex:1 1 100%;justify-content:center;min-height:38px}
    }
  `,
})
export class SalesDocumentNavigation {
  readonly scope = input<SalesScope>('ALL');
  readonly tab = input<SalesTab>('OFFERTE');
  readonly counts = input.required<Record<SalesTab, number>>();
  readonly loading = input(false);
  readonly outstandingOnly = input(false);
  readonly scopeChange = output<SalesScope>();
  readonly tabChange = output<SalesTab>();
  readonly outstandingChange = output<boolean>();
  readonly tabs: { key: SalesTab; label: string }[] = [
    { key: 'OFFERTE', label: 'Offertes' }, { key: 'FACTUUR', label: 'Facturen' }, { key: 'ARCHIEF', label: 'Archief' },
  ];
  readonly scopes: { key: SalesScope; label: string; hint: string }[] = [
    { key: 'ALL', label: 'Alles', hint: 'Reguliere verkoop en partnerdocumenten in één overzicht' },
    { key: 'STANDARD', label: 'Regulier', hint: 'Offertes en facturen voor verkoop aan je klanten' },
    { key: 'PARTNER', label: 'Partner', hint: 'Voorschotten en veilingafrekeningen van gezamenlijke inkopen' },
  ];
  readonly scopeHint = computed(() => this.scopes.find((item) => item.key === this.scope())?.hint ?? '');
  navigateTabs(event: KeyboardEvent): void {
    const current = this.tabs.findIndex(item => item.key === this.tab());
    const next = event.key === 'ArrowRight' ? (current + 1) % 3 : event.key === 'ArrowLeft' ? (current + 2) % 3
      : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : -1;
    if (next < 0) return;
    event.preventDefault();
    this.tabChange.emit(this.tabs[next].key);
    (event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }
}
