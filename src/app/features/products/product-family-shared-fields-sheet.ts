import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
} from '@angular/core';
import type { Product, ProductFamily } from '../../core/api/models';
import { Sheet } from '../../shared/ui';
import {
  PRODUCT_FAMILY_SHARED_FIELDS,
  PRODUCT_FAMILY_SHARED_FIELD_GROUPS,
  ProductFamilySharedField,
  ProductFamilySharedFieldsApply,
  ProductFamilySharedFieldTarget,
  productFamilySharedFieldTargets,
  productFamilySharedFieldValue,
  productFamilySharedFieldsApplyPayload,
} from './product-family-shared-fields';

export {
  PRODUCT_FAMILY_SHARED_FIELDS,
  PRODUCT_FAMILY_SHARED_FIELD_GROUPS,
  type ProductFamilySharedField,
  type ProductFamilySharedFieldsApply,
  type ProductFamilySharedFieldTarget,
  productFamilySharedFieldTargets,
  productFamilySharedFieldValue,
  productFamilySharedFieldsApplyPayload,
} from './product-family-shared-fields';

/**
 * One deliberate, one-time family update. This component never persists or
 * silently links fields; the parent owns preview, API calls and refreshes.
 */
@Component({
  selector: 'app-product-family-shared-fields-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet],
  template: `
    @if (open()) {
      <app-sheet title="Toepassen op kleuren" [wide]="true" (closed)="requestClose()">
        <div body class="shared-sheet">
          <section class="source-card" aria-label="Hoofdproduct voor deze bewerking">
            <span class="source-card__eyebrow">Hoofdproduct voor deze bewerking</span>
            <div class="source-card__line">
              <i class="colour-dot" [class.colour-dot--empty]="!source().colourHex"
                 [style.background]="source().colourHex || null" aria-hidden="true"></i>
              <span>
                <b>{{ source().name }}</b>
                <small>{{ sourceVariantLabel() }}{{ source().sku ? ' · ' + source().sku : '' }}</small>
              </span>
            </div>
            <p>De gekozen gegevens worden één keer vanuit dit product gekopieerd. Ze blijven daarna per kleur bewerkbaar.</p>
          </section>

          <div class="review" role="status" aria-live="polite" aria-atomic="true">
            <span><b>{{ selectedFieldCount() }}</b> {{ fieldCountLabel() }}</span>
            <i aria-hidden="true">→</i>
            <span><b>{{ selectedTargetCount() }}</b> {{ colourCountLabel() }}</span>
          </div>

          <div class="field-groups">
            @for (group of fieldGroups; track group.label) {
              <fieldset class="option-group">
                <legend>{{ group.label }}</legend>
                @for (field of group.fields; track field.key) {
                  <label class="option-row">
                    <input type="checkbox" [checked]="selectedFields().has(field.key)" [disabled]="busy()"
                           [attr.data-initial-focus]="field.key === 'NAME' ? '' : null"
                           (change)="setField(field.key, $any($event.target).checked)" />
                    <span>
                      <b>{{ field.label }}</b>
                      <small>{{ field.summary }}</small>
                      <em class="option-row__value">Nu: {{ fieldValue(field.key) }}</em>
                    </span>
                  </label>
                }
              </fieldset>
            }
          </div>

          <fieldset class="option-group target-group">
            <legend>
              <span>Kleuren kiezen</span>
              @if (targets().length) {
                <button type="button" [disabled]="busy()" (click)="toggleAllTargets()">
                  {{ allTargetsSelected() ? 'Alles deselecteren' : 'Alles selecteren' }}
                </button>
              }
            </legend>
            @for (target of targets(); track target.productId) {
              <label class="option-row target-row">
                <input type="checkbox" [checked]="selectedTargetIds().has(target.productId)" [disabled]="busy()"
                       (change)="setTarget(target.productId, $any($event.target).checked)" />
                <i class="colour-dot" [class.colour-dot--empty]="!target.colourHex"
                   [style.background]="target.colourHex || null" aria-hidden="true"></i>
                <span>
                  <b>{{ targetLabel(target) }}</b>
                  <small>
                    {{ target.sku || target.name }}
                    @if (!target.active) { <em>inactief</em> }
                  </small>
                </span>
              </label>
            } @empty {
              <p class="empty-state">Er zijn geen andere kleuren in deze reeks.</p>
            }
          </fieldset>

          <p class="protected-note">
            <span aria-hidden="true">i</span>
            <strong>SKU, kleur, EAN’s, voorraad, foto’s en leveranciersafspraken blijven per kleur.</strong>
          </p>
        </div>

        <div foot class="shared-sheet__actions">
          <button class="btn" type="button" [disabled]="busy()" (click)="requestClose()">Annuleren</button>
          <button class="btn btn--primary" type="button" [disabled]="!canApply() || busy()" (click)="submit()">
            @if (busy()) {
              Bezig…
            } @else if (saveFirst()) {
              Opslaan en toepassen op {{ selectedTargetCount() }} {{ colourCountLabel() }}
            } @else {
              Toepassen op {{ selectedTargetCount() }} {{ colourCountLabel() }}
            }
          </button>
        </div>
      </app-sheet>
    }
  `,
  styles: `
    :host { display: contents; }
    .shared-sheet { display: grid; gap: 14px; }
    .source-card {
      display: grid; gap: 7px; padding: 13px; border: 1px solid var(--rose-line);
      border-radius: var(--r); background: color-mix(in srgb, var(--surface) 84%, var(--rose-soft));
    }
    .source-card__eyebrow {
      color: var(--rose); font-size: 9.5px; font-weight: 800; letter-spacing: .08em;
      text-transform: uppercase;
    }
    .source-card__line { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .source-card__line > span { display: grid; min-width: 0; }
    .source-card b { overflow: hidden; font-size: 14px; text-overflow: ellipsis; white-space: nowrap; }
    .source-card small, .source-card p { color: var(--muted); font-size: 11px; line-height: 1.4; }
    .colour-dot {
      flex: 0 0 auto; width: 22px; height: 22px; border: 1px solid rgb(0 0 0 / 14%);
      border-radius: 50%; box-shadow: inset 0 0 0 2px var(--surface);
    }
    .colour-dot--empty {
      background: repeating-linear-gradient(45deg, #eee 0 4px, #fff 4px 8px) !important;
    }
    .review {
      display: flex; align-items: center; justify-content: center; gap: 10px; min-height: 42px;
      padding: 8px 12px; border-radius: 13px; background: var(--surface-2);
      color: var(--muted); font-size: 12px;
    }
    .review b { color: var(--ink); font-variant-numeric: tabular-nums; }
    .review i { color: var(--rose); font-style: normal; }
    .field-groups { display: grid; gap: 12px; }
    .option-group { min-width: 0; margin: 0; padding: 0; border: 1px solid var(--line);
      border-radius: var(--r); background: var(--surface); overflow: hidden; }
    .option-group legend {
      width: 100%; padding: 8px 12px 6px; color: var(--muted); background: var(--surface-2);
      font-size: 10px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase;
    }
    .option-row {
      display: flex; align-items: center; gap: 11px; min-height: 58px; padding: 9px 12px;
      border-top: 1px solid var(--line); cursor: pointer;
    }
    .option-row input { flex: 0 0 auto; width: 22px; height: 22px; margin: 0; accent-color: var(--rose); }
    .option-row:has(input:disabled) { cursor: wait; opacity: .7; }
    .option-row > span { display: grid; gap: 1px; min-width: 0; }
    .option-row b { color: var(--ink-2); font-size: 12.5px; }
    .option-row small { color: var(--muted); font-size: 10.5px; line-height: 1.35; }
    .option-row__value {
      margin-top: 3px; overflow: hidden; color: var(--ink-2); font-size: 10.5px;
      font-style: normal; font-weight: 700; line-height: 1.35; text-overflow: ellipsis;
    }
    .target-group legend { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .target-group legend button {
      min-height: 36px; padding: 0 4px; border: 0; background: transparent; color: var(--rose-dark);
      font: inherit; font-size: 10.5px; font-weight: 750; text-transform: none; cursor: pointer;
    }
    .target-group legend button:disabled { cursor: wait; opacity: .55; }
    .target-row { min-height: 54px; }
    .target-row .colour-dot { width: 20px; height: 20px; }
    .target-row em {
      margin-left: 5px; padding: 1px 5px; border-radius: 999px; background: var(--warn-soft);
      color: var(--warn); font-size: 9px; font-style: normal; font-weight: 750;
    }
    .empty-state { padding: 16px 12px; color: var(--muted); font-size: 12px; }
    .protected-note {
      display: flex; align-items: flex-start; gap: 9px; margin: 0; padding: 11px 12px;
      border-radius: var(--r-sm); background: var(--blue-soft); color: var(--ink-2);
      font-size: 11px; line-height: 1.45;
    }
    .protected-note > span {
      display: grid; flex: 0 0 auto; width: 20px; height: 20px; place-items: center;
      border-radius: 50%; background: var(--blue); color: white; font-weight: 800;
    }
    .shared-sheet__actions { display: contents; }
    @media (min-width: 680px) {
      .shared-sheet { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: start; }
      .source-card, .review, .protected-note { grid-column: 1 / -1; }
      .field-groups { grid-column: 1; }
      .target-group { grid-column: 2; }
    }
    @media (pointer: coarse) {
      .target-group legend button { min-height: 44px; }
    }
  `,
})
export class ProductFamilySharedFieldsSheet {
  readonly open = input.required<boolean>();
  readonly source = input.required<Product>();
  readonly family = input.required<ProductFamily>();
  readonly products = input.required<readonly Product[]>();
  readonly busy = input(false);
  /** The parent persists the current draft before issuing the atomic family command. */
  readonly saveFirst = input(false);

