import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { CatalogApi } from '../../core/api/catalog-api';
import { messageOf } from '../../core/api/errors';
import type { Product, ProductFamily, PurchaseOrderView, StockLevel } from '../../core/api/models';
import { PartnerCountUnitCode, PartnerSalesApi, isMissingEndpoint } from '../../core/api/partner-sales-api';
import { SourcingApi } from '../../core/api/sourcing-api';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { Skeleton } from '../../shared/skeleton';
import { productParts } from '../customers/customer-price-state';
import { PartnerUnitChoice, effectiveUnit, partnerUnitChoices, piecesPerSalesUnit, searchText, storedUnits } from './partner-unit-choices';

const NL = new Intl.NumberFormat('nl-BE');

interface UnitRow {
  productId: number;
  head: string;
  tail: string | null;
  /** "36 rozen op voorraad", "op container"; with the SKU in front when another row reads the same. */
  where: string;
  choices: PartnerUnitChoice[];
  search: string;
}

interface UnitGroup {
  key: string;
  name: string;
  rows: UnitRow[];
}

/** One option of a family's "Zet alle n op …". */
interface BulkOption {
  unit: PartnerCountUnitCode;
  label: string;
}

/**
 * Instellingen › Partnerportaal › Eenheid per product: per product the unit the
 * partner counts in by default (per roos / per display / per omdoos; no choice
 * = per stuk, never per set), grouped by family, with search, a "Zet alle n op
 * …" per family and "Alles per stuk". Only the products in his stock (at his
 * location) or on his containers, and any product that already has a default.
 * The draft joins the settings page's one save model through the parent
 * (dirtyCount, save, revert); it saves only the products that changed
 * (PUT /api/partner-portal-admin/{customerId}/units, never a full replace).
 */
