import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, computed, effect, inject, input, model, output, signal, untracked,
} from '@angular/core';
import { AuthImage } from '../../core/api/auth-image';
import { Icon } from '../../shared/icon';
import { palletFit, type CarrierKind, type PalletSpec } from './pallet-calculator-model';
import { matchPalletTiles, type PalletBrowserSection, type PalletBrowserTile } from './pallet-browser-model';

/** One cell of the grid: a section heading (Alle) or a tile with what it shows. */
interface GridItem {
  key: string;
  heading: string | null;
  tile: PalletBrowserTile | null;
  /** The pallet colour of a tile that is in the calculation. */
  pick: string | null;
  figure: string;
  warn: boolean;
  label: string;
}

const PROBLEMS: Readonly<Record<string, string>> = {
  'afmetingen ontbreken': 'Maten ontbreken',
  'doos past niet op de pallet': 'Past niet',
  'te hoog of te zwaar': 'Te hoog of zwaar',
};

/**
 * Palletberekening's way in: photo tiles under chips (Recent, Alle, the
 * categories), each tile one carton with its answer for the pallet in use.
 * Search is the second path: the 🔍 chip on the phone, the page's toolbar
 * field on the desk (it drives `query`). A tap emits `chosen`; the page adds
 * the product, or shows its card when it is already in the calculation.
 */
