import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import type { PartnerContainer, PartnerProductSpec } from '../../core/api/partner-portal-api';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { Sheet } from '../../shared/ui';
import { count } from './partner-format';
import {
  LineGroup, LineRow, cartonContentText, cartonsText, cbmNumber, cbmText, dayText, isReceived, kgText, lineFigure, lineGroups,
  packagingText, palletsText, perPalletText, productSpecText, sizeText,
} from './partner-containers-model';
import { PartnerPhoto, safeColour } from './partner-photo';
import { stockFigure } from './partner-units';

interface LineView {
  key: number;
  row: LineRow;
  colour: string | null;
  figure: { main: string; sub: string | null };
  ordered: string | null;
  /** Desk cells: numbers under their column heads. */
  cartons: string;
  cbm: string;
  pallets: string;
  /** Phone: "3 dozen · 0,04 m³ · ± 1 pallet". */
  phone: string;
  size: string;
  content: string;
  /** "± 48 dozen per pallet". */
  perPallet: string;
  /** The product's own size ("10 × 10 × 8 cm"), and its weight and packaging in one line. */
  own: string;
  ownMore: string;
  /** All of it in one line (the narrow table and the phone). */
  spec: string;
}

interface GroupView {
  key: string;
  label: string;
  swatches: string[];
  lines: LineView[];
}

/**
 * What is in one container, grouped by category and family the way the ERP's
 * purchase order reads: Foto · Product (colour, variant) · Afmeting (the
 * product's own size, weight and packaging) · Aantal (in the product's default
 * unit, "= 48 stolpen" beside it) · Dozen · m³ · ± Pallets · Omdoos (B × D × H ·
 * per doos · kg · per pallet). Afmeting and Omdoos fold into the product cell
 * on a narrower table. Above it one line of facts: the ports, where it is
 * unloaded (his own container or Enrosed's warehouse only), the order day and
 * the weight. A photo opens the product larger with its whole specification.
 * Never a price, amount or supplier. On the phone each product is a row with
 * the figures underneath.
 */
