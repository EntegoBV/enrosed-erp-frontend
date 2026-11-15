import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, input, output, signal, viewChild,
} from '@angular/core';
import { AuthImage } from '../../core/api/auth-image';
import { HostBridge } from '../../core/platform/host-bridge';
import { Icon } from '../../shared/icon';
import { NumPipe } from '../../shared/pipes';
import type { CarrierKind, CartonUp, PalletSpec } from './pallet-calculator-model';
import {
  MAX_BUILDER_BOXES, computedFill, deckOf, extentOf, landing, loadBuild, nextSpot, saveBuild, settle, sidesOf, sized, solidsOf,
  type BuilderBox, type BuilderItem, type BuilderPart, type Landing, type Solid,
} from './pallet-builder-model';
import { BuilderScene } from './pallet-builder-scene';

interface Target extends Landing { up: CartonUp; turned: boolean }

/**
 * A press on the 3D view: on a box that may be dragged (with a mouse any box,
 * with a finger only the chosen one), else the camera turns and a tap chooses.
 */
interface StagePress { id: number | null; pointerId: number; x: number; y: number; moving: boolean; movable: boolean }

/** A press on a product of the tray: a tap adds one omdoos, a drag carries it onto the carrier. */
interface TrayPress { item: BuilderItem; pointerId: number; x: number; y: number; touch: boolean; column: boolean; active: boolean }

/** What a box's card says: the product, its size and weight, how many stand here. */
export interface BoxCard { item: BuilderItem; size: string; here: string }

function cm(value: number): string {
  return value.toLocaleString('nl-BE', { maximumFractionDigits: 1 });
}

const HISTORY = 60;
const DRAG_START_PX = 7;

/**
 * 3D laden (Palletberekening): build a pallet or a Deense kar by hand. The
 * products of the calculation stand on a tray; drag one onto the carrier,
 * or tap it to set it on the next free place. A box lands on the floor or
 * on the boxes under it, snaps to nearby edges, and never goes above the
 * loading height. A chosen box turns (Draai), lies on its side (Kantel,
 * when omdozen may tip), gets a twin (+1) or goes (Weg); drag it to move
 * it, and what stood on it drops down. Automatisch lays the carrier as
 * Palletberekening counts it. The build stays on this device per carrier.
 * Which product is where: the mouse over a box shows its card and draws the
 * edges of all its boxes in its colour; a product in the legend (Op de kar)
 * or on the tray puts it in focus and fades the rest. On a phone a tap on a
 * box does what the mouse does, and a finger turns the view unless it starts
 * on the chosen box (Emre, 2026-11-15: see the products, mouse over them,
 * very good on mobile).
 * three.js loads with this screen only (a @defer on the page).
 */
