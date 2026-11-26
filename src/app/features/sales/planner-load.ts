import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { LoadMode, PalletProfile } from '../../core/api/models';
import { Segmented, type SegmentOption } from '../../shared/segmented';
import { ORDER_LOAD_CHOICES } from './pallet-calculator-model';
import { PalletStepper } from './pallet-glyph';

const MODES: SegmentOption[] = [{ id: 'PALLETS', label: 'Op pallets' }, { id: 'LOOSE_CARTONS', label: 'Losse dozen' }];
/** An order on the Deense kar travels "Op karren". */
const KAR_MODES: SegmentOption[] = [{ id: 'PALLETS', label: 'Op karren' }, MODES[1]];
/**
 * Palletberekening's labels for the three pallet types, then the Deense kar (2026-11-25). Four
 * "Euro 120×80" segments do not fit a 375 px phone: there the size stands under the short name
 * ("Euro" over "120×80"); the desk aside is too narrow for the sizes, which the hero reads out anyway.
 */
const PROFILES: SegmentOption[] = ORDER_LOAD_CHOICES.map((choice) =>
  ({ id: choice.id, label: choice.short, sub: choice.size.replace(/ /g, ''), ariaLabel: `${choice.label} ${choice.size} cm` }));
const PROFILES_SHORT: SegmentOption[] = ORDER_LOAD_CHOICES.map((choice) =>
  ({ id: choice.id, label: choice.short, ariaLabel: `${choice.label} ${choice.size} cm` }));

/**
 * How the order travels: on pallets (or karren) or as loose cartons, which
 * pallet type or the Deense kar, how high it may be loaded and how far an
 * omdoos may stick out past the floor (Spill). The phone
 * shows it in the Lading sheet, the desk in the planner's aside. The planner
 * decides what a choice changes.
 */
