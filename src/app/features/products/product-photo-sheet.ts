import { ChangeDetectionStrategy, Component, computed, effect, input, model, output, signal } from '@angular/core';
import { AuthImage } from '../../core/api/auth-image';
import {
  CatalogChannel,
  ProductPhotoOverview,
  ProductPhotoOverviewPhoto,
  ProductPhotoRoleKey,
} from '../../core/api/models';
import { formatBytes } from '../../shared/format-bytes';
import { Icon } from '../../shared/icon';
import { PhotoRenditionControls } from '../../shared/photo-rendition-controls';
import { Sheet } from '../../shared/ui';
import {
  cleanupScope,
  photoScopeLabel,
  publishTargetForRole,
  roleChoice,
  roleToggleLabel,
  rolesForPhoto,
  selectedChannels,
  tileRoleBadges,
  toggledChannels,
  websiteReasonText,
} from './product-photos-state';

export interface ProductPhotoRoleRequest {
  role: ProductPhotoRoleKey;
  photoKey: string | null;
}

export interface ProductPhotoChannelsRequest {
  photo: ProductPhotoOverviewPhoto;
  channels: CatalogChannel[];
}

export interface ProductPhotoScopeRequest {
  photo: ProductPhotoOverviewPhoto;
  variantProductId: number | null;
}

export interface ProductPhotoPromoteRequest {
  photo: ProductPhotoOverviewPhoto;
  scope: 'THIS_VARIANT' | 'ALL_VARIANTS';
  cleanup: boolean;
}

const CHANNEL_SWITCHES: ReadonlyArray<{
  channel: CatalogChannel;
  flag: 'website' | 'catalogue' | 'orderApp';
  label: string;
  description: string;
}> = [
  { channel: 'WEBSITE', flag: 'website', label: 'Website', description: 'Productpagina en galerij van deze reeks' },
  { channel: 'CATALOGUE', flag: 'catalogue', label: 'Catalogus', description: 'Gedrukte catalogus en catalogus-pdf' },
  { channel: 'ORDER_APP', flag: 'orderApp', label: 'Bestelapp', description: 'Assortiment in de bestelapp' },
];

/**
 * One photo, everything about it: what it is used for, where it is visible,
 * which colours it belongs to. Every choice is sent up at once; the panel
 * saves it and hands a fresh overview back, so this sheet never guesses.
 */
