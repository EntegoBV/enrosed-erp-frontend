import { ChangeDetectionStrategy, Component, ElementRef, ViewEncapsulation, afterNextRender, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { CatalogApi } from '../../core/api/catalog-api';
import { SourcingApi } from '../../core/api/sourcing-api';
import { messageOf } from '../../core/api/errors';
import type { Product } from '../../core/api/models';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { Segmented, type SegmentOption } from '../../shared/segmented';
import { Sheet, Ui } from '../../shared/ui';
import { productSalesUnit } from './product-sales-unit';
import { receivedContainersFor, type ReceivedContainer } from './received-containers';
import {
  bookingHelp, bookingKinds, bookingLabel, bookingNeedsContainer, bookingNotePlaceholder, bookingPreview, bookingReady,
  bookingToast, containerOptionLabel, newBookingDraft, parseCount, switchBookingKind,
  type BookingDraft, type BookingKind, type BookingLevel,
} from './stock-booking';

/** What a host hears after a booking: enough to refresh its figures. */
export interface StockBooked {
  kind: BookingKind;
  delta: number;
  locationName: string;
  /** Set when a damage or shortage was reported on a container: the host refreshes its Schade/tekort list. */
  containerId: number | null;
  /** The product as the server returned it, when the call returns one (not for a container report). */
  product: Product | null;
}

/**
 * Voorraad boeken: the one sheet for every stock booking by hand (a recount,
 * damaged or short pieces, a demo, a move between locations), with the
 * effect shown before anything is saved and an explicit button. Used by the
 * product page (desk and phone), the Voorraad page and the editor; each
 * hosts it at page level. The words, the preview and the readiness come
 * from stock-booking.ts. No styles array: styles/products/_booking.scss.
 */
@Component({
  selector: 'app-stock-booking-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  /* The area partial, loaded with the screens that book stock; scoped under the host element. */
  styleUrl: '../../../styles/products/_booking.scss',
  encapsulation: ViewEncapsulation.None,
  imports: [Sheet, Segmented],
  template: `
    <app-sheet title="Voorraad boeken" [variant]="desktop.active() ? 'default' : 'ios'" (closed)="closed.emit()">
      <div body class="bk">
        <p class="bk-sub">{{ product().name }}@if (product().colour) { · {{ product().colour }}}</p>
        <app-segmented class="bk-kinds" [class.ios-seg--stacked]="!desktop.active()" [variant]="desktop.active() ? 'desk' : 'ios'"
                       label="Wat boek je?" [options]="kindOptions()" [value]="draft().kind" (changed)="setKind($any($event))" />
        <p class="bk-help">{{ help() }}</p>

        <div class="bk-fields">
          @if (levels().length > 1) {
            <label class="bk-field">
              <span class="bk-field__label">{{ draft().kind === 'TRANSFER' ? 'Van' : 'Locatie' }}</span>
              <select class="select bk-field__control" [value]="draft().locationId ?? ''" (change)="setLocation($any($event.target).value)">
                @for (level of levels(); track level.locationId) {
                  <option [value]="level.locationId" [selected]="level.locationId === draft().locationId">{{ level.name }} ({{ count(level.quantity) }})</option>
                }
              </select>
            </label>
            @if (draft().kind === 'TRANSFER') {
              <label class="bk-field">
                <span class="bk-field__label">Naar</span>
                <select class="select bk-field__control" (change)="setTarget($any($event.target).value)">
                  @for (level of levels(); track level.locationId) {
                    @if (level.locationId !== draft().locationId) {
                      <option [value]="level.locationId" [selected]="level.locationId === draft().toLocationId">{{ level.name }} ({{ count(level.quantity) }})</option>
                    }
                  }
                </select>
              </label>
            }
          }
          <label class="bk-field">
            <span class="bk-field__label">{{ draft().kind === 'RECOUNT' ? 'Geteld' : 'Aantal ' + units().plural }}</span>
            <input #quantity class="input bk-field__control bk-qty" type="text" inputmode="numeric" autocomplete="off"
                   [attr.aria-label]="draft().kind === 'RECOUNT' ? 'Geteld' : 'Aantal ' + units().plural"
                   [value]="raw()" (input)="setQuantity($any($event.target).value)" (keydown.enter)="submitFromField($event)" />
          </label>
          @if (needsContainer()) {
            <label class="bk-field bk-field--wide">
              <span class="bk-field__label">Uit welke container?</span>
              <select class="select bk-field__control" [disabled]="containersLoading()" (change)="setContainer($any($event.target).value)">
                <option value="" [selected]="draft().containerId === null">Niet aan een container gekoppeld</option>
                @if (!containersLoading()) {
                  @for (container of containers(); track container.id) {
                    <option [value]="container.id" [selected]="draft().containerId === container.id">{{ optionLabel(container) }}</option>
                  }
                }
              </select>
              <small class="bk-hint">{{ draft().containerId === null
                ? 'Gekoppeld komt de melding in het dossier van die container en als waarschuwing op de volgende leveranciersorder.'
                : 'De melding komt in het dossier van deze container en op de volgende leveranciersorder van dit product.' }}</small>
            </label>
          }
          <label class="bk-field bk-field--wide">
            <span class="bk-field__label">Notitie <span class="opt"></span></span>
            <input class="input bk-field__control" type="text" [placeholder]="notePlaceholder()" [value]="draft().note"
                   (input)="setNote($any($event.target).value)" />
          </label>
        </div>

        @if (preview(); as view) {
          <div class="bk-preview" [class.is-short]="view.state === 'short'" [class.is-same]="view.state === 'same'" aria-live="polite">
            @switch (view.state) {
              @case ('short') { <span>Meer dan er ligt op {{ view.location }} ({{ count(view.before) }})</span> }
              @case ('same') { <span>{{ view.location }} blijft op {{ count(view.before) }}</span> }
              @case ('move') {
                <span>{{ view.location }}: {{ count(view.before) }} → <b>{{ count(view.after) }}</b> · {{ view.to!.location }}: {{ count(view.to!.before) }} → <b>{{ count(view.to!.after) }}</b></span>
              }
              @default {
                <span>{{ view.location }}: {{ count(view.before) }} → <b>{{ count(view.after) }}</b></span>
                <em [class.plus]="view.delta > 0">{{ view.delta > 0 ? '+' : '' }}{{ count(view.delta) }}</em>
              }
            }
          </div>
        }
      </div>
      <div foot style="display:contents">
        @if (desktop.active()) {
          <span class="spacer"></span>
          <button class="btn" type="button" (click)="closed.emit()">Annuleren</button>
          <button class="btn btn--primary" type="button" [disabled]="busy() || !ready()" (click)="submit()">{{ busy() ? 'Bezig…' : primaryLabel() }}</button>
        } @else {
          <button class="ios-capsule ios-capsule--accent ios-capsule--block bk-submit" type="button" [disabled]="busy() || !ready()" (click)="submit()">
            {{ busy() ? 'Bezig…' : primaryLabel() }}
          </button>
        }
      </div>
    </app-sheet>
  `,
})
export class StockBookingSheet {
  readonly product = input.required<Product>();
  readonly levels = input.required<BookingLevel[]>();
  /** The product page passes its own list; without it the sheet asks once, only for damage or shortage. */
  readonly containersIn = input<ReceivedContainer[] | undefined>(undefined, { alias: 'containers' });
  readonly kind = input<BookingKind>('RECOUNT');
  readonly locationId = input<number | null>(null);
  readonly booked = output<StockBooked>();
  readonly closed = output<void>();

  readonly desktop = inject(DesktopViewport);
  private readonly catalog = inject(CatalogApi);
  private readonly sourcing = inject(SourcingApi);
  private readonly ui = inject(Ui);
  private readonly quantityField = viewChild<ElementRef<HTMLInputElement>>('quantity');

  readonly draft = signal<BookingDraft>({ kind: 'RECOUNT', locationId: null, toLocationId: null, quantity: null, note: '', containerId: null });
  /** The text in the count field; the draft holds what it means. */
  readonly raw = signal('');
  readonly busy = signal(false);
  private readonly loadedContainers = signal<ReceivedContainer[] | null>(null);
  readonly containersLoading = signal(false);
  private containersAsked = false;

  readonly units = computed(() => productSalesUnit(this.product()));
  readonly kindOptions = computed<SegmentOption[]>(() =>
    bookingKinds(this.levels().length).map((option) => ({ id: option.kind, label: option.label, icon: option.icon })));
  readonly help = computed(() => bookingHelp(this.draft().kind, this.units().plural));
  readonly notePlaceholder = computed(() => bookingNotePlaceholder(this.draft().kind));
  readonly primaryLabel = computed(() => bookingLabel(this.draft().kind));
  readonly needsContainer = computed(() => bookingNeedsContainer(this.draft().kind));
  readonly containers = computed(() => this.containersIn() ?? this.loadedContainers() ?? []);
  readonly preview = computed(() => bookingPreview(this.draft(), this.levels(), this.product().stockQuantity ?? 0));
  readonly ready = computed(() => bookingReady(this.draft(), this.levels(), this.product().stockQuantity ?? 0));
  readonly optionLabel = containerOptionLabel;

  constructor() {
    /* The sheet opens on what the host asked: the kind and, for a location row, that location. */
    effect(() => {
      const draft = newBookingDraft(this.kind(), this.levels(), this.locationId());
      untracked(() => {
        this.draft.set(draft);
        this.raw.set(draft.quantity === null ? '' : String(draft.quantity));
      });
    });
    /* Damage and shortage can point at a container: without the host's list, ask once. */
    effect(() => {
      if (this.needsContainer() && this.containersIn() === undefined) untracked(() => void this.loadContainers());
    });
    afterNextRender(() => {
      if (this.desktop.active()) this.quantityField()?.nativeElement.select();
    });
  }

  private async loadContainers(): Promise<void> {
    const id = this.product().id;
    if (this.containersAsked || id === null) return;
    this.containersAsked = true;
    this.containersLoading.set(true);
    try {
      this.loadedContainers.set(receivedContainersFor(await this.sourcing.purchaseOrders(), id));
    } catch {
      /* Soft: the report simply stays unlinked, as before. */
      this.loadedContainers.set([]);
    } finally {
      this.containersLoading.set(false);
    }
  }

  count(value: number): string {
    return value.toLocaleString('nl-BE');
  }

  setKind(kind: BookingKind): void {
    const next = switchBookingKind(this.draft(), kind, this.levels());
    this.draft.set(next);
    if (next.kind === 'RECOUNT' || this.draft().quantity === null) this.raw.set(next.quantity === null ? '' : String(next.quantity));
  }

  setLocation(raw: string): void {
    const locationId = Number(raw);
    if (!Number.isFinite(locationId)) return;
    const level = this.levels().find((item) => item.locationId === locationId);
    this.draft.update((draft) => {
      const next = { ...draft, locationId };
      if (draft.kind === 'RECOUNT') next.quantity = level?.quantity ?? null;
      if (draft.kind === 'TRANSFER' && draft.toLocationId === locationId) {
        next.toLocationId = this.levels().find((item) => item.locationId !== locationId)?.locationId ?? null;
      }
      return next;
    });
    if (this.draft().kind === 'RECOUNT') this.raw.set(level ? String(level.quantity) : '');
  }

  setTarget(raw: string): void {
    const toLocationId = Number(raw);
    if (Number.isFinite(toLocationId)) this.draft.update((draft) => ({ ...draft, toLocationId }));
  }

  setQuantity(raw: string): void {
    this.raw.set(raw);
    this.draft.update((draft) => ({ ...draft, quantity: parseCount(raw) }));
  }

  setContainer(raw: string): void {
    const id = raw === '' ? null : Number(raw);
    this.draft.update((draft) => ({ ...draft, containerId: id === null || Number.isNaN(id) ? null : id }));
  }

  setNote(note: string): void {
    this.draft.update((draft) => ({ ...draft, note }));
  }

  submitFromField(event: Event): void {
    event.preventDefault();
    if (this.ready()) void this.submit();
  }

  async submit(): Promise<void> {
    const product = this.product();
    const draft = this.draft();
    const preview = this.preview();
    if (product.id === null || this.busy() || !this.ready() || !preview || draft.quantity === null) return;
    const quantity = draft.quantity;
    const note = draft.note.trim() || null;
    const container = this.needsContainer() ? this.containers().find((item) => item.id === draft.containerId) ?? null : null;
    this.busy.set(true);
    try {
      let saved: Product | null = null;
      switch (draft.kind) {
        case 'RECOUNT':
          saved = await this.catalog.setStock(product.id, quantity, draft.locationId, note);
          break;
        case 'TRANSFER':
          saved = await this.catalog.transferStock(product.id, draft.locationId!, draft.toLocationId!, quantity, note);
          break;
        case 'DAMAGED':
        case 'SHORTAGE':
          if (container) {
            await this.sourcing.reportAfterReceipt(container.id, { productId: product.id, locationId: draft.locationId, quantity, kind: draft.kind, note });
          } else {
            saved = await this.catalog.takeOutStock(product.id, { locationId: draft.locationId, quantity, kind: draft.kind, note });
          }
          break;
        default:
          saved = await this.catalog.takeOutStock(product.id, { locationId: draft.locationId, quantity, kind: 'DEMO', note });
      }
      this.ui.toast(bookingToast({
        kind: draft.kind, delta: preview.delta, quantity, location: preview.location, container: container?.name ?? null,
        toLocation: preview.to?.location ?? null, unit: this.units(),
      }));
      this.booked.emit({ kind: draft.kind, delta: preview.delta, locationName: preview.location, containerId: container?.id ?? null, product: saved });
    } catch (failure: unknown) {
      /* The sheet stays open with what was typed. */
      this.ui.toast(messageOf(failure, 'Boeken mislukt'), 'err');
    } finally {
      this.busy.set(false);
    }
  }
}
