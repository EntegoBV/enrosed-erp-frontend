import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { PalletStepper } from '../sales/pallet-glyph';
import {
  CATALOG_LOAD_BOUNDS, CATALOG_LOAD_STANDARD, boundedLoadValue, catalogLoadChanged, catalogLoadSummary,
  type CatalogLoad, type CatalogLoadKey,
} from './catalog-load';

/** The example under the fields: one selected product as the PDF names it, with its figures on the picked load. */
export interface CatalogLoadExample {
  name: string;
  /** Pieces per pallet and per kar in the staff format (nl-BE: the line is a Dutch sentence); null where nothing fits (the PDF's "-"). */
  perPallet: string | null;
  perKar: string | null;
}

interface LoadField {
  key: CatalogLoadKey;
  label: string;
  hint: string;
  /** A second part of the hint: after a dot on a wide card, on a line of its own on a phone. */
  also?: string;
  /** For a screen reader: the field, and what − and + do. */
  aria: string;
  less: string;
  more: string;
  min: number;
  max: number;
  step: number;
}

/**
 * The studio's card "Laadhoogte en spill" (Emre, 2026-11-26: some customers have other standard heights and
 * want another overview): the europallet's and the Deense kar's loading height and the spill this PDF counts
 * with, in both modes. Collapsed like "Volgorde in PDF" above it; its line always says the three values and is
 * tinted while one differs from the standard, so a deviation is seen before the download. The example line is
 * the live feedback where the preview shows no figures (Handelscatalogus) or has scrolled away (a phone).
 * The card only draws and reports: the studio keeps the pick. Its styles live here because the studio's own
 * stylesheet is at its 16 kB budget.
 */
@Component({
  selector: 'app-catalog-load-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PalletStepper],
  template: `
    <details class="load" [class.load--set]="changed()" [class.load--desk]="desk()">
      <summary>
        <span><b>Laadhoogte en spill</b><small>{{ summary() }}</small></span>
        <i aria-hidden="true">+</i>
      </summary>
      <div class="load__body">
        <div class="load__fields">
          @for (field of fields; track field.key) {
            <div class="load__field">
              <b>{{ field.label }}</b>
              <span class="load__input">
                <app-pallet-stepper [size]="desk() ? 'md' : 'lg'" [value]="settings()[field.key]" [min]="field.min" [max]="field.max"
                                    [step]="field.step" [disabled]="disabled()" [label]="field.aria" [lessLabel]="field.less"
                                    [moreLabel]="field.more" (changed)="pick(field.key, $event)" />
                <span>cm</span>
              </span>
              <small>{{ field.hint }}@if (field.also) {<i aria-hidden="true"> · </i><span>{{ field.also }}</span>}</small>
            </div>
          }
        </div>
        @if (example() || changed()) {
          <div class="load__foot">
            @if (example(); as example) {
              <!-- One line on a wide card, two on a phone; a long name ends in an ellipsis and never pushes the figures away. -->
              <p class="load__example" [attr.title]="example.name">
                <span class="load__name">Bijv. {{ example.name }}</span>
                <span class="load__figures">{{ example.perPallet ?? '–' }} per pallet · {{ example.perKar ?? '–' }} per kar</span>
              </p>
            }
            @if (changed()) { <button class="load__reset" type="button" [disabled]="disabled()" aria-label="Laadhoogte en spill terug op standaard" (click)="reset()">Standaard</button> }
          </div>
        }
      </div>
    </details>
  `,
  styles: `
    :host { display: block; min-width: 0; container-type: inline-size; }
    .load { border: 1px solid var(--line); border-radius: 18px; background: var(--surface); overflow: hidden; }
    .load > summary { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 18px 22px; min-height: 72px; cursor: pointer; list-style: none; }
    .load > summary::-webkit-details-marker { display: none; }
    .load > summary > span { display: grid; min-width: 0; gap: 5px; }
    .load > summary b { font-size: 15px; }
    .load > summary small { color: var(--muted); font-size: 12px; line-height: 1.4; }
    .load--set > summary small { color: var(--rose-dark); font-weight: 650; }
    .load > summary i { color: var(--muted); font-size: 24px; font-style: normal; }
    .load[open] > summary i { transform: rotate(45deg); }
    .load__body { display: grid; min-width: 0; gap: 14px; padding: 0 22px 18px; }
    .load__fields { display: grid; min-width: 0; gap: 12px; }
    .load__field { display: grid; grid-template: 'label input' auto 'hint input' auto / minmax(0, 1fr) auto; align-items: center; gap: 1px 12px; min-width: 0; }
    .load__field > b { grid-area: label; align-self: end; font-size: 14px; }
    .load__field > small { grid-area: hint; align-self: start; color: var(--muted); font-size: 12px; line-height: 1.4; }
    /* Narrow: the hint's second part on its own line, so it never breaks in the middle of its words. */
    .load__field > small > i { display: none; }
    .load__field > small > span { display: block; }
    .load__input { grid-area: input; display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 13px; }
    .load__foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px 14px; min-width: 0; padding-top: 12px; border-top: 1px solid var(--line); }
    .load__example { display: grid; flex: 1 1 200px; min-width: 0; gap: 2px; margin: 0; color: var(--muted); font-size: 12px; line-height: 1.5; }
    .load__name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .load__figures { color: var(--ink-2); font-weight: 650; font-variant-numeric: tabular-nums; }
    .load__reset { flex: none; min-height: 44px; margin-left: auto; padding: 0 4px; border: 0; background: none; color: var(--rose); font: inherit; font-size: 15px; cursor: pointer; }
    .load__reset:disabled { opacity: .45; cursor: default; }
    .load--desk .load__reset { min-height: 30px; font-size: 12px; font-weight: 650; }
    /* A wide card says a hint and the example on one line each; the example's name gives way, the figures never do. */
    @container (min-width: 520px) {
      .load__field > small > i, .load__field > small > span { display: inline; font-style: normal; }
      .load__example { display: flex; align-items: baseline; gap: 5px; }
      .load__name { flex: 0 1 auto; }
      .load__figures { flex: none; white-space: nowrap; }
      .load__figures::before { content: '· '; color: var(--muted); font-weight: 400; }
    }
    /* The inset of "Volgorde in PDF" above it, so the two cards line up on a phone. */
    @media (max-width: 520px) {
      .load > summary, .load__body { padding-inline: 16px; }
    }
  `,
})
export class CatalogLoadSettings {
  readonly settings = input.required<CatalogLoad>();
  readonly example = input<CatalogLoadExample | null>(null);
  /** The desk takes the small stepper, a phone the 44 px one. */
  readonly desk = input(false);
  readonly disabled = input(false);
  readonly settingsChange = output<CatalogLoad>();

