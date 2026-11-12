import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import type { PartnerCountUnitKey, PartnerRecentSale } from '../../core/api/partner-portal-api';
import { Icon } from '../../shared/icon';
import { DraftEntry, MeldingDraft } from './partner-draft';
import { PartLine, partLine, pricePerLabel, stockLine, unitOption } from './partner-entry-rules';
import { euro, shortDate } from './partner-format';
import { PartnerCountField } from './partner-count-field';
import { PartnerMoneyField } from './partner-money-field';
import { safeColour } from './partner-photo';

/**
 * The products of a melding on the desk, as one table: Product · Eenheid ·
 * Aantal · = stuks · Prijs per roos · Totaal · ×. A buyback on the clock is an
 * indented sub-row of its product (Veiling), or the row itself (Terugkoop):
 * Klokprijs, and Terugkoopkost incl. commissie + transport. Lines that stop
 * Opslaan (too many, not whole) stand right under their row.
 */
@Component({
  selector: 'app-partner-entry-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, FormsModule, Icon, PartnerCountField, PartnerMoneyField],
  template: `
    @let d = draft();
    @let kind = d.kind();
    @let money = d.money();
    <div class="wk-table et" role="table" aria-label="Producten van de melding">
      <div class="wk-thead et-row" role="row">
        <span class="wk-th" role="columnheader">Product</span>
        <span class="wk-th" role="columnheader">Eenheid</span>
        <span class="wk-th wk-th--num" role="columnheader">Aantal</span>
        <span class="wk-th" role="columnheader">= stuks</span>
        <span class="wk-th wk-th--num" role="columnheader">{{ priceHead() }}</span>
        <span class="wk-th wk-th--num" role="columnheader">{{ kind === 'terugkoop' ? 'Terugkoop' : 'Totaal' }}</span>
        <span class="wk-th" role="columnheader"><span class="sr-only">Acties</span></span>
      </div>
      @for (entry of d.entries(); track entry.product.productId; let i = $index) {
        @let em = money.entries[i] ?? null;
        @let main = kind === 'terugkoop' ? 'buyback' : 'sale';
        @let line = lineOf(entry, main);
        <div class="wk-tr et-row et-main" role="row">
          <span class="wk-td et-product" role="cell">
            <b>@if (entry.product.variant) { <i class="et-dot" [style.background]="colour(entry)" aria-hidden="true"></i> }{{ entry.product.name }}</b>
            <span class="et-sub">{{ productSub(entry) }}</span>
          </span>
          <ng-container *ngTemplateOutlet="part; context: { entry: entry, which: main, line: line, em: em }" />
          <span class="wk-td et-act" role="cell">
            @if (kind === 'veiling' && !entry.buybackOpen) {
              <button class="wk-btn wk-btn--ghost wk-btn--sm wk-btn--icon" type="button" title="Teruggekocht op de klok"
                      [attr.aria-label]="'Teruggekocht op de klok: ' + entry.product.name" (click)="d.setBuybackOpen(entry.product.productId, true)">
                <app-icon name="restore" [size]="15" />
              </button>
            }
            <button class="wk-btn wk-btn--ghost wk-btn--sm wk-btn--icon" type="button" title="Weghalen"
                    [attr.aria-label]="'Weghalen: ' + entry.product.name" (click)="d.remove(entry.product.productId)">
              <app-icon name="close" [size]="15" />
            </button>
          </span>
        </div>
        <ng-container *ngTemplateOutlet="notes; context: { line: line, exceeds: main === 'sale' && em?.costsExceedGross }" />
        @if (kind === 'veiling' && entry.buybackOpen) {
          @let back = lineOf(entry, 'buyback');
          <div class="wk-tr et-row et-back" role="row">
            <span class="wk-td et-product et-product--back" role="cell" title="Teruggekocht op de klok"><b>Teruggekocht</b><span class="et-sub">op de klok</span></span>
            <ng-container *ngTemplateOutlet="part; context: { entry: entry, which: 'buyback', line: back, em: em }" />
            <span class="wk-td et-act" role="cell">
              <button class="wk-btn wk-btn--ghost wk-btn--sm wk-btn--icon" type="button" title="Terugkoop weghalen"
                      [attr.aria-label]="'Terugkoop weghalen: ' + entry.product.name" (click)="d.setBuybackOpen(entry.product.productId, false)">
                <app-icon name="close" [size]="15" />
              </button>
            </span>
          </div>
          <ng-container *ngTemplateOutlet="notes; context: { line: back, exceeds: false }" />
        }
      } @empty {
        <div class="wk-tr et-row et-empty" role="row"><span class="et-span" role="cell">Kies hierboven de producten.</span></div>
      }
      <div class="wk-tr et-row et-foot" role="row">
        <span class="et-span" role="cell">
          <button class="wk-link et-add" type="button" (click)="addProducts.emit()"><app-icon name="plus" [size]="14" />Product</button>
        </span>
      </div>
    </div>

    <ng-template #part let-entry="entry" let-which="which" let-line="line" let-em="em">
      <span class="wk-td" role="cell">
        @if (line.units.length > 1) {
          <select class="et-unit" [attr.aria-label]="'Eenheid ' + entry.product.name" [ngModel]="line.unit.unit"
                  (ngModelChange)="setUnit(entry, which, $event)">
            @for (unit of line.units; track unit.unit) { <option [value]="unit.unit">{{ optionLabel(unit) }}</option> }
          </select>
        } @else {
          <span class="et-unit-text">{{ line.unit.one }}</span>
        }
      </span>
      <span class="wk-td" role="cell">
        <input class="et-num" appPartnerCount [step]="line.step" [max]="line.max" placeholder="0"
               [attr.aria-label]="(which === 'buyback' ? 'Aantal teruggekocht ' : 'Aantal ') + entry.product.name"
               [attr.aria-invalid]="line.invalid ? 'true' : null"
               [ngModel]="entry[which].count" (ngModelChange)="draft().updatePart(entry.product.productId, which, { count: $event })" />
      </span>
      <span class="wk-td et-pieces" role="cell">{{ line.piecesText }}</span>
      <span class="wk-td" role="cell">
        <label class="et-money">
          <span aria-hidden="true">€</span>
          <input appPartnerMoney #price="partnerMoney" placeholder="0,00"
                 [attr.aria-label]="(which === 'buyback' ? 'Klokprijs per ' : 'Prijs per ') + line.units[0].one + ' ' + entry.product.name"
                 [ngModel]="entry[which].price" (ngModelChange)="draft().updatePart(entry.product.productId, which, { price: $event })" />
        </label>
        @if (price.unreadable()) { <span class="et-bad">Geen bedrag</span> }
      </span>
      <span class="wk-td wk-td--num et-total" role="cell">
        @if (which === 'sale') {
          <b>{{ eur(em?.sale?.grossEur) }}</b>
        } @else {
          <b class="et-cost">{{ eur(em?.buyback?.costEur) }}</b>
          @if (em?.buyback; as b) { @if (b.costEur !== b.grossEur) { <span class="et-sub">klok {{ eur(b.grossEur) }}</span> } }
        }
      </span>
    </ng-template>

    <ng-template #notes let-line="line" let-exceeds="exceeds">
      @for (message of line.messages; track message.text) {
        <div class="wk-tr et-row et-note" role="row"><span class="et-span" role="cell" [class.is-bad]="message.bad">{{ message.text }}</span></div>
      }
      @if (exceeds) {
        <div class="wk-tr et-row et-note" role="row"><span class="et-span is-bad" role="cell">De kosten zijn hoger dan de opbrengst</span></div>
      }
    </ng-template>
  `,
  styles: `
    :host{display:block;min-width:0}
    .et{--wk-cols:minmax(140px,1fr) 112px 68px 80px 100px 88px 56px;--wk-gap:8px;--wk-pad-x:10px;border:1px solid var(--line);border-radius:14px;background:var(--surface)}
    .et .wk-thead{border-radius:14px 14px 0 0}
    .et .wk-th{white-space:normal;line-height:1.15}
    .et-main{min-height:52px}
    .et-product{display:grid;align-content:center;white-space:normal}
    .et-product b{overflow:hidden;font-size:13.5px;font-weight:650;line-height:1.3;text-overflow:ellipsis;white-space:nowrap}
    .et-sub{display:block;color:var(--muted);font-size:11.5px;line-height:1.3;overflow-wrap:anywhere}
    .et-dot{display:inline-block;width:9px;height:9px;margin-right:6px;border-radius:50%;background:#c9bfb7;box-shadow:inset 0 0 0 1px rgb(26 22 20/14%)}
    .et-back{min-height:46px;background:color-mix(in srgb,#c7851d 6%,var(--surface))}
    .et-product--back{padding-left:18px}
    .et-product--back .et-sub{padding-left:14px;color:color-mix(in srgb,#c7851d 70%,var(--muted))}
    .et-product--back b{color:#7c4a0b;font-size:12.5px;font-weight:700}
    .et-product--back b::before{content:'↳ ';color:color-mix(in srgb,#c7851d 60%,var(--muted))}
    .et-unit{width:100%;height:32px;padding:0 22px 0 8px;border:1px solid var(--line-strong);border-radius:8px;background:var(--surface) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%23857a73' stroke-width='1.5'/%3E%3C/svg%3E") right 8px center no-repeat;color:var(--ink);font:inherit;font-size:12.5px;appearance:none;-webkit-appearance:none;cursor:pointer}
    .et-unit:focus{border-color:var(--rose);outline:none;box-shadow:var(--wk-focus)}
    .et-unit-text{color:var(--ink-2);font-size:12.5px}
    .et-num{width:100%;height:32px;padding:0 8px;border:1px solid var(--line-strong);border-radius:8px;background:var(--surface);color:var(--ink);font:inherit;font-size:13.5px;font-weight:650;font-variant-numeric:tabular-nums;text-align:right;outline:none}
    .et-num:focus,.et-money:focus-within{border-color:var(--rose);box-shadow:var(--wk-focus)}
    .et-num[aria-invalid=true]{border-color:var(--danger);background:var(--danger-soft);color:var(--danger)}
    .et-pieces{color:var(--muted);font-size:12px}
    .et-money{display:flex;align-items:center;gap:4px;height:32px;padding:0 8px;border:1px solid var(--line-strong);border-radius:8px;background:var(--surface);color:var(--muted);font-size:12.5px;cursor:text}
    .et-money input{flex:1;width:100%;min-width:0;height:30px;padding:0;border:0;background:transparent;color:var(--ink);font:inherit;font-size:13.5px;font-weight:650;font-variant-numeric:tabular-nums;text-align:right;outline:none}
    .et-money:has(input[aria-invalid=true]){border-color:var(--danger);background:var(--danger-soft)}
    .et-bad{display:block;color:var(--danger);font-size:11px;font-weight:600}
    .et-total{display:grid;justify-items:end;align-content:center}
    .et-total b{font-size:13.5px;font-weight:700}
    .et-cost{color:#7c4a0b}
    .et-act{display:flex;justify-content:flex-end;gap:2px;overflow:visible}
    .et-note{min-height:28px;border-bottom-style:dashed;background:var(--surface-2)}
    .et-span{grid-column:1 / -1;min-width:0;padding:5px 0;color:var(--ink-2);font-size:12.5px;white-space:normal}
    .et-span.is-bad{color:var(--danger);font-weight:600}
    .et-empty .et-span{padding:18px 0;color:var(--muted);text-align:center}
    .et-foot{min-height:40px;border-bottom:0}
    .et-add{gap:4px;font-size:13px}
  `,
})
export class PartnerEntryTable {
  readonly draft = input.required<MeldingDraft>();
  /** Recent sales: the day each product last sold (Terugkoop). */
  readonly recent = input<readonly PartnerRecentSale[]>([]);
  /** "+ Product": the screen opens its product choice. */
  readonly addProducts = output<void>();

  private readonly recentById = computed(() => new Map(this.recent().map((tile) => [tile.productId, tile])));

  readonly priceHead = computed(() => pricePerLabel(this.draft().entries(), this.draft().kind() === 'terugkoop' ? 'Klokprijs' : 'Prijs'));

  lineOf(entry: DraftEntry, which: 'sale' | 'buyback'): PartLine {
    return partLine(this.draft(), entry, which);
  }

  productSub(entry: DraftEntry): string {
    const stock = stockLine(this.draft(), entry, this.recentById().get(entry.product.productId)?.lastSoldOn ?? null, shortDate);
    return [entry.product.variant, stock].filter(Boolean).join(' · ');
  }

  setUnit(entry: DraftEntry, which: 'sale' | 'buyback', key: string): void {
    this.draft().setUnit(entry.product.productId, which, key as PartnerCountUnitKey);
  }

  optionLabel(unit: PartLine['unit']): string {
    return unitOption(unit);
  }

  colour(entry: DraftEntry): string | null {
    return safeColour(entry.product.colourHex);
  }

  eur(value: number | null | undefined): string {
    return value == null ? '—' : euro(value);
  }
}
