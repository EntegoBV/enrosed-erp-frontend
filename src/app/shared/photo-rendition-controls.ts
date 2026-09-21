import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthImage } from '../core/api/auth-image';
import { CatalogApi } from '../core/api/catalog-api';
import { saveBlob } from '../core/api/download';
import { messageOf } from '../core/api/errors';
import { PhotoRendition, PhotoRenditions } from '../core/api/models';
import { formatBytes } from './format-bytes';

type Profile = 'original' | 'small' | 'medium' | 'custom';

/** Inspect and download smaller copies without replacing or republishing the source. */
@Component({
  selector: 'app-photo-rendition-controls',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, AuthImage],
  template: `
    <section class="renditions" aria-label="Fotoformaten en compressie" [attr.aria-busy]="loading()">
      <div class="renditions__head"><b>Fotoformaten en compressie</b><small>Het origineel blijft bewaard voor downloaden en de druk-PDF. Kleine versies laden sneller in het ERP.</small></div>
      @if (error()) { <p class="renditions__error" role="alert">{{ error() }} <button class="btn btn--sm" type="button" (click)="load()" [disabled]="loading()">Opnieuw laden</button></p> }
      @if (loading() && !metadata()) { <p role="status">Fotoformaten laden…</p> }
      @if (metadata()) {
        <div class="renditions__versions" role="group" aria-label="Versie bekijken">
          @for (version of versions(); track version.key) {
            <button type="button" [attr.aria-pressed]="profile() === version.key" (click)="profile.set(version.key)" [disabled]="loading()">
              <b>{{ version.label }}</b><span>{{ dimensions(version.value) }}</span><strong>{{ bytes(version.value.sizeBytes) }}</strong>
            </button>
          }
        </div>
        @if (current(); as rendition) {
          <img class="renditions__preview" [appAuthSrc]="rendition.url" appAuthSize="original" [alt]="filename() + ' — ' + profileLabel()" />
          <div class="renditions__download"><small>{{ profileLabel() }} · {{ dimensions(rendition) }} · {{ bytes(rendition.sizeBytes) }}</small><button class="btn btn--sm" type="button" [disabled]="downloading() || loading()" (click)="download()">{{ downloading() ? 'Downloaden…' : 'Download deze versie' }}</button></div>
        }
        <fieldset [disabled]="disabled() || loading()">
          <legend>Een andere bestandsgrootte maken</legend>
          <label><span>Voorinstelling</span><select class="select" [ngModel]="preset()" (ngModelChange)="selectPreset($event)"><option value="mobile">Mobiel · 480 px · 75%</option><option value="screen">Scherm · 1280 px · 82%</option><option value="large">Groot · 2400 px · 92%</option><option value="custom">Zelf instellen</option></select></label>
          <div class="renditions__inputs">
            <label><span>Gewenste maximale breedte (px)</span><input class="input" type="number" min="160" max="2400" step="1" [ngModel]="width()" (ngModelChange)="setWidth($event)" /></label>
            <label><span>JPEG-kwaliteit (%)</span><input class="input" type="number" min="40" max="95" step="1" [ngModel]="quality()" (ngModelChange)="setQuality($event)" /></label>
          </div>
          <small>Transparante beelden gebruiken PNG zonder kwaliteitsverlies. Andere beelden gebruiken JPEG met de gekozen kwaliteit. Een kleine bron wordt niet vergroot.</small>
          <small>De getoonde afmetingen en bestandsgrootte zijn het werkelijke resultaat. Als veilig verkleinen geen kleiner bestand oplevert, blijft de bronversie behouden.</small>
          <button class="btn btn--sm" type="button" [disabled]="!validSettings()" (click)="generate()">{{ loading() ? 'Versie maken…' : 'Versie maken en vergelijken' }}</button>
        </fieldset>
        <p class="renditions__note">De eigen versie is bedoeld om te vergelijken en downloaden. Deze instellingen worden niet als vaste fotoversie opgeslagen en veranderen geen publicatiekanaal of cataloguskeuze.</p>
      }
    </section>
  `,
  styles: `
    :host { display: block; min-width: 0; }
    .renditions { padding-top: 16px; margin-top: 16px; border-top: 1px solid var(--line); }
    .renditions__head, label { display: grid; gap: 6px; }
    .renditions__head b, legend { font-size: 12px; font-weight: 650; }
    small, label > span, .renditions__note { color: var(--muted); font-size: 11px; line-height: 1.5; }
    .renditions__versions { display: grid; grid-template-columns: repeat(auto-fit, minmax(115px, 1fr)); gap: 8px; margin-top: 12px; }
    .renditions__versions button { display: grid; gap: 4px; min-width: 0; padding: 10px; min-height: 76px; border: 1px solid var(--line); border-radius: 9px; background: var(--surface); color: var(--ink); text-align: left; cursor: pointer; }
    .renditions__versions button[aria-pressed=true] { border-color: var(--rose); background: var(--rose-soft); }
    .renditions__versions b { font-size: 12px; } .renditions__versions span { font-size: 10px; color: var(--muted); } .renditions__versions strong { font-size: 12px; }
    .renditions__preview { display: block; width: 100%; height: 200px; object-fit: contain; margin: 12px 0; background: repeating-conic-gradient(#eee 0% 25%,#fff 0% 50%) 50% / 16px 16px; border-radius: 9px; }
    .renditions__download { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; }
    fieldset { display: grid; gap: 12px; min-width: 0; margin: 16px 0 0; padding: 14px; border: 1px solid var(--line); border-radius: 9px; }
    legend { padding-inline: 5px; } .renditions__inputs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .input, .select { width: 100%; min-width: 0; min-height: 44px; font-size: 13px; } .btn { min-height: 44px; }
    .renditions__error { color: var(--danger); font-size: 12px; } .renditions__note { margin-bottom: 0; }
    button:focus-visible { outline: 2px solid var(--rose); outline-offset: 2px; }
    @media(max-width: 560px) { .input, .select { font-size: 16px; } .renditions__inputs { grid-template-columns: 1fr; } }
  `,
})
export class PhotoRenditionControls {
  private readonly catalog = inject(CatalogApi);
  readonly endpoint = input.required<string>();
  readonly filename = input.required<string>();
  readonly disabled = input(false);
  readonly metadata = signal<PhotoRenditions | null>(null);
  readonly loading = signal(false);
  readonly downloading = signal(false);
  readonly error = signal<string | null>(null);
  readonly profile = signal<Profile>('medium');
  readonly preset = signal('screen');
  readonly width = signal<number | null>(1280);
  readonly quality = signal<number | null>(82);
  readonly bytes = formatBytes;
  private sequence = 0;
  readonly versions = computed(() => {
    const data = this.metadata();
    const names = [{ key: 'original', label: 'Origineel' }, { key: 'small', label: 'Klein' }, { key: 'medium', label: 'Scherm' }, { key: 'custom', label: 'Eigen versie' }] as const;
    return data ? names.flatMap(item => data[item.key] ? [{ ...item, value: data[item.key]! }] : []) : [];
  });
  readonly current = computed(() => this.metadata()?.[this.profile()] ?? null);
  readonly validSettings = computed(() => {
    const width = this.width(), quality = this.quality();
    return width !== null && quality !== null && Number.isInteger(width) && Number.isInteger(quality)
      && width >= 160 && width <= 2400 && quality >= 40 && quality <= 95;
  });