@Component({
  selector: 'app-pallet-builder',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthImage, Icon, NgTemplateOutlet, NumPipe],
  host: { '(document:keydown)': 'key($event)' },
  template: `
    <div class="pb3" role="dialog" aria-modal="true" aria-labelledby="pb3-title">
      <header class="pb3-bar">
        <button class="pb3-btn pb3-btn--round" type="button" (click)="closed.emit()" aria-label="Sluiten" title="Sluiten (Esc)">
          <app-icon name="close" [size]="18" />
        </button>
        <div class="pb3-title">
          <h2 id="pb3-title">3D laden</h2>
          <p>{{ label() }}</p>
        </div>
        <div class="pb3-tools">
          <button class="pb3-btn" type="button" [disabled]="!canUndo()" (click)="undo()" aria-label="Ongedaan maken" title="Ongedaan maken">
            <app-icon name="restore" [size]="16" /><span class="pb3-lbl">Ongedaan</span>
          </button>
          <button class="pb3-btn" type="button" [disabled]="!parts().length" (click)="autoFill()" aria-label="Automatisch vullen"
                  title="Vul zoals Palletberekening telt">
            <app-icon name="auto" [size]="16" /><span class="pb3-lbl">Automatisch</span>
          </button>
          <button class="pb3-btn" type="button" [disabled]="!boxes().length" (click)="clearAll()" aria-label="Alles eraf" title="Alles eraf">
            <app-icon name="trash" [size]="16" /><span class="pb3-lbl">Leeg</span>
          </button>
        </div>
      </header>

      <div class="pb3-main">
        <div class="pb3-stage" #stage [class.pb3-stage--box]="hoverId() !== null" (pointermove)="hover($event)" (pointerleave)="unhover()">
          <div class="pb3-top">
            <div class="pb3-stats" aria-live="polite">
              <span><b>{{ stats().count | num }}</b> {{ stats().count === 1 ? 'omdoos' : 'omdozen' }}</span>
              <span [class.pb3-warn]="stats().tooHigh"><b>{{ stats().topCm | num }}</b> / {{ spec().maxHeightCm | num }} cm</span>
              <span [class.pb3-warn]="stats().tooHeavy"><b>{{ stats().weightKg | num }}</b> / {{ spec().maxWeightKg | num }} kg</span>
            </div>
            @if (onCarrier().length) {
              <div class="pb3-legend" role="group" [attr.aria-label]="'Op de ' + one() + ': tik een product om het uit te lichten'">
                @for (entry of onCarrier(); track entry.item.key) {
                  <button type="button" class="pb3-tag" [class.pb3-tag--on]="pinned() === entry.item.key" [attr.aria-pressed]="pinned() === entry.item.key"
                          (click)="pin(entry.item.key)" (pointerenter)="lean($event, entry.item.key)" (pointerleave)="lean($event, null)"
                          [title]="entry.item.title">
                    <i [style.background]="entry.item.colour"></i><span>{{ entry.item.title }}</span><b>{{ entry.count | num }}</b>
                  </button>
                }
              </div>
            }
          </div>
          <button class="pb3-btn pb3-btn--round pb3-view" type="button" (click)="frameView()" aria-label="Beeld terugzetten" title="Beeld terugzetten">
            <app-icon name="expand" [size]="16" />
          </button>
          @if (note(); as text) { <p class="pb3-note" role="status">{{ text }}</p> }
          @if (failed()) {
            <p class="pb3-empty">3D werkt niet in deze browser.</p>
          } @else if (ready() && !boxes().length) {
            <div class="pb3-empty">
              <p>{{ touch() ? 'Sleep een product omhoog op de ' + one() + ', of tik erop.' : 'Sleep een product op de ' + one() + ', of klik erop.' }}</p>
              @if (parts().length) {
                <button class="btn btn--primary btn--sm" type="button" (click)="autoFill()"><app-icon name="auto" [size]="15" /><span>Automatisch vullen</span></button>
              }
            </div>
          }
          @if (tip(); as info) {
            <div class="pb3-tip" [style.left.px]="info.x" [style.top.px]="info.y" aria-hidden="true">
              <ng-container [ngTemplateOutlet]="facts" [ngTemplateOutletContext]="{ $implicit: info.card }" />
            </div>
          }
          @if (selectedCard(); as card) {
            <div class="pb3-pick" role="toolbar" [attr.aria-label]="'Gekozen omdoos: ' + card.item.title">
              <div class="pb3-pick__info"><ng-container [ngTemplateOutlet]="facts" [ngTemplateOutletContext]="{ $implicit: card }" /></div>
              <div class="pb3-pick__actions">
                <button type="button" (click)="turn()" title="Draai (R)"><app-icon name="refresh" [size]="17" /><span>Draai</span></button>
                @if (turnable() && sidesOf(card.item).length > 1) {
                  <button type="button" (click)="tipOver()" title="Kantel (T)"><app-icon name="exchange" [size]="17" /><span>Kantel</span></button>
                }
                <button type="button" (click)="copy()" title="Nog één (D)"><app-icon name="copy" [size]="17" /><span>+1</span></button>
                <button type="button" class="pb3-pick__out" (click)="remove()" title="Weg (Delete)"><app-icon name="trash" [size]="17" /><span>Weg</span></button>
                <button type="button" class="pb3-pick__close" (click)="selected.set(null)" aria-label="Klaar" title="Klaar (Esc)"><app-icon name="close" [size]="15" /></button>
              </div>
            </div>
          }
        </div>

        <aside class="pb3-tray" aria-label="Producten">
          @for (item of items(); track item.key) {
            <button class="pb3-item" type="button" [disabled]="!isSized(item)" [class.pb3-item--lit]="focus() === item.key"
                    (pointerdown)="trayDown($event, item)" (click)="trayClick(item)"
                    (pointerenter)="lean($event, item.key)" (pointerleave)="lean($event, null)"
                    [attr.aria-label]="'Zet een omdoos ' + item.title + ' erbij'">
              <i class="pb3-item__tape" [style.background]="item.colour"></i>
              @if (item.photo) { <img class="pb3-item__img" [appAuthSrc]="item.photo" alt="" draggable="false" (load)="photoLoaded(item.key, $event)" /> }
              @else { <span class="pb3-item__img pb3-kraft"></span> }
              <span class="pb3-item__text">
                <b>{{ item.title }}</b>
                <small>{{ placedText(item) }}</small>
              </span>
              <span class="pb3-item__add" aria-hidden="true"><app-icon name="plus" [size]="14" /></span>
            </button>
          }
        </aside>
      </div>
      @if (chip(); as at) { <span class="pb3-chip pb3-kraft" [style.left.px]="at.x" [style.top.px]="at.y" [style.--tape]="at.colour"></span> }
    </div>

    <ng-template #facts let-card>
      <span class="pb3-card">
        @if (card.item.photo) { <img class="pb3-card__img" [appAuthSrc]="card.item.photo" alt="" /> }
        @else { <span class="pb3-card__img pb3-kraft"></span> }
        <span class="pb3-card__text">
          <b><i [style.background]="card.item.colour"></i>{{ card.item.title }}</b>
          <span>{{ card.size }}</span>
          <span>{{ card.here }}</span>
        </span>
      </span>
    </ng-template>
  `,
  styles: [`
    :host{display:contents}
    .pb3{position:fixed;inset:0;z-index:190;display:flex;flex-direction:column;background:var(--surface-2);color:var(--ink);animation:pb3-in .2s var(--ease-out,ease)}
    @keyframes pb3-in{from{opacity:0}}
    .pb3-bar{display:flex;align-items:center;gap:10px;padding:calc(8px + var(--safe-t,0px)) calc(12px + var(--safe-r,0px)) 8px calc(12px + var(--safe-l,0px));border-bottom:1px solid var(--line);background:var(--surface)}
    .pb3-title{flex:1;min-width:0}
    .pb3-title h2{margin:0;font-size:16px;font-weight:750}
    .pb3-title p{margin:1px 0 0;font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .pb3-tools{display:flex;gap:6px}
    .pb3-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-width:40px;height:40px;padding:0 12px;border:1px solid var(--line-strong);border-radius:999px;background:var(--surface);color:var(--ink);font:inherit;font-size:13px;font-weight:600;cursor:pointer;-webkit-tap-highlight-color:transparent}
    .pb3-btn:disabled{opacity:.4;cursor:default}.pb3-btn:active:not(:disabled){background:var(--surface-2)}
    .pb3-btn--round{width:40px;padding:0}
    .pb3-main{flex:1;min-height:0;display:grid;grid-template-rows:minmax(0,1fr) auto}
    .pb3-stage{position:relative;min-height:0;overflow:hidden;touch-action:none;cursor:grab;background:radial-gradient(120% 90% at 50% 30%,var(--surface) 0,var(--surface-2) 72%)}
    .pb3-stage:active{cursor:grabbing}.pb3-stage--box{cursor:move}
    .pb3-top{position:absolute;top:10px;left:12px;right:62px;display:flex;flex-direction:column;align-items:flex-start;gap:6px;pointer-events:none}
    .pb3-stats{display:flex;flex-wrap:wrap;gap:6px}
    .pb3-stats span,.pb3-note{padding:5px 10px;border:1px solid var(--line);border-radius:999px;background:color-mix(in srgb,var(--surface) 88%,transparent);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);font-size:12.5px;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
    .pb3-stats b{color:var(--ink);font-weight:750}
    .pb3-stats .pb3-warn,.pb3-stats .pb3-warn b{color:var(--warn);border-color:color-mix(in srgb,var(--warn) 40%,var(--line))}
    .pb3-legend{display:flex;gap:6px;max-width:100%;overflow-x:auto;scrollbar-width:none;pointer-events:auto;padding:2px;margin:-2px}
    .pb3-tag{display:inline-flex;flex:none;align-items:center;gap:7px;max-width:240px;height:32px;padding:0 11px 0 9px;border:1px solid var(--line);border-radius:999px;background:color-mix(in srgb,var(--surface) 92%,transparent);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);color:var(--ink);font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;-webkit-tap-highlight-color:transparent}
    .pb3-tag i{flex:none;width:10px;height:10px;border-radius:3px}
    .pb3-tag span{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
    .pb3-tag b{font-weight:750;color:var(--muted);font-variant-numeric:tabular-nums}
    .pb3-tag--on{border-color:var(--ink);background:var(--ink);color:var(--surface)}.pb3-tag--on b{color:inherit;opacity:.75}
    .pb3-view{position:absolute;top:10px;right:12px}
    .pb3-note{position:absolute;top:96px;left:50%;transform:translateX(-50%);margin:0;color:var(--warn);font-weight:650}
    .pb3-empty{position:absolute;left:50%;bottom:22px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:10px;width:max-content;max-width:calc(100% - 32px);margin:0;font-size:13.5px;color:var(--muted);text-align:center;pointer-events:none}
    .pb3-empty p{margin:0}.pb3-empty .btn{pointer-events:auto}
    .pb3-tip{position:absolute;z-index:2;width:max-content;max-width:300px;padding:9px 12px 9px 9px;border:1px solid var(--line);border-radius:14px;background:color-mix(in srgb,var(--surface) 96%,transparent);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);box-shadow:0 10px 30px rgb(40 28 18 / 18%);pointer-events:none}
    .pb3-card{display:flex;align-items:center;gap:10px;min-width:0}
    .pb3-card__img{flex:none;width:46px;height:46px;border-radius:10px;object-fit:cover;background:var(--surface-2)}
    .pb3-card__text{display:flex;flex-direction:column;gap:1px;min-width:0;font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}
    .pb3-card__text b{display:flex;align-items:center;gap:6px;color:var(--ink);font-size:13.5px;font-weight:700;line-height:1.25}
    .pb3-card__text b i{flex:none;width:10px;height:10px;border-radius:3px}
    .pb3-card__text span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .pb3-pick{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);display:flex;align-items:center;gap:6px;max-width:calc(100% - 20px);padding:6px 6px 6px 8px;border:1px solid var(--line);border-radius:18px;background:color-mix(in srgb,var(--surface) 95%,transparent);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);box-shadow:0 8px 28px rgb(40 28 18 / 16%);animation:pb3-in .15s ease-out}
    .pb3-pick__info{min-width:0;max-width:280px;padding-right:4px}
    .pb3-pick__actions{display:flex;align-items:center;gap:2px}
    .pb3-pick__actions button{display:inline-flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;min-width:52px;height:48px;padding:0 6px;border:0;border-radius:12px;background:none;color:var(--ink);font:inherit;font-size:11px;font-weight:650;cursor:pointer;-webkit-tap-highlight-color:transparent}
    .pb3-pick__actions button:active,.pb3-pick__actions button:hover{background:var(--surface-2)}
    .pb3-pick .pb3-pick__out{color:var(--danger,#b3261e)}
    .pb3-pick .pb3-pick__close{min-width:36px;color:var(--muted)}
    .pb3-tray{display:flex;gap:8px;overflow-x:auto;overscroll-behavior:contain;padding:10px calc(12px + var(--safe-r,0px)) calc(10px + var(--safe-b,0px)) calc(12px + var(--safe-l,0px));border-top:1px solid var(--line);background:var(--surface);scrollbar-width:none}
    .pb3-item{position:relative;flex:none;display:grid;grid-template-columns:44px minmax(0,1fr) auto;align-items:center;gap:10px;width:208px;padding:8px 10px 8px 12px;border:1px solid var(--line);border-radius:14px;background:var(--surface);color:var(--ink);font:inherit;text-align:left;cursor:grab;touch-action:pan-x;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}
    .pb3-item:disabled{opacity:.5;cursor:default}.pb3-item:active:not(:disabled){background:var(--surface-2)}
    .pb3-item--lit{border-color:var(--ink-2)}
    .pb3-item__tape{position:absolute;left:-1px;top:10px;bottom:10px;width:4px;border-radius:0 4px 4px 0}
    .pb3-item__img{width:44px;height:44px;border-radius:10px;object-fit:cover;background:var(--surface-2);pointer-events:none}
    .pb3-item__text{display:flex;flex-direction:column;min-width:0}
    .pb3-item__text b{overflow:hidden;font-size:12.5px;font-weight:650;line-height:1.25;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}
    .pb3-item__text small{margin-top:2px;font-size:11.5px;color:var(--muted);font-variant-numeric:tabular-nums}
    .pb3-item__add{display:grid;place-items:center;width:26px;height:26px;border-radius:50%;background:var(--surface-2);color:var(--ink-2)}
    .pb3-kraft{background:#c0905f linear-gradient(transparent 40%,var(--tape,#9a6b3f) 40% 58%,transparent 58%);box-shadow:inset 0 0 0 1px rgb(90 58 28 / 30%)}
    .pb3-chip{position:fixed;z-index:3;width:40px;height:30px;margin:-34px 0 0 -20px;border-radius:3px;pointer-events:none;box-shadow:0 8px 18px rgb(40 28 18 / 28%)}
    .pb3 :is(button):focus-visible{outline:2px solid var(--rose);outline-offset:2px}
    @media (min-width: 1024px), (min-width: 680px) and (hover: hover){
      .pb3-main{grid-template-rows:none;grid-template-columns:280px minmax(0,1fr)}
      .pb3-tray{order:-1;flex-direction:column;overflow:auto;padding:12px;border-top:0;border-right:1px solid var(--line)}
      .pb3-item{width:auto;touch-action:none}
      .pb3-item__add{opacity:0;transition:opacity .15s}.pb3-item:hover .pb3-item__add{opacity:1}
      .pb3-pick__info .pb3-card__img{width:36px;height:36px}
      .pb3-pick__info .pb3-card__text span:nth-child(2){display:none}
    }
    /* The phone: the chosen box's card spans the width over the tray, its buttons in a row of their own. */
    @media (max-width: 679.98px), (hover: none) and (max-width: 1023.98px){
      .pb3-lbl{display:none}.pb3-tools .pb3-btn{width:40px;padding:0}
      .pb3-stats span{padding:4px 8px;font-size:12px}
      .pb3-tag{height:34px}
      .pb3-pick{left:10px;right:10px;bottom:10px;transform:none;flex-direction:column;align-items:stretch;gap:4px;max-width:none;padding:10px 10px 6px}
      .pb3-pick__info{max-width:none;padding:0 2px}
      .pb3-pick__actions{justify-content:space-between}
      .pb3-pick__actions button{flex:1;height:52px;font-size:12px}
      .pb3-pick .pb3-pick__close{flex:none;min-width:44px}
      .pb3-note{top:auto;bottom:178px}
    }
    /* A phone on its side (or the folded Duo): the tray as a column on the left, the 3D as wide as it gets. */
    @media (hover: none) and (orientation: landscape) and (max-height: 560px){
      .pb3-bar{padding-top:calc(4px + var(--safe-t,0px));padding-bottom:4px}
      .pb3-main{grid-template-rows:none;grid-template-columns:calc(220px + var(--safe-l,0px)) minmax(0,1fr)}
      .pb3-tray{order:-1;flex-direction:column;overflow:auto;padding:8px 8px calc(8px + var(--safe-b,0px)) calc(8px + var(--safe-l,0px));border-top:0;border-right:1px solid var(--line);touch-action:pan-y}
      .pb3-item{width:auto;touch-action:pan-y}
      .pb3-pick{left:50%;right:auto;transform:translateX(-50%);flex-direction:row;align-items:center;max-width:calc(100% - 20px);padding:6px}
      .pb3-pick__info .pb3-card__text span:nth-child(2){display:none}
      .pb3-pick__actions button{flex:none;min-width:50px;height:46px}
      .pb3-note{bottom:80px}
    }
  `],
})
export class PalletBuilder {
  private readonly hostBridge = inject(HostBridge);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  readonly items = input.required<readonly BuilderItem[]>();
  readonly carrier = input.required<CarrierKind>();
  readonly spec = input.required<PalletSpec>();
  /** Where the build is kept on this device: 'kar' or the pallet type. */
  readonly storeKey = input.required<string>();
  readonly label = input('');
  readonly turnable = input(true);
  /** The first carrier as Palletberekening counts it: what Automatisch lays. */
  readonly parts = input<readonly BuilderPart[]>([]);
  readonly closed = output<void>();

