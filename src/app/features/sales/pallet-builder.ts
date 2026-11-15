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

/** A press on the 3D view: on a box (it may be dragged) or on empty space (the camera turns). */
interface StagePress { id: number | null; pointerId: number; x: number; y: number; moving: boolean }

/** A press on a product of the tray: a tap adds one omdoos, a drag carries it onto the carrier. */
interface TrayPress { item: BuilderItem; pointerId: number; x: number; y: number; touch: boolean; active: boolean }

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
 * three.js loads with this screen only (a @defer on the page).
 */
@Component({
  selector: 'app-pallet-builder',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthImage, Icon, NumPipe],
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
        <div class="pb3-stage" #stage>
          <div class="pb3-stats" aria-live="polite">
            <span><b>{{ stats().count | num }}</b> {{ stats().count === 1 ? 'omdoos' : 'omdozen' }}</span>
            <span [class.pb3-warn]="stats().tooHigh"><b>{{ stats().topCm | num }}</b> / {{ spec().maxHeightCm | num }} cm</span>
            <span [class.pb3-warn]="stats().tooHeavy"><b>{{ stats().weightKg | num }}</b> / {{ spec().maxWeightKg | num }} kg</span>
          </div>
          <button class="pb3-btn pb3-btn--round pb3-view" type="button" (click)="frameView()" aria-label="Beeld terugzetten" title="Beeld terugzetten">
            <app-icon name="expand" [size]="16" />
          </button>
          @if (note(); as text) { <p class="pb3-note" role="status">{{ text }}</p> }
          @if (failed()) {
            <p class="pb3-empty">3D werkt niet in deze browser.</p>
          } @else if (ready() && !boxes().length) {
            <div class="pb3-empty">
              <p>Sleep een product op de {{ one() }}, of tik erop.</p>
              @if (parts().length) {
                <button class="btn btn--primary btn--sm" type="button" (click)="autoFill()"><app-icon name="auto" [size]="15" /><span>Automatisch vullen</span></button>
              }
            </div>
          }
          @if (selectedItem(); as item) {
            <div class="pb3-pick" role="toolbar" [attr.aria-label]="'Gekozen omdoos: ' + item.title">
              <span class="pb3-pick__name"><i [style.background]="item.colour"></i><span>{{ item.title }}</span></span>
              <button type="button" (click)="turn()" title="Draai (R)"><app-icon name="refresh" [size]="16" /><span>Draai</span></button>
              @if (turnable() && sidesOf(item).length > 1) {
                <button type="button" (click)="tip()" title="Kantel (T)"><app-icon name="exchange" [size]="16" /><span>Kantel</span></button>
              }
              <button type="button" (click)="copy()" title="Nog één (D)"><app-icon name="copy" [size]="16" /><span>+1</span></button>
              <button type="button" class="pb3-pick__out" (click)="remove()" title="Weg (Delete)"><app-icon name="trash" [size]="16" /><span>Weg</span></button>
            </div>
          }
        </div>

        <aside class="pb3-tray" aria-label="Producten">
          @for (item of items(); track item.key) {
            <button class="pb3-item" type="button" [disabled]="!isSized(item)" (pointerdown)="trayDown($event, item)" (click)="trayClick(item)"
                    [attr.aria-label]="'Zet een omdoos ' + item.title + ' erbij'">
              <i class="pb3-item__tape" [style.background]="item.colour"></i>
              @if (item.photo) { <img class="pb3-item__img" [appAuthSrc]="item.photo" appAuthLazy alt="" draggable="false" /> }
              @else { <span class="pb3-item__img pb3-kraft"></span> }
              <span class="pb3-item__text">
                <b>{{ item.title }}</b>
                <small>{{ placedText(item) }}</small>
              </span>
            </button>
          }
        </aside>
      </div>
      @if (chip(); as at) { <span class="pb3-chip pb3-kraft" [style.left.px]="at.x" [style.top.px]="at.y" [style.--tape]="at.colour"></span> }
    </div>
  `,
  styles: [`
    :host{display:contents}
    .pb3{position:fixed;inset:0;z-index:190;display:flex;flex-direction:column;background:var(--surface-2);color:var(--ink);animation:pb3-in .2s var(--ease-out,ease)}
    @keyframes pb3-in{from{opacity:0;transform:scale(.985)}}
    .pb3-bar{display:flex;align-items:center;gap:10px;padding:calc(8px + var(--safe-t,0px)) calc(12px + var(--safe-r,0px)) 8px calc(12px + var(--safe-l,0px));border-bottom:1px solid var(--line);background:var(--surface)}
    .pb3-title{flex:1;min-width:0}
    .pb3-title h2{margin:0;font-size:16px;font-weight:750}
    .pb3-title p{margin:1px 0 0;font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .pb3-tools{display:flex;gap:6px}
    .pb3-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-width:40px;height:40px;padding:0 12px;border:1px solid var(--line-strong);border-radius:999px;background:var(--surface);color:var(--ink);font:inherit;font-size:13px;font-weight:600;cursor:pointer;-webkit-tap-highlight-color:transparent}
    .pb3-btn:disabled{opacity:.4;cursor:default}.pb3-btn:active:not(:disabled){background:var(--surface-2)}
    .pb3-btn--round{width:40px;padding:0}
    .pb3-main{flex:1;min-height:0;display:grid;grid-template-rows:minmax(0,1fr) auto}
    .pb3-stage{position:relative;min-height:0;overflow:hidden;touch-action:none;background:radial-gradient(120% 90% at 50% 30%,var(--surface) 0,var(--surface-2) 72%)}
    .pb3-stats{position:absolute;top:12px;left:12px;right:64px;display:flex;flex-wrap:wrap;gap:6px;pointer-events:none}
    .pb3-stats span,.pb3-note{padding:5px 10px;border:1px solid var(--line);border-radius:999px;background:color-mix(in srgb,var(--surface) 88%,transparent);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);font-size:12.5px;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
    .pb3-stats b{color:var(--ink);font-weight:750}
    .pb3-stats .pb3-warn,.pb3-stats .pb3-warn b{color:var(--warn);border-color:color-mix(in srgb,var(--warn) 40%,var(--line))}
    .pb3-view{position:absolute;top:10px;right:12px}
    .pb3-note{position:absolute;top:50px;left:50%;transform:translateX(-50%);margin:0;color:var(--warn);font-weight:650;animation:pb3-in .15s ease-out}
    .pb3-empty{position:absolute;left:50%;bottom:22px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:10px;width:max-content;max-width:calc(100% - 32px);margin:0;font-size:13.5px;color:var(--muted);text-align:center;pointer-events:none}
    .pb3-empty p{margin:0}.pb3-empty .btn{pointer-events:auto}
    .pb3-pick{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);display:flex;align-items:center;gap:2px;max-width:calc(100% - 20px);padding:5px;border:1px solid var(--line);border-radius:18px;background:color-mix(in srgb,var(--surface) 94%,transparent);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);box-shadow:0 8px 28px rgb(40 28 18 / 16%);animation:pb3-in .15s ease-out}
    .pb3-pick__name{display:flex;align-items:center;gap:7px;min-width:0;max-width:220px;padding:0 8px 0 6px;font-size:12.5px;font-weight:650}
    .pb3-pick__name span{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
    .pb3-pick__name i{flex:none;width:10px;height:10px;border-radius:3px}
    .pb3-pick button{display:inline-flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;min-width:52px;height:46px;padding:0 6px;border:0;border-radius:12px;background:none;color:var(--ink);font:inherit;font-size:11px;font-weight:650;cursor:pointer;-webkit-tap-highlight-color:transparent}
    .pb3-pick button:active{background:var(--surface-2)}.pb3-pick .pb3-pick__out{color:var(--danger,#b3261e)}
    .pb3-tray{display:flex;gap:8px;overflow-x:auto;overscroll-behavior:contain;padding:10px calc(12px + var(--safe-r,0px)) calc(10px + var(--safe-b,0px)) calc(12px + var(--safe-l,0px));border-top:1px solid var(--line);background:var(--surface);scrollbar-width:none}
    .pb3-item{position:relative;flex:none;display:grid;grid-template-columns:44px minmax(0,1fr);align-items:center;gap:10px;width:184px;padding:8px 10px 8px 12px;border:1px solid var(--line);border-radius:14px;background:var(--surface);color:var(--ink);font:inherit;text-align:left;cursor:grab;touch-action:pan-x;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}
    .pb3-item:disabled{opacity:.5;cursor:default}.pb3-item:active:not(:disabled){background:var(--surface-2)}
    .pb3-item__tape{position:absolute;left:-1px;top:10px;bottom:10px;width:4px;border-radius:0 4px 4px 0}
    .pb3-item__img{width:44px;height:44px;border-radius:10px;object-fit:cover;background:var(--surface-2);pointer-events:none}
    .pb3-item__text{display:flex;flex-direction:column;min-width:0}
    .pb3-item__text b{overflow:hidden;font-size:12.5px;font-weight:650;line-height:1.25;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}
    .pb3-item__text small{margin-top:2px;font-size:11.5px;color:var(--muted);font-variant-numeric:tabular-nums}
    .pb3-kraft{background:#c0905f linear-gradient(transparent 40%,var(--tape,#9a6b3f) 40% 58%,transparent 58%);box-shadow:inset 0 0 0 1px rgb(90 58 28 / 30%)}
    .pb3-chip{position:fixed;z-index:1;width:40px;height:30px;margin:-34px 0 0 -20px;border-radius:3px;pointer-events:none;box-shadow:0 8px 18px rgb(40 28 18 / 28%)}
    .pb3 :is(button):focus-visible{outline:2px solid var(--rose);outline-offset:2px}
    @media (min-width: 1024px), (min-width: 680px) and (hover: hover){
      .pb3-main{grid-template-rows:none;grid-template-columns:272px minmax(0,1fr)}
      .pb3-tray{order:-1;flex-direction:column;overflow:auto;padding:12px;border-top:0;border-right:1px solid var(--line)}
      .pb3-item{width:auto;touch-action:none}
    }
    @media (max-width: 679.98px), (hover: none) and (max-width: 1023.98px){
      .pb3-lbl{display:none}.pb3-tools .pb3-btn{width:40px;padding:0}
      .pb3-pick__name{display:none}
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
  private noteTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    /* One pass in order: the carrier (the floor every box stands on), the looks, then the boxes. */
    effect(() => {
      const kind = this.carrier(); const spec = this.spec(); const deck = this.deck();
      const items = this.items(); const map = this.itemMap(); const boxes = this.boxes();
      if (!this.sceneReady() || !this.scene) return;
      this.scene.setCarrier(kind, spec, deck);
      this.scene.setItems(items);
      this.scene.setBoxes(boxes, map);
    });
    effect(() => {
      const id = this.selected();
      if (this.sceneReady()) this.scene?.markPicked(id);
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
  tip(): void {
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
    const id = this.scene.boxAt(event.clientX, event.clientY);
    this.press = { id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, moving: false };
    if (id !== null) {
      this.scene.orbit = false;
      this.selected.set(id);
      try { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); } catch { /* the pointer is already gone */ }
    }
  };

  private readonly move = (event: PointerEvent): void => {
    if (this.trayPress?.pointerId === event.pointerId) { this.trayMove(event); return; }
    const press = this.press;
    if (!press || press.pointerId !== event.pointerId || press.id === null || !this.scene) return;
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
    if (press.id === null) {
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < DRAG_START_PX) this.selected.set(null);
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
    this.trayPress = { item, pointerId: event.pointerId, x: event.clientX, y: event.clientY, touch: event.pointerType !== 'mouse', active: false };
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
      /* On a phone the tray scrolls sideways: only an upward pull carries a box out. */
      if (press.touch && !(dy < -DRAG_START_PX && Math.abs(dy) > Math.abs(dx))) { this.trayPress = null; return; }
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
      case 't': case 'T': case 'k': case 'K': this.tip(); return;
      case 'd': case 'D': case '+': this.copy(); return;
      case 'Delete': case 'Backspace':
        if (this.selected() !== null) { event.preventDefault(); this.remove(); }
        return;
    }
  }
}