@Component({
  selector: 'app-product-photo-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthImage, Icon, PhotoRenditionControls, Sheet],
  template: `
    @if (photo(); as photo) {
      <app-sheet [title]="photo.kind === 'OWN' ? 'Losse productfoto' : 'Reeksfoto'" (closed)="closed.emit()">
        <div body class="ps" [attr.aria-busy]="busy()" (click)="rememberControl($event)">
          <div class="ps-stage" tabindex="0" data-initial-focus role="group" aria-roledescription="foto"
               [attr.aria-label]="'Foto ' + (index() + 1) + ' van ' + photos().length + (photos().length > 1 ? '. Pijltjes links en rechts bladeren.' : '')"
               (keydown)="stageKeydown($event)" (pointerdown)="startSwipe($event)" (pointerup)="finishSwipe($event)"
               (pointercancel)="swipe = null">
            <img [appAuthSrc]="photo.mediumUrl || photo.largeUrl" appAuthSize="medium" draggable="false"
                 [alt]="photoScopeLabel(photo, colour()) + ' · foto ' + (index() + 1)" />
            @if (badges().length) {
              <span class="ps-badges">@for (badge of badges(); track badge) { <span [class.ps-badge--warn]="badge === 'Dubbel'">{{ badge }}</span> }</span>
            }
            @if (photos().length > 1) {
              <button class="ps-step ps-step--prev" type="button" aria-label="Vorige foto" (click)="step(-1)"><app-icon name="chevron" [size]="20" /></button>
              <button class="ps-step ps-step--next" type="button" aria-label="Volgende foto" (click)="step(1)"><app-icon name="chevron" [size]="20" /></button>
              <span class="ps-count" aria-hidden="true">{{ index() + 1 }} / {{ photos().length }}</span>
            }
          </div>
          <p class="ps-meta"><b>{{ photoScopeLabel(photo, colour()) }}</b><span>{{ websiteReasonText(photo) }}</span></p>
          <p class="sr-only" role="status" aria-live="polite">Foto {{ index() + 1 }} van {{ photos().length }}</p>

          @if (roles().length) {
            <section class="ps-block" aria-labelledby="ps-roles-title">
              <h3 id="ps-roles-title">Gebruik als</h3>
              <div class="ps-roles">
                @for (role of roles(); track role) {
                  @let state = roleState(photo, role);
                  <button class="ps-role" type="button" [class.ps-role--on]="state.pressed" [attr.aria-pressed]="state.pressed"
                          [disabled]="busy()" [title]="state.hint" (click)="toggleRole(photo, role, state.explicit)">
                    <span class="ps-role__mark" aria-hidden="true">{{ state.pressed ? '✓' : '+' }}</span>
                    <span class="ps-role__copy"><b>{{ roleToggleLabel(role, colour()) }}</b>@if (state.note) { <small>{{ state.note }}</small> }</span>
                  </button>
                }
              </div>
            </section>
          }

          @if (photo.kind === 'SERIES') {
            <section class="ps-block" aria-labelledby="ps-channels-title">
              <h3 id="ps-channels-title">Zichtbaar op</h3>
              @let channels = selectedChannels(photo);
              <div class="ps-switches">
                @for (item of channelSwitches; track item.channel) {
                  <button class="switch-row ps-switch" type="button" role="switch" [class.switch-row--on]="channels.includes(item.channel)"
                          [attr.aria-checked]="channels.includes(item.channel)" [disabled]="busy() || !photo.publishable"
                          (click)="channelsRequested.emit({ photo, channels: toggledChannels(photo, item.channel) })">
                    <span class="switch-row__copy"><b>{{ item.label }}</b><small>{{ item.description }}</small></span>
                    <span class="switch-row__track" aria-hidden="true"><i></i></span>
                  </button>
                }
              </div>
              @if (!photo.publishable) { <p class="ps-note">Deze foto kan nog niet online. Controleer voor welke kleur hij geldt.</p> }
            </section>

            <section class="ps-block" aria-labelledby="ps-scope-title">
              <h3 id="ps-scope-title">Geldt voor</h3>
              <div class="ps-segment" role="group" aria-labelledby="ps-scope-title">
                @if (photo.scope === 'OTHER_VARIANT') {
                  <button type="button" aria-pressed="true" disabled>Alleen {{ photo.variantLabel || 'andere kleur' }}</button>
                }
                <button type="button" [attr.aria-pressed]="photo.scope === 'THIS_VARIANT'" [disabled]="busy()"
                        (click)="photo.scope !== 'THIS_VARIANT' && scopeRequested.emit({ photo, variantProductId: productId() })">Alleen {{ colour() }}</button>
                <button type="button" [attr.aria-pressed]="photo.scope === 'ALL_VARIANTS'" [disabled]="busy()"
                        (click)="photo.scope !== 'ALL_VARIANTS' && scopeRequested.emit({ photo, variantProductId: null })">Alle kleuren</button>
              </div>
            </section>
          } @else {
            <section class="ps-block ps-own" aria-labelledby="ps-own-title">
              <h3 id="ps-own-title">{{ photo.duplicateOfKey ? 'Dubbele foto' : 'In de reeks zetten' }}</h3>
              <p>Losse productfoto — hoort alleen bij dit product. Zet hem in de reeks om te kiezen voor welke kleuren en kanalen hij geldt.</p>
              @if (photo.duplicateOfKey) {
                <p class="ps-warning" role="note"><app-icon name="alert" [size]="16" /><span>Deze foto staat al bij de reeksfoto’s.</span></p>
                <button class="btn btn--sm" type="button" [disabled]="busy()"
                        (click)="promoteRequested.emit({ photo, scope: cleanupScope(overview(), photo), cleanup: true })">Dubbele foto opruimen</button>
              } @else {
                <div class="ps-segment" role="group" aria-label="Zet in de reeks voor">
                  <button type="button" [attr.aria-pressed]="promoteScope() === 'THIS_VARIANT'" (click)="promoteScope.set('THIS_VARIANT')">Alleen {{ colour() }}</button>
                  <button type="button" [attr.aria-pressed]="promoteScope() === 'ALL_VARIANTS'" (click)="promoteScope.set('ALL_VARIANTS')">Alle kleuren</button>
                </div>
                <button class="btn btn--sm" type="button" [disabled]="busy()"
                        (click)="promoteRequested.emit({ photo, scope: promoteScope(), cleanup: false })">Zet in de reeks</button>
              }
            </section>
          }

          <details class="ps-advanced" [open]="advancedOpen()" (toggle)="advancedOpen.set($any($event.target).open)">
            <summary>Geavanceerd</summary>
            <p class="ps-file"><span>{{ photo.originalFilename }}</span><small>@if (photo.widthPx && photo.heightPx) { {{ photo.widthPx }} × {{ photo.heightPx }} px · }{{ bytes(photo.sizeBytes) }}</small></p>
            @if (advancedOpen()) {
              <app-photo-rendition-controls [endpoint]="renditionsEndpoint(photo)" [filename]="photo.originalFilename" [disabled]="busy()" />
            }
          </details>
        </div>
        <div foot class="ps-foot">
          <button class="btn btn--danger ps-delete" type="button" [disabled]="busy()" (click)="removeRequested.emit(photo)"><app-icon name="trash" [size]="17" /> Verwijderen</button>
          <button class="btn" type="button" [disabled]="busy()" (click)="downloadRequested.emit(photo)"><app-icon name="download" [size]="17" /> Download origineel</button>
        </div>
      </app-sheet>
    }
  `,
  styles: `
    :host { display: contents; }
    .ps { display: grid; gap: 16px; min-width: 0; }
    .ps-stage { position: relative; display: grid; place-items: center; aspect-ratio: 4 / 3; max-height: 48dvh; width: 100%; margin-inline: auto;
      padding: 10px; overflow: hidden; border: 1px solid var(--line); border-radius: 18px; background: var(--surface-2); touch-action: pan-y pinch-zoom; }
    .ps-stage:focus-visible { outline: 2px solid var(--rose); outline-offset: 2px; }
    .ps-stage img { width: 100%; height: 100%; object-fit: contain; user-select: none; -webkit-user-drag: none; }
    .ps-badges { position: absolute; top: 9px; left: 9px; display: flex; flex-wrap: wrap; gap: 5px; max-width: calc(100% - 18px); pointer-events: none; }
    .ps-badges span { padding: 3px 8px; border-radius: 999px; background: var(--rose); color: #fff; font-size: 11px; font-weight: 700; }
    .ps-badges .ps-badge--warn { background: var(--warn); }
    .ps-step { position: absolute; top: 50%; display: grid; place-items: center; width: 44px; height: 44px; padding: 0; border: 1px solid var(--line);
      border-radius: 50%; background: color-mix(in srgb, var(--surface) 92%, transparent); color: var(--ink); box-shadow: var(--sh-1); cursor: pointer; transform: translateY(-50%); }
    .ps-step--prev { left: 8px; } .ps-step--prev app-icon { transform: scaleX(-1); } .ps-step--next { right: 8px; }
    .ps-step:focus-visible, .ps-role:focus-visible, .ps-segment button:focus-visible, .ps-switch:focus-visible, .ps-advanced summary:focus-visible { outline: 2px solid var(--rose); outline-offset: 2px; }
    .ps-count { position: absolute; right: 9px; bottom: 9px; padding: 2px 8px; border-radius: 999px; background: rgb(16 13 12 / 62%); color: #fff;
      font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .ps-meta { display: flex; flex-wrap: wrap; gap: 2px 10px; margin: -6px 0 0; color: var(--muted); font-size: 12.5px; }
    .ps-meta b { color: var(--ink-2); }
    .ps-block { display: grid; gap: 8px; min-width: 0; }
    .ps-block h3 { font-size: 11px; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
    .ps-roles { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
    .ps-role { display: flex; align-items: center; gap: 9px; min-height: 48px; padding: 7px 11px; border: 1px solid var(--line-strong); border-radius: 13px;
      background: var(--surface); color: var(--ink); text-align: left; cursor: pointer; }
    .ps-role:disabled { opacity: .5; cursor: not-allowed; }
    .ps-role__mark { display: grid; place-items: center; flex: none; width: 22px; height: 22px; border-radius: 50%; background: var(--surface-2);
      color: var(--muted); font-size: 13px; font-weight: 800; }
    .ps-role__copy { display: grid; min-width: 0; line-height: 1.25; }
    .ps-role__copy b { font-size: 13px; }
    .ps-role__copy small { color: var(--muted); font-size: 11px; }
    .ps-role--on { border-color: var(--rose); background: var(--rose-soft); }
    .ps-role--on .ps-role__mark { background: var(--rose); color: #fff; }
    .ps-role--on .ps-role__copy small { color: var(--rose-dark); }
    .ps-switches { display: grid; gap: 6px; }
    .ps-switch { width: 100%; min-height: 52px; font: inherit; color: inherit; text-align: left; }
    .ps-switch:disabled { opacity: .55; cursor: not-allowed; }
    .ps-segment { display: flex; gap: 4px; padding: 4px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface-2); }
    .ps-segment button { flex: 1; min-width: 0; min-height: 44px; padding: 6px 10px; border: 0; border-radius: 10px; background: transparent;
      color: var(--ink-2); font-size: 13px; font-weight: 650; cursor: pointer; overflow-wrap: anywhere; }
    .ps-segment button[aria-pressed=true] { background: var(--surface); color: var(--ink); box-shadow: 0 2px 6px rgb(25 36 32 / 8%); }
    .ps-segment button:disabled:not([aria-pressed=true]) { opacity: .5; cursor: not-allowed; }
    .ps-note, .ps-own > p { color: var(--muted); font-size: 12.5px; line-height: 1.5; }
    .ps-own { padding: 12px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface-2); }
    .ps-own .btn { justify-self: start; }
    .ps-warning { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 10px; background: var(--warn-soft); color: var(--warn);
      font-size: 12.5px; font-weight: 650; }
    .ps-advanced { border-top: 1px solid var(--line); padding-top: 4px; }
    .ps-advanced summary { display: flex; align-items: center; min-height: 44px; color: var(--ink-2); font-size: 13px; font-weight: 650; cursor: pointer; }
    .ps-file { display: grid; gap: 2px; margin-bottom: 4px; font-size: 12px; overflow-wrap: anywhere; }
    .ps-file small { color: var(--muted); }
    .ps-foot { display: contents; }
    .ps-foot .btn { gap: 6px; }
    @media (min-width: 680px) {
      .ps-delete { margin-right: auto; }
      .ps-stage { max-height: 420px; }
    }
    @media (hover: hover) and (pointer: fine) {
      .ps-step { opacity: 0; transition: opacity .12s; }
      .ps-stage:hover .ps-step, .ps-step:focus-visible { opacity: 1; }
    }
    @media (prefers-reduced-motion: reduce) {
      .ps-step { transition: none; }
    }
  `,
})
export class ProductPhotoSheet {
  /** The list the arrows walk through: the grid the sheet was opened from. */
  readonly photos = input.required<ProductPhotoOverviewPhoto[]>();
  readonly key = model.required<string>();
  readonly overview = input.required<ProductPhotoOverview>();
  readonly colour = input.required<string>();
  readonly productId = input.required<number>();
  readonly busy = input(false);

