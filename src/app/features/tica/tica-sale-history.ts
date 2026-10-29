import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TicaApi, TicaSaleHistory as History } from '../../core/api/tica-api';
import { messageOf } from '../../core/api/errors';
import { CatalogApi } from '../../core/api/catalog-api';
import { Product } from '../../core/api/models';
import { stockMovementDelta, stockMovementAfter } from '../products/stock-quantity';
import { Sheet } from '../../shared/ui';
import { EurPipe, NumPipe } from '../../shared/pipes';
import { ticaMoment } from './tica-format';
import { ticaStockLabel } from './tica-stock-rules';

@Component({
  selector: 'app-tica-sale-history',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet, RouterLink, EurPipe, NumPipe],
  template: `
    @if (saleId()) {
      <app-sheet title="TICA-verkoop en voorraad" variant="ios" (closed)="close()">
        <div body class="tsh-body">
          @if (loading()) { <p>Geschiedenis laden…</p> }
          @else if (error(); as error) { <p class="tsh-error" role="alert">{{ error }} <button class="linklike" type="button" (click)="load(saleId()!)">Opnieuw proberen</button></p> }
          @else if (history(); as history) {
            <p class="tsh-intro">Elke bronwijziging en voorraadcorrectie blijft bewaard. De verkoopdatum komt uit TICA; de verwerkingsdatum toont wanneer het ERP de wijziging heeft geboekt.</p>
            <ol class="tsh-revisions">
              @for (revision of history.revisions; track revision.id) {
                <li>
                  <header><strong>{{ revision.description || revision.sku || 'TICA-verkoop' }}</strong><span>{{ revision.active ? 'Bron actief' : 'Vervallen in TICA' }}</span></header>
                  <p class="tsh-meta">Verkocht {{ moment(revision.sourceSoldAt) }}<br />Verwerkt {{ moment(revision.recordedAt) }}</p>
                  <dl><div><dt>Aantal in TICA</dt><dd>{{ revision.quantity | num }}</dd></div><div><dt>Omzet na korting</dt><dd>{{ revision.netTotal | eur: 2 }} excl. btw</dd></div></dl>
                  <p class="tsh-status">{{ stockLabel(revision) }}</p>
                  @if (revision.movements.length) {
                    <ul class="tsh-movements">
                      @for (move of revision.movements; track move.id) {
                        <li><div><b>{{ moveDelta(move, products().get(move.productId)) }}</b> voorraad · daarna {{ moveAfter(move, products().get(move.productId)) }}<small>{{ moment(move.at) }}@if (move.reference) { · {{ move.reference }}}</small></div><a [routerLink]="['/products', move.productId]" fragment="stock-card">Productvoorraad ›</a></li>
                      }
                    </ul>
                  } @else { <p class="tsh-meta">Deze bronversie heeft geen nieuwe voorraadmutatie.</p> }
                </li>
              } @empty { <li>Nog geen bronrevisies beschikbaar.</li> }
            </ol>
          }
        </div>
        <div foot><button class="btn" type="button" (click)="close()">Sluiten</button></div>
      </app-sheet>
    }
  `,
  styles: `
    .tsh-body { line-height: 1.5; }
    .tsh-intro,.tsh-meta { color:var(--muted);font-size:12px; }
    .tsh-intro { margin:0 0 20px; }
    .tsh-revisions,.tsh-movements { list-style:none;margin:0;padding:0; }
    .tsh-revisions>li { padding:16px 0;border-top:1px solid var(--line); }
    header { display:flex;flex-wrap:wrap;gap:5px 12px;justify-content:space-between; }
    header strong { font-size:14px;overflow-wrap:anywhere; }
    header span { color:var(--muted);font-size:11px; }
    dl { display:grid;gap:6px;margin:12px 0;font-size:12px; }
    dl div { display:flex;justify-content:space-between;gap:14px; }
    dt { color:var(--muted); } dd { text-align:right;font-variant-numeric:tabular-nums; }
    .tsh-status { font-size:12px;font-weight:650;margin:12px 0; }
    .tsh-movements { padding:0 12px;border-radius:10px;background:var(--surface-2); }
    .tsh-movements li { display:flex;justify-content:space-between;gap:12px;padding:12px 0;font-size:12px; }
    .tsh-movements small { display:block;color:var(--muted);font-size:11px;margin-top:4px; }
    .tsh-movements a { flex:none;align-self:flex-start; }
    .tsh-error { color:var(--danger);font-size:13px; }
    @media (max-width: 679.98px), (hover: none) and (max-width: 1023.98px) { .tsh-body {padding:8px 16px 20px;} .tsh-movements li {flex-wrap:wrap;} }
  `,
})
export class TicaSaleHistory {
  private readonly api = inject(TicaApi);
  private readonly catalog = inject(CatalogApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroy = inject(DestroyRef);
  private version = 0;
  readonly saleId = signal<number | null>(null);
  readonly history = signal<History | null>(null);
  readonly products = signal(new Map<number, Product>());
  readonly moveDelta = stockMovementDelta;
  readonly moveAfter = stockMovementAfter;
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly moment = ticaMoment;
  readonly stockLabel = ticaStockLabel;
  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroy)).subscribe(params => {
      const id = Number(params.get('sale'));
      if (Number.isSafeInteger(id) && id > 0) { this.saleId.set(id); void this.load(id); }
      else { ++this.version; this.saleId.set(null); this.history.set(null); }
    });
  }
  async load(id: number): Promise<void> {
    const version = ++this.version;
    this.loading.set(true); this.error.set(null); this.history.set(null);
    try {
      const history = await this.api.saleHistory(id);
      const ids = [...new Set(history.revisions.flatMap(revision => revision.movements.map(move => move.productId)))];
      const results = await Promise.allSettled(ids.map(id => this.catalog.product(id)));
      if (!this.destroy.destroyed && version === this.version) {
        this.products.set(new Map(results.flatMap((result, index) => result.status === 'fulfilled' ? [[ids[index], result.value] as const] : [])));
        this.history.set(history);
      }
    } catch (failure) {
      if (!this.destroy.destroyed && version === this.version) this.error.set(messageOf(failure, 'De verkoopgeschiedenis kon niet worden geladen.'));
    } finally { if (!this.destroy.destroyed && version === this.version) this.loading.set(false); }
  }
  close(): void { void this.router.navigate([], { relativeTo: this.route, queryParams: { sale: null }, queryParamsHandling: 'merge', replaceUrl: true }); }
}
