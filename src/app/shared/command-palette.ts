import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { SalesApi } from '../core/api/sales-api';
import { SourcingApi } from '../core/api/sourcing-api';
import { CatalogApi } from '../core/api/catalog-api';
import { Icon } from './icon';

type HitKind = 'action' | 'sales' | 'purchase' | 'product' | 'customer';

interface Hit {
  kind: HitKind;
  id: string;
  title: string;
  meta: string;
  badge?: string;
  route: string[];
  haystack: string;
}

interface Group { key: HitKind; title: string; icon: string; hits: Hit[]; }

const STATUS_LABELS: Record<string, string> = {
  CONCEPT: 'Concept', VERZONDEN: 'Verzonden', BEKEKEN: 'Bekeken', GEACCEPTEERD: 'Geaccepteerd',
  AFGEWEZEN: 'Afgewezen', VERLOPEN: 'Verlopen', GEANNULEERD: 'Geannuleerd',
  BESTELD: 'Besteld', ONDERWEG: 'Onderweg', ONTVANGEN: 'Ontvangen',
};

/**
 * Spotlight for the desk: ⌘K (Ctrl+K) or the search field in the sidebar
 * opens one box that finds an order, container, product or customer by any
 * word you remember, and jumps to any screen. Lists load once per session
 * on first use; no money is shown here, so it is safe with a customer
 * looking on.
 */
