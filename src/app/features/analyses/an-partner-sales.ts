import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NumPipe } from '../../shared/pipes';
import { SignedEurPipe } from '../../shared/signed-eur';
import { AnDrillHost } from './drill-host';
import { partnerProductView, partnerSalesView, type PartnerSalesFigureKey } from './drill-partner-sales';
import type { PartnerSalesFigures, PartnerSalesProductRow } from './partner-sales-analysis';

/** The piece words of a product ("stuk"/"stuks", "roos"/"rozen"): what one piece is, also inside a display. */
export type PartnerSalesUnitFn = (productId: number) => { one: string; other: string };

const PRODUCTS_SHOWN = 6;

/**
 * Verkoop › Veilingverkopen (contract 7c Analyses): what the partner reported in the period, by sold_on - stuks
 * (pieces: a display of 12 rozen counts 12), bruto, netto and what is not invoiced yet (confirmed or not: the sub says
 * how many wait for Bevestigen), each opening its meldingen (rows that add up to it); per product the weighted
 * average price per piece (never summed across products); Veiling, Direct and Terugkoop apart. Not in Omzet or
 * Resultaat: the invoice made from the meldingen counts there. Under the TICA card, in the page's an-card look
 * (analyses-*.scss, global); its own figure cells are component styles. Amounts below zero read "− € x".
 */