  readonly roleRequested = output<ProductPhotoRoleRequest>();
  readonly channelsRequested = output<ProductPhotoChannelsRequest>();
  readonly scopeRequested = output<ProductPhotoScopeRequest>();
  readonly promoteRequested = output<ProductPhotoPromoteRequest>();
  readonly downloadRequested = output<ProductPhotoOverviewPhoto>();
  readonly removeRequested = output<ProductPhotoOverviewPhoto>();
  readonly closed = output<void>();

  readonly channelSwitches = CHANNEL_SWITCHES;
  readonly photoScopeLabel = photoScopeLabel;
  readonly websiteReasonText = websiteReasonText;
  readonly roleToggleLabel = roleToggleLabel;
  readonly selectedChannels = selectedChannels;
  readonly toggledChannels = toggledChannels;
  readonly cleanupScope = cleanupScope;
  readonly bytes = formatBytes;

  readonly index = computed(() => Math.max(0, this.photos().findIndex((photo) => photo.key === this.key())));
  readonly photo = computed(() => this.photos().find((photo) => photo.key === this.key()) ?? null);
  readonly roles = computed(() => {
    const photo = this.photo();
    return photo ? rolesForPhoto(photo) : [];
  });
  readonly badges = computed(() => {
    const photo = this.photo();
    return photo ? [...tileRoleBadges(photo), ...(photo.duplicateOfKey ? ['Dubbel'] : [])] : [];
  });
  readonly promoteScope = signal<'THIS_VARIANT' | 'ALL_VARIANTS'>('THIS_VARIANT');
  /** The renditions block fires a request when shown, so it only exists while opened. */
  readonly advancedOpen = signal(false);
  swipe: { id: number; x: number; y: number } | null = null;
  private lastControl: HTMLElement | null = null;