  readonly close = output<void>();
  readonly apply = output<ProductFamilySharedFieldsApply>();

  readonly fieldGroups = PRODUCT_FAMILY_SHARED_FIELD_GROUPS;
  readonly selectedFields = signal<ReadonlySet<ProductFamilySharedField>>(
    new Set(PRODUCT_FAMILY_SHARED_FIELDS),
  );
  readonly selectedTargetIds = signal<ReadonlySet<number>>(new Set());

  readonly targets = computed(() => productFamilySharedFieldTargets(
    this.family(), this.source(), this.products(),
  ));
  readonly selectedFieldCount = computed(() => this.selectedFields().size);
  readonly selectedTargetCount = computed(() => this.selectedTargetIds().size);
  readonly allTargetsSelected = computed(() =>
    this.targets().length > 0 && this.targets().every((target) =>
      this.selectedTargetIds().has(target.productId)),
  );
  readonly canApply = computed(() =>
    this.family().id !== null
    && this.source().id !== null
    && this.source().familyId === this.family().id
    && this.selectedFieldCount() > 0
    && this.selectedTargetCount() > 0,
  );

  private contextKey: string | null = null;

  constructor() {
    effect(() => {
      const isOpen = this.open();
      const familyId = this.family().id;
      const sourceId = this.source().id;
      const targetIds = this.targets().map((target) => target.productId).join(',');
      const nextKey = isOpen ? `${familyId ?? 'new'}:${sourceId ?? 'new'}:${targetIds}` : null;
      if (nextKey === this.contextKey) return;
      this.contextKey = nextKey;
      if (nextKey === null) return;
      this.selectedFields.set(new Set(PRODUCT_FAMILY_SHARED_FIELDS));
      this.selectedTargetIds.set(new Set(this.targets().map((target) => target.productId)));
    });
  }

