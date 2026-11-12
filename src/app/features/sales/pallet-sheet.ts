import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { AuthImage } from '../../core/api/auth-image';
import { Icon } from '../../shared/icon';
import { NumPipe } from '../../shared/pipes';
import { Sheet } from '../../shared/ui';
import { PalletGlyph, PalletStepper } from './pallet-glyph';
import { PALLET_TYPES, normalizeManualPalletType } from './pallet-stack';
import { palletPill } from './planner-pallet';
import type { PalletPart, PalletVm, Placement, PlannerLine, PlannerSpec } from './shipping-planner-model';
import type { ShippingPalletAction } from './shipping-planner';

/**
 * One hand-built pallet in its own sheet: what is on it, what can still go
 * on, its name, type and measured height, and moving or removing it. The
 * phone opens it from a row; the desk from "Soort en hoogte…" in a card's
 * menu. Removing and moving are the planner's (undo, the sheet follows).
 */
@Component({
  selector: 'app-pallet-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthImage, Icon, NumPipe, PalletGlyph, PalletStepper, Sheet],
  template: `
    @let p = pallet();
    <app-sheet [title]="p.label" variant="ios" (closed)="closed.emit()">
      <div body class="ps">
        <div class="ps-top">
          <app-pallet-glyph size="lg" [blocks]="p.blocks" [over]="p.over" />
          <div>
            <h3>{{ p.full ? 'vol' : (p.fill * 100 | num) + ' %' }}</h3>
            <p><span [class.is-danger]="p.over">{{ heightText() }}</span>@if (p.weightKg > 0) { · <span [class.is-danger]="p.heavy">{{ p.weightKg | num }} kg</span> }</p>
          </div>
          @if (issue(); as pill) { <span class="badge" [class]="'badge--' + pill.tone">{{ pill.text }}</span> }
        </div>

        <section class="ps-sec" aria-labelledby="ps-on">
          <div class="ps-head"><h4 id="ps-on">Op deze pallet</h4><span>{{ p.cartons | num }}</span></div>
          @if (p.parts.length) {
            <div class="ps-group">
              @for (part of p.parts; track $index) {
                <div class="ps-item" [style.--sp-colour]="part.colour">
                  @if (part.photoUrl) { <img class="ps-thumb" [appAuthSrc]="part.photoUrl" appAuthLazy alt="" /> }
                  @else { <span class="ps-thumb"><app-icon name="products" [size]="18" /></span> }
                  <span class="ps-name">{{ part.name }}</span>
                  <span class="ps-sub" [class.is-danger]="danger(part)">{{ sub(part) }}</span>
                  @if (canEdit()) {
                    <app-pallet-stepper [value]="part.cartons" [max]="part.cartons + remaining(part.productId)"
                                        [plusDisabled]="remaining(part.productId) <= 0" [label]="'Omdozen ' + part.name + ' op ' + p.label"
                                        (changed)="setCartons(part.productId, $event)" />
                  } @else { <b class="ps-count">{{ part.cartons | num }}</b> }
                </div>
              }
            </div>
          } @else {
            <p class="ps-empty">Nog leeg: zet hieronder een product op deze pallet.</p>
          }
        </section>

        @if (canEdit() && addable().length) {
          <section class="ps-sec" aria-labelledby="ps-add">
            <div class="ps-head"><h4 id="ps-add">Erbij zetten</h4></div>
            <div class="ps-group">
              @for (line of addable(); track line.productId) {
                <div class="ps-item ps-item--add" [style.--sp-colour]="line.colour">
                  @if (line.photoUrl) { <img class="ps-thumb" [appAuthSrc]="line.photoUrl" appAuthLazy alt="" /> }
                  @else { <span class="ps-thumb"><app-icon name="products" [size]="18" /></span> }
                  <span class="ps-name">{{ line.name }}</span>
                  <span class="ps-sub">{{ remaining(line.productId) | num }} los</span>
                  <button class="ps-plus" type="button" [attr.aria-label]="line.name + ' erbij zetten'"
                          (click)="act.emit({ type: 'add-item', palletIndex: p.index, productId: line.productId })">
                    <app-icon name="plus" [size]="20" />
                  </button>
                </div>
              }
            </div>
          </section>
        }

        <section class="ps-sec" aria-labelledby="ps-pallet">
          <div class="ps-head"><h4 id="ps-pallet">Pallet</h4></div>
          <div class="ps-group">
            <label class="ps-field"><span>Naam</span>
              <input [value]="p.label" [disabled]="!canEdit()" (change)="rename($event)" (keydown.enter)="blur($event)" /></label>
            <label class="ps-field"><span>Soort</span>
              <select [disabled]="!canEdit()" (change)="setType($event)">
                @for (choice of types; track choice.value) { <option [value]="choice.value" [selected]="choice.value === p.type">{{ choice.label }}</option> }
                @if (customType(); as custom) { <option [value]="custom" selected>{{ custom }}</option> }
              </select></label>
            <label class="ps-field"><span>Gemeten hoogte</span>
              <span class="ps-unit"><input type="text" inputmode="numeric" placeholder="auto" autocomplete="off" [disabled]="!canEdit()"
                     [value]="p.measured && p.heightCm !== null ? p.heightCm : ''" (change)="setHeight($event)" (keydown.enter)="blur($event)" />cm</span></label>
          </div>
          @if (canEdit()) {
            <div class="ps-group ps-duo">
              <button class="ps-action" type="button" [disabled]="p.index === 0" (click)="move.emit(-1)">Naar voren</button>
              <button class="ps-action" type="button" [disabled]="p.index >= count() - 1" (click)="move.emit(1)">Naar achteren</button>
            </div>
            <div class="ps-group"><button class="ps-action ps-action--danger" type="button" (click)="remove.emit(p.index)">Pallet verwijderen</button></div>
          }
        </section>
      </div>
      <div foot style="display:contents"><button class="btn btn--primary" type="button" (click)="closed.emit()">Klaar</button></div>
    </app-sheet>
  `,
  styles: [`
    .ps{display:grid;gap:18px}
    .ps-top{display:grid;grid-template-columns:44px minmax(0,1fr) auto;align-items:end;gap:14px;padding:6px 16px 0}
    .ps-top h3{font-size:22px;font-weight:800;font-variant-numeric:tabular-nums}
    .ps-top p{margin-top:2px;color:var(--muted);font-size:13px;font-variant-numeric:tabular-nums}
    .ps-sec{display:grid;gap:7px;min-width:0}
    .ps-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:0 16px;color:var(--muted);font-size:13px;font-weight:600;font-variant-numeric:tabular-nums}
    .ps-head h4{font-size:13px;font-weight:600;letter-spacing:.02em;text-transform:uppercase}
    .ps-group{overflow:hidden;border-radius:var(--ios-radius,22px);background:var(--surface)}
    .ps-group>*+*{border-top:.5px solid var(--ios-sep)}
    .ps-item{display:grid;grid-template-columns:40px minmax(0,1fr) auto;grid-template-areas:"thumb name name" "thumb sub step";align-items:center;column-gap:12px;row-gap:2px;padding:10px 16px;box-shadow:inset 4px 0 var(--sp-colour)}
    .ps-item--add{grid-template-columns:40px minmax(0,1fr) 44px;grid-template-areas:"thumb name plus" "thumb sub plus"}
    .ps-thumb{grid-area:thumb;align-self:start;display:grid;place-items:center;width:40px;height:40px;border-radius:10px;background:var(--surface-2);color:var(--muted);object-fit:cover}
    .ps-name{grid-area:name;min-width:0;overflow:hidden;font-size:15px;font-weight:600;text-overflow:ellipsis;white-space:nowrap}
    .ps-sub{grid-area:sub;min-width:0;overflow:hidden;color:var(--muted);font-size:13px;text-overflow:ellipsis;white-space:nowrap}
    .ps-item app-pallet-stepper,.ps-count{grid-area:step;justify-self:end}
    .ps-plus{grid-area:plus;display:grid;place-items:center;width:44px;height:44px;padding:0;border:0;border-radius:50%;background:var(--rose);color:#fff;cursor:pointer}
    .is-danger{color:var(--danger);font-weight:650}
    .ps-empty{padding:14px 16px;border-radius:var(--ios-radius,22px);background:var(--surface);color:var(--muted);font-size:14px}
    .ps-field{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:12px;min-height:52px;padding:4px 16px;font-size:16px}
    .ps-field input,.ps-field select{min-width:0;width:100%;height:44px;padding:0;border:0;background:none;color:var(--muted);font-size:16px;text-align:right;text-align-last:right}
    .ps-field :focus{outline:none;color:var(--ink)}
    .ps-unit{display:flex;align-items:center;gap:4px;min-width:0;color:var(--muted)}
    .ps-duo{display:grid;grid-template-columns:1fr 1fr}.ps-duo>*+*{border-top:0;border-left:.5px solid var(--ios-sep)}
    .ps-action{display:flex;align-items:center;justify-content:center;width:100%;min-height:52px;padding:0 12px;border:0;background:var(--surface);color:var(--rose);font-size:16px;cursor:pointer}
    .ps-action:disabled{opacity:.4;cursor:default}.ps-action--danger{color:var(--danger)}
    @media (max-width: 679.98px), (hover: none) and (max-width: 1023.98px){.ps{padding:0 var(--ios-inset,16px)}}
    @media (min-width: 1024px), (min-width: 680px) and (hover: hover){
      .ps-group,.ps-empty{border:1px solid var(--line);border-radius:12px}
      .ps-head,.ps-top{padding-inline:4px}
      .ps-field{min-height:46px;font-size:14px}.ps-field input,.ps-field select{height:40px;font-size:14px}
      .ps-action{min-height:44px;font-size:14px}
    }
  `],
})
export class PalletSheet {
  readonly pallet = input.required<PalletVm>();
  readonly lines = input<readonly PlannerLine[]>([]);
  readonly placements = input<ReadonlyMap<number, Placement>>(new Map());
  readonly spec = input.required<PlannerSpec>();
  readonly count = input(0);
  readonly canEdit = input(false);