@Component({
  selector: 'app-settings-partner-units',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, Skeleton],
  template: `
    @if (desk.active()) {
      <section class="spu" [attr.aria-label]="'Eenheid per product voor ' + person()">
        <div class="spu-bar">
          <div class="spu-title">
            <h3>Eenheid per product</h3>
            <p>Zo telt {{ person() }} standaard in het portaal; per melding kiest hij zelf. Zonder keuze: per stuk.</p>
          </div>
          @if (ready() && allRows().length > 6) {
            <input class="spu-search" type="search" placeholder="Zoek product" aria-label="Zoek product" [value]="query()" (input)="query.set($any($event.target).value)" />
          }
          @if (ready() && anyOther()) { <button class="wk-btn wk-btn--sm" type="button" (click)="allPerPiece()">Alles per stuk</button> }
        </div>
        <ng-container [ngTemplateOutlet]="state" />
        @if (ready()) {
          @for (group of groups(); track group.key) {
            <div class="spu-group">
              <div class="spu-group__head">
                <b>{{ group.name }}</b>
                <small>{{ groupLine(group) }}</small>
                @if (bulkOf(group); as options) {
                  @if (options.length > 1) {
                    <select class="spu-bulk" [attr.aria-label]="'Zet alle ' + group.rows.length + ' van ' + group.name + ' op'" (change)="bulk(group, $any($event.target))">
                      <option value="" selected>Zet alle {{ group.rows.length }} op…</option>
                      @for (option of options; track option.unit) { <option [value]="option.unit">{{ option.label }}</option> }
                    </select>
                  }
                }
              </div>
              <div class="spu-rows">
                @for (row of group.rows; track row.productId) {
                  <div class="spu-row" [class.is-dirty]="changed(row.productId)">
                    <span class="spu-name"><b>{{ row.head }}@if (row.tail) {<span>{{ row.tail }}</span>}</b><small>{{ row.where }}</small></span>
                    @if (row.choices.length > 1) {
                      <select class="spu-select" [attr.aria-label]="'Eenheid van ' + row.head + (row.tail ?? '')" (change)="set(row.productId, $any($event.target).value)">
                        @for (choice of row.choices; track choice.unit) {
                          <option [value]="choice.unit" [selected]="unitOf(row) === choice.unit">{{ choice.label }}</option>
                        }
                      </select>
                    } @else {
                      <span class="spu-only">{{ row.choices[0].label }}</span>
                    }
                  </div>
                }
              </div>
            </div>
          } @empty {
            @if (query()) { <p class="spu-empty">Geen product gevonden voor "{{ query() }}".</p> }
          }
        }
      </section>
    } @else {
      <section class="ios-section">
        <div class="ios-section__head"><h2>Eenheid per product</h2></div>
        <ng-container [ngTemplateOutlet]="state" />
        @if (ready() && allRows().length > 6) {
          <div class="ios-group"><label class="spu-cell"><input class="spu-cell__search" type="search" placeholder="Zoek product" [value]="query()" (input)="query.set($any($event.target).value)" /></label></div>
        }
        @if (ready()) {
          @for (group of groups(); track group.key) {
            <p class="spu-caption">{{ group.name }} · {{ groupLine(group) }}</p>
            <div class="ios-group">
              @for (row of group.rows; track row.productId) {
                <label class="spu-cell" [class.is-dirty]="changed(row.productId)">
                  <span class="spu-cell__name">{{ row.head }}{{ row.tail }}<small>{{ row.where }}</small></span>
                  @if (row.choices.length > 1) {
                    <select (change)="set(row.productId, $any($event.target).value)">
                      @for (choice of row.choices; track choice.unit) {
                        <option [value]="choice.unit" [selected]="unitOf(row) === choice.unit">{{ choice.label }}</option>
                      }
                    </select>
                  } @else { <span class="spu-cell__only">{{ row.choices[0].label }}</span> }
                </label>
              }
            </div>
          }
          @if (anyOther()) {
            <div class="ios-group"><button class="spu-cell spu-cell--btn" type="button" (click)="allPerPiece()">Alles per stuk</button></div>
          }
        }
        <p class="ios-section__foot">Zo telt {{ person() }} standaard; per melding kiest hij zelf. Zonder keuze: per stuk.</p>
      </section>
    }

    <ng-template #state>
      @if (missing()) {
        <p class="spu-empty">De server kent Eenheid per product nog niet.</p>
      } @else if (error(); as message) {
        <p class="spu-empty spu-err" role="alert">{{ message }} <button class="spu-link" type="button" (click)="load()">Opnieuw</button></p>
      } @else if (!ready()) {
        <div class="spu-skel"><app-skeleton kind="lines" [rows]="3" /></div>
      } @else if (!allRows().length) {
        <p class="spu-empty">Nog geen product in zijn voorraad of op zijn containers.</p>
      }
      @if (saveError(); as message) { <p class="spu-empty spu-err" role="alert">{{ message }}</p> }
    </ng-template>
  `,
  styles: `
    :host { display: block; }
    .spu { container: spu / inline-size; margin: 10px 16px 0; padding-top: 12px; border-top: 1px solid var(--line); }
    .spu-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin-bottom: 8px; }
    .spu-title { flex: 1 1 280px; min-width: 0; }
    .spu-title h3 { margin: 0; color: var(--muted); font-size: 11px; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
    .spu-title p { margin: 3px 0 0; color: var(--muted); font-size: 12px; line-height: 1.4; }
    .spu-search { width: 200px; height: 32px; padding: 0 10px; border: 1px solid var(--line-strong); border-radius: 9px; background: var(--surface); color: var(--ink); font: inherit; font-size: 13px; }
    .spu-search:focus, .spu-select:focus, .spu-bulk:focus { border-color: var(--rose); outline: none; box-shadow: 0 0 0 3px color-mix(in srgb, var(--rose) 18%, transparent); }
    .spu-group { margin-top: 10px; border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
    .spu-group__head { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; min-height: 40px; padding: 5px 8px 5px 12px; background: var(--surface-2); border-bottom: 1px solid var(--line); }
    .spu-group__head b { font-size: 13px; }
    .spu-group__head small { flex: 1; min-width: 0; color: var(--muted); font-size: 11.5px; }
    .spu-bulk, .spu-select { height: 32px; max-width: 100%; padding: 0 8px; border: 1px solid var(--line-strong); border-radius: 8px; background: var(--surface); color: var(--ink); font: inherit; font-size: 12.5px; }
    .spu-bulk { min-width: 150px; color: var(--rose-dark); font-weight: 650; }
    .spu-rows { display: grid; grid-template-columns: minmax(0, 1fr); }
    @container spu (min-width: 820px) { .spu-rows { grid-template-columns: repeat(2, minmax(0, 1fr)); } .spu-row:nth-child(even) { border-left: 1px solid var(--line); } }
    .spu-row { display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 4px 8px 4px 12px; border-top: 1px solid var(--line); }
    .spu-rows .spu-row:first-child { border-top: 0; }
    @container spu (min-width: 820px) { .spu-rows .spu-row:nth-child(2) { border-top: 0; } }
    .spu-name { display: grid; flex: 1; min-width: 0; }
    .spu-name b { overflow: hidden; font-size: 13px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
    .spu-name b span { color: var(--ink-2); font-weight: 500; }
    .spu-name small { color: var(--muted); font-size: 11px; }
    .spu-select { flex: none; width: 196px; }
    .spu-only { flex: none; width: 196px; padding: 0 9px; color: var(--muted); font-size: 12.5px; }
    .spu-row.is-dirty .spu-name b::before, .spu-cell.is-dirty .spu-cell__name::before {
      content: ''; display: inline-block; width: 6px; height: 6px; margin-right: 6px; border-radius: 50%; background: var(--warn); vertical-align: 2px; }
    .spu-empty { margin: 6px 0; color: var(--muted); font-size: 12.5px; }
    .spu-err { color: var(--danger); font-weight: 600; }
    .spu-link { padding: 0; border: 0; background: none; color: var(--rose-dark); font: inherit; font-weight: 650; cursor: pointer; }
    .spu-skel { padding: 4px 0; }
    .spu-caption { margin: 14px 16px 6px; color: var(--muted); font-size: 13px; }
    .spu-cell { display: flex; align-items: center; gap: 10px; min-height: 48px; padding: 6px 16px; background: var(--surface); }
    .spu-cell + .spu-cell { border-top: .5px solid var(--line); }
    .spu-cell__name { display: grid; flex: 1; min-width: 0; color: var(--ink); font-size: 15px; }
    .spu-cell__name small { color: var(--muted); font-size: 12.5px; }
    .spu-cell select { flex: 0 1 auto; max-width: 52%; height: 36px; padding: 0; border: 0; background: transparent; color: var(--muted); font: inherit; font-size: 15px; text-align: right; text-align-last: right; appearance: none; -webkit-appearance: none; outline: none; }
    .spu-cell__only { flex: none; color: var(--muted); font-size: 15px; }
    .spu-cell__search { flex: 1; min-width: 0; height: 36px; padding: 0; border: 0; background: transparent; color: var(--ink); font: inherit; font-size: 16px; outline: none; }
    .spu-cell--btn { width: 100%; border: 0; color: var(--rose-dark); font: inherit; font-size: 16px; font-weight: 600; text-align: left; cursor: pointer; }
  `,
  host: { '[attr.data-customer]': 'customerId()' },
})
export class SettingsPartnerUnits {
  private readonly api = inject(PartnerSalesApi);
  private readonly catalog = inject(CatalogApi);
  private readonly sourcing = inject(SourcingApi);
  readonly desk = inject(DesktopViewport);

