import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Icon } from '../../shared/icon';
import { FinanceState } from './finance-state';

/** The desk status bar: freshness on the left, the selection or a running bulk action in the middle, the count on the right. */
@Component({
  selector: 'app-finance-status-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  imports: [Icon],
  template: `
    <footer class="wk-statusbar" aria-live="polite">
      @if (state.loadErrors().length) {
        <button type="button" (click)="toBanner()"><app-icon name="alert" [size]="13" /> {{ state.loadErrors().length }} {{ state.loadErrors().length === 1 ? 'bron' : 'bronnen' }} niet geladen</button>
      } @else if (state.loading()) {
        <span>Gegevens ophalen…</span>
      } @else if (updated(); as time) {
        <span>Bijgewerkt {{ time }}</span>
      }
      <span class="wk-statusbar__mid">{{ middle() }}</span>
      <span class="wk-statusbar__end">{{ text() }}</span>
    </footer>
  `,
})
export class FinanceStatusBar {
  readonly state = inject(FinanceState);
  readonly text = input('');
  readonly selected = input(0);

  readonly updated = computed(() => this.state.loadedAt()?.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' }) ?? '');
  readonly middle = computed(() => {
    const progress = this.state.progress();
    if (progress) return `Bezig: ${Math.min(progress.total, progress.done + 1)} van ${progress.total}…`;
    return this.selected() ? `${this.selected()} geselecteerd` : '';
  });

  toBanner(): void {
    document.getElementById('fin-banner')?.scrollIntoView({ block: 'nearest' });
  }
}