@Component({
  selector: 'app-partner-container-lines',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PartnerPhoto, Sheet],
  template: `
    @if (facts()) { <p class="cl-facts">{{ facts() }}</p> }
    @if (groups().length) {
      @if (desk.active()) {
        <div class="cl">
          <div class="wk-table cl-table" role="table" [attr.aria-label]="'Producten in ' + container().name">
            <div class="wk-thead cl-row" role="row">
              <span class="wk-th" role="columnheader"><span class="sr-only">Foto</span></span>
              <span class="wk-th" role="columnheader">Product</span>
              <span class="wk-th cl-own" role="columnheader">Afmeting</span>
              <span class="wk-th wk-th--num" role="columnheader">Aantal</span>
              <span class="wk-th wk-th--num" role="columnheader">Dozen</span>
              <span class="wk-th wk-th--num" role="columnheader">m³</span>
              <span class="wk-th wk-th--num" role="columnheader">± Pallets</span>
              <span class="wk-th cl-box" role="columnheader">Omdoos</span>
            </div>
            @for (group of groups(); track group.key) {
              <div class="wk-group cl-group" role="row">
                <span class="wk-group__label cl-group__label" role="cell">
                  {{ group.label }} <span class="wk-group__count">{{ group.lines.length }}</span>
                  @if (group.swatches.length > 1) {
                    <span class="cl-swatches" aria-hidden="true">@for (colour of group.swatches; track colour) { <i [style.background]="colour"></i> }</span>
                  }
                </span>
              </div>
              @for (line of group.lines; track line.key) {
                <div class="wk-tr cl-row cl-tr" role="row">
                  <span class="wk-td" role="cell">
                    <button class="cl-zoom" type="button" [attr.aria-label]="'Bekijk ' + line.row.spec.name" (click)="zoom.set(line)">
                      <app-partner-photo class="cl-photo" [product]="line.row.spec" />
                    </button>
                  </span>
                  <span class="wk-td cl-name" role="cell">
                    <b>{{ line.row.spec.name }}</b>
                    @if (line.row.spec.variant) { <small><i class="cl-dot" [style.background]="line.colour" aria-hidden="true"></i>{{ line.row.spec.variant }}</small> }
                    @if (line.spec) { <small class="cl-own-inline">{{ line.spec }}</small> }
                    @if (line.size || line.content) { <small class="cl-box-inline">Omdoos {{ boxLine(line) }}</small> }
                  </span>
                  <span class="wk-td cl-own cl-owncell" role="cell">
                    @if (line.own) { <b>{{ line.own }}</b> } @else if (!line.ownMore) { <span class="cl-muted">—</span> }
                    @if (line.ownMore) { <small>{{ line.ownMore }}</small> }
                  </span>
                  <span class="wk-td wk-td--num cl-fig" role="cell">
                    <b>{{ line.figure.main }}</b>
                    @if (line.figure.sub) { <small>{{ line.figure.sub }}</small> }
                    @if (line.ordered) { <small>{{ line.ordered }}</small> }
                  </span>
                  <span class="wk-td wk-td--num" role="cell">{{ line.cartons }}</span>
                  <span class="wk-td wk-td--num" role="cell">{{ line.cbm }}</span>
                  <span class="wk-td wk-td--num" role="cell">{{ line.pallets || '—' }}</span>
                  <span class="wk-td cl-box cl-boxcell" role="cell">
                    @if (line.size) { <b>{{ line.size }}</b> } @else { <span class="cl-muted">maat onbekend</span> }
                    @if (line.content) { <small>{{ line.content }}</small> }
                    @if (line.perPallet) { <small>{{ line.perPallet }}</small> }
                  </span>
                </div>
              }
            }
          </div>
        </div>
      } @else {
        <ul class="cl-list" [attr.aria-label]="'Producten in ' + container().name">
          @for (group of groups(); track group.key) {
            <li class="cl-list__group">{{ group.label }}</li>
            @for (line of group.lines; track line.key) {
              <li class="cl-item">
                <button class="cl-zoom" type="button" [attr.aria-label]="'Bekijk ' + line.row.spec.name" (click)="zoom.set(line)">
                  <app-partner-photo class="cl-item__photo" [product]="line.row.spec" />
                </button>
                <span class="cl-item__text">
                  <b>{{ line.row.spec.name }}</b>
                  @if (line.row.spec.variant) { <small><i class="cl-dot" [style.background]="line.colour" aria-hidden="true"></i>{{ line.row.spec.variant }}</small> }
                  <small>{{ line.phone }}</small>
                  @if (line.spec) { <small>{{ line.spec }}</small> }
                  @if (line.size || line.content) { <small>Omdoos {{ boxLine(line) }}</small> }
                </span>
                <span class="cl-item__fig">
                  <b>{{ line.figure.main }}</b>
                  @if (line.figure.sub) { <small>{{ line.figure.sub }}</small> }
                  @if (line.ordered) { <small>{{ line.ordered }}</small> }
                </span>
              </li>
            }
          }
        </ul>
      }
    } @else {
      <p class="cl-none">Er staan geen producten op deze container.</p>
    }

    @if (zoom(); as z) {
      @let spec = z.row.spec;
      <app-sheet variant="ios" [title]="spec.name" (closed)="zoom.set(null)">
        <div body class="cz">
          <app-partner-photo class="cz-photo" size="medium" [product]="spec" />
          <dl class="cz-list">
            @if (spec.variant) { <div><dt>Kleur</dt><dd><span><i class="cl-dot" [style.background]="z.colour" aria-hidden="true"></i>{{ spec.variant }}</span></dd></div> }
            @if (z.own) { <div><dt>Afmeting</dt><dd>{{ z.own }}</dd></div> }
            @if (spec.productWeightKg) { <div><dt>Gewicht</dt><dd>{{ kg(spec.productWeightKg) }}</dd></div> }
            @if (packaging(spec); as p) { <div><dt>Verpakking</dt><dd>{{ p }}</dd></div> }
            @if (z.size) { <div><dt>Omdoos</dt><dd>{{ z.size }}</dd></div> }
            @if (z.content) { <div><dt>Per doos</dt><dd>{{ z.content }}</dd></div> }
            @if (z.perPallet) { <div><dt>Per pallet</dt><dd>{{ z.perPallet }}</dd></div> }
            <div><dt>Op deze container</dt><dd>{{ z.figure.main }}@if (z.figure.sub) { <small>{{ z.figure.sub }}</small> }</dd></div>
          </dl>
        </div>
        <div foot><button class="ios-capsule ios-capsule--block" type="button" (click)="zoom.set(null)">Sluiten</button></div>
      </app-sheet>
    }
  `,
  styles: `
    :host{display:block;min-width:0}
    .cl-facts{margin:0;padding:8px 16px 8px 52px;color:var(--ink-2);font-size:12.5px}
    .cl{container:cl / inline-size;padding:0 12px 12px 40px}
    .cl-table{--wk-cols:40px minmax(0,1.3fr) minmax(128px,.9fr) minmax(104px,auto) 56px 64px 70px minmax(150px,1fr);--wk-pad-x:12px;--wk-gap:10px;--wk-row-h:48px;border:1px solid var(--line);border-radius:10px;overflow:hidden}
    .cl-table .wk-thead{position:static}
    .cl-group{position:static;grid-template-columns:minmax(0,1fr);min-height:28px}
    .cl-group__label{font-size:11px;letter-spacing:.05em;text-transform:uppercase}
    .cl-group .wk-group__count{letter-spacing:0}
    .cl-swatches{display:inline-flex;gap:3px;margin-left:4px}
    .cl-swatches>i{width:9px;height:9px;border-radius:50%;box-shadow:inset 0 0 0 1px rgb(26 22 20/14%)}
    .cl-tr:last-child{border-bottom:0}
    .cl-photo{display:block;width:36px;height:36px;border-radius:8px}
    .cl-name,.cl-fig,.cl-boxcell{display:grid;align-content:center}
    .cl-name b{overflow:hidden;font-size:13px;font-weight:650;text-overflow:ellipsis;white-space:nowrap}
    .cl-fig{justify-items:end}
    .cl-fig b{font-weight:700;font-variant-numeric:tabular-nums}
    .cl-boxcell b{font-weight:600;font-variant-numeric:tabular-nums}
    small{display:block;overflow:hidden;color:var(--muted);font-size:11.5px;text-overflow:ellipsis;white-space:nowrap}
    .cl-dot{display:inline-block;width:8px;height:8px;margin-right:5px;border-radius:50%;background:#c9bfb7;box-shadow:inset 0 0 0 1px rgb(26 22 20/14%)}
    .cl-muted{color:var(--muted)}
    .cl-box-inline,.cl-own-inline{display:none}
    .cl-owncell{display:grid;align-content:center}
    .cl-owncell b{font-weight:600;font-variant-numeric:tabular-nums}
    .cl-owncell small{white-space:normal}
    .cl-zoom{display:block;padding:0;border:0;border-radius:9px;background:none;cursor:zoom-in}
    .cl-zoom:focus-visible{outline:2px solid var(--rose);outline-offset:2px}
    @container cl (max-width: 979.98px){
      .cl-table{--wk-cols:40px minmax(0,1.5fr) minmax(104px,auto) 56px 64px 70px minmax(150px,1fr)}
      .cl-own{display:none}
      .cl-own-inline{display:block}
    }
    @container cl (max-width: 819.98px){
      .cl-table{--wk-cols:40px minmax(0,1.5fr) minmax(96px,auto) 56px 68px 70px}
      .cl-box{display:none}
      .cl-box-inline{display:block}
    }
    .cz{display:grid;gap:14px}
    .cz-photo{width:100%;max-width:420px;aspect-ratio:1;justify-self:center;border-radius:18px}
    .cz-list{display:grid;margin:0;padding:4px 16px;border-radius:18px;background:var(--surface)}
    .cz-list>div{display:flex;justify-content:space-between;gap:14px;padding:9px 0;font-size:14.5px}
    .cz-list>div+div{border-top:.5px solid var(--ios-sep,var(--line))}
    .cz-list dt{color:var(--muted)}
    .cz-list dd{display:grid;justify-items:end;margin:0;color:var(--ink);font-weight:600;text-align:right;font-variant-numeric:tabular-nums}
    .cz-list dd small{color:var(--muted);font-size:12.5px;font-weight:500}
    .cl-none{margin:0;padding:12px 16px 16px 52px;color:var(--muted);font-size:13px}
    .cl-list{margin:0;padding:0 0 6px;list-style:none}
    .cl-list__group{padding:10px 14px 4px;color:var(--muted);font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase}
    .cl-item{display:grid;grid-template-columns:44px minmax(0,1fr) auto;gap:12px;align-items:center;min-height:60px;padding:8px 14px}
    .cl-item+.cl-item{border-top:.5px solid var(--ios-sep,var(--line))}
    .cl-item__photo{display:block;width:44px;height:44px;border-radius:11px}
    .cl-item__text{display:grid;gap:1px;min-width:0}
    .cl-item__text b{font-size:15px;font-weight:650;line-height:1.25;overflow-wrap:anywhere}
    .cl-item__text small,.cl-item__fig small{font-size:13px;white-space:normal}
    .cl-item__fig{display:grid;justify-items:end;text-align:right}
    .cl-item__fig b{font-size:15.5px;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}
    @media (max-width: 679.98px), (hover: none) and (max-width: 1023.98px){
      .cz{padding:0 var(--ios-inset,16px)}
      .cl-facts{padding:2px 14px 6px;font-size:13.5px}
      .cl-none{padding:8px 14px 14px}
    }
  `,
})
export class PartnerContainerLines {
  readonly container = input.required<PartnerContainer>();
  readonly specs = input.required<ReadonlyMap<number, PartnerProductSpec>>();
  readonly order = input.required<ReadonlyMap<number, number>>();
  readonly today = input.required<string>();