@Component({
  selector: 'app-pallet-browser',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthImage, Icon],
  host: { '[class.pb--desk]': "variant() === 'desk'" },
  template: `
    @if (variant() === 'desk') {
      <div class="wk-chips" role="group" aria-label="Productgroep">
        @for (chip of chips(); track chip.key) {
          <button class="wk-chip" type="button" [attr.aria-pressed]="pressed(chip.key)" (click)="tapChip(chip.key)">
            @if (chip.key === 'recent') { <app-icon name="recent" [size]="13" /> }{{ chip.name }}
          </button>
        }
      </div>
    } @else if (searchShown()) {
      <div class="ios-search is-active pb-search">
        <label class="ios-search__field">
          <app-icon name="search" [size]="16" />
          <input type="search" enterkeyhint="go" autocomplete="off" placeholder="Naam, kleur, SKU of barcode" aria-label="Product zoeken"
                 [value]="query()" (input)="query.set(text($event))" (keydown.enter)="enter($event)" (keydown.escape)="cancelSearch()" />
          <button class="ios-search__clear" type="button" aria-label="Zoekterm wissen" (click)="clearQuery()"><app-icon name="close" [size]="15" /></button>
        </label>
        <button class="ios-search__cancel" type="button" (pointerdown)="$event.preventDefault()" (click)="cancelSearch()">Annuleer</button>
      </div>
    } @else {
      <div class="ios-chips pb-chips" role="group" aria-label="Productgroep">
        <button class="ios-chip pb-find" type="button" aria-label="Zoeken" (click)="startSearch()"><app-icon name="search" [size]="17" /></button>
        @for (chip of chips(); track chip.key) {
          <button class="ios-chip" type="button" [attr.aria-pressed]="pressed(chip.key)" (click)="tapChip(chip.key)">
            @if (chip.key === 'recent') { <app-icon name="recent" [size]="15" /> }{{ chip.name }}
          </button>
        }
      </div>
    }
    @if (open() || query().trim()) {
      @if (hint()) { <p class="pb-hint">Kies een product: je ziet meteen wat er op een {{ carrier() === 'kar' ? 'Deense kar' : 'pallet' }} en in een container past.</p> }
      @if (full()) { <p class="pb-full">Maximaal {{ maxRows() }} producten</p> }
      <div class="pb-grid">
        @if (loading()) {
          @for (n of skeletons; track n) { <span class="pb-skel" aria-hidden="true"><span class="pb-skel__photo skel"></span><span class="skel skel--line"></span></span> }
        } @else {
          @for (item of items(); track item.key) {
            @if (item.tile; as tile) {
              <button class="pb-tile" type="button" [class.is-picked]="item.pick" [style.--pick]="item.pick"
                      [disabled]="full() && !item.pick" [attr.aria-label]="item.label" (click)="chosen.emit(tile)">
                <span class="pb-photo">
                  @if (tile.photo) { <img [appAuthSrc]="tile.photo" appAuthLazy alt="" draggable="false" /> }
                  @else { <span class="pb-ph"><app-icon name="products" [size]="30" /></span> }
                  @if (tile.label) { <span class="pb-size">{{ tile.label }}</span> }
                  @if (tile.colours.length > 1) {
                    <span class="pb-dots" aria-hidden="true">
                      @for (colour of tile.colours.slice(0, 4); track colour.name) { <i [style.--dot]="colour.hex"></i> }
                      @if (tile.colours.length > 4) { +{{ tile.colours.length - 4 }} }
                    </span>
                  }
                  @if (item.pick) { <span class="pb-check" aria-hidden="true"><app-icon name="tick" [size]="14" /></span> }
                </span>
                <span class="pb-name" aria-hidden="true">{{ tile.name }}</span>
                <span class="pb-fig" [class.is-warn]="item.warn" aria-hidden="true"><app-icon name="pallet" [size]="13" /><span>{{ item.figure }}</span></span>
              </button>
            } @else {
              <h3 class="pb-sec">{{ item.heading }}</h3>
            }
          } @empty {
            <p class="pb-none">Geen product gevonden</p>
          }
        }
      </div>
      @if (foldable() && open() && !searchShown()) {
        <button type="button" (click)="fold()"
                [class]="variant() === 'desk' ? 'wk-btn wk-btn--ghost wk-btn--sm pb-fold' : 'ios-capsule ios-capsule--sm ios-capsule--tinted pb-fold'">
          <app-icon name="chevron-up" [size]="15" />Inklappen
        </button>
      }
    }
  `,
  styles: [`
    :host{display:flex;flex-direction:column;gap:10px;min-width:0}
    .pb-chips{margin-inline:-12px;--ios-inset:12px}
    .pb-chips .pb-find{padding:0 11px}
    .ios-chip>app-icon,.wk-chip>app-icon{display:flex}
    .pb-search{min-height:48px}
    .pb-hint{margin:0;color:var(--muted);font-size:13.5px;line-height:1.45}
    .pb-full{margin:0;color:var(--warn);font-size:13px;font-weight:650}
    .pb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:14px 8px}
    :host(.pb--desk) .pb-grid{grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:14px 10px}
    .pb-sec{grid-column:1/-1;margin:6px 0 -6px;color:var(--muted);font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}
    .pb-none{grid-column:1/-1;margin:0;padding:18px 0;color:var(--muted);font-size:14px;text-align:center}
    .pb-tile{display:grid;align-content:start;gap:5px;min-width:0;padding:0;border:0;background:none;color:var(--ink);font:inherit;text-align:left;cursor:pointer;-webkit-tap-highlight-color:transparent}
    .pb-tile:disabled{opacity:.45;cursor:default}
    .pb-tile:focus-visible{outline:none}.pb-tile:focus-visible .pb-photo{outline:2px solid var(--rose);outline-offset:2px}
    .pb-photo{position:relative;display:block;aspect-ratio:1;overflow:hidden;border-radius:14px;background:var(--surface);transition:transform var(--dur-1,.12s) var(--ease-out,ease)}
    .pb-photo>img{display:block;width:100%;height:100%;object-fit:cover}
    .pb-ph{display:grid;place-items:center;height:100%;color:var(--muted-2)}
    .is-picked .pb-photo{box-shadow:0 0 0 3px var(--pick)}
    .pb-check{position:absolute;top:6px;right:6px;display:grid;place-items:center;width:24px;height:24px;border-radius:50%;background:var(--pick);color:#fff;box-shadow:0 0 0 2px var(--surface)}
    .pb-size{position:absolute;top:6px;left:6px;max-width:calc(100% - 12px);padding:2px 8px;border-radius:999px;background:var(--glass-bg-strong);font-size:11px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .is-picked .pb-size{max-width:calc(100% - 42px)}
    .pb-dots{position:absolute;bottom:6px;left:6px;display:flex;align-items:center;gap:3px;padding:3px 5px;border-radius:999px;background:var(--glass-bg-strong);font-size:10px;font-weight:700;line-height:9px}
    .pb-dots i{width:9px;height:9px;border-radius:50%;background:var(--dot,var(--surface));box-shadow:inset 0 0 0 .5px rgb(26 22 20/25%)}
    .pb-name{display:-webkit-box;min-height:2.5em;overflow:hidden;font-size:12.5px;font-weight:600;line-height:1.25;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow-wrap:anywhere}
    .pb-fig{display:flex;align-items:center;gap:4px;margin-top:-2px;min-width:0;color:var(--muted);font-size:11.5px;font-weight:600;font-variant-numeric:tabular-nums}
    .pb-fig>app-icon{display:flex;flex:none}.pb-fig>span{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
    .pb-fig.is-warn{color:var(--warn)}
    .pb-skel{display:grid;gap:8px}.pb-skel__photo{aspect-ratio:1;border-radius:14px}
    .pb-fold{align-self:center;gap:4px}
    @media (hover: hover){.pb-tile:hover:not(:disabled):not(.is-picked) .pb-photo{box-shadow:0 0 0 1px var(--line-strong)}}
    @media (hover: none){.pb-tile:active:not(:disabled) .pb-photo{transform:scale(.97)}}
  `],
})
export class PalletBrowser {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly changes = inject(ChangeDetectorRef);