  private readonly stage = viewChild.required<ElementRef<HTMLElement>>('stage');

  readonly boxes = signal<BuilderBox[]>([]);
  readonly selected = signal<number | null>(null);
  readonly ready = signal(false);
  readonly failed = signal(false);
  readonly note = signal('');
  readonly canUndo = signal(false);
  readonly chip = signal<{ x: number; y: number; colour: string } | null>(null);
  /** The box under the mouse and where the mouse is in the view. */
  readonly hoverId = signal<number | null>(null);
  private readonly hoverAt = signal({ x: 0, y: 0, width: 0, height: 0 });
  /** A product the mouse rests on in the legend or the tray; a product tapped in the legend stays in focus. */
  private readonly leaning = signal<number | null>(null);
  readonly pinned = signal<number | null>(null);
  /** The tray's photos once loaded: they go on the cartons' labels. */
  private readonly photos = signal<ReadonlyMap<number, HTMLImageElement>>(new Map());
  readonly touch = signal(typeof matchMedia === 'function' && matchMedia('(hover: none)').matches);

  readonly itemMap = computed(() => new Map(this.items().map((item) => [item.key, item])));
  readonly deck = computed(() => deckOf(this.spec()));
  readonly one = computed(() => (this.carrier() === 'kar' ? 'kar' : 'pallet'));
  readonly counts = computed(() => {
    const counts = new Map<number, number>();
    for (const box of this.boxes()) counts.set(box.key, (counts.get(box.key) ?? 0) + 1);
    return counts;
  });
  readonly stats = computed(() => {
    const items = this.itemMap();
    const spec = this.spec();
    let top = 0; let weightKg = 0;
    for (const solid of solidsOf(this.boxes(), items)) top = Math.max(top, solid.y + solid.sy);
    for (const box of this.boxes()) weightKg += items.get(box.key)?.weightKg ?? 0;
    const topCm = Math.round(spec.baseHeightCm + top);
    return {
      count: this.boxes().length, topCm, weightKg: Math.round(weightKg),
      tooHigh: topCm > spec.maxHeightCm + 0.5, tooHeavy: weightKg > spec.maxWeightKg + 1e-6,
    };
  });
  readonly selectedBox = computed(() => this.boxes().find((box) => box.id === this.selected()) ?? null);
  readonly selectedItem = computed(() => {
    const box = this.selectedBox();
    return box ? this.itemMap().get(box.key) ?? null : null;
  });