  readonly customerId = input.required<number>();
  /** "Frans", else "de partner". */
  readonly person = input('de partner');
  /** The location his stock lives at (his setting, else the main warehouse); null = any. */
  readonly locationId = input<number | null>(null);

  readonly query = signal('');
  readonly loading = signal(false);
  readonly missing = signal(false);
  readonly error = signal<string | null>(null);
  readonly saveError = signal<string | null>(null);
  readonly saving = signal(false);
  private readonly loaded = signal(false);
  readonly ready = computed(() => this.loaded() && !this.missing() && !this.error());

  private readonly stored = signal<ReadonlyMap<number, PartnerCountUnitCode>>(new Map());
  private readonly draft = signal<ReadonlyMap<number, PartnerCountUnitCode>>(new Map());
  private readonly products = signal<Product[]>([]);
  private readonly families = signal<ProductFamily[]>([]);
  private readonly levels = signal<StockLevel[]>([]);
  private readonly orders = signal<PurchaseOrderView[]>([]);
  private run = 0;

  constructor() {
    /* Asked for this partner and its location; asked again when either changes. */
    effect(() => {
      this.customerId();
      this.locationId();
      untracked(() => void this.load());
    });
  }

  async load(): Promise<void> {
    const run = ++this.run;
    const customerId = this.customerId();
    this.loading.set(true);
    this.error.set(null);
    try {
      const [rows, products, families, levels, orders] = await Promise.all([
        this.api.units(customerId),
        this.catalog.products(),
        this.catalog.productFamilies().catch(() => [] as ProductFamily[]),
        this.catalog.stockLevels().catch(() => [] as StockLevel[]),
        this.sourcing.purchaseOrders().catch(() => [] as PurchaseOrderView[]),
        this.catalog.unitNames().catch(() => []),
      ]);
      if (run !== this.run) return;
      /* The draft stays: a reload (another location saved beside it) must not drop what is still to be saved. */
      this.stored.set(storedUnits(rows));
      this.products.set(products);
      this.families.set(families);
      this.levels.set(levels);
      this.orders.set(orders);
      this.missing.set(false);
      this.saveError.set(null);
      this.loaded.set(true);
    } catch (failure: unknown) {
      if (run !== this.run) return;
      if (isMissingEndpoint(failure)) { this.missing.set(true); this.loaded.set(true); return; }
      this.error.set(messageOf(failure, 'De eenheden konden niet worden geladen.'));
    } finally {
      if (run === this.run) this.loading.set(false);
    }
  }