  readonly act = output<ShippingPalletAction>();
  readonly move = output<-1 | 1>();
  readonly remove = output<number>();
  readonly closed = output<void>();

  readonly types = PALLET_TYPES;
  readonly customType = computed(() => {
    const type = this.pallet().type;
    return type && !PALLET_TYPES.some((choice) => choice.value === type) ? type : null;
  });
  readonly issue = computed(() => {
    const pill = palletPill(this.pallet());
    return pill.tone === 'danger' || pill.tone === 'warn' ? pill : null;
  });
  readonly addable = computed(() => {
    const here = new Set(this.pallet().parts.map((part) => part.productId));
    return this.lines().filter((line) => !here.has(line.productId) && this.remaining(line.productId) > 0);
  });

  heightText(): string {
    const pallet = this.pallet();
    const max = Math.round(this.spec().maxHeightCm);
    if (pallet.heightCm === null) return `– / ${max} cm`;
    return `${pallet.measured ? '' : '≈ '}${Math.round(pallet.heightCm)} / ${max} cm`;
  }

  remaining(productId: number): number {
    return this.placements().get(productId)?.remaining ?? 0;
  }

  private known(part: PalletPart): boolean {
    return this.lines().some((line) => line.productId === part.productId);
  }

  danger(part: PalletPart): boolean {
    return !this.known(part) || (this.placements().get(part.productId)?.over ?? 0) > 0;
  }