  readonly summary = computed(() => catalogLoadSummary(this.settings()));
  readonly changed = computed(() => catalogLoadChanged(this.settings()));

  /* The hints say what the number holds: a height is the loaded height with the pallet's wood or the kar's base;
     the spill counts per side, and on the kar only across the open long sides (Emre, 2026-11-26). */
  readonly fields: readonly LoadField[] = [
    { key: 'palletHeightCm', label: 'Pallet', hint: 'incl. pallet', aria: 'Hoogte pallet in cm', less: '10 cm lager', more: '10 cm hoger', ...CATALOG_LOAD_BOUNDS.palletHeightCm },
    { key: 'karHeightCm', label: 'Deense kar', hint: 'incl. kar', aria: 'Hoogte Deense kar in cm', less: '10 cm lager', more: '10 cm hoger', ...CATALOG_LOAD_BOUNDS.karHeightCm },
    { key: 'spillCm', label: 'Spill', hint: 'per kant', also: 'kar: alleen lange zijden', aria: 'Spill in cm per kant', less: '1 cm minder', more: '1 cm meer', ...CATALOG_LOAD_BOUNDS.spillCm },
  ];

  /**
   * A stepped or typed value. The stepper already reports whole numbers within the bounds (a typed 999 comes back
   * as 260) and never an emptied field here; the bounds are applied once more so nothing else can reach the request.
   */
  pick(key: CatalogLoadKey, value: number | null): void {
    if (this.disabled() || value === null) return;
    const next = boundedLoadValue(key, value);
    if (next !== this.settings()[key]) this.settingsChange.emit({ ...this.settings(), [key]: next });
  }

  /** "Standaard": all three back at once. */
  reset(): void {
    if (!this.disabled()) this.settingsChange.emit({ ...CATALOG_LOAD_STANDARD });
  }
}
