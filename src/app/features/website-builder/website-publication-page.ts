import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { CatalogApi } from '../../core/api/catalog-api';
import { messageOf } from '../../core/api/errors';
import { WebsiteBuilderHomepage } from '../../core/api/models';
import { PageHeader } from '../../shared/page-header';
import { WebsiteSyncStatus } from '../settings/website-sync-status';
import { WebsiteAdminNav } from './website-admin-nav';

@Component({
  selector: 'app-website-publication-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeader, RouterLink, WebsiteAdminNav, WebsiteSyncStatus],
  template: `
    <app-page-header
      title="Website publiceren"
      subtitle="Zie het verschil tussen opgeslagen, gepubliceerd en werkelijk live."
      [showBell]="false"
    >
      <a class="btn btn--primary btn--sm" [href]="previewBaseUrl" target="_blank" rel="noopener">
        Testsite openen ↗
      </a>
    </app-page-header>

    <main class="content publication-page">
      <app-website-admin-nav active="publication" />

      <section class="publication-guide" role="note">
        <span aria-hidden="true">1</span><div><b>Opslaan</b><small>Bewaart een concept in het ERP.</small></div>
        <i aria-hidden="true">→</i>
        <span aria-hidden="true">2</span><div><b>Publiceren</b><small>Maakt de gekozen homepage-indeling actief.</small></div>
        <i aria-hidden="true">→</i>
        <span aria-hidden="true">3</span><div><b>Website-build</b><small>Vercel verwerkt de nieuwe data op de testsite.</small></div>
      </section>

      <app-website-sync-status />

      @if (loading()) {
        <section class="snapshot-state card" role="status">Publicatiegegevens laden…</section>
      } @else if (loadError()) {
        <section class="snapshot-state snapshot-state--error card" role="alert">
          <div><b>Publicatiegegevens niet geladen</b><small>{{ loadError() }}</small></div>
          <button class="btn btn--primary" type="button" (click)="load()">Opnieuw proberen</button>
        </section>
      } @else if (snapshot(); as current) {
        <section class="snapshot-grid" aria-label="Concept en publicatie">
          <article class="snapshot-card card" [class.snapshot-card--warn]="hasUnpublishedChanges()">
            <span>Concept</span>
            <b>{{ hasUnpublishedChanges() ? 'Klaar om te publiceren' : 'Gelijk aan gepubliceerd' }}</b>
            <small>{{ visibleDraftSections() }} homepage-onderdelen zichtbaar</small>
            <time [attr.datetime]="current.updatedAt">{{ current.updatedAt ? formatMoment(current.updatedAt) : 'Nog geen wijziging geregistreerd' }}</time>
          </article>
          <article class="snapshot-card card snapshot-card--ok">
            <span>Gepubliceerde indeling</span>
            <b>{{ visiblePublishedSections() }} onderdelen actief</b>
            <small>Revisie {{ current.revision }}</small>
            <time [attr.datetime]="current.publishedAt">{{ current.publishedAt ? formatMoment(current.publishedAt) : 'Nog niet gepubliceerd' }}</time>
          </article>
        </section>

        <section class="publication-actions card">
          <div>
            <h2>{{ hasUnpublishedChanges() ? 'Er staat een concept klaar' : 'Indeling is gepubliceerd' }}</h2>
            <p>{{ hasUnpublishedChanges()
              ? 'Controleer het live voorbeeld en publiceer vanuit Homepage-indeling.'
              : 'Controleer hierboven of de website-build ook de status Live heeft.' }}</p>
          </div>
          <a class="btn btn--primary" routerLink="/website/layout">
            {{ hasUnpublishedChanges() ? 'Controleren & publiceren' : 'Indeling bekijken' }}
          </a>
        </section>
      }
    </main>
  `,
  styles: `
    :host { display: block; }
    .publication-page { max-width: 1380px; padding-bottom: calc(72px + env(safe-area-inset-bottom)); }
    .publication-guide {
      display: grid; grid-template-columns: auto 1fr auto auto 1fr auto auto 1fr; align-items: center;
      gap: 12px; margin-bottom: 14px; padding: 18px; border: 1px solid var(--line);
      border-radius: var(--r); background: var(--surface);
    }
    .publication-guide > span { display: grid; width: 36px; height: 36px; place-items: center; border-radius: 50%; background: var(--rose-soft); color: var(--rose-dark); font-weight: 850; }
    .publication-guide > div { display: grid; gap: 2px; }
    .publication-guide b { font-size: 15px; }
    .publication-guide small { color: var(--muted); font-size: 13px; line-height: 1.4; }
    .publication-guide i { color: var(--muted-2); font-size: 20px; font-style: normal; }
    .snapshot-state { display: flex; min-height: 150px; align-items: center; justify-content: center; color: var(--muted); }
    .snapshot-state--error { justify-content: space-between; gap: 16px; padding: 18px; color: var(--danger); }
    .snapshot-state--error > div { display: grid; gap: 3px; }
    .snapshot-state--error small { color: var(--muted); }
    .snapshot-state .btn { min-height: 48px; }
    .snapshot-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .snapshot-card { display: grid; gap: 6px; min-height: 170px; align-content: center; padding: 20px; border-left: 5px solid var(--line-strong); }
    .snapshot-card--warn { border-left-color: var(--warn); background: var(--warn-soft); }
    .snapshot-card--ok { border-left-color: var(--ok); }
    .snapshot-card > span { color: var(--muted); font-size: 12px; font-weight: 850; letter-spacing: .1em; text-transform: uppercase; }
    .snapshot-card b { font-size: 22px; }
    .snapshot-card small, .snapshot-card time { color: var(--muted); font-size: 14px; }
    .publication-actions { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-top: 12px; padding: 20px; }
    .publication-actions h2 { font-size: 21px; }
    .publication-actions p { margin-top: 4px; color: var(--muted); font-size: 15px; line-height: 1.5; }
    .publication-actions .btn { min-height: 48px; flex: none; }

    @media (max-width: 800px) {
      .publication-page { padding-inline: 12px; }
      .publication-guide { grid-template-columns: auto 1fr; }
      .publication-guide i { display: none; }
      .snapshot-grid { grid-template-columns: 1fr; }
      .publication-actions, .snapshot-state--error { align-items: stretch; flex-direction: column; }
      .publication-actions .btn, .snapshot-state .btn { width: 100%; }
    }
  `,
})
export class WebsitePublicationPage {
  private readonly catalog = inject(CatalogApi);
  readonly previewBaseUrl = environment.websitePreviewUrl;
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly snapshot = signal<WebsiteBuilderHomepage | null>(null);

  readonly hasUnpublishedChanges = computed(() => {
    const current = this.snapshot();
    return !!current && JSON.stringify(current.draft.sections) !== JSON.stringify(current.published.sections);
  });
  readonly visibleDraftSections = computed(() =>
    this.snapshot()?.draft.sections.filter((section) => section.enabled).length ?? 0,
  );
  readonly visiblePublishedSections = computed(() =>
    this.snapshot()?.published.sections.filter((section) => section.enabled).length ?? 0,
  );

  private readonly dateFormatter = new Intl.DateTimeFormat('nl-BE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  constructor() { void this.load(); }

  async load(): Promise<void> {
    if (this.loading() && this.snapshot()) return;
    this.loading.set(true);
    this.loadError.set(null);
    try {
      this.snapshot.set(await this.catalog.websiteBuilderHomepage());
    } catch (failure: unknown) {
      this.loadError.set(messageOf(failure, 'Controleer de verbinding met de testomgeving.'));
    } finally {
      this.loading.set(false);
    }
  }

  formatMoment(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Tijdstip onbekend' : this.dateFormatter.format(date);
  }
}
