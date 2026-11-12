import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import type { PartnerContainer, PartnerProductSpec } from '../../core/api/partner-portal-api';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { Icon } from '../../shared/icon';
import { count } from './partner-format';
import { PartnerContainerLines } from './partner-container-lines';
import {
  ArrivalWords, STATE_TONE, STATE_WORD, arrivalLine, arrivalWords, cargoLine, dayText, isReceived, loadLines, stateOf,
} from './partner-containers-model';

interface Row {
  container: PartnerContainer;
  word: string;
  tone: string;
  load: { first: string; second: string };
  pallets: string;
  palletsSub: string;
  /** The sailing day, "vertrokken" without one, or (muted) "nog niet". */
  departure: string;
  departureMuted: boolean;
  departureSub: string;
  arrival: ArrivalWords;
  /** Phone: "40HQ · ± 2 pallets · 1,29 m³" and "Aankomst ± do 20 nov · over 8 dagen". */
  cargo: string;
  when: string;
}

/**
 * Enrosed's containers as one table, desk first: Container (PO number, "Samen
 * met jou" on his own) · Type · Lading (producten · dozen · m³ · % vol) ·
 * ± Pallets · Vertrek · Aankomst · Status; a row opens what is in it (the
 * products grouped by category and family). The selected container is
 * highlighted. Columns fold with the table's own width (Type and Vertrek
 * under 900 px). On the phone every container is a row that opens the same
 * way. Never a price, amount or supplier.
 */