  constructor() {
    effect(() => {
      this.key();
      this.advancedOpen.set(false);
      this.promoteScope.set('THIS_VARIANT');
    });
    /* A save disables every control for a moment, which drops keyboard focus.
       Hand it back to the control that started the save. */
    let wasBusy = false;
    effect(() => {
      const busy = this.busy();
      if (wasBusy && !busy) {
        const target = this.lastControl;
        setTimeout(() => requestAnimationFrame(() => {
          const active = document.activeElement;
          if (target?.isConnected && (!active || active === document.body)) target.focus();
        }));
      }
      wasBusy = busy;
    });
  }

  rememberControl(event: Event): void {
    this.lastControl = (event.target as HTMLElement).closest('button');
  }

  roleState(photo: ProductPhotoOverviewPhoto, role: ProductPhotoRoleKey): {
    pressed: boolean; explicit: boolean; note: string; hint: string;
  } {
    const pressed = photo.roles.includes(role);
    const choice = roleChoice(this.overview(), role);
    const explicit = pressed && choice?.key === photo.key && choice.explicit;
    const publish = pressed ? null : publishTargetForRole(photo, role);
    return {
      pressed,
      explicit,
      note: pressed ? (explicit ? 'Zelf gekozen' : 'Automatisch')
        : publish === 'website' ? 'Komt ook op de website'
        : publish === 'catalogue' ? 'Komt ook in de catalogus' : '',
      hint: explicit ? 'Tik om weer automatisch te laten kiezen'
        : pressed ? 'Tik om deze foto vast te zetten' : 'Tik om deze foto te gebruiken',
    };
  }

