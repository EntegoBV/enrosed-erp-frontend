import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, output } from '@angular/core';
import { Segmented, SegmentOption } from '../../shared/segmented';
import { FinanceState } from './finance-state';

const QUICK = [21, 6, 0];

/** The btw rate as '21% | 6% | 0% | Anders'; Anders opens a field for any other rate. */
@Component({
  selector: 'app-vat-choice',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Segmented],
  template: `
    <app-segmented [variant]="state.desk() ? 'desk' : 'ios'" label="Btw" [options]="options" [value]="choice()" (changed)="pick($event)" />
    @if (choice() === 'other') {
      <span class="fin-vat-other"><input class="input" type="number" min="0" max="100" step="0.5" inputmode="decimal" aria-label="Ander btw-percentage"
             [value]="value() ?? 0" (input)="changed.emit(+($any($event.target).value || 0))" /><i>%</i></span>
    }
  `,
})
export class VatChoice {
  readonly state = inject(FinanceState);
  readonly value = input<number | null>(21);
  readonly changed = output<number>();
  readonly options: SegmentOption[] = [{ id: '21', label: '21%' }, { id: '6', label: '6%' }, { id: '0', label: '0%' }, { id: 'other', label: 'Anders' }];
  private readonly picked = computed(() => (QUICK.includes(this.value() ?? 0) ? String(this.value() ?? 0) : 'other'));
  readonly choice = linkedSignal(() => this.picked());

  pick(id: string): void {
    this.choice.set(id);
    if (id !== 'other') this.changed.emit(Number(id));
  }
}