  readonly sections = input.required<readonly PalletBrowserSection[]>();
  readonly recent = input<readonly PalletBrowserTile[]>([]);
  /** Tile key → the pallet colour of its card. */
  readonly picked = input<ReadonlyMap<string, string>>(new Map());
  readonly pallet = input.required<PalletSpec>();
  /** What the pallet spec is: a tile reads "per pallet" or "per kar". */
  readonly carrier = input<CarrierKind>('pallet');
  readonly variant = input<'ios' | 'desk'>('ios');
  readonly loading = input(false);
  readonly full = input(false);
  readonly maxRows = input(12);
  /** The empty state: the screen's one sentence. */
  readonly hint = input(false);
  /** Rows exist: the open chip folds the grid again and "Inklappen" shows. */
  readonly foldable = input(false);
  readonly open = model(true);
  readonly query = model('');
  readonly chosen = output<PalletBrowserTile>();

  /** 'recent', 'all' or a section key; kept while the page lives, null = the default. */
  readonly chip = signal<string | null>(null);
  /** Phone only: the search field replaces the chips. */
  readonly searching = signal(false);
  readonly skeletons = [0, 1, 2, 3, 4, 5];
  /** Whether the grid was open before the phone search opened it. */
  private openBeforeSearch = true;

  readonly searchShown = computed(() => this.searching() && this.variant() === 'ios');
  private readonly categorised = computed(() => this.sections().some((section) => section.categorised));

  readonly chips = computed(() => [
    ...(this.recent().length ? [{ key: 'recent', name: 'Recent' }] : []),
    { key: 'all', name: 'Alle' },
    ...(this.categorised() ? this.sections().map((section) => ({ key: section.key, name: section.name })) : []),
  ]);

  /** The chip whose grid shows: the chosen one while it still exists, else Recent (or Alle). */
  readonly shownChip = computed(() => {
    const chip = this.chip();
    const recent = this.recent().length > 0;
    if (chip === 'all' || (chip === 'recent' && recent)) return chip;
    if (chip && this.categorised() && this.sections().some((section) => section.key === chip)) return chip;
    return recent ? 'recent' : 'all';
  });