  toggleRole(photo: ProductPhotoOverviewPhoto, role: ProductPhotoRoleKey, explicit: boolean): void {
    if (this.busy()) return;
    this.roleRequested.emit({ role, photoKey: explicit ? null : photo.key });
  }

  step(direction: -1 | 1): void {
    const photos = this.photos();
    if (photos.length < 2) return;
    this.key.set(photos[(this.index() + direction + photos.length) % photos.length].key);
  }

  stageKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      this.step(event.key === 'ArrowLeft' ? -1 : 1);
    }
  }

  startSwipe(event: PointerEvent): void {
    if (!event.isPrimary || (event.target as HTMLElement).closest('button')) { this.swipe = null; return; }
    this.swipe = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }

  finishSwipe(event: PointerEvent): void {
    const start = this.swipe;
    this.swipe = null;
    if (!start || start.id !== event.pointerId) return;
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (Math.abs(deltaX) < 42 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.15) return;
    this.step(deltaX < 0 ? 1 : -1);
  }

  renditionsEndpoint(photo: ProductPhotoOverviewPhoto): string {
    const overview = this.overview();
    return photo.kind === 'OWN'
      ? `/api/products/${this.productId()}/photos/${photo.productPhotoId}/renditions`
      : `/api/product-families/${overview.familyId}/images/${photo.familyPhotoId}/renditions`;
  }
}