@Component({
  selector: 'app-partner-container-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, PartnerContainerLines],
  template: `
    @if (desk.active()) {
      <div class="ct">
        <div class="wk-table ct-table" role="table" aria-label="Containers">
          <div class="wk-thead ct-row" role="row">
            <span class="wk-th" role="columnheader"><span class="sr-only">Open</span></span>
            <span class="wk-th" role="columnheader">Container</span>
            <span class="wk-th ct-wide" role="columnheader">Type</span>
            <span class="wk-th" role="columnheader">Lading</span>
            <span class="wk-th wk-th--num" role="columnheader" [attr.title]="palletTitle()">± Pallets</span>
            <span class="wk-th ct-wide" role="columnheader">Vertrek</span>
            <span class="wk-th" role="columnheader">Aankomst</span>
            <span class="wk-th" role="columnheader">Status</span>
          </div>
          @for (row of rows(); track row.container.id) {
            @let c = row.container;
            @let open = isOpen(c.id);
            <div class="wk-tr wk-tr--link ct-row ct-tr" role="row" tabindex="0" [id]="'pc-' + c.id" [attr.aria-expanded]="open"
                 [attr.aria-selected]="c.id === selectedId()" [class.is-open]="open" (click)="toggled.emit(c.id)"
                 (keydown.enter)="toggled.emit(c.id)" (keydown.space)="$event.preventDefault(); toggled.emit(c.id)">
              <span class="wk-td ct-chev" role="cell"><app-icon name="chevron-right" [size]="15" /></span>
              <span class="wk-td ct-cell" role="cell">
                <b class="ct-name">{{ c.name }}</b>
                @if (c.own) { <small class="ct-own">Samen met jou</small> }
              </span>
              <span class="wk-td ct-cell ct-wide" role="cell"><b>{{ c.containerType }}</b>@if (c.containerLabel && c.containerLabel !== c.containerType) { <small>{{ c.containerLabel }}</small> }</span>
              <span class="wk-td ct-cell" role="cell">
                <b class="ct-load"><span class="ct-narrow">{{ c.containerType }} · </span>{{ row.load.first }}</b>
                <small>{{ row.load.second }}</small>
              </span>
              <span class="wk-td wk-td--num ct-cell" role="cell"><b>{{ row.pallets || '—' }}</b>@if (row.palletsSub) { <small>{{ row.palletsSub }}</small> }</span>
              <span class="wk-td ct-cell ct-wide" role="cell">
                @if (row.departureMuted) { <span class="ct-muted">{{ row.departure }}</span> } @else { <b>{{ row.departure }}</b> }
                @if (row.departureSub) { <small>{{ row.departureSub }}</small> }
              </span>
              <span class="wk-td ct-cell" role="cell">
                <b [class.is-late]="row.arrival.late">{{ row.arrival.main }}</b>
                @if (row.arrival.moved || row.arrival.sub) { <small [class.is-late]="row.arrival.late && !row.arrival.moved">{{ row.arrival.moved || row.arrival.sub }}</small> }
              </span>
              <span class="wk-td ct-status" role="cell"><span class="wk-pill {{ row.tone }}">{{ row.word }}</span></span>
            </div>
            @if (open) {
              <div class="ct-detail" role="row">
                <div role="cell">
                  <app-partner-container-lines [container]="c" [specs]="specs()" [order]="order()" [today]="today()" />
                </div>
              </div>
            }
          }
        </div>
      </div>
    } @else {
      <div class="ct-list">
        @for (row of rows(); track row.container.id) {
          @let c = row.container;
          @let open = isOpen(c.id);
          <div class="ct-item" [id]="'pc-' + c.id" [class.is-on]="c.id === selectedId()">
            <button class="ct-item__head" type="button" [attr.aria-expanded]="open" (click)="toggled.emit(c.id)">
              <span class="ct-item__top">
                <b>{{ c.name }}</b>
                <span class="wk-pill {{ row.tone }}">{{ row.word }}</span>
              </span>
              @if (c.own) { <span class="ct-item__own">Samen met jou</span> }
              <span class="ct-item__sub">{{ row.cargo }}</span>
              <span class="ct-item__when" [class.is-late]="row.arrival.late">{{ row.when }}</span>
              @if (row.arrival.moved) { <span class="ct-item__sub">{{ row.arrival.moved }}</span> }
              <app-icon class="ct-item__chev" name="chevron-down" [size]="18" />
            </button>
            @if (open) {
              <app-partner-container-lines [container]="c" [specs]="specs()" [order]="order()" [today]="today()" />
            }
          </div>
        }
      </div>
    }
  `,
  styles: `
    :host{display:block;min-width:0}
    .ct{container:ct / inline-size}
    .ct-table{--wk-cols:28px minmax(150px,1fr) 92px minmax(180px,1fr) 80px 104px 136px 108px;--wk-pad-x:12px;--wk-gap:10px}
    .ct-narrow{display:none}
    @container ct (max-width: 899.98px){
      .ct-table{--wk-cols:28px minmax(0,1fr) minmax(0,1.3fr) 70px 124px 104px}
      .ct-wide{display:none!important}
      .ct-narrow{display:inline}
    }
    .ct-tr{min-height:52px;scroll-margin-top:calc(var(--pp-sticky-top,60px) + var(--wk-head-h,32px) + 8px)}
    .ct-tr.is-open{background:var(--surface-2)}
    .ct-tr[aria-selected=true]{background:var(--rose-soft);box-shadow:inset 3px 0 0 var(--rose)}
    .ct-chev{display:grid;place-items:center;color:var(--muted)}
    .ct-chev app-icon{transition:transform var(--dur-1,.12s)}
    .ct-tr.is-open .ct-chev app-icon{transform:rotate(90deg)}
    .ct-cell{display:grid;align-content:center}
    .ct-cell b{overflow:hidden;font-weight:650;font-variant-numeric:tabular-nums;text-overflow:ellipsis;white-space:nowrap}
    .ct-cell small{display:block;overflow:hidden;color:var(--muted);font-size:11.5px;text-overflow:ellipsis;white-space:nowrap}
    .ct-cell b.ct-name{font-size:13.5px;font-weight:720}
    .ct-cell small.ct-own{color:var(--rose-dark);font-weight:650}
    .ct-status{display:flex;align-items:center}
    .ct-load{font-weight:600!important}
    .ct-muted{color:var(--muted)}
    .is-late{color:#9a6212!important}
    .ct-detail{border-bottom:1px solid var(--line);background:var(--surface-2)}
    .ct-list{display:grid;gap:10px}
    .ct-item{border-radius:18px;background:var(--surface);overflow:hidden;scroll-margin-top:calc(var(--pp-sticky-top,108px) + 8px)}
    .ct-item.is-on{box-shadow:0 0 0 2px var(--rose-line)}
    .ct-item__head{position:relative;display:grid;gap:2px;width:100%;min-height:44px;padding:13px 44px 13px 14px;border:0;background:none;color:var(--ink);font:inherit;text-align:left;cursor:pointer;-webkit-tap-highlight-color:transparent}
    .ct-item__head:focus-visible{outline:2px solid var(--rose-dark);outline-offset:-2px}
    .ct-item__top{display:flex;align-items:center;justify-content:space-between;gap:10px}
    .ct-item__top b{min-width:0;overflow:hidden;font-size:16.5px;font-weight:750;font-variant-numeric:tabular-nums;text-overflow:ellipsis;white-space:nowrap}
    .ct-item__own{color:var(--rose-dark);font-size:13.5px;font-weight:650}
    .ct-item__sub{color:var(--ink-2);font-size:14px}
    .ct-item__when{font-size:14px;font-weight:650}
    .ct-item__chev{position:absolute;right:14px;bottom:16px;color:var(--muted);transition:transform var(--dur-1,.12s)}
    .ct-item__head[aria-expanded=true] .ct-item__chev{transform:rotate(180deg)}
  `,
})
export class PartnerContainerTable {
  readonly containers = input.required<readonly PartnerContainer[]>();
  readonly specs = input.required<ReadonlyMap<number, PartnerProductSpec>>();
  readonly order = input.required<ReadonlyMap<number, number>>();
  readonly today = input.required<string>();
  readonly selectedId = input<number | null>(null);
  readonly expanded = input<ReadonlySet<number>>(new Set());
  /** "Europallet 120 × 80 cm, tot 260 cm hoog". */
  readonly palletTitle = input<string | null>(null);
  readonly toggled = output<number>();

  readonly desk = inject(DesktopViewport);

  readonly rows = computed<Row[]>(() => {
    const today = this.today();
    return this.containers().map((container) => {
      const state = stateOf(container, today);
      const totals = container.totals;
      const unknown = totals?.palletsUnknown ?? 0;
      const arrival = arrivalWords(container, today);
      return {
        container, word: STATE_WORD[state], tone: STATE_TONE[state],
        load: totals ? loadLines(totals) : { first: '', second: '' },
        pallets: totals?.pallets != null ? `± ${count(totals.pallets)}` : '',
        palletsSub: unknown > 0 ? `${count(unknown)} zonder maat` : '',
        departure: container.shippedOn ? dayText(container.shippedOn, today) : state === 'BESTELD' ? 'nog niet' : isReceived(container) ? '—' : 'vertrokken',
        departureMuted: !container.shippedOn && (state === 'BESTELD' || isReceived(container)),
        departureSub: container.departurePort ?? '',
        arrival,
        cargo: cargoLine(container),
        when: isReceived(container) ? (container.receivedOn ? `Aangekomen ${arrival.main}` : 'Aangekomen') : `Aankomst ${arrivalLine(container, today)}`,
      };
    });
  });

  isOpen(id: number): boolean {
    return this.expanded().has(id);
  }
}