  setField(field: ProductFamilySharedField, checked: boolean): void {
    this.selectedFields.update((current) => {
      const next = new Set(current);
      if (checked) next.add(field);
      else next.delete(field);
      return next;
    });
  }

  setTarget(productId: number, checked: boolean): void {
    this.selectedTargetIds.update((current) => {
      const next = new Set(current);
      if (checked) next.add(productId);
      else next.delete(productId);
      return next;
    });
  }

  toggleAllTargets(): void {
    this.selectedTargetIds.set(this.allTargetsSelected()
      ? new Set()
      : new Set(this.targets().map((target) => target.productId)));
  }

  requestClose(): void {
    if (this.busy()) return;
    this.close.emit();
  }

  submit(): void {
    const familyId = this.family().id;
    if (familyId === null || !this.canApply()) return;
    this.apply.emit(productFamilySharedFieldsApplyPayload(
      familyId,
      this.targets(),
      this.selectedTargetIds(),
      this.selectedFields(),
    ));
  }

  sourceVariantLabel(): string {
    return [this.source().colour?.trim(), this.source().variantSize?.trim()]
      .filter(Boolean).join(' · ') || 'Geen kleur of maat';
  }

  targetLabel(target: ProductFamilySharedFieldTarget): string {
    return [target.colour?.trim(), target.size?.trim()].filter(Boolean).join(' · ')
      || target.name || `Product ${target.productId}`;
  }

  fieldValue(field: ProductFamilySharedField): string {
    return productFamilySharedFieldValue(field, this.source());
  }

  fieldCountLabel(): string {
    return this.selectedFieldCount() === 1 ? 'gegeven' : 'gegevens';
  }

  colourCountLabel(): string {
    return this.selectedTargetCount() === 1 ? 'kleur' : 'kleuren';
  }
}
