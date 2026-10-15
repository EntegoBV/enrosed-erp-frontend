import { ChangeDetectionStrategy, Component, computed, input, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { OrderStep, PackagingKind, Product, ProductFamily, UnitName } from '../../core/api/models';
import {
  basisOptionFigure, capitalize, convertedPrice, convertPriceLabel, customerReading, DEFAULT_UNIT_KEY, erpReading,
  priceBasisChange, priceBasisWarning, productSalesUnit, salesSetupSentence, unitCount,
} from './product-sales-unit';
import {
  effectiveOrderStep, localUnitsPerOrderStep, orderStepChoices, orderStepExample, orderStepFellBack, orderStepOf,
} from './product-order-step';

type Packaging = Product['packaging'];

/**
 * "Hoe verkoop je dit product?": the first block of Verkoopprijs (desk section
 * 05, phone tab Prijs). One sentence says the whole setup; each row below it
 * sets one thing, in the order of the sentence: what one piece is called, the
 * packaging and its count, what the price field is for, and what a customer
 * orders per. Two previews show what the customer reads and what the ERP
 * counts. Presentational: it reads the editor's draft and hands every change
 * back as a packaging patch (or, for the convert button, a price); the stored
 * fields are the ones that existed before (kind, piecesPerUnit, salesUnit,
 * unitKey, orderStep) and nothing is converted by itself.
 *
 * Its styles live in styles/product-sales-setup.scss: the editor's own
 * component styles sit at their budget.
 */
@Component({
  selector: 'app-product-sales-setup',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <section class="pss" [class.pss--collapsed]="collapsed()" aria-labelledby="pss-title">
      <header class="pss__head">
        <div class="pss__title">
          <h3 id="pss-title">Hoe verkoop je dit product?</h3>
          @if (!collapsed()) { <p>Eén keuze voor offertes, facturen, klantportaal en website. Bestaande documenten veranderen niet.</p> }
        </div>
        @if (familyOthers(); as others) {
          <!-- Settings are per colour: copying stays the explicit "Naar de reeks kopiëren". -->
          <button class="pss__pill" type="button" [disabled]="disabled()" (click)="copyToFamily.emit()"
                  [attr.aria-label]="'Geldt alleen voor ' + colourName() + '. Ook voor de ' + others + ' andere kleuren instellen'">
            <i [style.background]="product().colourHex || null" aria-hidden="true"></i>
            <span>Alleen {{ colourName() }}</span><span aria-hidden="true">·</span>
            <b>Ook voor {{ others }} andere kleur{{ others === 1 ? '' : 'en' }} ›</b>
          </button>
        }
      </header>

      <p class="pss__sentence" aria-live="polite">@for (part of sentence(); track $index) {@if (part.mark) {<mark>{{ part.text }}</mark>} @else {<span>{{ part.text }}</span>}}</p>

      @if (collapsed()) {
        <div class="pss__summary">
          <p><b>{{ reading().main }}</b><small>{{ reading().detail }}</small></p>
          <button class="pss__toggle" type="button" aria-expanded="false" aria-controls="pss-rows" (click)="expanded.set(true)">Wijzigen <span aria-hidden="true">⌄</span></button>
        </div>
      } @else {
        <div class="pss__rows" id="pss-rows">
          <div class="pss__row">
            <div class="pss__label"><span id="pss-unit-label">Eén stuk heet</span><small>Het woord op offertes en de website, in elke taal</small></div>
            <div class="pss__control">
              <div class="chips filter-rail pss__chips" role="group" aria-labelledby="pss-unit-label">
                @for (unit of units(); track unit.key) {
                  <button type="button" class="chip" [class.active]="unitKey() === unit.key" [attr.aria-pressed]="unitKey() === unit.key"
                          [disabled]="disabled()" (click)="chooseUnit(unit.key)">{{ capitalize(unit.one) }}</button>
                }
              </div>
            </div>
          </div>

          <div class="pss__row">
            <div class="pss__label"><span id="pss-packaging-label">Verpakking</span><small>Rond de {{ piece().other }}, zoals in de winkel</small></div>
            <div class="pss__control">
              <div class="pss__seg pss__seg--3" id="p-packaging-kind" tabindex="-1" role="group" aria-labelledby="pss-packaging-label">
                @for (option of packagingOptions; track option.kind) {
                  <button type="button" [class.is-on]="kind() === option.kind" [attr.aria-pressed]="kind() === option.kind"
                          [disabled]="disabled()" (click)="chooseKind(option.kind)"><b>{{ option.label }}</b></button>
                }
              </div>
              @if (kind() === 'DISPLAY') {
                <div class="pss__count">
                  <label class="req" for="p-packaging-pieces">{{ capitalize(piece().other) }} in één display</label>
                  <input class="input num right" id="p-packaging-pieces" type="number" min="1" step="1" inputmode="numeric" placeholder="bijv. 12"
                         [ngModel]="product().packaging.piecesPerUnit" [disabled]="disabled()"
                         (ngModelChange)="patch({ piecesPerUnit: whole($event) })" />
                </div>
                @if (product().packaging.piecesPerUnit === 1) { <p class="pss__hint pss__hint--warn">Eén {{ piece().one }} per display? Kies dan Geschenkdoosje.</p> }
              }
            </div>
          </div>

          <div class="pss__row">
            <div class="pss__label"><span id="pss-basis-label">Prijs geldt per</span><small>Wat het prijsveld betekent</small></div>
            <div class="pss__control">
              @if (kind() === 'DISPLAY') {
                <div class="pss__seg" role="group" aria-labelledby="pss-basis-label">
                  <button type="button" [class.is-on]="!unit().isDisplay" [attr.aria-pressed]="!unit().isDisplay" [disabled]="disabled()" (click)="chooseBasis('PIECE')">
                    <b>Eén {{ piece().one }}</b><small>prijs van 1 {{ piece().one }}</small>
                    @if (pieceFigure(); as figure) { <em class="pss__figure">{{ figure }}</em> }
                  </button>
                  <button type="button" [class.is-on]="unit().isDisplay" [attr.aria-pressed]="unit().isDisplay"
                          [disabled]="disabled() || (!count() && !unit().isDisplay)" (click)="chooseBasis('DISPLAY')">
                    <b>Display van {{ count() ?? '…' }}</b>
                    <small>{{ count() ? count() + ' ' + piece().other + ' samen' : 'vul eerst in hoeveel ' + piece().other + ' erin zitten' }}</small>
                    @if (displayFigure(); as figure) { <em class="pss__figure">{{ figure }}</em> }
                  </button>
                </div>
              } @else {
                <div class="pss__fixed">
                  <span class="pss__fixed-option"><b>Eén {{ piece().one }}</b><small>prijs van 1 {{ piece().one }}</small></span>
                  <small>{{ kind() === 'GIFT_BOX' ? 'Geschenkdoosje: 1 ' + piece().one + ' per doosje.' : 'Geen display: de prijs geldt per ' + piece().one + '.' }}</small>
                </div>
              }
              <p class="pss__hint">Voorraad, aantallen en doosinhoud tellen in <b>{{ unit().plural }}</b>.</p>
              @if (change(); as basisChange) {
                <div class="alert alert--warn pss__warn" role="status">
                  <span class="alert__icon" aria-hidden="true">!</span>
                  <div>
                    <p>{{ warning() }}</p>
                    @if (!fixedPrice()) {
                      <p>Met kostprijs + opslag rekent de prijs met de opgeslagen kostprijs, tot een nieuwe inkoopcalculatie die per {{ basisChange.to === 'DISPLAY' ? 'display' : piece().one }} berekent.</p>
                    }
                    <div class="pss__warn-actions">
                      @if (convertTarget(); as target) {
                        <button class="btn btn--sm" type="button" [disabled]="disabled()" (click)="fill(target)">{{ convertLabel() }}</button>
                      }
                      <button class="btn btn--sm" type="button" [disabled]="disabled()" (click)="restore()">Terugzetten</button>
                    </div>
                  </div>
                </div>
              }
            </div>
          </div>

          <div class="pss__row">
            <div class="pss__label"><span id="pss-step-label">Klant bestelt per</span><small>Waarop een aantal afrondt</small></div>
            <div class="pss__control">
              <div class="pss__seg" [class.pss__seg--3]="choices().length === 3" role="group" aria-labelledby="pss-step-label">
                @for (choice of choices(); track choice.step) {
                  <button type="button" [class.is-on]="step() === choice.step" [attr.aria-pressed]="step() === choice.step"
                          [disabled]="disabled()" (click)="chooseStep(choice.step)"><b>{{ choice.label }}</b><small>{{ choice.detail }}</small></button>
                }
              </div>
              <p class="pss__hint" aria-live="polite">{{ example() }}</p>
              @if (fellBack()) {
                <p class="pss__hint pss__hint--warn" role="status">Klant bestelt nu per {{ piece().one }}: {{ kind() === 'DISPLAY' ? 'vul in hoeveel ' + piece().other + ' er in de display zitten' : 'er is geen display meer' }}.</p>
              }
              <p class="pss__hint">Omdoos: {{ cartonLine() }} <button class="linklike" type="button" (click)="editCarton.emit()">{{ cartonCount() ? 'Wijzigen' : 'Invullen' }} ›</button></p>
            </div>
          </div>
        </div>

        <div class="pss__previews">
          <div class="pss__customer">
            <span class="pss__kicker">Zo leest de klant het · offerte, portaal en website</span>
            <b>{{ reading().main }}</b>
            <small>{{ reading().detail }}</small>
          </div>
          <div class="pss__erp">
            <span class="pss__kicker">Zo rekent het ERP</span>
            <dl>
              @for (row of erp(); track row.label) { <div><dt>{{ row.label }}</dt><dd>{{ row.value }}</dd></div> }
            </dl>
          </div>
        </div>
        @if (canCollapse()) {
          <button class="pss__toggle pss__toggle--close" type="button" aria-expanded="true" aria-controls="pss-rows" (click)="expanded.set(false)">Inklappen <span aria-hidden="true">⌃</span></button>
        }
      }
    </section>
  `,
})
export class ProductSalesSetup {
  /** The editor's draft. */
  readonly product = input.required<Product>();
  /** The product as last loaded or saved; null for a new one. */
  readonly saved = input<Product | null>(null);
  /** The unit choices; the current unit only until the server list arrives. */
  readonly units = input<readonly UnitName[]>([]);
  /** The catalogue price as the draft stands (fixed, or cost + markup). */
  readonly price = input(0);
  /** "Vaste verkoopprijs": only then the convert button can fill the price. */
  readonly fixedPrice = input(true);
  /** What one carton holds, typed or automatic, in the stored unit. */
  readonly cartonCount = input<number | null>(null);
  readonly family = input<ProductFamily | null>(null);
  readonly disabled = input(false);
  readonly desktop = input(true);
  /** Phone: open, or folded to the sentence once a saved product is complete. */
  readonly expanded = model(false);

  readonly packagingChange = output<Partial<Packaging>>();
  readonly priceChange = output<number>();
  readonly copyToFamily = output<void>();
  readonly editCarton = output<void>();

  readonly capitalize = capitalize;
  readonly packagingOptions: readonly { kind: PackagingKind; label: string }[] = [
    { kind: 'NONE', label: 'Los' },
    /* A soft hyphen: three options side by side on a phone break it as Geschenk-doosje. */
    { kind: 'GIFT_BOX', label: 'Geschenk\u00addoosje' },
    { kind: 'DISPLAY', label: 'Display' },
  ];

  readonly unit = computed(() => productSalesUnit(this.product()));
  readonly piece = computed(() => this.unit().piece);
  readonly kind = computed<PackagingKind>(() => this.product().packaging?.kind ?? 'NONE');
  /** Pieces of a display of two or more; null otherwise. */
  readonly count = computed(() => this.unit().piecesPerDisplay);
  readonly unitKey = computed(() => this.product().packaging?.unitKey?.trim().toLowerCase() || DEFAULT_UNIT_KEY);
  /** "Klant bestelt per" as the draft reads it: per display without a display to count is one unit. */
  readonly step = computed(() => effectiveOrderStep(this.product()));
  readonly choices = computed(() => orderStepChoices(this.product(), this.unit(), this.cartonCount()));
  readonly example = computed(() => orderStepExample(this.step(),
    localUnitsPerOrderStep({ ...this.product(), carton: { ...this.product().carton, piecesPerCarton: this.cartonCount() } }), this.unit()));
  readonly fellBack = computed(() => orderStepFellBack(this.saved(), this.product()));

  readonly sentence = computed(() => salesSetupSentence(this.product(), this.step()));
  readonly reading = computed(() => customerReading(this.product(), this.price(), this.cartonCount(), this.step()));
  readonly erp = computed(() => erpReading(this.product(), this.price(), this.cartonCount()));
  readonly pieceFigure = computed(() => basisOptionFigure(this.product(), this.price(), 'PIECE'));
  readonly displayFigure = computed(() => basisOptionFigure(this.product(), this.price(), 'DISPLAY'));

  /** "12 diamanten (1 display)", "4 displays (48 rozen)", or what is missing. */
  readonly cartonLine = computed(() => {
    const carton = this.cartonCount();
    if (!carton || carton < 1) return 'doosinhoud ontbreekt';
    const unit = this.unit();
    const count = this.count();
    const text = unitCount(unit, carton);
    if (!count) return text;
    if (unit.isDisplay) return `${text} (${unitCount({ singular: unit.piece.one, plural: unit.piece.other }, carton * count)})`;
    return carton % count === 0 ? `${text} (${unitCount({ singular: 'display', plural: 'displays' }, carton / count)})` : text;
  });

  /** The saved product's price basis about to change; null for a new product. */
  readonly change = computed(() => priceBasisChange(this.saved(), this.product()));
  readonly warning = computed(() => {
    const change = this.change();
    return change ? priceBasisWarning(this.product(), change, this.price(), this.cartonCount()) : '';
  });
  /**
   * The basis switch in progress, for the saved product it started from: the
   * draft price when the basis left the saved one (a price typed just before
   * counts), and the price the convert button filled in. A save or another
   * product makes it stale; then the saved price stands in.
   */
  private readonly switched = signal<{ saved: Product | null; price: number | null; filled: number | null } | null>(null);
  private readonly switchNow = computed(() => {
    const switched = this.switched();
    return switched && switched.saved === this.saved() && this.change() ? switched : null;
  });
  /** What the convert button converts: the price as it stood when the basis changed. */
  readonly convertBase = computed(() => {
    const saved = this.saved();
    const switched = this.switchNow();
    return switched ? switched.price : saved?.fixedSalesPriceEur ?? saved?.computedSalesPriceEur ?? null;
  });
  /**
   * That price on the new basis, while the draft still holds it unconverted;
   * once the price is filled in or typed over, the button is done.
   */
  readonly convertTarget = computed(() => {
    const base = this.convertBase();
    if (!this.fixedPrice() || !this.saved() || base === null || this.product().fixedSalesPriceEur !== base) return null;
    const target = convertedPrice(base, this.change());
    return target !== null && target !== base ? target : null;
  });
  readonly convertLabel = computed(() => this.convertTarget() === null ? '' : convertPriceLabel(this.convertBase(), this.change()));

  readonly familyOthers = computed(() => {
    const product = this.product();
    const family = this.family();
    if (product.id === null || !family || family.id !== product.familyId) return 0;
    return family.members.filter((member) => member.productId !== product.id).length;
  });
  readonly colourName = computed(() => this.product().colour?.trim() || 'deze kleur');

  /** Something on the card asks for a look: it stays open on a phone. */
  readonly attention = computed(() => this.change() !== null || this.fellBack()
    || (this.kind() === 'DISPLAY' && !this.count()));
  readonly canCollapse = computed(() => !this.desktop() && this.saved() !== null && !this.attention());
  readonly collapsed = computed(() => this.canCollapse() && !this.expanded());

  patch(changes: Partial<Packaging>): void {
    this.packagingChange.emit(changes);
  }

  whole(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? Math.round(number) : null;
  }

  chooseUnit(key: string): void {
    if (key !== this.unitKey()) this.patch({ unitKey: key });
  }

  chooseKind(kind: PackagingKind): void {
    if (kind !== this.kind()) this.patchBasis({ kind });
  }

  chooseBasis(basis: 'PIECE' | 'DISPLAY'): void {
    if (basis !== (this.unit().isDisplay ? 'DISPLAY' : 'PIECE')) this.patchBasis({ salesUnit: basis });
  }

  /** The convert button: the price only, remembered so going back takes it back. */
  fill(target: number): void {
    const base = this.convertBase();
    this.switched.set({ saved: this.saved(), price: base, filled: target });
    this.priceChange.emit(target);
  }

  /**
   * A packaging patch that can move the price basis. Leaving the saved basis
   * remembers the price it left from; coming back to it (with the option, the
   * packaging or Terugzetten) takes a converted price back, so a price filled
   * in for one basis never stays behind on the other without the warning.
   */
  private patchBasis(changes: Partial<Packaging>): void {
    const product = this.product();
    const before = this.change();
    const after = priceBasisChange(this.saved(), { ...product, packaging: { ...product.packaging, ...changes } });
    if (before && !after) this.undoConvertedPrice();
    else if (!before && after) this.switched.set({ saved: this.saved(), price: product.fixedSalesPriceEur ?? null, filled: null });
    this.patch(changes);
  }

  /** The price before the convert button, while the draft still holds what it filled in. */
  private undoConvertedPrice(): void {
    const switched = this.switchNow();
    if (switched?.filled != null && switched.price != null && this.product().fixedSalesPriceEur === switched.filled) {
      this.priceChange.emit(switched.price);
    }
    this.switched.set(null);
  }

  chooseStep(step: OrderStep): void {
    if (step !== orderStepOf(this.product())) this.patch({ orderStep: step });
  }

  /** Back to the saved packaging, count, basis and step; a converted price goes back too. */
  restore(): void {
    const saved = this.saved();
    if (!saved) return;
    this.undoConvertedPrice();
    const packaging = saved.packaging;
    this.patch({ kind: packaging.kind, piecesPerUnit: packaging.piecesPerUnit ?? null,
      salesUnit: packaging.salesUnit ?? 'PIECE', orderStep: packaging.orderStep ?? null });
  }
}