  readonly sidesOf = sidesOf;

  /** The products standing on the carrier, in the tray's order: the legend. */
  readonly onCarrier = computed(() => this.items()
    .map((item) => ({ item, count: this.counts().get(item.key) ?? 0 }))
    .filter((entry) => entry.count > 0));
  /** The product in focus; a pinned product that left the carrier lets go. */
  readonly focus = computed(() => {
    const leaning = this.leaning();
    if (leaning !== null) return leaning;
    const pinned = this.pinned();
    return pinned !== null && this.counts().has(pinned) ? pinned : null;
  });
  /** The product whose boxes get coloured edges: the one under the mouse, else the chosen one. */
  private readonly marked = computed(() => {
    const hovered = this.hoverId();
    const box = hovered === null ? this.selectedBox() : this.boxes().find((candidate) => candidate.id === hovered) ?? null;
    return box?.key ?? null;
  });
  readonly selectedCard = computed(() => {
    const box = this.selectedBox();
    return box ? this.card(box) : null;
  });
  /** The card beside the mouse, kept inside the view. */
  readonly tip = computed(() => {
    const id = this.hoverId();
    if (id === null || id === this.selected()) return null;
    const box = this.boxes().find((candidate) => candidate.id === id);
    const card = box ? this.card(box) : null;
    if (!card) return null;
    const at = this.hoverAt();
    const width = 300; const height = 70;
    const x = at.x + 18 + width > at.width ? Math.max(8, at.x - 18 - width) : at.x + 18;
    const y = at.y + 22 + height > at.height ? Math.max(8, at.y - 18 - height) : at.y + 22;
    return { x, y, card };
  });

