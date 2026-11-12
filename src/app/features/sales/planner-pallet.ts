import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { AuthImage } from '../../core/api/auth-image';
import { Icon } from '../../shared/icon';
import { NumPipe } from '../../shared/pipes';
import type { MenuPoint } from '../../shared/context-menu-position';
import { PalletGlyph, PalletStepper } from './pallet-glyph';
import type { PalletVm, Placement, PlannerLine } from './shipping-planner-model';
import type { ShippingPalletAction } from './shipping-planner';

/** "28 omdozen", "1 omdoos". */
export function omdozen(count: number): string {
  return `${count.toLocaleString('nl-BE')} ${count === 1 ? 'omdoos' : 'omdozen'}`;
}

/** The pill of one pallet: "vol", "65 %", "leeg", "te hoog", "te zwaar", "nakijken". */
export function palletPill(pallet: PalletVm): { text: string; tone: 'ok' | 'neutral' | 'warn' | 'danger' } {
  switch (pallet.status) {
    case 'vol': return { text: 'vol', tone: 'ok' };
    case 'pct': return { text: `${Math.round(pallet.fill * 100)} %`, tone: 'neutral' };
    case 'leeg': return { text: 'leeg', tone: 'warn' };
    default: return { text: pallet.status, tone: 'danger' };
  }
}

/**
 * One pallet: a row on the phone (a hand-built one opens its sheet), or a
 * card on the desk where the stack is edited in place. The glyph is the
 * drag handle; the planner binds the pointer on this host and only starts
 * a drag from [data-drag-handle]. No overlays here: the ⋯ menu and the
 * sheet are the planner's.
 */
