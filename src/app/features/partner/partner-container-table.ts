import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import type { PartnerContainer, PartnerProductSpec } from '../../core/api/partner-portal-api';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { Icon } from '../../shared/icon';
import { PartnerContainerLines } from './partner-container-lines';
import {
  ArrivalCell, STATE_TONE, STATE_WORD, cargoLine, cartonsText, cbmText, dayText, isReceived, palletsText, portCell, productsText, stateOf,
  stockCell,
} from './partner-containers-model';
import { PartnerPakbonButton } from './partner-pakbon-button';
import { PartnerRoute } from './partner-route';

interface Row {
  container: PartnerContainer;
  word: string;
  tone: string;
  load: { first: string; second: string };
  /** The sailing day, "vertrokken" without one, or (muted) "nog niet". */
  departure: string;
  departureMuted: boolean;
  departureSub: string;
  portCell: ArrivalCell;
  stockCell: ArrivalCell;
  /** Phone: "40HQ · ± 2 pallets · 1,29 m³". */
  cargo: string;
}

/**
 * Enrosed's purchase orders (containers) as one table, desk first (2026-11-28): Inkooporder (PO number, its state
 * and type, "Samen met jou" on his own) · Vertrokken (the day and the port it left) · Aankomst haven · In
 * Zaltbommel (the day and hour set by hand in the ERP) · Lading · Pakbon. Vertrokken never folds away; Lading does
 * on a narrow table (it is in the opened row and on the pakbon). A row opens what is in it. On the phone each
 * container is a card with its way (Besteld → Vertrokken → Haven → Zaltbommel), its cargo, Pakbon and Inhoud.
 * Never a price, amount or supplier.
 */
