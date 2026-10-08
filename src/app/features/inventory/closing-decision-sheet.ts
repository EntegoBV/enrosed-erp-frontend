import {
  ChangeDetectionStrategy, Component, Injector, OnInit, afterNextRender, computed, effect, inject, input, output, signal, untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import type { Notice } from '../../core/api/inventory-models';
import { DateField } from '../../shared/date-field';
import { Sheet } from '../../shared/ui';
import { decimalText, parseDecimal } from './inventory-number';

/**
 * The element id of the row a notice is solved on, the same id the step
 * components give that row; null when the notice names no row. The shell
 * links "Nog te doen" to `?stap={segment}#{id}` and the step scrolls there.
 */
export function noticeAnchor(notice: Notice): string | null {
  switch (notice.segment) {
    case 'tellen':
      return notice.locationId != null ? `inv-loc-${notice.locationId}` : null;
    case 'datum':
      return notice.locationId != null ? `inv-roll-${notice.locationId}` : null;
    case 'waarde':
      if (notice.code === 'ZONDER_WAARDE') return 'inv-unvalued';
      if (notice.purchaseOrderId != null) return `inv-container-${notice.purchaseOrderId}`;
      return notice.productId != null ? `inv-product-${notice.productId}` : null;
    case 'apart':
      if (notice.salesOrderId != null) return `inv-apart-invoice-${notice.salesOrderId}`;
      if (notice.purchaseOrderId != null) return `inv-apart-container-${notice.purchaseOrderId}`;
      return notice.productId != null ? 'inv-apart-third' : null;
    case 'afsluiten':
      return notice.code === 'BTW_BEVESTIGING' ? 'inv-vat' : null;
  }
}

/**
 * Follows the address fragment to a row of this step: `prepare` opens what
 * hides the row (a tab, a fold), then the row scrolls into view. Call it in
 * an injection context.
 */
export function followAnchor(prepare: (anchor: string) => void = () => {}): void {
  const fragment = toSignal(inject(ActivatedRoute).fragment, { initialValue: null });
  const injector = inject(Injector);
  effect(() => {
    const anchor = fragment();
    if (!anchor || !anchor.startsWith('inv-')) return;
    untracked(() => prepare(anchor));
    /* After the router has put the page back at the top, and once the row is drawn. */
    afterNextRender(() => setTimeout(() => scrollWhenDrawn(anchor, 20), 80), { injector });
  });
}

function scrollWhenDrawn(anchor: string, tries: number): void {
  const row = document.getElementById(anchor);
  /* A tall card starts at its head; a single row sits in the middle. */
  if (row) row.scrollIntoView({ block: row.getBoundingClientRect().height > window.innerHeight * 0.6 ? 'start' : 'center' });
  else if (tries > 0) requestAnimationFrame(() => scrollWhenDrawn(anchor, tries - 1));
}

/** What one decision asks. Every part is optional except the title and the save label. */
export interface DecisionSheetSpec {
  title: string;
  /** Plain paragraphs above the fields. */
  lead?: readonly string[];
  choice?: { label: string; value: string | null; options: readonly { value: string; label: string; help?: string }[] };
  product?: { label: string; options: readonly { id: number; label: string }[] };
  quantity?: { label: string; value: number | null; min: number; help?: string };
  date?: { label: string; value: string | null; readOnly?: boolean; help?: string };
  /** A short text such as the owner of the goods or the name of the signer. */
  name?: { label: string; value: string };
  reason?: { label: string; value: string; required: boolean; placeholder?: string };
  saveLabel: string;
  /** The second action that takes the decision back, e.g. "Terug naar het voorstel". */
  removeLabel?: string | null;
}

export interface DecisionSheetResult {
  choice: string | null;
  productId: number | null;
  quantity: number | null;
  date: string | null;
  name: string;
  reason: string;
}

/**
 * The one sheet behind the decisions that only need a few facts and a
 * reason: a tick of step 2, the ownership date, which pieces the supplier
 * charged, a container in transit, a partner container or quantity, an
 * invoice, goods of third parties, the signer and the reason of a
 * correction. It asks what its spec names and hands the answers back; the
 * step builds the write.
 */
@Component({
  selector: 'app-closing-decision-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet, DateField],
  template: `
    <app-sheet [title]="spec().title" (closed)="closed.emit()">
      <div body class="inv-sheet">
        @for (text of spec().lead ?? []; track $index) { <p class="inv-sheet__lead">{{ text }}</p> }
        @if (spec().choice; as field) {
          <div class="inv-sheet__choices" role="radiogroup" [attr.aria-label]="field.label">
            @for (option of field.options; track option.value) {
              <button class="inv-sheet__choice" type="button" role="radio" [attr.aria-checked]="choice() === option.value" (click)="choice.set(option.value)">
                <span>{{ option.label }}</span>
                @if (option.help) { <small>{{ option.help }}</small> }
              </button>
            }
          </div>
        }
        @if (spec().product; as field) {
          <div class="field">
            <label for="inv-decision-product">{{ field.label }}</label>
            <select class="select" id="inv-decision-product" (change)="productId.set(+$any($event.target).value || null)">
              <option value="">Kies een product</option>
              @for (option of field.options; track option.id) { <option [value]="option.id" [selected]="productId() === option.id">{{ option.label }}</option> }
            </select>
          </div>
        }
        @if (spec().quantity; as field) {
          <div class="field">
            <label for="inv-decision-quantity">{{ field.label }}</label>
            <input class="input num" id="inv-decision-quantity" type="text" inputmode="numeric" autocomplete="off" [value]="quantity()" (input)="quantity.set($any($event.target).value)" />
            @if (quantityError(); as error) { <span class="hint inv-hint--stop" role="alert">{{ error }}</span> }
            @if (field.help) { <span class="hint">{{ field.help }}</span> }
          </div>
        }
        @if (spec().date; as field) {
          <div class="field">
            <label for="inv-decision-date">{{ field.label }}</label>
            @if (field.readOnly) {
              <input class="input num" id="inv-decision-date" type="text" readonly [value]="belgian(date())" />
            } @else {
              <app-date-field fieldId="inv-decision-date" [value]="date()" (valueChange)="date.set($event)" />
            }
            @if (field.help) { <span class="hint">{{ field.help }}</span> }
          </div>
        }
        @if (spec().name; as field) {
          <div class="field">
            <label for="inv-decision-name">{{ field.label }}</label>
            <input class="input" id="inv-decision-name" type="text" maxlength="160" autocomplete="off" [value]="name()" (input)="name.set($any($event.target).value)" />
          </div>
        }
        @if (spec().reason; as field) {
          <div class="field inv-sheet__last">
            <label for="inv-decision-reason">{{ field.label }}</label>
            <textarea class="textarea" id="inv-decision-reason" rows="3" maxlength="1000" [placeholder]="field.placeholder ?? ''" [value]="reason()" (input)="reason.set($any($event.target).value)"></textarea>
          </div>
        }
      </div>
      <div foot style="display:contents">
        @if (spec().removeLabel; as label) {
          <button class="btn" type="button" [disabled]="busy()" (click)="remove.emit()">{{ label }}</button>
        } @else {
          <button class="btn" type="button" (click)="closed.emit()">Annuleren</button>
        }
        <button class="btn btn--primary" type="button" [disabled]="!canSave()" (click)="submit()">{{ busy() ? 'Bezig…' : spec().saveLabel }}</button>
      </div>
    </app-sheet>
  `,
})
export class ClosingDecisionSheet implements OnInit {
  readonly spec = input.required<DecisionSheetSpec>();
  readonly busy = input(false);
  readonly save = output<DecisionSheetResult>();
  readonly remove = output<void>();
  readonly closed = output<void>();

  readonly choice = signal<string | null>(null);
  readonly productId = signal<number | null>(null);
  readonly quantity = signal('');
  readonly date = signal('');
  readonly name = signal('');
  readonly reason = signal('');

  private readonly amount = computed(() => parseDecimal(this.quantity()));
  /** Why the typed quantity cannot be saved, said under the field; null while it is empty or fine. */
  readonly quantityError = computed(() => {
    const field = this.spec().quantity;
    const amount = this.amount();
    if (!field || amount === null) return null;
    if (!Number.isInteger(amount)) return 'Vul een geheel aantal in, zonder decimalen.';
    return amount < field.min ? `Het aantal moet ${field.min} of meer zijn.` : null;
  });

  readonly canSave = computed(() => {
    const spec = this.spec();
    if (this.busy()) return false;
    if (spec.choice && !this.choice()) return false;
    if (spec.product && this.productId() === null) return false;
    if (spec.quantity) {
      const amount = this.amount();
      if (amount === null || !Number.isInteger(amount) || amount < spec.quantity.min) return false;
    }
    if (spec.date && !this.date()) return false;
    if (spec.name && !this.name().trim()) return false;
    return !spec.reason?.required || !!this.reason().trim();
  });

  /* Once, on opening: a recompute behind the sheet must not wipe what is being typed. */
  ngOnInit(): void {
    const spec = this.spec();
    this.choice.set(spec.choice?.value ?? null);
    this.quantity.set(decimalText(spec.quantity?.value));
    this.date.set(spec.date?.value ?? '');
    this.name.set(spec.name?.value ?? '');
    this.reason.set(spec.reason?.value ?? '');
  }

  belgian(date: string): string {
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    return parts ? `${parts[3]}/${parts[2]}/${parts[1]}` : date;
  }

  submit(): void {
    if (!this.canSave()) return;
    this.save.emit({
      choice: this.choice(), productId: this.productId(), quantity: this.spec().quantity ? this.amount() : null,
      date: this.date() || null, name: this.name().trim(), reason: this.reason().trim(),
    });
  }
}