  /** In his stock at his location, on his containers, or with a default already: grouped by family. */
  readonly allRows = computed<(UnitRow & { familyId: number | null })[]>(() => {
    const customerId = this.customerId();
    const location = this.locationId();
    const stock = new Map<number, number>();
    for (const level of this.levels()) {
      if (location != null && level.locationId !== location) continue;
      if (level.quantity > 0) stock.set(level.productId, (stock.get(level.productId) ?? 0) + level.quantity);
    }
    const onContainers = new Set<number>();
    for (const view of this.orders()) {
      if (view.order.partnerCustomerId !== customerId) continue;
      for (const line of view.order.lines ?? []) onContainers.add(line.productId);
    }
    const stored = this.stored();
    const rows = this.products()
      .filter((product) => product.id != null && (stock.has(product.id) || onContainers.has(product.id) || stored.has(product.id)))
      .map((product) => {
        const id = product.id!;
        const parts = productParts(product, { productId: id, name: product.name, sku: product.sku });
        const choices = partnerUnitChoices(product);
        /* Stock in pieces, the way the partner counts (a display of 12 rozen is 12 rozen). */
        const piece = choices.find((choice) => choice.unit === 'STUK') ?? choices[0];
        const pieces = (stock.get(id) ?? 0) * piecesPerSalesUnit(product);
        return {
          productId: id, familyId: product.familyId ?? null, head: parts.head, tail: parts.tail, sku: product.sku?.trim() || null,
          where: pieces > 0 ? `${NL.format(pieces)} ${pieces === 1 ? piece.one : piece.other} op voorraad` : onContainers.has(id) ? 'op container' : 'niet op voorraad',
          choices,
          search: searchText(`${product.name} ${product.sku ?? ''} ${product.colour ?? ''} ${product.variantSize ?? ''}`),
        };
      });
    /* Two products that read the same (name, colour and Maat alike): the SKU tells them apart. */
    const label = (row: { head: string; tail: string | null }) => searchText(`${row.head}${row.tail ?? ''}`);
    const seen = new Map<string, number>();
    for (const row of rows) seen.set(label(row), (seen.get(label(row)) ?? 0) + 1);
    return rows.map(({ sku, ...row }) => ((seen.get(label(row)) ?? 0) > 1 ? { ...row, where: `${sku ?? `#${row.productId}`} · ${row.where}` } : row));
  });

  readonly groups = computed<UnitGroup[]>(() => {
    const words = searchText(this.query()).split(/\s+/).filter(Boolean);
    const names = new Map(this.families().filter((family) => family.id != null).map((family) => [family.id!, family.name]));
    const groups = new Map<string, UnitGroup>();
    for (const row of this.allRows()) {
      if (words.length && !words.every((word) => row.search.includes(word))) continue;
      const name = row.familyId != null ? names.get(row.familyId) ?? null : null;
      const key = name ? `f${row.familyId}` : 'other';
      if (!groups.has(key)) groups.set(key, { key, name: name ?? 'Overige', rows: [] });
      groups.get(key)!.rows.push(row);
    }
    const sorted = [...groups.values()].sort((a, b) => (a.key === 'other' ? 1 : b.key === 'other' ? -1 : a.name.localeCompare(b.name, 'nl')));
    /* No family at all: one plain list, not "Overige". */
    if (sorted.length === 1 && sorted[0].key === 'other') sorted[0].name = 'Producten';
    for (const group of sorted) group.rows.sort((a, b) => `${a.head}${a.tail ?? ''}`.localeCompare(`${b.head}${b.tail ?? ''}`, 'nl'));
    return sorted;
  });

  /** The unit shown for a product: the draft, else the stored one, per piece when the product no longer offers it. */
  unitOf(row: Pick<UnitRow, 'productId' | 'choices'>): PartnerCountUnitCode {
    const draft = this.draft();
    return effectiveUnit(draft.has(row.productId) ? draft.get(row.productId) : this.stored().get(row.productId), row.choices);
  }

  private storedOf(row: Pick<UnitRow, 'productId' | 'choices'>): PartnerCountUnitCode {
    return effectiveUnit(this.stored().get(row.productId), row.choices);
  }

  private readonly changes = computed(() => this.allRows()
    .filter((row) => this.draft().has(row.productId) && this.unitOf(row) !== this.storedOf(row))
    .map((row) => ({ productId: row.productId, unit: this.unitOf(row) === 'STUK' ? null : this.unitOf(row) })));
  readonly dirtyCount = computed(() => this.changes().length);
  readonly dirty = computed(() => this.dirtyCount() > 0);
  readonly anyOther = computed(() => this.allRows().some((row) => this.unitOf(row) !== 'STUK'));

  changed(productId: number): boolean {
    return this.changes().some((change) => change.productId === productId);
  }

  set(productId: number, unit: string): void {
    if (unit !== 'STUK' && unit !== 'VERPAKKING' && unit !== 'OMDOOS') return;
    this.draft.update((map) => new Map(map).set(productId, unit));
    this.saveError.set(null);
  }

  /** "4 per omdoos · 2 per bowl": what the family counts in now. */
  groupLine(group: UnitGroup): string {
    const counts = new Map<string, number>();
    for (const row of group.rows) {
      const label = row.choices.find((choice) => choice.unit === this.unitOf(row))?.label.split(' · ')[0] ?? 'per stuk';
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    const parts = [...counts].map(([label, n]) => (counts.size === 1 ? `alle ${label}` : `${n} ${label}`));
    return `${group.rows.length} ${group.rows.length === 1 ? 'product' : 'producten'} · ${parts.join(' · ')}`;
  }

  /** The units at least one product of the family offers, with how many when not all do. */
  bulkOf(group: UnitGroup): BulkOption[] {
    const n = group.rows.length;
    const nouns = new Set(group.rows.map((row) => row.choices[0].one));
    const out: BulkOption[] = [{ unit: 'STUK', label: nouns.size === 1 ? `per ${[...nouns][0]}` : 'per stuk' }];
    for (const [unit, word] of [['VERPAKKING', 'display'], ['OMDOOS', 'omdoos']] as const) {
      const k = group.rows.filter((row) => row.choices.some((choice) => choice.unit === unit)).length;
      if (k) out.push({ unit, label: k === n ? `per ${word}` : `per ${word} (${k} van ${n})` });
    }
    return out;
  }

  /** Zet alle n op …: every product of the family that offers the unit; the others keep theirs. */
  bulk(group: UnitGroup, select: HTMLSelectElement): void {
    const unit = select.value as PartnerCountUnitCode | '';
    select.value = '';
    if (!unit) return;
    this.draft.update((map) => {
      const next = new Map(map);
      for (const row of group.rows) if (row.choices.some((choice) => choice.unit === unit)) next.set(row.productId, unit);
      return next;
    });
    this.saveError.set(null);
  }

  allPerPiece(): void {
    this.draft.update((map) => {
      const next = new Map(map);
      for (const row of this.allRows()) next.set(row.productId, 'STUK');
      return next;
    });
  }

  revert(): void {
    this.draft.set(new Map());
    this.saveError.set(null);
  }

  /** Sends only what changed; false (with the reason on the block) when it failed. */
  async save(): Promise<boolean> {
    const changes = this.changes();
    if (this.saving() || !changes.length) return !changes.length;
    this.saving.set(true);
    this.saveError.set(null);
    try {
      const rows = await this.api.saveUnits(this.customerId(), changes);
      if (rows) this.stored.set(storedUnits(rows));
      else this.stored.update((map) => {
        const next = new Map(map);
        for (const change of changes) {
          if (change.unit) next.set(change.productId, change.unit);
          else next.delete(change.productId);
        }
        return next;
      });
      this.draft.set(new Map());
      return true;
    } catch (failure: unknown) {
      this.saveError.set(messageOf(failure, 'De eenheden zijn niet opgeslagen. Probeer opnieuw.'));
      return false;
    } finally {
      this.saving.set(false);
    }
  }
}