  private scene: BuilderScene | null = null;
  private readonly sceneReady = signal(false);
  private loaded = false;
  private nextId = 1;
  private history: BuilderBox[][] = [];
  private press: StagePress | null = null;
  private trayPress: TrayPress | null = null;
  /** The boxes a drag works against: the others, settled as if the dragged one were gone. */
  private dragOthers: BuilderBox[] = [];
  private dragSolids: Solid[] = [];
  private target: Target | null = null;
  private readonly pointers = new Set<number>();
  private suppressClick = false;
  private hoverFrame = 0;
  private topObserver: ResizeObserver | null = null;
  private lastHover: PointerEvent | null = null;
  private noteTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    /* One pass in order: the carrier (the floor every box stands on), the looks, then the boxes. */
    effect(() => {
      const kind = this.carrier(); const spec = this.spec(); const deck = this.deck();
      const items = this.items(); const map = this.itemMap(); const boxes = this.boxes();
      if (!this.sceneReady() || !this.scene) return;
      this.scene.setCarrier(kind, spec, deck);
      this.scene.setItems(items, this.photos());
      this.scene.setBoxes(boxes, map);
    });
    effect(() => {
      const id = this.selected();
      if (this.sceneReady()) this.scene?.markPicked(id);
    });
    effect(() => {
      const focus = this.focus(); const marked = this.marked(); const hovered = this.hoverId();
      if (!this.sceneReady() || !this.scene) return;
      this.scene.setFocus(focus, marked);
      this.scene.setHover(hovered);
    });
    effect(() => {
      const boxes = this.boxes();
      if (this.loaded) saveBuild(this.storeKey(), boxes);
    });

