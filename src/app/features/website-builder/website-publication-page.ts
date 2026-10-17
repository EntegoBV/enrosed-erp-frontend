import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, inject } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { IosNav } from '../../shared/ios-nav';
import { LoadError } from '../../shared/load-error';
import { Skeleton } from '../../shared/skeleton';
import { WEBSITE_SYNC_TECHNICAL, rebuildTimeline, shortMoment, websiteSyncCopy } from '../settings/website-sync-copy';
import { WebsiteSyncStatus } from '../settings/website-sync-status';
import { WebsiteSyncStore } from '../settings/website-sync-store';
import { differenceLine, homepageDifferences } from './website-homepage';
import { WebsiteRecent } from './website-recent';
import { WebsiteStatusBar } from './website-status-bar';
import { WebsiteStore } from './website-store';

/**
 * Publicatie of Website beheren (/website/publication): what stands live and
 * what is coming. The website update as one state with its four moments
 * (queued, started, accepted, live), the homepage concept next to what is
 * live with the differences in words, and the latest changes of reeksen.
 */
@Component({
  selector: 'app-website-publication-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrls: ['../../../styles/website-workspace.scss', '../../../styles/website-overview.scss', '../../../styles/website-publication.scss'],
  imports: [IosNav, LoadError, NgTemplateOutlet, RouterLink, Skeleton, WebsiteRecent, WebsiteStatusBar, WebsiteSyncStatus],
  template: `
    <ng-template #updateBody>
      @if (sync.status() || sync.loadError()) {
        <div class="ws-live" role="status">
          <span class="ws-live__state" [class]="'ws-live__state is-' + copy().tone"><i aria-hidden="true"></i>{{ copy().label }}</span>
          <span class="ws-live__detail">{{ copy().detail }}@if (copy().moment; as moment) { · {{ moment }} }</span>
          @if (copy().error; as error) { <span class="ws-live__error">{{ error }}</span> }
          @if (copy().nextAttempt; as next) { <span class="ws-live__detail">{{ next }}</span> }
          @if (copy().action; as action) {
            @if (action === 'todo') { <a class="wk-btn wk-btn--sm" routerLink="/website" fragment="translation-work">{{ copy().actionLabel }}</a> }
            @else {
              <button class="wk-btn wk-btn--sm" type="button" [disabled]="sync.loading() || sync.retrying()"
                      (click)="action === 'retry' ? sync.retry() : sync.load()">{{ copy().actionLabel }}</button>
            }
          }
          @if (sync.status()?.status === 'NOT_CONFIGURED') {
            <details class="ws-tech"><summary>Technische uitleg</summary><p>{{ technical }}</p></details>
          }
        </div>
        @if (timeline(); as steps) {
          <ol class="ws-timeline" aria-label="Verloop van de laatste website-update">
            @for (step of steps; track step.label) {
              <li [class]="'is-' + step.state"><i aria-hidden="true"></i><b>{{ step.label }}</b><time>{{ step.moment ?? (step.state === 'current' ? 'bezig' : step.state === 'failed' ? 'mislukt' : '—') }}</time></li>
            }
          </ol>
        }
      } @else {
        <div class="ws-scroll"><app-skeleton kind="lines" [rows]="4" /></div>
      }
    </ng-template>

    <ng-template #homepageBody>
      @if (store.homepageSummary(); as home) {
        <dl class="ws-compare">
          <div class="ws-compare__head"><dt></dt><dd>Concept</dd><dd>Live</dd></div>
          <div><dt>Blokken zichtbaar</dt><dd>{{ home.draftVisible }}</dd><dd>{{ home.publishedVisible }}</dd></div>
          <div><dt>Moment</dt>
            <dd>{{ home.updatedAt ? 'Gewijzigd ' + moment(home.updatedAt) : 'Nooit gewijzigd' }}</dd>
            <dd>{{ home.publishedAt ? 'Gepubliceerd ' + moment(home.publishedAt) : 'Standaardindeling · nooit aangepast' }}</dd></div>
          <div><dt>Conceptversie</dt><dd>{{ home.revision }}</dd><dd></dd></div>
        </dl>
        <div class="ws-diff">
          @for (line of differences(); track line) { <p>{{ line }}</p> } @empty { <p class="ws-diff--same">Concept en live zijn gelijk.</p> }
        </div>
        @if (home.differs) {
          <div class="ws-card-foot"><a class="wk-btn wk-btn--primary" routerLink="/website/layout">Controleren &amp; publiceren</a></div>
        }
      } @else if (store.errors().homepage) {
        <app-load-error title="Publicatiegegevens niet geladen" [message]="store.errors().homepage!" (retry)="reload()" />
      } @else {
        <div class="ws-scroll"><app-skeleton kind="lines" [rows]="4" /></div>
      }
    </ng-template>

    @if (desk.active()) {
      <div class="wk-page ws-page">
        <header class="wk-toolbar">
          <div class="wk-toolbar__lead">
            <h1 class="wk-toolbar__title">Publicatie</h1>
            <span class="ws-sub">Wat staat er live en wat komt eraan</span>
          </div>
          <div class="wk-toolbar__tools"><a class="wk-btn" routerLink="/website/layout">Homepage ›</a></div>
        </header>
        <div class="wk-body"><div class="wk-pane"><div class="ws-scroll">
          <div class="ws-cols ws-pub-cols">
            <div class="ws-col">
              <section class="ws-card" aria-labelledby="ws-update-title">
                <header class="ws-card-head"><h2 id="ws-update-title">Website-update</h2></header>
                <ng-container *ngTemplateOutlet="updateBody" />
              </section>
              <app-website-recent layout="card" [limit]="10" [fetchLimit]="10" />
            </div>
            <div class="ws-col">
              <section class="ws-card" aria-labelledby="ws-home-title">
                <header class="ws-card-head"><h2 id="ws-home-title">Homepage-indeling</h2></header>
                <ng-container *ngTemplateOutlet="homepageBody" />
              </section>
            </div>
          </div>
        </div></div></div>
        <app-website-status-bar [text]="statusText()" />
      </div>
    } @else {
      <div class="ios-page ws-ios">
        <app-ios-nav title="Publicatie" backLabel="Overzicht" backUrl="/website" backAriaLabel="Terug naar Overzicht">
          <app-website-sync-status caption variant="chip" />
        </app-ios-nav>
        <section class="ios-section"><div class="ios-section__head"><h2>Website-update</h2></div>
          <div class="ios-card ws-pub-ios-card"><ng-container *ngTemplateOutlet="updateBody" /></div></section>
        <section class="ios-section"><div class="ios-section__head"><h2>Homepage-indeling</h2></div>
          <div class="ios-card ws-pub-ios-card"><ng-container *ngTemplateOutlet="homepageBody" /></div></section>
        <app-website-recent layout="group" [limit]="5" [fetchLimit]="5" />
      </div>
    }
  `,
})
export class WebsitePublicationPage {
  readonly desk = inject(DesktopViewport);
  readonly store = inject(WebsiteStore);
  readonly sync = inject(WebsiteSyncStore);
  readonly technical = WEBSITE_SYNC_TECHNICAL;

  readonly copy = computed(() => websiteSyncCopy({
    status: this.sync.status(), loading: this.sync.loading(), loadError: this.sync.loadError(), pollEnded: this.sync.pollEnded(),
  }));
  readonly timeline = computed(() => rebuildTimeline(this.sync.status()));
  readonly differences = computed(() => {
    const snapshot = this.store.homepage();
    return snapshot ? homepageDifferences(snapshot).map(differenceLine) : [];
  });
  readonly statusText = computed(() => {
    const home = this.store.homepageSummary();
    return home ? `Homepage: ${home.differs ? 'concept niet gepubliceerd' : 'gelijk aan live'}` : '';
  });

  constructor() {
    void this.store.ensure(['homepage']);
  }

  reload(): void {
    void this.store.refresh(['homepage']);
  }

  moment(value: string): string {
    return shortMoment(value) ?? 'onbekend';
  }
}