  constructor() { effect(() => { const endpoint = this.endpoint(); this.metadata.set(null); this.profile.set('medium'); void this.fetch(endpoint); }); }
  dimensions(value: PhotoRendition): string { return value.widthPx && value.heightPx ? `${value.widthPx} × ${value.heightPx} px` : 'Afmetingen onbekend'; }
  profileLabel(): string { return this.versions().find(row => row.key === this.profile())?.label ?? ''; }
  load(): void { void this.fetch(this.endpoint()); }
  setWidth(value: number | null): void { this.width.set(value); this.preset.set('custom'); }
  setQuality(value: number | null): void { this.quality.set(value); this.preset.set('custom'); }
  selectPreset(value: string): void {
    this.preset.set(value);
    const settings = ({ mobile: [480, 75], screen: [1280, 82], large: [2400, 92] } as Record<string, number[]>)[value];
    if (settings) { this.width.set(settings[0]); this.quality.set(settings[1]); }
  }
  generate(): void {
    if (!this.validSettings() || this.loading() || this.disabled()) return;
    void this.fetch(this.endpoint(), { width: this.width()!, quality: this.quality()! });
  }
  private async fetch(endpoint: string, custom?: { width: number; quality: number }): Promise<void> {
    const sequence = ++this.sequence;
    this.loading.set(true); this.error.set(null);
    try {
      const data = await this.catalog.photoRenditions(endpoint, custom);
      if (sequence !== this.sequence) return;
      this.metadata.set(data);
      if (custom && data.custom) this.profile.set('custom');
      else if (!data[this.profile()]) this.profile.set('medium');
    } catch (failure: unknown) {
      if (sequence === this.sequence) this.error.set(messageOf(failure, 'Fotoformaten laden mislukt'));
    } finally { if (sequence === this.sequence) this.loading.set(false); }
  }
  async download(): Promise<void> {
    const rendition = this.current();
    if (!rendition || this.downloading()) return;
    const profile = this.profile(), originalFilename = this.filename();
    this.downloading.set(true);
    try {
      const blob = await this.catalog.photoBlob(rendition.url);
      const extension = rendition.contentType === 'image/png' ? 'png' : rendition.contentType === 'image/webp' ? 'webp' : rendition.contentType === 'image/gif' ? 'gif' : 'jpg';
      const filename = profile === 'original' ? originalFilename : `${originalFilename.replace(/\.[^.]+$/, '')}-${profile}-${rendition.widthPx ?? 'screen'}.${extension}`;
      saveBlob(blob, filename);
    } catch (failure: unknown) { this.error.set(messageOf(failure, 'Foto downloaden mislukt')); }
    finally { this.downloading.set(false); }
  }
}