    afterNextRender(() => void this.start());
    this.destroyRef.onDestroy(() => {
      window.removeEventListener('pointermove', this.move);
      window.removeEventListener('pointerup', this.up);
      window.removeEventListener('pointercancel', this.cancel);
      clearTimeout(this.noteTimer);
      cancelAnimationFrame(this.hoverFrame);
      this.topObserver?.disconnect();
      this.scene?.dispose();
      this.scene = null;
    });
  }

  private async start(): Promise<void> {
    const logo = await new Promise<HTMLImageElement | null>((resolve) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = 'logo-ui.png';
    });
    if (this.destroyRef.destroyed) return;
    const stage = this.stage().nativeElement;
    try {
      const accent = getComputedStyle(this.element.nativeElement).getPropertyValue('--rose').trim();
      this.scene = new BuilderScene(stage, logo, accent);
    } catch {
      this.failed.set(true);
      return;
    }
    /* The figures and the legend over the top of the view: the picture centres under them. */
    const top = stage.querySelector<HTMLElement>('.pb3-top');
    if (top) {
      const measure = () => this.scene?.setInsetTop(top.offsetTop + top.offsetHeight + 6);
      measure();
      this.topObserver = new ResizeObserver(measure);
      this.topObserver.observe(top);
    }
    stage.addEventListener('pointerdown', this.down, { capture: true });
    window.addEventListener('pointermove', this.move);
    window.addEventListener('pointerup', this.up);
    window.addEventListener('pointercancel', this.cancel);

    const stored = settle(loadBuild(this.storeKey(), this.itemMap()), this.itemMap());
    this.nextId = stored.reduce((max, box) => Math.max(max, box.id), 0) + 1;
    this.boxes.set(stored);
    this.loaded = true;
    this.sceneReady.set(true);
    this.ready.set(true);
  }

  isSized(item: BuilderItem): boolean {
    return sized(item);
  }

  placedText(item: BuilderItem): string {
    if (!sized(item)) return 'Maten ontbreken';
    const placed = this.counts().get(item.key) ?? 0;
    return item.wanted ? `${placed.toLocaleString('nl-BE')} van ${item.wanted.toLocaleString('nl-BE')}` : `${placed.toLocaleString('nl-BE')} erop`;
  }

  frameView(): void {
    this.scene?.frameView();
  }

  /** "58,5 × 40 × 34 cm · 12 kg · op de zij" and "6 van 6 op de kar · 36 stuks". */
  private card(box: BuilderBox): BoxCard | null {
    const item = this.itemMap().get(box.key);
    if (!item) return null;
    const size = [`${cm(item.lengthCm)} × ${cm(item.widthCm)} × ${cm(item.heightCm)} cm`];
    if (item.weightKg > 0) size.push(`${cm(item.weightKg)} kg`);
    if (box.up !== 'h') size.push(box.up === 'w' ? 'op de zij' : 'op de korte kant');
    const count = this.counts().get(item.key) ?? 0;
    const here = [`${count.toLocaleString('nl-BE')}${item.wanted ? ` van ${item.wanted.toLocaleString('nl-BE')}` : ''} op deze ${this.one()}`];
    if (item.units) {
      const pieces = count * item.units.per;
      here.push(`${pieces.toLocaleString('nl-BE')} ${pieces === 1 ? item.units.one : item.units.other}`);
    }
    return { item, size: size.join(' · '), here: here.join(' · ') };
  }

  /** The mouse over the view: the box under it, once a frame. */
  hover(event: PointerEvent): void {
    if (event.pointerType !== 'mouse') return;
    if (event.buttons || this.press || this.trayPress?.active || !this.scene || event.target !== this.scene.canvas) {
      if (this.hoverId() !== null) this.hoverId.set(null);
      return;
    }
    this.lastHover = event;
    if (this.hoverFrame) return;
    this.hoverFrame = requestAnimationFrame(() => {
      this.hoverFrame = 0;
      const last = this.lastHover;
      if (!last || !this.scene) return;
      const rect = this.stage().nativeElement.getBoundingClientRect();
      this.hoverAt.set({ x: last.clientX - rect.left, y: last.clientY - rect.top, width: rect.width, height: rect.height });
      this.hoverId.set(this.scene.boxAt(last.clientX, last.clientY));
    });
  }

  unhover(): void {
    this.lastHover = null;
    this.hoverId.set(null);
  }

  /** The mouse on a product in the legend or the tray: that product in focus while it rests there. */
  lean(event: PointerEvent, key: number | null): void {
    if (event.pointerType === 'mouse') this.leaning.set(key);
  }

  /** A tap or click in the legend keeps a product in focus; again lets go. */
  pin(key: number): void {
    this.pinned.set(this.pinned() === key ? null : key);
    this.hostBridge.haptic('selection');
  }

  /** A tray photo has loaded: it goes on that product's labels (only an image the canvas may read). */
  photoLoaded(key: number, event: Event): void {
    const image = event.target as HTMLImageElement;
    const source = image.currentSrc || image.src;
    let readable = source.startsWith('blob:') || source.startsWith('data:');
    try { readable ||= new URL(source, location.href).origin === location.origin; } catch { /* not a URL */ }
    if (!readable || !image.naturalWidth || this.photos().get(key) === image) return;
    this.photos.update((photos) => new Map(photos).set(key, image));
  }

  /* ------------------------------------------------------------------ edits */

  private commit(next: BuilderBox[]): void {
    this.history.push(this.boxes());
    if (this.history.length > HISTORY) this.history.shift();
    this.canUndo.set(true);
    this.boxes.set(next);
  }

  undo(): void {
    const previous = this.history.pop();
    if (!previous) return;
    this.boxes.set(previous);
    if (!previous.some((box) => box.id === this.selected())) this.selected.set(null);
    this.canUndo.set(this.history.length > 0);
  }

  clearAll(): void {
    if (!this.boxes().length) return;
    this.commit([]);
    this.selected.set(null);
  }

  autoFill(): void {
    const filled = computedFill(this.itemMap(), this.parts(), this.deck(), this.nextId);
    if (!filled.length) { this.say('Hier valt niets automatisch te vullen'); return; }
    this.nextId += filled.length;
    /* The count reckons a short layer as a full one; in 3D what stands above its gap drops onto the layer below. */
    this.commit(settle(filled, this.itemMap()));
    this.selected.set(null);
    this.hostBridge.haptic('success');
  }

  /** Tap on a product: one omdoos on the next free place, on the side Palletberekening counts it. */
  addOne(item: BuilderItem): void {
    if (!sized(item)) return;
    if (this.boxes().length >= MAX_BUILDER_BOXES) { this.say('Dat zijn genoeg omdozen'); return; }
    const spot = nextSpot(solidsOf(this.boxes(), this.itemMap()), item, [item.up], this.deck());
    if (!spot) { this.say(`Geen plaats meer op deze ${this.one()}`); return; }
    const box: BuilderBox = { id: this.nextId++, key: item.key, ...spot };
    this.commit([...this.boxes(), box]);
    this.selected.set(box.id);
    this.hostBridge.haptic('selection');
  }

  turn(): void {
    const box = this.selectedBox();
    if (box) this.reshape(box, box.up, !box.turned);
  }

  /** The next side the omdoos can stand on. */
  tipOver(): void {
    const box = this.selectedBox();
    const item = this.selectedItem();
    if (!box || !item || !this.turnable()) return;
    const sides = sidesOf(item);
    if (sides.length < 2) return;
    this.reshape(box, sides[(sides.indexOf(box.up) + 1) % sides.length], box.turned);
  }

  copy(): void {
    const box = this.selectedBox();
    const item = this.selectedItem();
    if (!box || !item) return;
    if (this.boxes().length >= MAX_BUILDER_BOXES) { this.say('Dat zijn genoeg omdozen'); return; }
    const spot = nextSpot(solidsOf(this.boxes(), this.itemMap()), item, [box.up], this.deck());
    if (!spot) { this.say(`Geen plaats meer op deze ${this.one()}`); return; }
    const twin: BuilderBox = { id: this.nextId++, key: item.key, ...spot };
    this.commit([...this.boxes(), twin]);
    this.selected.set(twin.id);
    this.hostBridge.haptic('selection');
  }

  remove(): void {
    const box = this.selectedBox();
    if (!box) return;
    this.commit(settle(this.boxes().filter((other) => other.id !== box.id), this.itemMap()));
    this.selected.set(null);
  }

  /**
   * Turned or tipped: the box is lifted, what stood on it drops, and it goes
   * back with its middle where it was, on top of what is under it then.
   */
  private reshape(box: BuilderBox, up: CartonUp, turned: boolean): void {
    const item = this.itemMap().get(box.key);
    if (!item) return;
    const before = extentOf(item, box.up, box.turned);
    const after = extentOf(item, up, turned);
    const others = settle(this.boxes().filter((other) => other.id !== box.id), this.itemMap());
    const land = landing(solidsOf(others, this.itemMap()), after, box.x + before.sx / 2, box.z + before.sz / 2, this.deck(), null);
    if (!land.fits) { this.say(land.reason === 'maat' ? `Zo past hij niet op de ${this.one()}` : 'Zo komt hij boven de max. hoogte'); return; }
    this.commit(settle([...others, { ...box, x: land.x, y: land.y, z: land.z, up, turned }], this.itemMap()));
  }

  private say(text: string): void {
    this.note.set(text);
    clearTimeout(this.noteTimer);
    this.noteTimer = setTimeout(() => this.note.set(''), 2400);
    this.hostBridge.haptic('warning');
  }

  /* ---------------------------------------------------------------- pointer */

  /** A press on the 3D view, before the camera sees it: on a box the camera stays put. */
  private readonly down = (event: PointerEvent): void => {
    this.pointers.add(event.pointerId);
    if (this.pointers.size > 1) { this.dropPress(); return; }
    if (!this.scene || this.trayPress?.active) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    this.touch.set(event.pointerType === 'touch');
    this.hoverId.set(null);
    const id = this.scene.boxAt(event.clientX, event.clientY);
    const movable = id !== null && (event.pointerType !== 'touch' || id === this.selected());
    this.press = { id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, moving: false, movable };
    if (movable) {
      this.scene.orbit = false;
      this.selected.set(id);
      try { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); } catch { /* the pointer is already gone */ }
    }
  };

  private readonly move = (event: PointerEvent): void => {
    if (this.trayPress?.pointerId === event.pointerId) { this.trayMove(event); return; }
    const press = this.press;
    if (!press || press.pointerId !== event.pointerId || !press.movable || !this.scene) return;
    const box = this.boxes().find((candidate) => candidate.id === press.id);
    const item = box ? this.itemMap().get(box.key) : undefined;
    if (!box || !item) return;
    if (!press.moving) {
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < DRAG_START_PX) return;
      press.moving = true;
      this.dragOthers = settle(this.boxes().filter((other) => other.id !== box.id), this.itemMap());
      this.dragSolids = solidsOf(this.dragOthers, this.itemMap());
      this.scene.hide(box.id);
    }
    this.target = this.aimAt(event, item, box.up, box.turned);
  };

  private readonly up = (event: PointerEvent): void => {
    this.pointers.delete(event.pointerId);
    if (this.trayPress?.pointerId === event.pointerId) { this.trayUp(event); return; }
    const press = this.press;
    if (!press || press.pointerId !== event.pointerId) return;
    this.press = null;
    if (this.scene) this.scene.orbit = true;
    if (!press.movable) {
      /* A tap chooses the box under it (nothing: none); a drag turned the view. */
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < DRAG_START_PX) {
        this.selected.set(press.id);
        if (press.id !== null) this.hostBridge.haptic('selection');
      }
      return;
    }
    if (!press.moving) return;
    this.scene?.hide(null);
    this.scene?.showGhost(null, null, false);
    const target = this.target;
    this.target = null;
    const box = this.boxes().find((candidate) => candidate.id === press.id);
    if (!box || !target) return;
    if (!target.fits) { this.say(this.refusal(target)); return; }
    this.commit(settle([...this.dragOthers, { ...box, x: target.x, y: target.y, z: target.z }], this.itemMap()));
    this.hostBridge.haptic('selection');
  };

  private readonly cancel = (event: PointerEvent): void => {
    this.pointers.delete(event.pointerId);
    if (this.trayPress?.pointerId === event.pointerId) { this.endTrayDrag(); return; }
    if (this.press?.pointerId === event.pointerId) this.dropPress();
  };

  private dropPress(): void {
    if (!this.press) return;
    this.press = null;
    this.target = null;
    if (this.scene) { this.scene.orbit = true; this.scene.hide(null); this.scene.showGhost(null, null, false); }
  }

  trayDown(event: PointerEvent, item: BuilderItem): void {
    if (!sized(item) || (event.pointerType === 'mouse' && event.button !== 0) || !this.scene) return;
    const tray = (event.currentTarget as HTMLElement).parentElement;
    const column = !!tray && getComputedStyle(tray).flexDirection === 'column';
    this.touch.set(event.pointerType === 'touch');
    this.trayPress = { item, pointerId: event.pointerId, x: event.clientX, y: event.clientY, touch: event.pointerType !== 'mouse', column, active: false };
  }

  trayClick(item: BuilderItem): void {
    if (this.suppressClick) { this.suppressClick = false; return; }
    this.addOne(item);
  }

  private trayMove(event: PointerEvent): void {
    const press = this.trayPress;
    if (!press || !this.scene) return;
    if (!press.active) {
      const dx = event.clientX - press.x; const dy = event.clientY - press.y;
      if (Math.hypot(dx, dy) < DRAG_START_PX) return;
      /* With a finger the tray scrolls along itself: only a pull towards the view carries a box out (up, or right from a column). */
      const out = press.column ? dx > DRAG_START_PX && Math.abs(dx) > Math.abs(dy) : dy < -DRAG_START_PX && Math.abs(dy) > Math.abs(dx);
      if (press.touch && !out) { this.trayPress = null; return; }
      press.active = true;
      this.dragOthers = this.boxes();
      this.dragSolids = solidsOf(this.dragOthers, this.itemMap());
      this.selected.set(null);
      try { (event.target as Element).setPointerCapture?.(event.pointerId); } catch { /* already captured */ }
    }
    const over = this.scene.contains(event.clientX, event.clientY);
    this.chip.set(over ? null : { x: event.clientX, y: event.clientY, colour: press.item.colour });
    this.target = over ? this.aimAt(event, press.item, press.item.up, false) : null;
    if (!over) this.scene.showGhost(null, null, false);
  }

  private trayUp(event: PointerEvent): void {
    const press = this.trayPress;
    if (!press?.active) { this.trayPress = null; return; }
    this.suppressClick = true;
    setTimeout(() => (this.suppressClick = false), 350);
    const target = this.target;
    this.endTrayDrag();
    if (!target || !this.scene?.contains(event.clientX, event.clientY)) return;
    if (!target.fits) { this.say(this.refusal(target)); return; }
    if (this.boxes().length >= MAX_BUILDER_BOXES) { this.say('Dat zijn genoeg omdozen'); return; }
    const box: BuilderBox = { id: this.nextId++, key: press.item.key, x: target.x, y: target.y, z: target.z, up: target.up, turned: target.turned };
    this.commit([...this.boxes(), box]);
    this.selected.set(box.id);
    this.hostBridge.haptic('selection');
  }

  private endTrayDrag(): void {
    this.trayPress = null;
    this.target = null;
    this.chip.set(null);
    this.scene?.showGhost(null, null, false);
  }

  /** The ghost under the pointer: where this box would land, and whether it may. */
  private aimAt(event: PointerEvent, item: BuilderItem, up: CartonUp, turned: boolean): Target | null {
    const scene = this.scene;
    if (!scene) return null;
    const extent = extentOf(item, up, turned);
    const aim = scene.aim(event.clientX, event.clientY, extent, this.dragSolids, null);
    if (!aim) { scene.showGhost(null, null, false); return null; }
    const land = landing(this.dragSolids, extent, aim.centreX, aim.centreZ, this.deck(), null);
    const target: Target = { ...land, up, turned };
    scene.showGhost(item, target, land.fits);
    return target;
  }

  private refusal(target: Target): string {
    return target.reason === 'maat' ? `Te groot voor deze ${this.one()}` : 'Zo komt hij boven de max. hoogte';
  }

  /* --------------------------------------------------------------- keyboard */

  key(event: KeyboardEvent): void {
    const target = event.target;
    if (target instanceof Element && target.closest('input, textarea, select, [contenteditable]')) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); this.undo(); return; }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        if (this.press || this.trayPress) { this.dropPress(); this.endTrayDrag(); }
        else if (this.selected() !== null) this.selected.set(null);
        else this.closed.emit();
        return;
      case 'r': case 'R': this.turn(); return;
      case 't': case 'T': case 'k': case 'K': this.tipOver(); return;
      case 'd': case 'D': case '+': this.copy(); return;
      case 'Delete': case 'Backspace':
        if (this.selected() !== null) { event.preventDefault(); this.remove(); }
        return;
    }
  }
}
