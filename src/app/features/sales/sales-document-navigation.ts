import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

export type SalesTab = 'OFFERTE' | 'FACTUUR' | 'ARCHIEF';
export type SalesScope = 'STANDARD' | 'PARTNER' | 'ALL';

/** Scope chooses the business context; the tabs choose documents within it. */
@Component({
  selector: 'app-sales-document-navigation',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="document-navigation" aria-label="Verkoopdocumenten kiezen">
      <div class="scope-row">
        <label class="scope-field"><span>Soort verkoop</span>
          <select [value]="scope()" (change)="scopeChange.emit($any($event.target).value)">
            <option value="STANDARD">Reguliere verkoop</option>
            <option value="PARTNER">Partnercontainers</option>
            <option value="ALL">Alle verkoop</option>
          </select>
        </label>
        <p class="scope-hint">{{ scopeHint() }}</p>
      </div>
      <div class="document-tabs" role="tablist" aria-label="Documenten" (keydown)="navigateTabs($event)">
        @for (item of tabs; track item.key) {
          <button type="button" role="tab" [id]="'sales-tab-' + item.key" aria-controls="sales-document-results"
            [attr.aria-selected]="tab() === item.key" [attr.tabindex]="tab() === item.key ? 0 : -1"
            [class.active]="tab() === item.key" (click)="tabChange.emit(item.key)">
            <span>{{ item.label }}</span><b [class.zero]="counts()[item.key] === 0">{{ loading() ? '…' : counts()[item.key] }}</b>
          </button>
        }
      </div>
      @if (tab() === 'FACTUUR') {
        <div class="payment-filter">
          <label><input type="checkbox" [checked]="outstandingOnly()" (change)="outstandingChange.emit($any($event.target).checked)" /><span>Alleen nog te ontvangen</span></label>
          @if (outstandingOnly()) { <small>Inclusief openstaande facturen in het archief.</small> }
        </div>
      }
    </section>
  `,
  styles: `
    :host{display:block;min-width:0}.document-navigation{margin-bottom:12px;border:1px solid var(--line);border-radius:16px;background:var(--surface);overflow:hidden}
    .scope-row{display:flex;align-items:center;gap:24px;padding:18px 20px;background:var(--surface-2)}
    .scope-field{display:grid;flex:0 0 240px;gap:6px;min-width:0}.scope-field>span{font-size:12px;font-weight:650;color:var(--ink-2)}
    select{width:100%;min-height:46px;min-width:0;padding:9px 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--ink);font:inherit;font-size:14px;font-weight:650;cursor:pointer}
    .scope-hint{margin:20px 0 0;color:var(--muted);font-size:13px;line-height:1.5;max-width:390px}
    .document-tabs{display:flex;gap:8px;padding:0 16px;border-top:1px solid var(--line)}
    .document-tabs button{display:flex;align-items:center;justify-content:center;gap:9px;min-height:56px;min-width:130px;padding:10px 18px;position:relative;border:0;background:transparent;color:var(--muted);font:inherit;font-size:14px;font-weight:650;cursor:pointer}
    .document-tabs button::after{position:absolute;content:'';height:3px;bottom:0;left:12px;right:12px;border-radius:3px;background:transparent}
    .document-tabs button.active{color:var(--rose-dark)}.document-tabs button.active::after{background:var(--rose-dark)}
    .document-tabs b{display:inline-flex;align-items:center;justify-content:center;min-width:25px;min-height:23px;padding:2px 7px;border-radius:7px;background:var(--surface-2);color:var(--ink-2);font-size:12px;font-variant-numeric:tabular-nums;font-weight:650}
    .document-tabs .active b{background:var(--rose-soft);color:var(--rose-dark)}.document-tabs b.zero{background:transparent;color:var(--muted)}
    .document-tabs button:hover{background:var(--surface-2)}select:focus-visible,.document-tabs button:focus-visible{outline:2px solid var(--rose-dark);outline-offset:-3px}
    .payment-filter{display:flex;align-items:center;flex-wrap:wrap;gap:4px 20px;padding:6px 20px;border-top:1px solid var(--line)}
    .payment-filter label{display:inline-flex;align-items:center;gap:9px;min-height:44px;font-size:13px;cursor:pointer}.payment-filter input{width:18px;height:18px;accent-color:var(--rose-dark);margin:0}.payment-filter small{color:var(--muted);font-size:12px;line-height:1.5}
    @media(max-width:679px){.scope-row{display:block;padding:14px}.scope-field{width:100%;gap:7px}select{font-size:16px;min-height:48px}.scope-hint{display:none}.document-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0;padding:0 6px}.document-tabs button{min-width:0;min-height:54px;padding:10px 4px;font-size:13px;gap:6px}.document-tabs b{min-width:21px;padding:2px 5px;font-size:11px}.payment-filter{padding:6px 14px 10px}.payment-filter small{width:100%}}
  `,
})
export class SalesDocumentNavigation {
  readonly scope = input<SalesScope>('STANDARD');
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
  readonly scopeHint = computed(() => ({
    STANDARD: 'Offertes en facturen voor verkoop aan je klanten.',
    PARTNER: 'Voorschotten en veilingafrekeningen van gezamenlijke inkopen.',
    ALL: 'Reguliere verkoop en partnerdocumenten in één overzicht.',
  })[this.scope()]);
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
