import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { AuthImage } from '../../core/api/auth-image';
import { Icon } from '../../shared/icon';
import { SegmentOption, Segmented } from '../../shared/segmented';
import { Sheet } from '../../shared/ui';
import { PHOTO_UPLOAD_TYPES, PhotoPickerKind, PickerTexts, PickerTile, PlacePhoto } from './product-photos-state';

/** One other colour's catalogue photo, for the strip under "Bekijk groot". */
export interface PhotoCompareNeighbour {
  label: string;
  photo: PlacePhoto | null;
}

/**
 * The one picker for the five choosable places: upload bar, candidates with
 * the photo of now first, the quiet automatic row. Presentational: every tap
 * goes up, the panel saves and hands the new model back. Activation saves, so
 * this is a plain list of buttons, never a radio group or a listbox.
 */
@Component({
  selector: 'app-product-photo-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthImage, Icon, Segmented, Sheet],
  template: `
    <app-sheet [title]="texts().title" [wide]="true" (closed)="closed.emit()">
      <div body class="pk" [attr.data-picker]="kind()" [attr.aria-busy]="busy()">
        <div class="pk-top">
          @if (texts().upload; as upload) {
            <label class="pk-upload" [class.pk-upload--off]="busy()">
              <span class="pk-upload__icon" aria-hidden="true"><app-icon name="upload" [size]="20" /></span>
              <span><b>{{ uploading() === 'upload' ? upload.uploading : uploading() === 'save' ? upload.saving : upload.title }}</b><small>{{ upload.sub }}</small></span>
              <input class="pk-file" type="file" [accept]="acceptTypes" [disabled]="busy()"
                     [attr.data-initial-focus]="candidates().length ? null : ''" (change)="pickFile($event)" />
            </label>
          } @else if (texts().noUpload; as line) {
            <p class="pk-note">{{ line }}</p>
          }
          <p class="pk-intro">{{ texts().sentence }}</p>
        </div>

        @if (texts().size; as size) {
          <div class="pk-size"><span>{{ size.label }}</span>
            <app-segmented class="pk-seg" variant="ios" [label]="size.label" [options]="sizeOptions()" [value]="detailSize() ?? 'STANDARD'"
                           (changed)="!busy() && sizeChanged.emit($event === 'LARGE' ? 'LARGE' : 'STANDARD')" />
          </div>
        }

        @if (candidates().length) {
          <ul class="pk-grid">
            @for (tile of candidates(); track tile.photo.key) {
              <li class="pk-tile" [class.pk-tile--on]="tile.current">
                <button class="pk-tile__pick" type="button" [disabled]="busy()" [attr.aria-current]="tile.current ? 'true' : null"
                        [attr.aria-label]="tile.label" [attr.data-initial-focus]="tile.current ? '' : null" [attr.data-photo-key]="tile.photo.key"
                        (click)="picked.emit(tile.photo.key)">
                  <span class="pk-tile__pic"><img [appAuthSrc]="tile.photo.smallUrl" alt="" draggable="false" appAuthLazy /></span>
                  <span class="pk-tile__label" [class.pk-tile__label--warn]="tile.captionTone === 'warn'">
                    @if (tile.current) { <span class="pk-tick" aria-hidden="true"><app-icon name="tick" [size]="11" /></span> }
                    {{ busyKey() === tile.photo.key ? texts().saving : tile.caption }}
                  </span>
                </button>
                <!-- TODO(photos-round): ui-spec 4.7 "Bekijk groot": the sibling button with tile.compareLabel, the compare
                     view (current() left, stepping, compareNeighbours() strip, compareOpened) and a file dropped on the sheet. -->
              </li>
            }
          </ul>
        } @else {
          <p class="pk-note">{{ texts().empty }}</p>
        }

        @if (texts().automatic; as automatic) {
          <div class="pk-auto">
            <p>{{ automatic.text }}</p>
            @if (automatic.link; as link) {
              <button class="pk-link" type="button" [disabled]="busy()" (click)="cleared.emit()">{{ link }}</button>
            }
          </div>
        }
        @if (texts().footnote; as footnote) { <p class="pk-foot">{{ footnote }}</p> }
      </div>
    </app-sheet>
  `,
  styles: `
    :host { display: contents; }
    .pk { display: grid; gap: 14px; min-width: 0; }
    .pk :is(button, label):focus-visible, .pk-upload:focus-within { outline: 2px solid var(--ink); outline-offset: 2px; }
    .pk-top { display: grid; gap: 14px; }
    .pk-upload { position: relative; display: grid; grid-template-columns: 44px minmax(0, 1fr); align-items: center; gap: 12px; min-height: 64px; padding: 9px 14px;
      border: 1.5px dashed var(--rose-mid); border-radius: 14px; background: var(--rose-soft); color: var(--rose-dark); cursor: pointer; }
    .pk-upload--off { opacity: .6; cursor: wait; }
    .pk-upload__icon { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 12px; background: var(--rose); color: #fff; }
    .pk-upload b { display: block; font-size: 14.5px; }
    .pk-upload small { display: block; font-size: 12.5px; line-height: 1.35; }
    .pk-file { position: absolute; width: 1px; height: 1px; opacity: 0; overflow: hidden; }
    .pk-intro { color: var(--ink-2); font-size: 13.5px; line-height: 1.5; }
    .pk-note, .pk-foot { color: #6a615b; font-size: 12.5px; line-height: 1.45; }
    .pk-foot { font-size: 12px; }
    .pk-size { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; font-size: 13px; font-weight: 650; }
    .pk-seg { flex: 1 1 240px; height: 44px; max-width: 360px; }
    .pk-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin: 0; padding: 0; list-style: none; }
    .pk-tile { display: grid; min-width: 0; overflow: hidden; border: 1px solid var(--line-strong); border-radius: 14px; background: var(--surface); }
    .pk-tile__pick { display: grid; grid-template-rows: auto 1fr; min-width: 0; padding: 0; border: 0; background: transparent; color: inherit; font: inherit;
      text-align: left; cursor: pointer; }
    .pk-tile__pick:disabled { cursor: wait; }
    .pk-tile__pic { display: grid; place-items: center; height: 132px; padding: 6px; border-bottom: 1px solid var(--line); background: #fff; }
    .pk-tile__pic img { max-width: 100%; max-height: 120px; object-fit: contain; }
    .pk-tile__label { display: flex; align-items: center; gap: 6px; min-height: 40px; padding: 6px 10px; color: var(--ink-2); font-size: 12.5px; font-weight: 600;
      line-height: 1.3; overflow-wrap: anywhere; }
    .pk-tile__label--warn { color: #7c450b; }
    .pk-tile--on { border-color: var(--rose); box-shadow: 0 0 0 2px var(--rose); }
    .pk-tile--on .pk-tile__label { background: var(--rose-soft); color: var(--rose-dark); font-weight: 700; }
    .pk-tick { display: grid; place-items: center; flex: none; width: 18px; height: 18px; border-radius: 50%; background: var(--rose); color: #fff; }
    .pk-auto { display: grid; justify-items: start; padding: 10px 12px 4px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface-2);
      color: var(--ink-2); font-size: 12.5px; line-height: 1.45; }
    .pk-auto p:only-child { padding-bottom: 6px; }
    .pk-link { min-height: 44px; padding: 0; border: 0; background: none; color: var(--rose-dark); font: inherit; font-size: 13px; font-weight: 650;
      text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
    .pk-link:disabled { opacity: .5; cursor: wait; }
    @media (min-width: 680px) {
      .pk-top:has(.pk-upload) { grid-template-columns: minmax(0, 1fr) 360px; align-items: center; gap: 20px; }
      .pk-top .pk-intro { order: -1; }
      .pk-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
      .pk-tile__pic { height: 196px; padding: 8px; }
      .pk-tile__pic img { max-height: 180px; }
    }
  `,
})
export class ProductPhotoPicker {
  /** The picker that is open (after the one-colour rule: see `pickerModel`). */
  readonly kind = input.required<PhotoPickerKind>();
  readonly texts = input.required<PickerTexts>();
  /** The photo the place shows now: the left half of "Bekijk groot". */
  readonly current = input<PlacePhoto | null>(null);
  /** The photo of now first, then the gallery order. */
  readonly candidates = input.required<PickerTile[]>();
  /** The tile whose choice is being saved; it reads "Bewaren…". */
  readonly busyKey = input<string | null>(null);
  /** The upload-and-use flow: sending the file, then saving the choice. */
  readonly uploading = input<'upload' | 'save' | null>(null);
  readonly detailSize = input<'STANDARD' | 'LARGE' | null>(null);
  /** Other colours' catalogue photos for "Bekijk groot"; null = no strip. */
  readonly compareNeighbours = input<PhotoCompareNeighbour[] | null>(null);
  readonly disabled = input(false);

  readonly picked = output<string>();
  readonly cleared = output<void>();
  readonly uploadRequested = output<File>();
  readonly sizeChanged = output<'STANDARD' | 'LARGE'>();
  readonly compareOpened = output<void>();
  readonly closed = output<void>();

  readonly acceptTypes = PHOTO_UPLOAD_TYPES.join(',');
  readonly busy = computed(() => this.disabled() || this.busyKey() !== null || this.uploading() !== null);
  readonly sizeOptions = computed<SegmentOption[]>(() => {
    const size = this.texts().size;
    return size ? [{ id: 'STANDARD', label: size.standard }, { id: 'LARGE', label: size.large }] : [];
  });

  pickFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (file && !this.busy()) this.uploadRequested.emit(file);
  }
}