  /** A tile's answer for the pallet or kar in use: the same figure as the card's Pallet or Deense kar row. */
  private readonly figures = computed(() => {
    const pallet = this.pallet();
    const figures = new Map<string, { text: string; warn: boolean }>();
    for (const section of this.sections()) {
      for (const tile of section.tiles) {
        const fit = palletFit(tile.lead.carton, pallet);
        const count = fit.cartonsPerPallet;
        figures.set(tile.key, count > 0
          ? { text: `${count.toLocaleString('nl-BE')} ${count === 1 ? 'omdoos' : 'omdozen'}`, warn: false }
          : { text: PROBLEMS[fit.problem ?? ''] ?? 'Past niet', warn: true });
      }
    }
    return figures;
  });

  readonly items = computed<GridItem[]>(() => {
    const query = this.query().trim();
    if (query) return matchPalletTiles(this.sections(), query).map((tile) => this.item(tile));
    const chip = this.searchShown() ? (this.recent().length ? 'recent' : 'all') : this.shownChip();
    if (chip === 'recent') return this.recent().map((tile) => this.item(tile));
    if (chip === 'all') {
      const headed = this.categorised();
      return this.sections().flatMap((section) => [
        ...(headed ? [{ key: `section:${section.key}`, heading: section.name, tile: null, pick: null, figure: '', warn: false, label: '' }] : []),
        ...section.tiles.map((tile) => this.item(tile)),
      ]);
    }
    return (this.sections().find((section) => section.key === chip)?.tiles ?? []).map((tile) => this.item(tile));
  });

  constructor() {
    /* A fold (after a pick, Inklappen) ends the phone search. */
    effect(() => {
      if (!this.open()) untracked(() => this.searching.set(false));
    });
  }

  /** Enter in a search: the first match that can be picked. False when there is none. */
  chooseFirst(): boolean {
    if (!this.query().trim()) return false;
    const picked = this.picked();
    const tile = matchPalletTiles(this.sections(), this.query()).find((candidate) => !this.full() || picked.has(candidate.key));
    if (!tile) return false;
    this.chosen.emit(tile);
    return true;
  }

  /** Wissen: back to the default chip, no search, the chip row scrolled to its start so that chip shows. */
  reset(): void {
    this.chip.set(null);
    this.searching.set(false);
    this.query.set('');
    this.host.nativeElement.querySelector('.pb-chips')?.scrollTo({ left: 0 });
  }

  pressed(key: string): boolean {
    return this.open() && !this.query().trim() && this.shownChip() === key;
  }

  /** Opens the grid on a chip; the open chip folds it again once there are rows. */
  tapChip(key: string): void {
    if (this.pressed(key)) {
      if (this.foldable()) this.open.set(false);
      return;
    }
    this.chip.set(key);
    this.query.set('');
    this.open.set(true);
  }

  fold(): void {
    this.query.set('');
    this.open.set(false);
  }

  /** The field takes the chips' place and the focus at once, inside the tap, so iOS raises its keyboard. */
  startSearch(): void {
    this.openBeforeSearch = this.open();
    this.searching.set(true);
    this.open.set(true);
    this.changes.detectChanges();
    this.host.nativeElement.querySelector<HTMLInputElement>('.pb-search input')?.focus();
  }

  cancelSearch(): void {
    this.query.set('');
    this.searching.set(false);
    if (!this.openBeforeSearch && this.foldable()) this.open.set(false);
  }

  clearQuery(): void {
    this.query.set('');
    this.host.nativeElement.querySelector<HTMLInputElement>('.pb-search input')?.focus();
  }

  enter(event: Event): void {
    event.preventDefault();
    this.chooseFirst();
  }

  text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  private item(tile: PalletBrowserTile): GridItem {
    const pick = this.picked().get(tile.key) ?? null;
    const figure = this.figures().get(tile.key) ?? { text: '', warn: false };
    const label = [
      tile.name, tile.label, figure.warn ? figure.text : `${figure.text} per ${this.carrier()}`,
      tile.colours.length > 1 ? `${tile.colours.length} kleuren` : null, pick ? 'staat in de berekening' : null,
    ].filter(Boolean).join(', ');
    return { key: tile.key, heading: null, tile, pick, figure: figure.text, warn: figure.warn, label };
  }
}
