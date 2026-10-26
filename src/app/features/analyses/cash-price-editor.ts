import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal } from '@angular/core';
import { Segmented, SegmentOption } from '../../shared/segmented';
import { cashPercentText, marginFromMarkup, markupFromPriceInput } from './cash-price-input';
import type { CashPercentageBasis } from './cash-price-input';

let nextPriceEditor = 0;

/** Both price percentages describe the same price; only markup is persisted. */
@Component({
  selector: 'app-cash-price-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Segmented],
  host: { '[class.is-ios]': "variant() === 'ios'" },
  template: `
    <app-segmented [variant]="variant()" label="Percentage invoeren als" [options]="basisOptions" [value]="basis()" (changed)="setBasis($event)" />
    <label class="cash-price__field" [for]="id">
      <span>{{ basis() === 'margin' ? 'Marge op verkoop' : 'Opslag op kost' }}</span>
      <span class="cash-price__entry">
        <input [id]="id" type="text" inputmode="decimal" autocomplete="off" [value]="entry()"
               [attr.aria-invalid]="error() ? 'true' : null" [attr.aria-describedby]="id + '-help' + (error() ? ' ' + id + '-error' : '')"
               (input)="draft.set($any($event.target).value); error.set(null)" (change)="commit($any($event.target).value)" />
        <span aria-hidden="true">%</span>
      </span>
    </label>
    @if (error(); as message) { <p class="cash-price__error" [id]="id + '-error'" role="alert">{{ message }}</p> }
    <p class="cash-price__equivalent" [id]="id + '-help'">{{ percent(markupPct()) }} % opslag op kost = <b>{{ percent(margin()) }} % marge op verkoop</b></p>
    <div class="cash-price__presets" [attr.aria-label]="basis() === 'margin' ? 'Marge kiezen' : 'Opslag kiezen'">
      @for (value of presets(); track value) {
        <button type="button" [attr.aria-pressed]="selected(value)" (click)="choose(value)">{{ percent(value) }} %</button>
      }
    </div>
  `,
  styles: `
    :host{display:grid;gap:10px;min-width:0}
    app-segmented{width:100%}
    .cash-price__field{display:flex;align-items:center;justify-content:space-between;gap:12px;color:var(--ink-2);font-size:13px;font-weight:650}
    .cash-price__entry{display:flex;align-items:baseline;gap:4px;flex:none;padding:5px 10px;border:1px solid var(--line-strong);border-radius:10px;background:var(--surface)}
    .cash-price__entry:focus-within{border-color:var(--rose);box-shadow:var(--wk-focus)}
    .cash-price__entry input{width:82px;min-height:30px;padding:0;border:0;outline:none;background:transparent;color:var(--ink);font:inherit;font-size:22px;font-weight:750;text-align:right;font-variant-numeric:tabular-nums}
    .cash-price__entry>span{color:var(--muted);font-size:16px}
    .cash-price__entry:has([aria-invalid=true]){border-color:var(--danger)}
    .cash-price__equivalent{margin:0;color:var(--muted);font-size:12px;line-height:1.5}
    .cash-price__equivalent b{color:var(--ink-2);font-weight:650}
    .cash-price__presets{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}
    .cash-price__presets button{min-height:34px;padding:4px;border:1px solid var(--line);border-radius:9px;background:var(--surface-2);color:var(--ink-2);font:inherit;font-size:12px;font-weight:650;cursor:pointer}
    .cash-price__presets button[aria-pressed=true]{border-color:var(--rose);background:var(--rose-soft);color:var(--rose-dark)}
    .cash-price__presets button:focus-visible{outline:2px solid var(--rose);outline-offset:2px}
    .cash-price__error{margin:0;color:var(--danger);font-size:13px;line-height:1.4}
    :host(.is-ios) app-segmented{height:50px}
    :host(.is-ios) .cash-price__field{font-size:15px}
    :host(.is-ios) .cash-price__entry input{min-height:34px;font-size:24px}
    :host(.is-ios) .cash-price__presets button{min-height:44px;border-radius:12px;font-size:14px}
    :host(.is-ios) .cash-price__equivalent{font-size:13px}
  `,
})
export class CashPriceEditor {
  readonly markupPct = input.required<number>();
  readonly variant = input<'desk' | 'ios'>('desk');
  readonly markupPctChange = output<number>();
  readonly id = `cash-price-${++nextPriceEditor}`;
  readonly basisOptions: SegmentOption[] = [{ id: 'margin', label: 'Marge %' }, { id: 'markup', label: 'Opslag %' }];
  readonly basis = signal<CashPercentageBasis>('margin');
  readonly draft = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly percent = cashPercentText;
  readonly margin = computed(() => marginFromMarkup(this.markupPct()));
  readonly current = computed(() => this.basis() === 'margin' ? this.margin() : this.markupPct());
  readonly entry = computed(() => this.draft() ?? String(Math.round(this.current() * 10) / 10).replace('.', ','));
  readonly presets = computed(() => this.basis() === 'margin' ? [20, 25, 40, 50] : [40, 50, 75, 100]);

  constructor() {
    effect(() => { this.markupPct(); this.draft.set(null); this.error.set(null); });
  }

  setBasis(value: string): void {
    this.basis.set(value === 'markup' ? 'markup' : 'margin');
    this.draft.set(null);
    this.error.set(null);
  }

  selected(value: number): boolean { return Math.abs(this.current() - value) < 0.05; }

  choose(value: number): void { this.commit(String(value)); }

  commit(raw: string): void {
    const parsed = markupFromPriceInput(raw, this.basis());
    this.error.set(parsed.error);
    if (parsed.error !== null) { this.draft.set(raw); return; }
    this.draft.set(null);
    this.markupPctChange.emit(parsed.value);
  }
}
