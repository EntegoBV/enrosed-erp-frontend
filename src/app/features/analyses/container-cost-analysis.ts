import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { PurchaseOrderView } from '../../core/api/models';
import { EurPipe, NumPipe } from '../../shared/pipes';
import { PurchaseReconciliation } from '../purchasing/purchase-reconciliation';
import { ContainerCostFilter, containerCostRows, containerCostTotals } from '../purchasing/purchase-reconciliation-metrics';

/** Payment reconciliation remains independent of the receipt-quality date filter below it. */
@Component({
  selector: 'app-container-cost-analysis',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, EurPipe, NumPipe, PurchaseReconciliation],
  template: `
    <section class="container-cost-analysis" aria-labelledby="container-cost-analysis-title" [attr.aria-busy]="loading()">
      <header class="container-cost-analysis__heading">
        <div><span class="eyebrow">Containerafrekening</span><h2 id="container-cost-analysis-title">Wat de container werkelijk kost</h2><p>Begroting, betalingen en open bedragen naast elkaar. Meer- en minderbetalingen blijven per leverancier, douane en extra kost zichtbaar.</p></div>
        <a class="btn btn--sm" routerLink="/costs">Kosten &amp; bank ›</a>
      </header>
      <div class="container-cost-analysis__filters">
        <label><span>Containers</span><select class="select" [ngModel]="filter()" (ngModelChange)="filter.set($event)"><option value="active">Besteld, onderweg &amp; ontvangen</option><option value="all">Alle containers, inclusief concepten</option><option value="open">Nog niet volledig afgerekend</option><option value="finalized">Volledig afgerekend</option><option value="higher">Duurder dan begroot</option><option value="lower">Goedkoper dan begroot</option></select></label>
        <label><span>Zoeken</span><input class="input" type="search" placeholder="Containernummer of naam" [ngModel]="search()" (ngModelChange)="search.set($event)" /></label>
      </div>
      @if (loading()) {
        <p class="container-cost-analysis__empty" role="status">Betalingen en containerkosten laden…</p>
      } @else {
        @if (unavailable()) { <p class="container-cost-analysis__warning" role="status">Voor {{ unavailable() }} container(s) ontbreekt de nacalculatie. Die bedragen zijn niet opgenomen; vernieuw om ze opnieuw op te halen.</p> }
        @if (rows().length) {
          <div class="container-cost-kpis">
            <article><span>Begrote externe kost</span><strong>{{ totals().plannedEur | eur }}</strong><small>{{ rows().length | num }} container(s) in dit overzicht</small></article>
            <article><span>Werkelijk betaald</span><strong>{{ totals().paidEur | eur }}</strong><small>Opgeslagen eurobedragen van betalingen</small></article>
            <article><span>Nog te betalen</span><strong>{{ totals().remainingEur | eur }}</strong><small>{{ totals().provisionalCount }} container(s) nog voorlopig</small></article>
            <article class="container-cost-kpis__forecast"><span>{{ totals().provisionalCount ? 'Verwachte externe kost' : 'Definitieve externe kost' }}</span><strong>{{ totals().forecastEur | eur }}</strong><small>{{ totals().finalizedCount }} container(s) volledig afgerekend</small></article>
          </div>
          <div class="container-cost-differences">
            <div><span>Meer betaald op afgesproken kosten</span><b>{{ totals().overpaidEur | eur }}</b><small>Controleer bij open betaalstromen of er nog een correctie volgt.</small></div>
            <div><span>Minder betaald na vereffening</span><b>{{ totals().settledSavingEur | eur }}</b><small>Een open saldo of gedeeltelijke betaling is geen besparing.</small></div>
            <div><span>Extra uitgaven buiten begroting</span><b>{{ totals().additionalEur | eur }}</b><small>Bankkosten, koerier en andere betalingen tellen mee in de kost.</small></div>
            <div><span>Netto verschil met begroting</span><b [class.higher]="totals().varianceEur > 0" [class.lower]="totals().varianceEur < 0">{{ totals().varianceEur > 0 ? '+' : '' }}{{ totals().varianceEur | eur }}</b><small>Interne Enrosed opslag staat apart in elke afrekening.</small></div>
          </div>
          <div class="container-cost-table" tabindex="0" role="region" aria-label="Kostenvergelijking per container">
            <table>
              <thead><tr><th>Container</th><th>Status</th><th>Begroot</th><th>Betaald</th><th>Open</th><th>Verwachte kost</th><th>Verschil</th><th>Per stuk</th><th><span class="sr-only">Open afrekening</span></th></tr></thead>
              <tbody>
                @for (row of rows(); track row.view.order.id) {
                  <tr [class.selected]="expandedId() === row.view.order.id">
                    <td><a [routerLink]="['/purchasing', row.view.order.id]">{{ row.view.order.alias || row.view.order.number }}</a>@if (row.view.order.alias) { <small>{{ row.view.order.number }}</small> }<small>{{ orderStatus(row.view.order.status) }}</small></td>
                    <td><span class="cost-state" [class.cost-state--final]="row.reconciliation.totals.finalized">{{ row.reconciliation.totals.finalized ? 'Afgerekend' : 'Voorlopig' }}</span></td>
                    <td>{{ row.reconciliation.totals.plannedExternalEur | eur }}</td>
                    <td>{{ row.reconciliation.totals.paidEur | eur }}</td>
                    <td>{{ row.reconciliation.totals.remainingEur | eur }}</td>
                    <td><b>{{ row.reconciliation.totals.forecastExternalEur | eur }}</b></td>
                    <td [class.higher]="row.reconciliation.totals.varianceEur > 0" [class.lower]="row.reconciliation.totals.varianceEur < 0">{{ row.reconciliation.totals.varianceEur > 0 ? '+' : '' }}{{ row.reconciliation.totals.varianceEur | eur }}</td>
                    <td>{{ row.reconciliation.totals.forecastExternalUnitEur === null ? '—' : (row.reconciliation.totals.forecastExternalUnitEur | eur: 4) }}<small>{{ row.reconciliation.totals.unitCostQuantity | num }} {{ row.reconciliation.totals.unitCostBasis === 'USABLE_RECEIVED' ? 'bruikbare' : 'bestelde' }} stuks</small></td>
                    <td><button class="btn btn--sm" type="button" [attr.aria-expanded]="expandedId() === row.view.order.id" [attr.aria-label]="'Afrekening ' + row.view.order.number" (click)="toggle(row.view.order.id)">{{ expandedId() === row.view.order.id ? 'Sluiten' : 'Afrekening & PDF' }}</button></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          @if (expanded(); as row) {
            <div class="container-cost-detail">
              <header><div><span>Container</span><h3>{{ row.view.order.alias || row.view.order.number }}</h3><small>{{ row.view.order.number }}</small></div><button class="btn btn--sm" type="button" (click)="expandedId.set(null)">Sluiten</button></header>
              <app-purchase-reconciliation [data]="row.reconciliation" [orderId]="row.view.order.id" [orderNumber]="row.view.order.number" />
            </div>
          }
        } @else { <p class="container-cost-analysis__empty">Geen containers voor deze selectie.</p> }
      }
    </section>
  `,
  styles: `
    :host{display:block;min-width:0;margin:24px 0}.container-cost-analysis{min-width:0}.container-cost-analysis__heading{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:14px}.eyebrow{font-size:10px;color:var(--rose-dark);font-weight:750;letter-spacing:.08em;text-transform:uppercase}h2{margin:5px 0;font-size:21px}.container-cost-analysis__heading p{max-width:740px;margin:0;font-size:12px;line-height:1.5;color:var(--muted)}.container-cost-analysis__heading>a{flex-shrink:0}
    .container-cost-analysis__filters{display:flex;flex-wrap:wrap;gap:12px;margin:14px 0}.container-cost-analysis__filters label{display:grid;gap:5px;min-width:0;flex:1}.container-cost-analysis__filters span{font-size:11px;color:var(--muted)}.container-cost-analysis__filters .select,.container-cost-analysis__filters .input{width:100%;min-width:0}
    .container-cost-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.container-cost-kpis article{display:grid;align-content:start;gap:8px;padding:16px;border:1px solid var(--line);border-radius:14px;background:var(--surface)}.container-cost-kpis span{font-size:11px;color:var(--muted)}.container-cost-kpis strong{font-size:23px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.container-cost-kpis small{color:var(--muted);font-size:10px;line-height:1.4}.container-cost-kpis .container-cost-kpis__forecast{background:var(--ink);color:#fff}.container-cost-kpis__forecast span,.container-cost-kpis__forecast small{color:rgb(255 255 255 / 75%)}
    .container-cost-differences{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:12px 0 16px;padding:14px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2)}.container-cost-differences>div{display:grid;align-content:start;gap:5px}.container-cost-differences span{font-size:11px}.container-cost-differences b{font-size:16px;font-variant-numeric:tabular-nums}.container-cost-differences small{font-size:10px;color:var(--muted);line-height:1.4}.higher{color:var(--warn)}.lower{color:var(--ok)}
    .container-cost-table{overflow:auto;border:1px solid var(--line);border-radius:12px;background:var(--surface)}table{width:100%;border-collapse:collapse}th,td{padding:12px;text-align:right;white-space:nowrap;border-bottom:1px solid var(--line);font-size:12px;font-variant-numeric:tabular-nums}thead th{font-size:10px;color:var(--muted);font-weight:650;background:var(--surface-2)}th:first-child,td:first-child{text-align:left}td:first-child{min-width:150px;max-width:260px;white-space:normal;overflow-wrap:anywhere}td:first-child a{color:var(--rose-dark);font-weight:700;text-decoration:none}td small{display:block;margin-top:3px;font-size:10px;color:var(--muted)}tr:last-child td{border-bottom:0}.selected td{background:var(--rose-soft)}.cost-state{display:inline-block;padding:4px 7px;border-radius:999px;background:var(--warn-soft);color:var(--warn);font-size:10px}.cost-state--final{background:var(--ok-soft);color:var(--ok)}.container-cost-analysis__warning{padding:12px;border-radius:12px;background:var(--warn-soft);font-size:12px;line-height:1.5}.container-cost-analysis__empty{padding:20px;border:1px solid var(--line);border-radius:12px;color:var(--muted);font-size:12px;background:var(--surface)}
    .container-cost-detail{max-width:820px;margin-top:16px;padding:14px;border:1px solid var(--rose-line);border-radius:16px;background:var(--rose-soft)}.container-cost-detail>header{display:flex;justify-content:space-between;align-items:center;gap:12px}.container-cost-detail>header span,.container-cost-detail>header small{font-size:10px;color:var(--muted)}h3{font-size:17px;margin:4px 0}.container-cost-detail app-purchase-reconciliation{margin-bottom:0}
    @media(max-width:1050px){.container-cost-kpis,.container-cost-differences{grid-template-columns:repeat(2,minmax(0,1fr))}.container-cost-kpis strong{font-size:21px}}@media(max-width:540px){.container-cost-analysis__heading{flex-direction:column}.container-cost-analysis__filters{display:grid}.container-cost-kpis{gap:7px}.container-cost-kpis article{padding:12px}.container-cost-kpis strong{font-size:18px}.container-cost-differences{gap:14px}.container-cost-detail{padding:8px}.container-cost-detail>header{padding:4px}h2{font-size:19px}}
  `,
})
export class ContainerCostAnalysis {
  readonly purchases = input.required<PurchaseOrderView[]>();
  readonly loading = input(false);
  readonly filter = signal<ContainerCostFilter>('active');
  readonly search = signal('');
  readonly expandedId = signal<number | null>(null);
  readonly rows = computed(() => containerCostRows(this.purchases(), this.filter(), this.search()));
  readonly totals = computed(() => containerCostTotals(this.rows()));
  readonly expanded = computed(() => this.rows().find((row) => row.view.order.id === this.expandedId()) ?? null);
  readonly unavailable = computed(() => this.purchases().filter((row) => !row.reconciliation).length);
  toggle(id: number): void { this.expandedId.update((current) => current === id ? null : id); }
  orderStatus(status: PurchaseOrderView['order']['status']): string {
    return { CONCEPT: 'Concept', BESTELD: 'Besteld', ONDERWEG: 'Onderweg', ONTVANGEN: 'Ontvangen' }[status];
  }
}