@Component({
  selector: 'app-planner-load',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PalletStepper, Segmented],
  template: `
    <div class="ld" [class.ld--desk]="desk()">
      <p class="ld-label" id="ld-mode">Verzending</p>
      <app-segmented label="Verzending" [variant]="desk() ? 'desk' : 'ios'" [options]="modes()" [value]="mode()" (changed)="modeChange.emit($any($event))" />
      @if (mode() === 'PALLETS') {
        <p class="ld-label">Pallettype</p>
        <app-segmented label="Pallettype" [variant]="desk() ? 'desk' : 'ios'" [options]="profiles()" [value]="profile()" (changed)="profileChange.emit($any($event))" />
        <div class="ld-row">
          <span class="ld-label" id="ld-height">Max. hoogte</span>
          <!-- A new stepper per fieldKey: a typed height the planner did not take leaves no number behind in the field. -->
          @for (key of [fieldKey()]; track key) {
            <app-pallet-stepper [size]="desk() ? 'md' : 'lg'" [value]="heightCm()" [step]="10" [min]="minCm()" [max]="maxCm()" [allowEmpty]="overridden()"
                                [disabled]="!canEdit()" label="Max. hoogte in cm" lessLabel="10 cm lager" moreLabel="10 cm hoger"
                                (changed)="heightChange.emit($event)" />
          }
          <span class="ld-unit">cm</span>
          @if (overridden() && canEdit()) { <button class="ld-reset" type="button" (click)="heightChange.emit(null)">Standaard</button> }
        </div>
        <p class="ld-note">incl. {{ kar() ? 'kar' : 'pallet' }} {{ baseText() }} cm</p>
        @if (spillShown()) {
          <div class="ld-row">
            <span class="ld-label" id="ld-spill">Spill</span>
            <app-pallet-stepper [size]="desk() ? 'md' : 'lg'" [value]="spillCm()" [step]="1" [min]="0" [max]="spillMaxCm()" [allowEmpty]="spillOverridden()"
                                [disabled]="!canEdit()" [label]="'Spill in ' + spillUnit()" lessLabel="1 cm minder" moreLabel="1 cm meer"
                                (changed)="spillChange.emit($event)" />
            <span class="ld-unit">{{ spillUnit() }}</span>
            @if (spillOverridden() && canEdit()) { <button class="ld-reset" type="button" (click)="spillChange.emit(null)">Standaard</button> }
          </div>
          @if (spillNote(); as note) { <p class="ld-note">{{ note }}</p> }
        }
      } @else if (layoutNote(); as note) {
        <p class="ld-note">{{ note }}</p>
      }
    </div>
  `,
  styles: [`
    .ld{display:grid;gap:8px;min-width:0}
    .ld app-segmented{min-width:0}
    .ld-label{color:var(--muted);font-size:13px;font-weight:600;letter-spacing:.02em;text-transform:uppercase}
    .ld-label:not(:first-child){margin-top:10px}
    .ld-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px;margin-top:10px}
    .ld-row .ld-label{flex:1 0 100%;margin:0}
    .ld-unit,.ld-note{color:var(--muted);font-size:13px}
    .ld-reset{min-height:44px;margin-left:auto;padding:0 4px;border:0;background:none;color:var(--rose);font-size:15px;cursor:pointer}
    .ld--desk{gap:6px}
    .ld--desk .ld-label{font-size:12px;font-weight:650;letter-spacing:0;text-transform:none;color:var(--ink-2)}
    .ld--desk .ld-label:not(:first-child){margin-top:6px}
    .ld--desk app-segmented{width:100%}
    .ld--desk .ld-row{margin-top:6px}.ld--desk .ld-row .ld-label{flex:1 1 auto}
    .ld--desk .ld-reset{min-height:30px;margin:0;font-size:12px;font-weight:650}
    .ld--desk .ld-unit,.ld--desk .ld-note{font-size:12px}
  `],
})
export class PlannerLoad {
  readonly mode = input.required<LoadMode>();
  readonly profile = input.required<PalletProfile>();
  readonly heightCm = input.required<number>();
  /** The highest height the stepper offers: 260 for a europallet, else 300 (the kar too). A higher stored one shows as it is. */
  readonly maxCm = input(300);
  /** The lowest: just above the base, 16 cm on a pallet, 18 on the kar. */
  readonly minCm = input(16);
  /** The order goes on the Deense kar: "Op karren", "incl. kar 16,5 cm". */
  readonly kar = input(false);
  /** Raised by the planner when it did not take a height from the field: the field then shows the height that stays. */
  readonly fieldKey = input(0);
  readonly overridden = input(false);
  /**
   * The Spill row (2026-11-26): how far an omdoos may stick out past the floor, cm per side, under the height. Shown
   * only when the server counts with a spill and says so (the planner decides); "Standaard" while spillOverridden.
   * spillCm is the document's stored pick, not the spill the figures were counted with (see spillNote). The unit
   * says where it counts: "cm per kant", on the kar "cm per lange zijde" (spillUnit).
   */
  readonly spillShown = input(false);
  readonly spillCm = input(0);
  readonly spillMaxCm = input(5);
  readonly spillOverridden = input(false);
  /** Why the picked spill does not count on this document ("Telt hier zonder spill: dat scheelt een pallet."); null: it counts. */
  readonly spillNote = input<string | null>(null);
  readonly baseCm = input(14.4);
  readonly canEdit = input(true);
  readonly desk = input(false);
  /** In loose mode with a hand layout: whether it comes back with the pallets. */
  readonly layoutNote = input<string | null>(null);

  readonly modeChange = output<LoadMode>();
  readonly profileChange = output<PalletProfile>();
  readonly heightChange = output<number | null>();
  /** A picked spill in cm; null: back to the standard. */
  readonly spillChange = output<number | null>();

  readonly modes = computed(() => (this.kar() ? KAR_MODES : MODES).map((option) => ({ ...option, disabled: !this.canEdit() })));
  readonly profiles = computed(() => (this.desk() ? PROFILES_SHORT : PROFILES).map((option) => ({ ...option, disabled: !this.canEdit() })));
  readonly baseText = computed(() => this.baseCm().toLocaleString('nl-BE', { maximumFractionDigits: 1 }));
  /**
   * The Spill row's unit, and what a screen reader hears of the stepper. On the Deense kar an omdoos sticks out
   * across the open long sides only: one wording wherever a kar's spill is set (Palletberekening says the same).
   */
  readonly spillUnit = computed(() => (this.kar() ? 'cm per lange zijde' : 'cm per kant'));
}