@Component({
  selector: 'app-planner-pallet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthImage, Icon, NgTemplateOutlet, NumPipe, PalletGlyph, PalletStepper],
  host: {
    '[attr.data-pallet-index]': 'pallet().index',
    '[class.is-dragging]': 'dragging()',
    '[class.is-target]': 'target()',
  },
  template: `
    @let p = pallet();
    <ng-template #facts>
      @if (p.to > p.from) { {{ p.to - p.from + 1 }} × }{{ cartonsText() }}
      · <span [class.is-danger]="p.over">{{ heightText() }}</span>
      @if (p.weightKg > 0) { · <span [class.is-danger]="p.heavy">{{ p.weightKg | num }} kg</span> }
    </ng-template>
    @if (look() === 'row') {
      <ng-template #row>
        <app-pallet-glyph [blocks]="p.blocks" [over]="p.over" />
        <span class="sp-row__title">{{ p.label }} <small>{{ p.contents }}</small></span>
        <span class="badge" [class]="'badge--' + pill().tone">{{ pill().text }}</span>
        <span class="sp-row__facts">
          @for (part of p.parts.slice(0, 4); track $index) { <i class="wk-dot" [style.--tone]="part.colour"></i> }
          <span><ng-container [ngTemplateOutlet]="facts" /></span>
        </span>
      </ng-template>
      @if (editable()) {
        <button class="sp-row" type="button" aria-haspopup="dialog" (click)="open.emit(p.index)">
          <ng-container [ngTemplateOutlet]="row" /><app-icon class="sp-row__chev" name="chevron-right" [size]="16" />
        </button>
      } @else {
        <div class="sp-row sp-row--static"><ng-container [ngTemplateOutlet]="row" /></div>
      }
    } @else {
      <article class="sp-card" [class.is-empty]="!p.parts.length">
        <header class="sp-card__head">
          @if (editable()) {
            <button class="sp-card__grip" type="button" data-drag-handle (keydown)="keyMove($event)"
                    [attr.aria-label]="p.label + ' verplaatsen. Sleep of gebruik de pijltjestoetsen.'">
              <app-pallet-glyph [blocks]="p.blocks" [over]="p.over" />
            </button>
            <input class="sp-card__name" [value]="p.label" [attr.aria-label]="'Naam van pallet ' + (p.index + 1)"
                   (change)="rename($event)" (keydown.enter)="blur($event)" />
          } @else {
            <app-pallet-glyph class="sp-card__grip" [blocks]="p.blocks" [over]="p.over" />
            <b class="sp-card__name">{{ p.label }}</b>
          }
          <span class="badge" [class]="'badge--' + pill().tone">{{ pill().text }}</span>
          <span class="sp-card__facts">@if (p.typeNote) { {{ p.typeNote }} · }<span [class.is-danger]="p.over">{{ heightText() }}</span>
            @if (p.weightKg > 0) { · <span [class.is-danger]="p.heavy">{{ p.weightKg | num }} kg</span> }</span>
          @if (editable()) {
            <button class="sp-card__more" type="button" aria-haspopup="menu" [attr.aria-label]="'Acties voor ' + p.label" (click)="openMenu($event)">
              <app-icon name="more" [size]="18" />
            </button>
          }
        </header>
        <div class="sp-card__items">
          @for (part of p.parts; track $index) {
            <div class="sp-item">
              <i class="wk-dot" [style.--tone]="part.colour"></i>
              <span class="sp-item__name">{{ part.name }}</span>
              @if (editable()) {
                <app-pallet-stepper size="sm" [value]="part.cartons" [max]="part.cartons + remaining(part.productId)"
                                    [plusDisabled]="remaining(part.productId) <= 0" [label]="'Omdozen ' + part.name + ' op ' + p.label"
                                    (changed)="setCartons(part.productId, $event)" />
              } @else {
                <b class="sp-item__count">{{ part.cartons }}</b>
              }
            </div>
          }
          @if (editable() && loose().length) {
            <button class="sp-card__add" type="button" [attr.aria-expanded]="chips()" (click)="chipsToggle.emit(p.index)">
              <app-icon name="plus" [size]="14" />Product
            </button>
            @if (chips()) {
              <div class="sp-chips">
                @for (line of loose(); track line.productId) {
                  <button class="sp-chip" type="button" [style.--sp-colour]="line.colour" [attr.aria-label]="line.name + ' erbij zetten'"
                          (click)="act.emit({ type: 'add-item', palletIndex: p.index, productId: line.productId })">
                    @if (line.photoUrl) { <img [appAuthSrc]="line.photoUrl" appAuthLazy alt="" /> } @else { <i></i> }
                    <span>{{ line.name }}</span><b>{{ remaining(line.productId) }} los</b>
                  </button>
                }
              </div>
            }
          }
        </div>
      </article>
    }
  `,
  styles: [`
    :host{display:block;min-width:0}
    .sp-row{display:grid;grid-template-columns:30px minmax(0,1fr) auto 14px;grid-template-areas:"glyph title pill chev" "glyph facts facts chev";align-items:center;column-gap:12px;row-gap:2px;width:100%;min-height:64px;padding:9px 16px;border:0;background:var(--surface);color:var(--ink);text-align:left;cursor:pointer;-webkit-tap-highlight-color:transparent}
    button.sp-row:active{background:var(--surface-2)}
    .sp-row--static{cursor:default;grid-template-columns:30px minmax(0,1fr) auto;grid-template-areas:"glyph title pill" "glyph facts facts"}
    .sp-row app-pallet-glyph{grid-area:glyph}.sp-row .badge{grid-area:pill}.sp-row__chev{grid-area:chev;color:var(--muted-2)}
    .sp-row__title{grid-area:title;min-width:0;overflow:hidden;font-size:15px;font-weight:650;text-overflow:ellipsis;white-space:nowrap}
    .sp-row__title small{margin-left:4px;color:var(--muted);font-size:15px;font-weight:400}
    .sp-row__facts{grid-area:facts;display:flex;align-items:center;gap:5px;min-width:0;color:var(--muted);font-size:13px;font-variant-numeric:tabular-nums;white-space:nowrap}
    .sp-row__facts>span{min-width:0;overflow:hidden;text-overflow:ellipsis}
    .is-danger{color:var(--danger);font-weight:650}
    .sp-card{min-width:0;height:100%;border:1px solid var(--line);border-radius:14px;background:var(--surface);transition:opacity .16s,transform .16s,box-shadow .16s}
    .sp-card.is-empty{border-style:dashed}
    :host(.is-dragging) .sp-card{opacity:.56;transform:scale(.985)}
    :host(.is-target) .sp-card{box-shadow:0 0 0 2px var(--rose-dark),0 8px 18px rgb(31 25 22/12%)}
    .sp-card__head{display:grid;grid-template-columns:30px minmax(0,1fr) auto 28px;grid-template-areas:"glyph name pill more" "glyph facts facts more";align-items:center;column-gap:10px;row-gap:1px;padding:10px 8px 8px 12px}
    .sp-card__grip{grid-area:glyph;display:grid;padding:0;border:0;border-radius:5px;background:none;cursor:grab;touch-action:none}
    .sp-card__grip:active{cursor:grabbing}
    .sp-card__name{grid-area:name;min-width:0;height:26px;margin-left:-5px;padding:0 4px;border:1px solid transparent;border-radius:7px;background:transparent;color:var(--ink);font-size:13.5px;font-weight:700;line-height:24px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    input.sp-card__name:hover,input.sp-card__name:focus{border-color:var(--line-strong);background:var(--surface-2);outline:none}
    .sp-card .badge{grid-area:pill}
    .sp-card__facts{grid-area:facts;min-width:0;overflow:hidden;color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums;text-overflow:ellipsis;white-space:nowrap}
    .sp-card__more{grid-area:more;display:grid;place-items:center;width:28px;height:28px;padding:0;border:0;border-radius:7px;background:none;color:var(--muted);cursor:pointer}
    .sp-card__more:hover{background:var(--surface-2);color:var(--ink)}
    .sp-card__items{padding:2px 12px 8px;border-top:1px solid var(--line)}
    .sp-item{display:grid;grid-template-columns:8px minmax(0,1fr) auto;align-items:center;gap:8px;min-height:38px;padding:3px 0;border-bottom:1px solid var(--line);font-size:12.5px}
    .sp-item:last-of-type{border-bottom:0}
    .sp-item__name{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;line-height:1.25;font-weight:600;overflow-wrap:anywhere}
    .sp-item__count{font-variant-numeric:tabular-nums}
    .sp-card__add{display:inline-flex;align-items:center;gap:4px;min-height:30px;margin-top:4px;padding:0;border:0;background:none;color:var(--rose-dark);font-size:12px;font-weight:650;cursor:pointer}
    .sp-chips{display:flex;flex-wrap:wrap;gap:6px;padding:2px 0 4px}
    .sp-chip{display:inline-flex;align-items:center;gap:6px;max-width:100%;min-width:0;height:30px;padding:0 4px;border:1px solid var(--line);border-radius:999px;background:var(--surface);color:var(--ink);font-size:12px;font-weight:600;cursor:pointer}
    .sp-chip:hover{border-color:var(--rose-line);background:var(--rose-soft)}
    .sp-chip img,.sp-chip i{flex:none;width:22px;height:22px;border-radius:50%;background:var(--surface-2);object-fit:cover;box-shadow:0 0 0 2px var(--sp-colour)}
    .sp-chip span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .sp-chip b{flex:none;padding:0 6px;border-radius:999px;background:var(--warn-soft);color:var(--warn);font-size:11px}
    @media (min-width: 1024px), (min-width: 680px) and (hover: hover){
      .sp-row{min-height:56px;padding:8px 12px}.sp-row__title,.sp-row__title small{font-size:14px}.sp-row__facts{font-size:12.5px}
    }
    @media (prefers-reduced-motion:reduce){.sp-card{transition:none}}
  `],
})
export class PlannerPallet {
  readonly pallet = input.required<PalletVm>();
  readonly look = input<'row' | 'card'>('row');
  /** A hand-built pallet that may change; an automatic one never does. */
  readonly editable = input(false);
  readonly count = input(0);
  readonly lines = input<readonly PlannerLine[]>([]);
  readonly placements = input<ReadonlyMap<number, Placement>>(new Map());
  readonly chips = input(false);
  readonly dragging = input(false);
  readonly target = input(false);