  sub(part: PalletPart): string {
    if (!this.known(part)) return 'niet meer in de order';
    const placement = this.placements().get(part.productId);
    if (placement?.over) return `${placement.over.toLocaleString('nl-BE')} te veel`;
    if (placement?.remaining) return `nog ${placement.remaining.toLocaleString('nl-BE')} los`;
    return 'alles geplaatst';
  }

  setCartons(productId: number, cartons: number | null): void {
    if (cartons !== null) this.act.emit({ type: 'set-item-cartons', palletIndex: this.pallet().index, productId, cartons });
  }

  rename(event: Event): void {
    this.act.emit({ type: 'rename-pallet', index: this.pallet().index, label: (event.target as HTMLInputElement).value.trim() });
  }

  setType(event: Event): void {
    const palletType = normalizeManualPalletType((event.target as HTMLSelectElement).value);
    this.act.emit({ type: 'set-pallet-type', index: this.pallet().index, palletType });
  }

  /** A measured height between the wood and the maximum; an emptied field goes back to the estimate. */
  setHeight(event: Event): void {
    const input = event.target as HTMLInputElement;
    const raw = input.value.replace(',', '.').trim();
    const spec = this.spec();
    const rounded = Math.round(Number(raw));
    const heightCm = raw === '' || !Number.isFinite(rounded) || rounded <= 0 ? null
      : Math.max(Math.ceil(spec.baseHeightCm), Math.min(Math.floor(spec.maxHeightCm), rounded));
    input.value = heightCm === null ? '' : String(heightCm);
    this.act.emit({ type: 'set-pallet-height', index: this.pallet().index, heightCm });
  }

  blur(event: Event): void {
    (event.target as HTMLElement).blur();
  }
}
