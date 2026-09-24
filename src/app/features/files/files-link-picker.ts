import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { MediaTargetType } from '../../core/api/media-models';
import { DocumentKind } from '../../core/api/models';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { Icon } from '../../shared/icon';
import { Segmented, SegmentOption } from '../../shared/segmented';
import { Skeleton } from '../../shared/skeleton';
import { Sheet } from '../../shared/ui';
import { FilesController, TargetOption } from './files-controller';

/** What a link does, said before it is made. */
const EFFECTS: Record<MediaTargetType, string> = {
  PRODUCT: 'Verschijnt bij het product onder Bestanden.',
  PRODUCT_FAMILY: 'Groepeert het bestand bij deze reeks. Websitefoto’s voeg je toe in Website › Producten.',
  COMPANY_COST: 'Verschijnt bij de kost in Kosten & bank.',
  PURCHASE_ORDER: 'Komt bij de documenten van de inkooporder, net als via het dossier; de koppeling verschijnt hier binnen een minuut.',
  PLANNER_ITEM: 'Alleen zichtbaar in Documenten & media; bijlagen voor de planner voeg je in de planner toe.',
};

/** The dossier's own document kinds; payment proofs belong to a payment in the dossier. */
const DOCUMENT_KINDS: readonly { value: DocumentKind; label: string }[] = [
  { value: 'COMMERCIAL_INVOICE', label: 'Commercial invoice' },
  { value: 'PACKING_LIST', label: 'Packing list' },
  { value: 'BILL_OF_LADING', label: 'Bill of lading' },
  { value: 'CUSTOMS', label: 'Douanedocument' },
  { value: 'OTHER', label: 'Andere' },
];

/**
 * "Koppelen aan…": one record of five kinds, found by typing. The role is
 * always Intern; the old role pills had no visible effect. Linking to a
 * purchase order adds the bytes to the dossier (see FilesController.applyLink).
 */
@Component({
  selector: 'app-files-link-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet, Segmented, Skeleton, Icon],
  template: `
    @if (c.linkPicker(); as state) {
      <app-sheet [title]="'Koppelen aan…' + (state.count > 1 ? ' (' + state.count + ' bestanden)' : '')" variant="ios" (closed)="cancel()">
        <div body class="files-picker">
          <app-segmented label="Soort record" [variant]="desktop.active() ? 'desk' : 'ios'" [options]="types"
                         [value]="type()" (changed)="setType($event)" />
          <p class="files-picker__effect">{{ effectText() }}</p>
          <label class="files-picker__filter">
            <app-icon name="search" [size]="16" />
            <input type="search" placeholder="Zoek…" autocomplete="off" aria-label="Zoek een record" [value]="filter()" (input)="filter.set(value($event))" />
          </label>
          <div class="files-picker__list" role="listbox" aria-label="Records">
            @if (c.targetsLoading() === type() && !options().length) {
              <app-skeleton kind="list" [rows]="4" />
            } @else if (c.targetsFailed() === type() && !options().length) {
              <p class="files-muted files-picker__empty">Niet geladen · <button class="wk-link" type="button" (click)="c.loadTargets(type())">Opnieuw proberen</button></p>
            } @else {
              @for (option of visible(); track option.id) {
                <button class="files-picker__row" type="button" role="option" [attr.aria-selected]="chosen()?.id === option.id" (click)="chosen.set(option)">
                  <span class="files-picker__name">{{ option.label }}</span>
                  @if (option.meta) { <small>{{ option.meta }}</small> }
                </button>
              } @empty {
                <p class="files-muted files-picker__empty">{{ filter() ? 'Niets gevonden voor “' + filter() + '”.' : 'Nog niets om aan te koppelen.' }}</p>
              }
              @if (matches().length > visible().length) { <p class="files-muted files-picker__empty">De eerste 50 van {{ matches().length }}; typ om te verfijnen.</p> }
            }
          </div>
          @if (type() === 'PURCHASE_ORDER') {
            <label class="field files-picker__kind"><span>Soort document</span>
              <select class="select" (change)="kind.set($any($event.target).value)">
                @for (option of kinds; track option.value) { <option [value]="option.value" [selected]="option.value === kind()">{{ option.label }}</option> }
              </select>
            </label>
            <p class="files-muted">Betalingsbewijzen zet je bij de betaling in het inkoopdossier.</p>
          }
        </div>
        <div foot style="display:contents">
          <span class="spacer"></span>
          @if (desktop.active()) { <button class="btn" type="button" (click)="cancel()">Annuleren</button> }
          <button class="btn btn--primary" type="button" [disabled]="!chosen()" (click)="confirm()">Koppelen</button>
        </div>
      </app-sheet>
    }
  `,
})
export class FilesLinkPicker {
  readonly c = inject(FilesController);
  readonly desktop = inject(DesktopViewport);

  readonly types: SegmentOption[] = [
    { id: 'PRODUCT', label: 'Product' },
    { id: 'PRODUCT_FAMILY', label: 'Reeks' },
    { id: 'COMPANY_COST', label: 'Kost' },
    { id: 'PURCHASE_ORDER', label: 'Inkooporder', shortLabel: 'Inkoop' },
    { id: 'PLANNER_ITEM', label: 'Planner' },
  ];
  readonly kinds = DOCUMENT_KINDS;

  readonly type = signal<MediaTargetType>(this.c.linkPicker()?.type ?? 'PRODUCT');
  readonly filter = signal('');
  readonly chosen = signal<TargetOption | null>(null);
  readonly kind = signal<DocumentKind>('OTHER');

  readonly effectText = computed(() => EFFECTS[this.type()]);
  readonly options = computed(() => this.c.targetOptions()[this.type()] ?? []);
  readonly matches = computed(() => {
    const words = this.filter().trim().toLocaleLowerCase('nl').split(/\s+/).filter(Boolean);
    if (!words.length) return this.options();
    return this.options().filter((option) => {
      const text = `${option.label} ${option.meta}`.toLocaleLowerCase('nl');
      return words.every((word) => text.includes(word));
    });
  });
  readonly visible = computed(() => this.matches().slice(0, 50));

  constructor() {
    effect(() => {
      const type = this.type();
      untracked(() => void this.c.loadTargets(type));
    });
  }

  value(event: Event): string { return (event.target as HTMLInputElement).value; }

  setType(id: string): void {
    this.type.set(id as MediaTargetType);
    this.chosen.set(null);
    this.filter.set('');
  }

  confirm(): void {
    const state = this.c.linkPicker();
    const chosen = this.chosen();
    if (!state || !chosen) return;
    this.c.linkPicker.set(null);
    state.onPick({
      targetType: this.type(), targetId: chosen.id, label: chosen.label,
      documentKind: this.type() === 'PURCHASE_ORDER' ? this.kind() : null,
    });
  }

  cancel(): void {
    const state = this.c.linkPicker();
    this.c.linkPicker.set(null);
    state?.onCancel?.();
  }
}