  readonly act = output<ShippingPalletAction>();
  readonly open = output<number>();
  readonly menu = output<{ index: number; point: MenuPoint }>();
  readonly chipsToggle = output<number>();

  readonly pill = computed(() => palletPill(this.pallet()));
  /** Products with omdozen on no pallet that are not on this one yet. */
  readonly loose = computed(() => {
    const here = new Set(this.pallet().parts.map((part) => part.productId));
    return this.lines().filter((line) => !here.has(line.productId) && this.remaining(line.productId) > 0);
  });

  cartonsText(): string {
    return omdozen(this.pallet().cartons);
  }

  heightText(): string {
    const pallet = this.pallet();
    if (pallet.heightCm === null) return '– cm';
    const prefix = pallet.measured || pallet.type === null ? '' : '≈ ';
    return `${prefix}${Math.round(pallet.heightCm)} cm`;
  }

  remaining(productId: number): number {
    return this.placements().get(productId)?.remaining ?? 0;
  }

  setCartons(productId: number, cartons: number | null): void {
    if (cartons === null) return;
    this.act.emit({ type: 'set-item-cartons', palletIndex: this.pallet().index, productId, cartons });
  }

  rename(event: Event): void {
    this.act.emit({ type: 'rename-pallet', index: this.pallet().index, label: (event.target as HTMLInputElement).value.trim() });
  }

  blur(event: Event): void {
    (event.target as HTMLElement).blur();
  }

  openMenu(event: MouseEvent): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.menu.emit({ index: this.pallet().index, point: { x: rect.left, y: rect.bottom + 4 } });
  }

  keyMove(event: KeyboardEvent): void {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    const fromIndex = this.pallet().index;
    const toIndex = fromIndex + (event.key === 'ArrowUp' ? -1 : 1);
    if (toIndex < 0 || toIndex >= this.count()) return;
    event.preventDefault();
    this.act.emit({ type: 'reorder-pallet', fromIndex, toIndex });
  }
}