@Component({
  selector: 'app-partner-container-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, PartnerContainerLines, PartnerPakbonButton, PartnerRoute],
  template: `
    @if (desk.active()) {
      <div class="ct">
        <div class="wk-table ct-table" role="table" aria-label="Inkooporders">
          <div class="wk-thead ct-row" role="row">
            <span class="wk-th" role="columnheader"><span class="sr-only">Open</span></span>
            <span class="wk-th" role="columnheader">Inkooporder</span>
            <span class="wk-th" role="columnheader">Vertrokken</span>
            <span class="wk-th" role="columnheader">Aankomst haven</span>
            <span class="wk-th" role="columnheader">In {{ warehouseName() }}</span>
            <span class="wk-th ct-load" role="columnheader">Lading</span>
            <span class="wk-th" role="columnheader"><span class="sr-only">Pakbon</span></span>
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
                <small class="ct-state {{ row.tone }}"><i class="wk-dot" aria-hidden="true"></i>{{ row.word }}</small>
                @if (c.own) { <small class="ct-own">Samen met jou</small> }
              </span>
              <span class="wk-td ct-cell" role="cell">
                @if (row.departureMuted) { <span class="ct-muted">{{ row.departure }}</span> } @else { <b>{{ row.departure }}</b> }
                @if (row.departureSub) { <small>{{ row.departureSub }}</small> }
              </span>
              @for (cell of [row.portCell, row.stockCell]; track $index) {
                <span class="wk-td ct-cell" role="cell" [attr.title]="cell.sub ? cell.main + ' · ' + cell.sub : null">
                  @if (cell.muted && !cell.sub) { <span class="ct-muted">{{ cell.main }}</span> }
                  @else {
                    <b [class.is-late]="cell.late" [class.ct-muted]="cell.muted">{{ cell.main }}</b>
                    @if (cell.sub) { <small [class.is-late]="cell.late">{{ cell.sub }}</small> }
                  }
                </span>
              }
              <span class="wk-td ct-cell ct-load" role="cell">
                <b class="ct-loadfig">{{ row.load.first }}</b>
                <small>{{ row.load.second }}</small>
              </span>
              <span class="wk-td ct-pak" role="cell">
                <app-partner-pakbon-button [containerId]="c.id" [name]="c.name" [compact]="true" />
              </span>
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
            <div class="ct-item__top">
              <b>{{ c.name }}</b>
              <span class="wk-pill {{ row.tone }}">{{ row.word }}</span>
            </div>
            <p class="ct-item__sub">{{ row.cargo }}@if (c.own) { <span class="ct-item__own"> · Samen met jou</span> }</p>
            <app-partner-route class="ct-item__route" [container]="c" [today]="today()" [warehouseName]="warehouseName()" />
            <div class="ct-item__actions">
              <app-partner-pakbon-button [containerId]="c.id" [name]="c.name" />
              <button class="ct-item__open" type="button" [attr.aria-expanded]="open" (click)="toggled.emit(c.id)">
                Inhoud <app-icon name="chevron-down" [size]="17" />
              </button>
            </div>
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
    .ct-table{--wk-cols:24px minmax(124px,1.1fr) minmax(92px,.85fr) minmax(108px,.95fr) minmax(108px,.95fr) minmax(116px,1fr) 84px;--wk-pad-x:12px;--wk-gap:10px}
    /* Lading folds away on a narrow table: it is in the opened row and on the pakbon. Vertrokken never does. */
    @container ct (max-width: 739.98px){
      .ct-table{--wk-cols:24px minmax(124px,1.2fr) minmax(92px,1fr) minmax(108px,1fr) minmax(108px,1fr) 84px}
      .ct-load{display:none!important}
    }
    /* The narrow rail beside a small window: no floors, so Pakbon never leaves the card (the cells end in "…"). */
    @container ct (max-width: 613.98px){
      .ct-table{--wk-cols:24px minmax(0,1.2fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) 84px}
    }
    .ct-tr{min-height:56px;scroll-margin-top:calc(var(--pp-sticky-top,0px) + var(--wk-head-h,32px) + 8px)}
    .ct-tr.is-open{background:var(--surface-2)}
    .ct-tr[aria-selected=true]{background:var(--rose-soft);box-shadow:inset 3px 0 0 var(--rose)}
    .ct-chev{display:grid;place-items:center;color:var(--muted)}
    .ct-chev app-icon{transition:transform var(--dur-1,.12s)}
    .ct-tr.is-open .ct-chev app-icon{transform:rotate(90deg)}
    .ct-cell{display:grid;align-content:center;min-width:0}
    .ct-cell b{overflow:hidden;font-weight:650;font-variant-numeric:tabular-nums;text-overflow:ellipsis;white-space:nowrap}
    .ct-cell small{display:block;overflow:hidden;color:var(--muted);font-size:11.5px;text-overflow:ellipsis;white-space:nowrap}
    .ct-cell b.ct-name{font-size:13.5px;font-weight:740}
    .ct-state{display:flex!important;align-items:center;gap:5px;color:color-mix(in srgb,var(--tone) 80%,var(--ink))!important;font-weight:650}
    .ct-cell small.ct-own{color:var(--rose-dark);font-weight:650}
    .ct-loadfig{font-weight:600!important}
    .ct-pak{display:flex;align-items:center;justify-content:flex-end}
    .ct-muted{color:var(--muted)}
    .is-late{color:#9a6212!important}
    .ct-detail{border-bottom:1px solid var(--line);background:var(--surface-2)}
    .ct-list{display:grid;gap:10px}
    .ct-item{padding:14px 14px 12px;border-radius:18px;background:var(--surface);overflow:hidden;scroll-margin-top:calc(var(--pp-sticky-top,108px) + 8px)}
    .ct-item.is-on{box-shadow:0 0 0 2px var(--rose-line)}
    .ct-item__top{display:flex;align-items:center;justify-content:space-between;gap:10px}
    .ct-item__top b{min-width:0;overflow:hidden;font-size:17px;font-weight:780;font-variant-numeric:tabular-nums;text-overflow:ellipsis;white-space:nowrap}
    .ct-item__sub{margin:2px 0 14px;color:var(--ink-2);font-size:14px}
    .ct-item__own{color:var(--rose-dark);font-weight:650}
    .ct-item__route{margin:0 -6px 14px}
    .ct-item__actions{display:flex;gap:8px}
    .ct-item__actions > *{flex:1}
    .ct-item__actions ::ng-deep .pb{width:100%;justify-content:center}
    .ct-item__open{display:inline-flex;align-items:center;justify-content:center;gap:4px;min-height:44px;padding:0 16px;border:0;border-radius:12px;background:color-mix(in srgb,var(--ink) 6%,var(--surface));color:var(--ink);font:inherit;font-size:15px;font-weight:650;cursor:pointer;-webkit-tap-highlight-color:transparent}
    .ct-item__open app-icon{transition:transform var(--dur-1,.12s)}
    .ct-item__open[aria-expanded=true] app-icon{transform:rotate(180deg)}
    .ct-item app-partner-container-lines{margin:12px -14px -12px;border-top:.5px solid var(--ios-sep,var(--line))}
  `,
})
export class PartnerContainerTable {
  readonly containers = input.required<readonly PartnerContainer[]>();
  readonly specs = input.required<ReadonlyMap<number, PartnerProductSpec>>();
  readonly order = input.required<ReadonlyMap<number, number>>();
  readonly today = input.required<string>();
  readonly selectedId = input<number | null>(null);
  readonly expanded = input<ReadonlySet<number>>(new Set());
  /** The main warehouse's name (Zaltbommel): the column of the arrival set by hand in the ERP. */
  readonly warehouseName = input('Zaltbommel');
  readonly toggled = output<number>();

  readonly desk = inject(DesktopViewport);

  readonly rows = computed<Row[]>(() => {
    const today = this.today();
    return this.containers().map((container) => {
      const state = stateOf(container, today);
      const totals = container.totals;
      return {
        container, word: STATE_WORD[state], tone: STATE_TONE[state],
        load: totals ? {
          first: palletsText(totals.pallets) || cartonsText(totals.cartons),
          second: [totals.pallets != null ? cartonsText(totals.cartons) : productsText(totals.products), (totals.cbmUnknown ? '± ' : '') + cbmText(totals.cbm)].join(' · '),
        } : { first: '', second: '' },
        departure: container.shippedOn ? dayText(container.shippedOn, today) : state === 'BESTELD' ? 'nog niet' : isReceived(container) ? '—' : 'vertrokken',
        departureMuted: !container.shippedOn && (state === 'BESTELD' || isReceived(container)),
        departureSub: container.departurePort ?? '',
        portCell: portCell(container, today),
        stockCell: stockCell(container, today, this.warehouseName()),
        cargo: cargoLine(container),
      };
    });
  });

  isOpen(id: number): boolean {
    return this.expanded().has(id);
  }
}
