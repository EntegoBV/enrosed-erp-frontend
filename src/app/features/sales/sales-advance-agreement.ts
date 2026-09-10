import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { AdvanceAgreement, SalesOrderView } from '../../core/api/models';
import { DateNlPipe, EurPipe, NumPipe } from '../../shared/pipes';

/** Only a saved agreement changes the quote workflow; historical quotes keep their behaviour. */
export function advanceAgreementFor(view: SalesOrderView | null | undefined): AdvanceAgreement | null {
  return view?.order.docType !== 'FACTUUR' ? view?.advanceAgreement ?? null : null;
}

@Component({
  selector: 'app-sales-advance-agreement',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DateNlPipe, EurPipe, NumPipe],
  template: `
    <section class="agreement" aria-label="Opgeslagen betaalplan">
      <header><span>Opgeslagen afspraak</span><h2>Historische offerte met betaalplan</h2></header>
      <p>Deze bestaande offerte bewaart de toen afgesproken producten en voorschottermijnen. Nieuwe partnerdocumenten worden direct als conceptfactuur per termijn gemaakt. Het definitieve bedrag volgt op de slotfactuur na de veiling, inclusief de afgesproken winstdeling.</p>
      <ol>
        @for (row of agreement().rows; track row.scheduleRowId) {
          <li><span class="agreement__number">{{ $index + 1 }}</span><div><b>{{ row.label }}</b><small>@if (row.percentage !== null) { {{ row.percentage | num }}% van het afgesproken voorschot } @else { Vast bedrag } @if (row.dueDate) { · {{ row.dueDate | dateNl }} }</small></div><strong>{{ row.amountEur | eur }}<small>excl. btw</small></strong></li>
        }
      </ol>
      <p class="agreement__saved">Deze offerte bewaart het betaalplan zoals het bij aanmaak is afgesproken. Latere wijzigingen op de inkooporder veranderen deze offerte niet.</p>
      <a class="btn btn--primary" [routerLink]="['/purchasing', agreement().purchaseOrderId]" [queryParams]="{ section: 'payments' }">Voorschotfacturen beheren</a>
    </section>
  `,
  styles: `
    :host{display:block;margin:14px 0;min-width:0}.agreement{padding:18px;border:1px solid var(--rose-line);border-radius:16px;background:var(--rose-soft);display:grid;gap:12px}.agreement header>span{color:var(--muted);font-size:11px;font-weight:700;text-transform:uppercase}.agreement h2{margin:3px 0 0;font-size:18px}.agreement p{margin:0;font-size:13px;line-height:1.6}.agreement ol{list-style:none;padding:0;margin:0;display:grid;gap:8px}.agreement li{display:grid;grid-template-columns:26px minmax(0,1fr) auto;gap:10px;align-items:start;background:var(--surface);padding:12px;border-radius:10px}.agreement__number{font-size:12px;color:var(--muted)}.agreement li b{overflow-wrap:anywhere;font-size:13px}.agreement small{display:block;color:var(--muted);font-size:11px;font-weight:400;line-height:1.5}.agreement li strong{text-align:right;white-space:nowrap;font-size:14px}.agreement .agreement__saved{font-size:12px;color:var(--muted)}.agreement .btn{white-space:normal;text-align:center}@media(max-width:430px){.agreement{padding:13px}.agreement li{grid-template-columns:20px minmax(0,1fr)}.agreement li strong{grid-column:2;text-align:left}}
  `,
})
export class SalesAdvanceAgreement {
  readonly agreement = input.required<AdvanceAgreement>();
}
