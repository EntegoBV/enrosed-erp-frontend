import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Sheet } from '../../shared/ui';
import { missingDocument } from './cost-ledger';
import { FinanceState } from './finance-state';

/**
 * The quarter for the accountant: one CSV of the company costs and container
 * payments (with the file names) and one zip of the cost documents. It opens
 * on the last completed quarter.
 */
@Component({
  selector: 'app-accountant-package-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet],
  template: `
    <app-sheet variant="ios" [title]="'Boekhouderspakket Q' + quarter() + ' ' + year()" (closed)="state.packageOpen.set(false)">
      <div body class="fin-sheet">
        <div class="fin-group" [class.ios-group]="!state.desk()"><div class="fin-field-row">
          <label class="fin-field"><span>Jaar</span>
            <select class="select" [value]="year()" (change)="year.set(+$any($event.target).value)">
              @for (option of years(); track option) { <option [value]="option" [selected]="option === year()">{{ option }}</option> }
            </select></label>
          <label class="fin-field"><span>Kwartaal</span>
            <select class="select" [value]="quarter()" (change)="quarter.set(+$any($event.target).value)">
              @for (option of [1, 2, 3, 4]; track option) { <option [value]="option" [selected]="option === quarter()">Q{{ option }}</option> }
            </select></label>
        </div></div>
        <p class="fin-sheet__lead">{{ counts().costs }} kosten, {{ counts().documents }} documenten{{ state.purchaseFiguresVisible() ? ', ' + counts().containers + ' containerbetalingen' : '' }}.</p>
        @if (counts().missing) {
          <button class="wk-link" type="button" (click)="showMissing()">{{ counts().missing }} {{ counts().missing === 1 ? 'kost' : 'kosten' }} zonder document ›</button>
        }
        <p class="fin-hint">Containerdocumenten blijven bij de container.</p>
      </div>
      <div foot style="display:contents">
        <button class="btn btn--primary" type="button" [disabled]="busy()" (click)="download()">{{ busy() ? 'Bezig…' : 'Download CSV en documenten' }}</button>
      </div>
    </app-sheet>
  `,
})
export class AccountantPackageSheet {
  readonly state = inject(FinanceState);
  private readonly start = this.state.packagePreset() ?? this.lastQuarter();
  readonly year = signal(this.start.year);
  readonly quarter = signal(this.start.quarter);
  readonly busy = signal(false);

  readonly years = computed(() => {
    const now = Number(this.state.today().slice(0, 4));
    const years = new Set<number>([now, now - 1, ...this.state.costs().map((cost) => Number(cost.date.slice(0, 4))).filter(Boolean)]);
    return [...years].sort((a, b) => b - a);
  });
  readonly range = computed(() => {
    const first = (this.quarter() - 1) * 3 + 1;
    return { from: `${this.year()}-${String(first).padStart(2, '0')}-01`, to: new Date(Date.UTC(this.year(), first + 2, 0)).toISOString().slice(0, 10) };
  });
  readonly counts = computed(() => {
    const { from, to } = this.range();
    const rows = this.state.ledger().filter((row) => row.date >= from && row.date <= to);
    const costs = rows.filter((row) => !!row.cost);
    return {
      costs: costs.length, containers: rows.length - costs.length,
      documents: costs.reduce((sum, row) => sum + this.state.attachmentsFor(row.cost!.id).length, 0),
      missing: costs.filter((row) => missingDocument(row.cost!, this.state.documentedIds())).length,
    };
  });

  showMissing(): void {
    const { from, to } = this.range();
    this.state.packageOpen.set(false);
    this.state.go({ view: 'costs', tab: 'company', docs: 'missing', from, to }, 'push');
  }

  async download(): Promise<void> {
    this.busy.set(true);
    try { await this.state.accountantPackage(this.year(), this.quarter()); }
    finally { this.busy.set(false); }
  }

  private lastQuarter(): { year: number; quarter: number } {
    const today = this.state.today();
    const year = Number(today.slice(0, 4));
    const current = Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1;
    return current === 1 ? { year: year - 1, quarter: 4 } : { year, quarter: current - 1 };
  }
}
