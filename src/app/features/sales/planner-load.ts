import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { LoadMode, PalletProfile } from '../../core/api/models';
import { Segmented, type SegmentOption } from '../../shared/segmented';
import { PALLET_CHOICES } from './pallet-calculator-model';
import { PalletStepper } from './pallet-glyph';

const MODES: SegmentOption[] = [{ id: 'PALLETS', label: 'Op pallets' }, { id: 'LOOSE_CARTONS', label: 'Losse dozen' }];
/** Palletberekening's labels; the desk aside is too narrow for the sizes, which the hero reads out anyway. */
const PROFILES: SegmentOption[] = PALLET_CHOICES.map((choice) =>
  ({ id: choice.id, label: `${choice.short} ${choice.size.replace(/ /g, '')}`, ariaLabel: `${choice.label} ${choice.size} cm` }));
const PROFILES_SHORT: SegmentOption[] = PALLET_CHOICES.map((choice) =>
  ({ id: choice.id, label: choice.short, ariaLabel: `${choice.label} ${choice.size} cm` }));

/**
 * How the order travels: on pallets or as loose cartons, which pallet, and
 * how high it may be loaded. The phone shows it in the Lading sheet, the
 * desk in the planner's aside. The planner decides what a choice changes.
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
          <app-pallet-stepper [size]="desk() ? 'md' : 'lg'" [value]="heightCm()" [step]="10" [min]="16" [max]="maxCm()" [allowEmpty]="overridden()"
                              [disabled]="!canEdit()" label="Max. hoogte in cm" lessLabel="10 cm lager" moreLabel="10 cm hoger"
                              (changed)="heightChange.emit($event)" />
          <span class="ld-unit">cm</span>
          @if (overridden() && canEdit()) { <button class="ld-reset" type="button" (click)="heightChange.emit(null)">Standaard</button> }
        </div>
        <p class="ld-note">incl. pallet {{ baseText() }} cm</p>
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
  /** The highest height the stepper offers: 260 for a europallet, else 300. A higher stored one shows as it is. */
  readonly maxCm = input(300);
  readonly overridden = input(false);
  readonly baseCm = input(14.4);
  readonly canEdit = input(true);
  readonly desk = input(false);
  /** In loose mode with a hand layout: whether it comes back with the pallets. */
  readonly layoutNote = input<string | null>(null);

  readonly modeChange = output<LoadMode>();
  readonly profileChange = output<PalletProfile>();
  readonly heightChange = output<number | null>();

  readonly modes = computed(() => MODES.map((option) => ({ ...option, disabled: !this.canEdit() })));
  readonly profiles = computed(() => (this.desk() ? PROFILES_SHORT : PROFILES).map((option) => ({ ...option, disabled: !this.canEdit() })));
  readonly baseText = computed(() => this.baseCm().toLocaleString('nl-BE', { maximumFractionDigits: 1 }));
}