@Component({
  selector: 'app-an-partner-sales',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, SignedEurPipe, NumPipe],
  template: `
    @let f = figures();
    <section class="an-card an-tica" aria-labelledby="an-vv-title">
      <header class="an-card__head"><h2 class="an-card__title" id="an-vv-title">Veilingverkopen</h2>
        <span class="an-card__sub">op verkoopdatum · niet in omzet</span>
        <span class="an-card__trail"><a class="an-link" routerLink="/veilingverkopen">Veilingverkopen ›</a></span></header>
      <div class="an-card__body">
        <div class="vva__figs">
          <button class="vva__fig" type="button" aria-haspopup="dialog" [disabled]="!f.all.pieces" (click)="open('pieces', f.all.pieces)">
            <span class="vva__label">Stuks</span><b class="vva__value">{{ f.all.pieces | num }}</b>
            <span class="vva__sub">{{ plural(f.all.reports, 'melding', 'meldingen') }}</span></button>
          <button class="vva__fig" type="button" aria-haspopup="dialog" [disabled]="!f.all.grossEur" (click)="open('gross', f.all.grossEur)">
            <span class="vva__label">Bruto</span><b class="vva__value">{{ f.all.grossEur | signedEur: 0 }}</b>
            <span class="vva__sub">kosten {{ f.all.costsEur | signedEur: 0 }}</span></button>
          <button class="vva__fig" type="button" aria-haspopup="dialog" [disabled]="!f.all.reports" (click)="open('net', f.all.netEur)">
            <span class="vva__label">Netto</span><b class="vva__value" [class.is-neg]="f.all.netEur < 0">{{ f.all.netEur | signedEur: 0 }}</b>
            <span class="vva__sub">na kosten en terugkoop</span></button>
          <button class="vva__fig" type="button" aria-haspopup="dialog" [class.is-warn]="f.open.pieces > 0" [disabled]="!f.open.reports" (click)="open('open', f.open.netEur)">
            <span class="vva__label">Nog niet gefactureerd</span><b class="vva__value">{{ f.open.pieces > 0 ? (f.open.netEur | signedEur: 0) : '—' }}</b>
            <span class="vva__sub">{{ f.open.pieces > 0 ? openSub() : f.open.reports ? 'terugkoop wacht' : 'alles gefactureerd' }}</span></button>
        </div>
        <div class="an-tica__lists an-tica__lists--two">
          <div>
            <h3 class="an-tica__h">Producten</h3>
            @for (product of shown(); track product.productId) {
              <button class="an-row an-row--chev" type="button" aria-haspopup="dialog" (click)="openProduct(product)">
                <span class="an-rank">{{ $index + 1 }}</span>
                <span class="an-row__body"><span class="an-row__title">{{ product.name }}@if (product.variant) { · {{ product.variant }} }</span>
                  <span class="an-row__sub">{{ units(product.productId, product.pieces) }}@if (product.averageEur !== null) { · gem. {{ product.averageEur | signedEur }} per {{ unitOf()(product.productId).one }} }@if (product.buybackPieces) { · {{ product.buybackPieces | num }} terug }</span></span>
                <span class="an-row__end"><span class="an-row__value">{{ product.grossEur | signedEur: 0 }}</span></span>
                <span class="an-row__chev" aria-hidden="true">›</span>
              </button>
            } @empty { <p class="an-empty">Geen producten in deze periode.</p> }
            @if (f.products.length > productsShown) {
              <button class="an-more" type="button" (click)="allProducts.set(!allProducts())">{{ allProducts() ? 'Minder tonen' : 'Alle ' + f.products.length + ' producten' }}</button>
            }
          </div>
          <div>
            <h3 class="an-tica__h">Soort</h3>
            <div class="an-row an-row--nolead">
              <span class="an-row__body"><span class="an-row__title">Verkocht op de veiling</span>
                <span class="an-row__sub">{{ plural(f.auction.reports, 'melding', 'meldingen') }} · {{ f.auction.pieces | num }} st · bruto {{ f.auction.grossEur | signedEur: 0 }}</span></span>
              <span class="an-row__end"><span class="an-row__value">{{ f.auction.netEur + f.auction.buybackEur | signedEur: 0 }}</span></span>
            </div>
            <div class="an-row an-row--nolead">
              <span class="an-row__body"><span class="an-row__title">Direct verkocht</span>
                <span class="an-row__sub">{{ plural(f.direct.reports, 'melding', 'meldingen') }} · {{ f.direct.pieces | num }} st · bruto {{ f.direct.grossEur | signedEur: 0 }}</span></span>
              <span class="an-row__end"><span class="an-row__value">{{ f.direct.netEur | signedEur: 0 }}</span></span>
            </div>
            <div class="an-row an-row--nolead">
              <span class="an-row__body"><span class="an-row__title">Teruggekocht op de klok</span>
                <span class="an-row__sub">{{ f.all.buybackPieces | num }} st · komt terug op voorraad</span></span>
              <span class="an-row__end"><span class="an-row__value" [attr.data-tone]="f.all.buybackEur ? 'danger' : null">{{ f.all.buybackEur ? '− ' : '' }}{{ f.all.buybackEur | signedEur: 0 }}</span></span>
            </div>
            <p class="an-empty vva__foot">Veiling en direct na kosten; de terugkoop gaat van het netto af.</p>
          </div>
        </div>
      </div>
    </section>
  `,
  styles: `
    :host { display: block; }
    /* The page gives .an-body > .an-card its gap; this card sits one level down, in its host. */
    .an-card { margin-bottom: var(--an-gap); }
    .vva__figs { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; padding: 4px 16px 14px; border-bottom: 1px solid var(--line); }
    .vva__fig { display: grid; align-content: start; gap: 1px; min-width: 0; min-height: 44px; padding: 6px 8px; border: 1px solid var(--line); border-radius: 12px;
      background: var(--surface); color: inherit; font: inherit; text-align: left; cursor: pointer; }
    .vva__fig:disabled { cursor: default; }
    @media (hover: hover) { .vva__fig:not(:disabled):hover { border-color: var(--rose-line, var(--line-strong)); background: var(--surface-2); } }
    .vva__fig:focus-visible { outline: 2px solid var(--rose); outline-offset: 1px; }
    .vva__label { color: var(--muted); font-size: 11.5px; font-weight: 650; }
    .vva__value { font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .vva__value.is-neg { color: var(--danger); }
    .vva__fig.is-warn .vva__value { color: var(--warn); }
    .vva__sub { overflow: hidden; color: var(--muted); font-size: 11.5px; text-overflow: ellipsis; white-space: nowrap; }
    .vva__foot { padding-top: 0; font-size: 11.5px; }
    @media (max-width: 899.98px) { .vva__figs { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  `,
})
export class AnPartnerSales {
  private readonly drill = inject(AnDrillHost);
  readonly figures = input.required<PartnerSalesFigures>();
  /** "Dit jaar · 1 jan – 11 nov 2026": the page's sales scope. */
  readonly scope = input.required<string>();
  readonly unitOf = input.required<PartnerSalesUnitFn>();

  readonly productsShown = PRODUCTS_SHOWN;
  readonly allProducts = signal(false);
  readonly shown = computed(() => this.allProducts() ? this.figures().products : this.figures().products.slice(0, PRODUCTS_SHOWN));

  /** "4 meldingen · 2 te bevestigen": Factureren takes the confirmed ones only. */
  openSub(): string {
    const f = this.figures();
    const waiting = f.openUnconfirmed;
    return this.plural(f.open.reports, 'melding', 'meldingen') + (waiting ? ` · ${waiting} te bevestigen` : '');
  }

  plural(count: number, one: string, many: string): string {
    return `${count.toLocaleString('nl-BE')} ${count === 1 ? one : many}`;
  }

  units(productId: number, count: number): string {
    const unit = this.unitOf()(productId);
    return this.plural(count, unit.one, unit.other);
  }

  open(key: PartnerSalesFigureKey, figure: number): void {
    this.drill.open([partnerSalesView(key, this.figures(), figure, this.scope())]);
  }

  openProduct(product: PartnerSalesProductRow): void {
    const name = product.variant ? `${product.name} · ${product.variant}` : product.name;
    this.drill.open([partnerProductView(product.productId, name, this.figures(), product.grossEur, this.scope())]);
  }
}