  readonly desk = inject(DesktopViewport);
  /** The product shown larger, with its whole specification. */
  readonly zoom = signal<LineView | null>(null);

  readonly groups = computed<GroupView[]>(() =>
    lineGroups(this.container(), this.specs(), this.order()).map((group: LineGroup) => ({
      key: group.key, label: group.label, swatches: group.swatches,
      lines: group.rows.map((row) => this.view(row)),
    })));

  /** "Ningbo → Rotterdam · lost in Magazijn · besteld di 3 nov · 412 kg". */
  readonly facts = computed(() => {
    const c = this.container();
    const today = this.today();
    const route = c.departurePort && c.destinationPort ? `${c.departurePort} → ${c.destinationPort}` : c.departurePort || c.destinationPort || '';
    const place = c.locationName ? `${isReceived(c) ? 'gelost in' : 'lost in'} ${c.locationName}` : '';
    const ordered = c.orderDate ? `besteld ${dayText(c.orderDate, today)}` : '';
    const weight = c.totals?.weightKg != null ? `${c.totals.weightUnknown ? '± ' : ''}${kgText(c.totals.weightKg)}` : '';
    return [c.containerLabel && c.containerLabel !== c.containerType ? c.containerLabel : '', route, place, ordered, weight].filter(Boolean).join(' · ');
  });