@Component({
  selector: 'app-command-palette',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    @if (open()) {
      <div class="palette" role="dialog" aria-modal="true" aria-label="Zoeken in Enrosed" (click)="onBackdrop($event)">
        <div class="palette__card">
          <div class="palette__field">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>
            <input #field class="palette__input" type="search" autocomplete="off" spellcheck="false"
                   placeholder="Zoek order, container, product, klant… of ga naar"
                   aria-label="Zoeken"
                   [value]="query()" (input)="query.set($any($event.target).value)" (keydown)="onKey($event)" />
            <button class="palette__esc" type="button" (click)="close()">esc</button>
          </div>
          <div class="palette__body" role="listbox">
            @if (loading() && query()) {
              <div class="palette__hint">Orders, producten en klanten laden…</div>
            }
            @for (group of groups(); track group.key) {
              <div class="palette__group">
                <div class="palette__group-title">{{ group.title }}</div>
                @for (hit of group.hits; track hit.id) {
                  <button type="button" class="palette__hit" role="option"
                          [class.palette__hit--active]="hit.id === activeId()"
                          [attr.aria-selected]="hit.id === activeId()"
                          (mousemove)="activeId.set(hit.id)" (click)="go(hit)">
                    <span class="palette__hit-icon"><app-icon [name]="group.icon" [size]="16" /></span>
                    <span class="palette__hit-copy"><b>{{ hit.title }}</b><small>{{ hit.meta }}</small></span>
                    @if (hit.badge) { <span class="palette__hit-badge">{{ hit.badge }}</span> }
                  </button>
                }
              </div>
            } @empty {
              @if (!loading()) {
                <div class="palette__hint">Niets gevonden voor “{{ query() }}”.</div>
              }
            }
          </div>
          <div class="palette__foot">
            <span><kbd>↑↓</kbd> kiezen</span><span><kbd>↵</kbd> openen</span><span><kbd>esc</kbd> sluiten</span>
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    .palette { position:fixed;inset:0;z-index:130;display:flex;align-items:flex-start;justify-content:center;
      padding:min(12vh,110px) 16px 16px;background:rgb(26 22 20/.42);
      backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);animation:palette-fade .15s ease }
    .palette__card { display:flex;width:min(640px,100%);max-height:min(70dvh,620px);flex-direction:column;overflow:hidden;
      border:1px solid rgb(255 255 255/.7);border-radius:22px;background:color-mix(in srgb,var(--surface) 94%,transparent);
      box-shadow:0 30px 80px rgb(26 22 20/.28),inset 0 1px 0 #fff;animation:palette-pop .18s cubic-bezier(.2,.8,.2,1) }
    .palette__field { display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--line) }
    .palette__field>svg { width:20px;height:20px;flex:none;fill:none;stroke:var(--muted);stroke-width:1.9;stroke-linecap:round }
    .palette__input { flex:1;min-width:0;border:0;background:transparent;color:var(--ink);font:inherit;font-size:17px;outline:none }
    .palette__input::-webkit-search-cancel-button { appearance:none }
    .palette__esc { padding:3px 8px;border:1px solid var(--line);border-radius:7px;background:var(--surface-2);color:var(--muted);font:inherit;font-size:11px;font-weight:650;cursor:pointer }
    .palette__body { flex:1;min-height:0;overflow-y:auto;padding:8px;overscroll-behavior:contain }
    .palette__group+.palette__group { margin-top:4px }
    .palette__group-title { padding:8px 10px 4px;color:var(--muted);font-size:10.5px;font-weight:750;letter-spacing:.07em;text-transform:uppercase }
    .palette__hit { display:flex;width:100%;align-items:center;gap:12px;padding:9px 10px;border:0;border-radius:12px;
      background:transparent;color:var(--ink);font:inherit;text-align:left;cursor:pointer }
    .palette__hit--active { background:var(--rose-soft);color:var(--rose-dark) }
    .palette__hit-icon { display:grid;width:32px;height:32px;flex:none;place-items:center;border-radius:10px;background:var(--surface-2);color:var(--ink-2) }
    .palette__hit--active .palette__hit-icon { background:var(--surface);color:var(--rose-dark) }
    .palette__hit-copy { display:grid;min-width:0;flex:1;gap:1px }
    .palette__hit-copy b { overflow:hidden;font-size:14px;font-weight:650;text-overflow:ellipsis;white-space:nowrap }
    .palette__hit-copy small { overflow:hidden;color:var(--muted);font-size:12px;text-overflow:ellipsis;white-space:nowrap }
    .palette__hit--active .palette__hit-copy small { color:color-mix(in srgb,var(--rose-dark) 70%,var(--muted)) }
    .palette__hit-badge { flex:none;padding:3px 8px;border-radius:999px;background:var(--surface-2);color:var(--muted);font-size:10.5px;font-weight:700;white-space:nowrap }
    .palette__hit--active .palette__hit-badge { background:var(--surface);color:var(--rose-dark) }
    .palette__hint { padding:18px 12px;color:var(--muted);font-size:13px;text-align:center }
    .palette__foot { display:flex;gap:16px;padding:8px 14px;border-top:1px solid var(--line);color:var(--muted);font-size:11px }
    .palette__foot kbd { font:inherit;font-weight:700 }
    @keyframes palette-fade { from { opacity:0 } }
    @keyframes palette-pop { from { opacity:0;transform:translateY(-8px) scale(.985) } }
    @media (max-width:679px) { .palette { padding:12px 8px } .palette__card { max-height:82dvh } .palette__foot { display:none } }
    @media (prefers-reduced-motion:reduce) { .palette,.palette__card { animation:none } }
  `,
})
export class CommandPalette {
  private readonly router = inject(Router);
  private readonly sales = inject(SalesApi);
  private readonly sourcing = inject(SourcingApi);
  private readonly catalog = inject(CatalogApi);

  readonly open = signal(false);
  readonly query = signal('');
  readonly loading = signal(false);
  readonly activeId = signal<string | null>(null);
  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');
  private readonly index = signal<Hit[]>([]);
  private loaded = false;

  /** Every screen a staff member reaches from the sidebar, findable by name. */
  private readonly actions: Hit[] = [
    ['Dashboard', 'Overzicht van vandaag', '/dashboard'],
    ['Verkooporders', 'Offertes, facturen en archief', '/sales'],
    ['Wijzigingen', 'Voorstellen van klanten', '/revisions'],
    ['Klanten', 'Klantenlijst', '/customers'],
    ['Inkooporders', 'Containercalculaties', '/purchasing'],
    ['Leveranciers', 'Leverancierslijst', '/suppliers'],
    ['Producten', 'Catalogus', '/products'],
    ['Nieuw product', 'Product toevoegen', '/products/new'],
    ['Voorraad', 'Voorraadstanden', '/stock'],
    ['Voorraadlocaties', 'Magazijnen en locaties', '/stock-locations'],
    ['EAN-codes', 'Barcodes', '/barcodes'],
    ['Categorieën', 'Productcategorieën', '/categories'],
    ['Analyses', 'Verkoop, voorraad, inkoop en resultaat', '/analyses'],
    ['Kosten & bank', 'Kosten, vaste kosten en banksaldo', '/costs'],
    ['Documenten & media', 'Foto’s, PDF’s en bestanden', '/files'],
    ['Website beheren', 'Teksten, producten en publicatie', '/website'],
    ['Landen & vracht', 'Leverlanden en vrachttarieven', '/countries'],
    ['Logboek', 'Wie deed wat', '/activity'],
    ['Instellingen', 'Bedrijfsgegevens en voorkeuren', '/settings'],
  ].map(([title, meta, path]) => ({
    kind: 'action' as const,
    id: 'action:' + path,
    title,
    meta,
    route: [path],
    haystack: (title + ' ' + meta).toLowerCase(),
  }));

  readonly groups = computed<Group[]>(() => {
    const tokens = this.query().trim().toLowerCase().split(/\s+/).filter(Boolean);
    const matches = (hit: Hit) => tokens.every((token) => hit.haystack.includes(token));
    if (tokens.length === 0) {
      return [{ key: 'action', title: 'Ga naar', icon: 'more', hits: this.actions.slice(0, 8) }];
    }
    const index = this.index();
    const pick = (kind: HitKind, title: string, icon: string, source: Hit[]): Group | null => {
      const hits = source.filter((hit) => hit.kind === kind && matches(hit)).slice(0, 6);
      return hits.length ? { key: kind, title, icon, hits } : null;
    };
    return [
      pick('sales', 'Verkoop', 'sales', index),
      pick('purchase', 'Inkoop', 'purchase', index),
      pick('product', 'Producten', 'products', index),
      pick('customer', 'Klanten', 'customers', index),
      pick('action', 'Ga naar', 'more', this.actions),
    ].filter((group): group is Group => group !== null);
  });

  private readonly flat = computed(() => this.groups().flatMap((group) => group.hits));

  constructor() {
    effect(() => {
      if (!this.open()) return;
      const field = this.field()?.nativeElement;
      field?.focus();
      field?.select();
    });
    /* The highlight always sits on a visible row: the first one after every keystroke. */
    effect(() => {
      const hits = this.flat();
      const active = this.activeId();
      if (!hits.some((hit) => hit.id === active)) this.activeId.set(hits[0]?.id ?? null);
    });
  }

  @HostListener('document:keydown', ['$event'])
  onDocumentKey(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.toggle();
    } else if (event.key === 'Escape' && this.open()) {
      event.preventDefault();
      this.close();
    }
  }

  show(): void {
    this.query.set('');
    this.open.set(true);
    void this.ensureLoaded();
  }

  close(): void { this.open.set(false); }

  toggle(): void { this.open() ? this.close() : this.show(); }

  onBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.close();
  }

  onKey(event: KeyboardEvent): void {
    const hits = this.flat();
    if (!hits.length) return;
    const current = Math.max(0, hits.findIndex((hit) => hit.id === this.activeId()));
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.activeId.set(hits[(current + 1) % hits.length].id);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.activeId.set(hits[(current - 1 + hits.length) % hits.length].id);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const hit = hits.find((candidate) => candidate.id === this.activeId()) ?? hits[0];
      this.go(hit);
    }
  }

  go(hit: Hit): void {
    this.close();
    void this.router.navigate(hit.route);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded || this.loading()) return;
    this.loading.set(true);
    const safe = async <T>(request: Promise<T>, fallback: T): Promise<T> => {
      try { return await request; } catch { return fallback; }
    };
    try {
      const [orders, purchases, products, customers, suppliers] = await Promise.all([
        safe(this.sales.orders(), []),
        safe(this.sourcing.purchaseOrders(), []),
        safe(this.catalog.products(), []),
        safe(this.sales.customers(), []),
        safe(this.sourcing.suppliers(), []),
      ]);
      const customerName = new Map(customers.map((customer) => [customer.id, customer.company]));
      const supplierName = new Map(suppliers.map((supplier) => [supplier.id, supplier.name]));
      const date = (iso: string | null | undefined) => {
        if (!iso) return '';
        const parsed = new Date(iso);
        return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleDateString('nl-BE', { day: '2-digit', month: '2-digit', year: 'numeric' });
      };
      const status = (value: string | null | undefined) => (value ? STATUS_LABELS[value] ?? value : '');
      const hits: Hit[] = [];
      for (const view of orders) {
        const order = view.order;
        const customer = customerName.get(order.customerId) ?? '';
        const meta = [order.number, date(order.orderDate)].filter(Boolean).join(' · ');
        hits.push({
          kind: 'sales', id: 'sales:' + order.id, title: customer || order.number, meta,
          badge: status(order.status), route: ['/sales', String(order.id)],
          haystack: [customer, order.number, status(order.status), order.notes].join(' ').toLowerCase(),
        });
      }
      for (const view of purchases) {
        const order = view.order;
        const supplier = supplierName.get(order.supplierId) ?? '';
        hits.push({
          kind: 'purchase', id: 'purchase:' + order.id, title: order.alias || order.number,
          meta: [order.alias ? order.number : '', supplier, date(order.orderDate)].filter(Boolean).join(' · '),
          badge: status(order.status), route: ['/purchasing', String(order.id)],
          haystack: [order.number, order.alias, supplier, status(order.status)].join(' ').toLowerCase(),
        });
      }
      for (const product of products) {
        if (product.id === null) continue;
        const title = [product.name, product.colour].filter(Boolean).join(' · ');
        hits.push({
          kind: 'product', id: 'product:' + product.id, title,
          meta: [product.sku || 'Geen SKU', product.variantSize].filter(Boolean).join(' · '),
          badge: product.active ? undefined : 'Inactief', route: ['/products', String(product.id)],
          haystack: [product.name, product.colour, product.sku, product.variantSize, product.canonicalBarcode].join(' ').toLowerCase(),
        });
      }
      for (const customer of customers) {
        if (customer.id === null) continue;
        hits.push({
          kind: 'customer', id: 'customer:' + customer.id, title: customer.company,
          meta: [customer.city, customer.countryCode, customer.contact].filter(Boolean).join(' · '),
          route: ['/customers'],
          haystack: [customer.company, customer.city, customer.contact, customer.email, customer.countryCode].join(' ').toLowerCase(),
        });
      }
      this.index.set(hits);
      this.loaded = true;
    } finally {
      this.loading.set(false);
    }
  }
}