  /** The omdoos in one line where it has no column (narrow table, phone); per pallet stays in the column and the card. */
  boxLine(line: LineView): string {
    return [line.size, line.content].filter(Boolean).join(' · ');
  }

  kg(value: number): string {
    return kgText(value);
  }

  packaging(spec: PartnerProductSpec): string {
    const text = packagingText(spec);
    return text ? text[0].toUpperCase() + text.slice(1) : '';
  }

  private view(row: LineRow): LineView {
    const { line, spec } = row;
    const ordered = line.orderedQuantity != null && line.orderedQuantity !== line.quantity
      ? `${stockFigure(spec, line.orderedQuantity).main} besteld` : null;
    return {
      key: line.productId, row, colour: safeColour(spec.colourHex), figure: lineFigure(line, spec), ordered,
      cartons: count(line.cartons), cbm: cbmNumber(line.cbm), pallets: line.pallets == null ? '' : `± ${count(line.pallets)}`,
      phone: [cartonsText(line.cartons), cbmText(line.cbm), palletsText(line.pallets)].filter(Boolean).join(' · '),
      size: sizeText(spec.cartonCm), content: cartonContentText(spec), perPallet: perPalletText(spec),
      own: sizeText(spec.productCm), ownMore: [kgText(spec.productWeightKg), packagingText(spec)].filter(Boolean).join(' · '),
      spec: productSpecText(spec),
    };
  }
}
