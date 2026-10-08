import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { saveBlob } from '../../core/api/download';
import { messageOf, readableFailure } from '../../core/api/errors';
import { InventoryApi, refusalCode, refusalDetails } from '../../core/api/inventory-api';
import type { ClosingView, DecisionWrite, Notice, NoticeSegment, OpeningLayerWrite } from '../../core/api/inventory-models';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { DateField } from '../../shared/date-field';
import { Icon } from '../../shared/icon';
import { PageHeader } from '../../shared/page-header';
import { EurPipe } from '../../shared/pipes';
import { BrusselsDatePipe, BrusselsDateTimePipe } from './inventory-dates';
import { Skeleton } from '../../shared/skeleton';
import { Ui } from '../../shared/ui';
import { ClosingDecisionSheet, noticeAnchor } from './closing-decision-sheet';
import type { DecisionSheetResult, DecisionSheetSpec } from './closing-decision-sheet';
import { ClosingStepCount } from './closing-step-count';
import { ClosingStepDate } from './closing-step-date';
import { ClosingStepFinalize } from './closing-step-finalize';
import { ClosingStepSeparate } from './closing-step-separate';
import { ClosingStepValue } from './closing-step-value';
import { dateText, fileName, sentence, stepStates, stripItems, versionStartRefusal } from './inventory-closing';
import type { StepState } from './inventory-closing';

const STEP_KEYS: readonly NoticeSegment[] = ['tellen', 'datum', 'waarde', 'apart', 'afsluiten'];

/** The dot of a step: done, under way, still to do. */
const STEP_TONE: Record<StepState, string> = { KLAAR: 'tone-ok', BEZIG: 'tone-warn', TODO: 'tone-grey' };
const STEP_WORD: Record<StepState, string> = { KLAAR: 'klaar', BEZIG: 'bezig', TODO: 'te doen' };

/** The reason sheet behind "Corrigeren (nieuwe versie)" of the banner, the same question step 5 asks. */
const CORRECTION_SPEC: DecisionSheetSpec = {
  title: 'Corrigeren (nieuwe versie)',
  lead: ['Deze versie blijft bewaard en leesbaar. De nieuwe versie start als concept met dezelfde beslissingen en wordt opnieuw berekend.'],
  reason: { label: 'Waarom is een correctie nodig?', value: '', required: true },
  saveLabel: 'Nieuwe versie starten',
};

/**
 * The closing of one financial year: the shell around the five step
 * components. It owns every call: a concept is opened with a recompute, so a
 * count booked or a container changed since the last visit is in the
 * figures, a final closing is read as stored. The steps only emit; each
 * answer of the server is a new view, which is also what closes their
 * sheets. Around the steps: the totals strip, the step bar (the active step
 * is the query `stap`, or the step the closing opened on: it never moves by
 * itself) and what is still to do. When the server says the figures moved
 * and the recompute that should follow fails, the page says so until a
 * recompute answers, and nothing can be made final meanwhile. A phone gets
 * the summary only. Layout classes of the shell are the .inv-shell ones below; the
 * steps bring styles/inventory-closing.scss.
 */
@Component({
  selector: 'app-stock-closing-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PageHeader, Skeleton, Icon, DateField, BrusselsDatePipe, BrusselsDateTimePipe, EurPipe, ClosingDecisionSheet,
    ClosingStepCount, ClosingStepDate, ClosingStepValue, ClosingStepSeparate, ClosingStepFinalize],
  template: `
    <app-page-header [showBack]="true" backTo="/stock/inventaris" [showBell]="false" [title]="title()" [subtitle]="subtitle()" />

    <div class="content inv-shell" [class.inv-shell--phone]="!desktop.active()">
      @if (view(); as v) {
        @if (v.status === 'DEFINITIEF') {
          <div class="alert alert--ok inv-shell__banner" role="status">
            <span>Definitief sinds {{ v.finalizedAt | brusselsDate }} door {{ v.finalizedByName || 'onbekend' }}. Niets kan nog gewijzigd worden.</span>
            <span class="inv-shell__banner-actions">
              <button class="btn btn--sm" type="button" [disabled]="busy()" (click)="download('pdf')">PDF</button>
              <button class="btn btn--sm" type="button" [disabled]="busy()" (click)="download('xlsx')">Excel</button>
              @if (v.canCorrect) {
                <button class="btn btn--sm" type="button" [disabled]="busy()" (click)="correcting.set(true)">Corrigeren (nieuwe versie)</button>
              }
            </span>
          </div>
        }
        @if (v.supersededById !== null) {
          <div class="alert alert--warn inv-shell__banner" role="status">
            <span>{{ replacedText() }}</span>
            <a class="inv-shell__link" [routerLink]="['/stock/inventaris/afsluiting', v.supersededById]">Open die versie ›</a>
          </div>
        }
        @if (v.previousClosingReplacedBy; as newer) {
          <div class="alert alert--warn inv-shell__banner" role="status">
            <span>Steunt op versie {{ v.previousClosing?.versionNo }} van {{ v.previousClosing?.closingYear }}, die vervangen is door versie {{ newer.versionNo }}. Maak een nieuwe versie.</span>
          </div>
        }

        @if (stale(); as why) {
          <div class="alert alert--danger inv-shell__banner" role="alert">
            <span>{{ why }} De cijfers op dit scherm zijn niet meer actueel.</span>
            <span class="inv-shell__banner-actions">
              <button class="btn btn--sm" type="button" [disabled]="busy()" (click)="recompute(true)">Herbereken</button>
            </span>
          </div>
        }

        <div class="inv-shell__bar">
          @if (desktop.active() && v.status === 'CONCEPT') {
            <label class="inv-shell__date" for="inv-shell-date">Afsluitdatum</label>
            <app-date-field class="inv-shell__datefield" fieldId="inv-shell-date" [value]="dateDraft()" (valueChange)="changeDate($event)" />
          }
          <span class="inv-shell__computed">@if (computing()) { Wordt herberekend… } @else { Berekend op {{ v.computedAt | brusselsDateTime }} }</span>
          @if (v.status === 'CONCEPT') {
            <span class="inv-shell__tools">
              @if (desktop.active()) {
                <button class="wk-btn" type="button" [class.is-busy]="computing()" [disabled]="busy()" (click)="recompute(true)">
                  <app-icon name="refresh" [size]="16" /> Herbereken</button>
              }
              <button class="wk-btn" type="button" [disabled]="busy()" (click)="download('pdf')">PDF</button>
              <button class="wk-btn" type="button" [disabled]="busy()" (click)="download('xlsx')">Excel</button>
            </span>
          }
        </div>

        @if (desktop.active()) {
          <div class="wk-strip inv-shell__strip" role="group" aria-label="Totalen">
            @for (item of strip(); track item.key) {
              <div class="wk-strip__item" [class.inv-shell__grand]="item.grand"><span class="wk-strip__label">{{ item.label }}</span>
                <span class="wk-strip__value">{{ item.valueEur | eur }}</span>
                @if (item.sub; as sub) { <span class="inv-shell__sub">{{ sub.label }} {{ sub.valueEur | eur }}</span> }
              </div>
            }
          </div>

          <div class="inv-shell__grid">
            <div class="inv-shell__main">
              <nav class="inv-shell__steps" aria-label="Stappen">
                @for (step of steps(); track step.key) {
                  <a class="inv-shell__step" [class.is-on]="step.key === stap()" [attr.aria-current]="step.key === stap() ? 'step' : null"
                     [routerLink]="[]" [queryParams]="{ stap: step.key }" queryParamsHandling="merge" [replaceUrl]="true">
                    <span class="wk-dot" [class]="tone(step.state)" [attr.aria-label]="word(step.state)" role="img"></span>
                    <span>{{ step.line }}</span>
                  </a>
                }
              </nav>
              @switch (stap()) {
                @case ('tellen') { <app-closing-step-count [view]="v" [busy]="busy()" /> }
                @case ('datum') {
                  <app-closing-step-date [view]="v" [busy]="busy()" (decision)="saveDecision($event)" (removeDecision)="removeDecision($event)" />
                }
                @case ('waarde') {
                  <app-closing-step-value [view]="v" [busy]="busy()" (decision)="saveDecision($event)" (removeDecision)="removeDecision($event)"
                                          (openingLayers)="saveOpeningLayers($event)" (retireOpeningLayer)="retireOpeningLayer($event)" />
                }
                @case ('apart') {
                  <app-closing-step-separate [view]="v" [busy]="busy()" (decision)="saveDecision($event)" (removeDecision)="removeDecision($event)" />
                }
                @default {
                  <app-closing-step-finalize [view]="v" [busy]="busy()" [stale]="stale() !== null" [refused]="refused()" (recompute)="recompute(true)" (decision)="saveDecision($event)" (removeDecision)="removeDecision($event)"
                                             (finalize)="finalize($event.signerName)" (startVersion)="startVersion($event.reason)"
                                             (download)="download($event)" />
                }
              }
            </div>

            <!-- Step 5 lists both itself; a final closing has nothing left to do. -->
            @if (stap() !== 'afsluiten') {
            <aside class="inv-shell__aside" aria-label="Nog te doen en aandachtspunten">
              @if (v.status === 'CONCEPT') {
              <section class="inv-shell__todo">
                <h2 class="inv-shell__todo-title" [class.inv-shell__todo-title--stop]="blockers().length > 0">Nog te doen ({{ blockers().length }})</h2>
                @for (notice of blockers(); track $index) {
                  <a class="inv-shell__notice" [routerLink]="[]" [queryParams]="{ stap: notice.segment }" queryParamsHandling="merge"
                     [fragment]="anchor(notice)">{{ notice.message }}</a>
                } @empty {
                  <p class="inv-shell__quiet">Niets houdt de afsluiting nog tegen.</p>
                }
              </section>
              }
              <section class="inv-shell__todo">
                <h2 class="inv-shell__todo-title">Aandachtspunten ({{ warnings().length }})</h2>
                @for (notice of warnings(); track $index) {
                  <a class="inv-shell__notice" [routerLink]="[]" [queryParams]="{ stap: notice.segment }" queryParamsHandling="merge"
                     [fragment]="anchor(notice)">{{ notice.message }}</a>
                } @empty {
                  <p class="inv-shell__quiet">Geen aandachtspunten.</p>
                }
              </section>
            </aside>
            }
          </div>
        } @else {
          <div class="ios-figures inv-shell__figures" role="group" aria-label="Totalen">
            @for (item of strip(); track item.key) {
              <div [class.inv-shell__grand]="item.grand"><small>{{ item.label }}</small><strong>{{ item.valueEur | eur }}</strong>
                @if (item.sub; as sub) { <small>{{ sub.label }} {{ sub.valueEur | eur }}</small> }
              </div>
            }
          </div>
          @if (v.status === 'CONCEPT') {
            <section class="card inv-shell__todo">
              <h2 class="inv-shell__todo-title" [class.inv-shell__todo-title--stop]="blockers().length > 0">Nog te doen ({{ blockers().length }})</h2>
              @for (notice of blockers(); track $index) { <p class="inv-shell__notice">{{ notice.message }}</p> }
              @empty { <p class="inv-shell__quiet">Niets houdt de afsluiting nog tegen.</p> }
            </section>
          }
          <section class="card inv-shell__todo">
            <h2 class="inv-shell__todo-title">Aandachtspunten ({{ warnings().length }})</h2>
            @for (notice of warnings(); track $index) { <p class="inv-shell__notice">{{ notice.message }}</p> }
            @empty { <p class="inv-shell__quiet">Geen aandachtspunten.</p> }
          </section>
          <p class="inv-shell__desk">Waarderen en afsluiten doe je op een groter scherm.</p>
        }
      } @else if (loadError(); as message) {
        <div class="alert alert--danger" role="alert">
          <span><strong>De afsluiting kon niet worden geladen.</strong> {{ message }}</span>
        </div>
        <p class="inv-shell__retry">
          @if (validId()) { <button class="btn btn--sm btn--primary" type="button" (click)="reload()">Opnieuw proberen</button> }
          <a class="inv-shell__link" routerLink="/stock/inventaris">Terug naar Jaarinventaris</a>
        </p>
      } @else {
        <div aria-busy="true"><app-skeleton kind="stats" /><app-skeleton kind="list" [rows]="6" /></div>
      }
    </div>

    @if (correcting()) {
      <app-closing-decision-sheet [spec]="correctionSpec" [busy]="busy()" (save)="startVersionFromSheet($event)" (closed)="correcting.set(false)" />
    }
  `,
  styles: `
    .inv-shell { --ios-inset: 0px; }
    .inv-shell__banner { align-items: center; flex-wrap: wrap; justify-content: space-between; gap: 8px 16px; margin-bottom: 10px; }
    .inv-shell__banner > span:first-child { flex: 1 1 260px; min-width: 0; }
    .inv-shell__banner-actions { display: flex; flex-wrap: wrap; gap: 6px; }
    .inv-shell__link { color: inherit; font-weight: 650; text-decoration: underline; text-underline-offset: 3px; white-space: nowrap; }
    .inv-shell__bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; min-height: 36px; margin: 0 2px 10px; }
    .inv-shell__date { color: var(--ink-2); font-size: 13px; font-weight: 650; }
    .inv-shell__datefield { width: 170px; }
    .inv-shell__computed { color: var(--muted); font-size: 12.5px; font-variant-numeric: tabular-nums; }
    .inv-shell__tools { display: flex; flex-wrap: wrap; gap: 6px; margin-left: auto; }
    .inv-shell__strip { margin-bottom: 14px; border: 1px solid var(--line); border-radius: 16px; }
    .inv-shell__grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; align-items: start; }
    .inv-shell__main { min-width: 0; }
    .inv-shell__steps { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
    .inv-shell__step { display: flex; flex: 1 1 150px; align-items: flex-start; gap: 8px; min-width: 0; padding: 9px 12px;
      border: 1px solid var(--line); border-radius: 12px; background: var(--surface); color: var(--ink-2); font-size: 12.5px;
      font-weight: 600; line-height: 1.35; text-decoration: none; }
    .inv-shell__step:hover { border-color: var(--line-strong); }
    .inv-shell__step:focus-visible { outline: 2px solid var(--rose); outline-offset: 2px; }
    .inv-shell__step.is-on { border-color: var(--rose-line); background: var(--rose-soft); color: var(--rose-dark); }
    .inv-shell__step .wk-dot { margin-top: 5px; }
    .inv-shell__aside { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; order: -1; }
    .inv-shell__todo { min-width: 0; padding: 12px 14px; border: 1px solid var(--line); border-radius: 16px; background: var(--surface); }
    /* The cards grow with their list: a title that says six must show six. */
    .inv-shell__grand { margin-left: auto; padding-left: 18px; border-left: 1px solid var(--line); }
    .inv-shell__grand .wk-strip__label { color: var(--ink); font-weight: 700; }
    .inv-shell__grand .wk-strip__value { font-size: 19px; font-weight: 750; }
    .inv-shell__sub { display: block; margin-top: 1px; color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
    .inv-shell__figures .inv-shell__grand { grid-column: 1 / -1; margin-left: 0; padding-left: 0; border-left: 0; }
    .inv-shell__retry { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; margin: 12px 2px 0; }
    .inv-shell__todo.card { border-color: rgb(255 255 255 / 70%); }
    .inv-shell__todo-title { margin: 0 0 6px; font-size: 13.5px; font-weight: 700; }
    .inv-shell__todo-title--stop { color: var(--danger); }
    .inv-shell__notice { display: block; margin: 0; padding: 7px 0; border-top: 1px solid var(--line); color: var(--ink-2);
      font-size: 12.5px; line-height: 1.45; text-decoration: none; overflow-wrap: anywhere; }
    a.inv-shell__notice:hover { color: var(--rose-dark); text-decoration: underline; text-underline-offset: 3px; }
    a.inv-shell__notice:focus-visible { outline: 2px solid var(--rose); outline-offset: 1px; border-radius: 4px; }
    .inv-shell__quiet { margin: 0; color: var(--muted); font-size: 12.5px; line-height: 1.45; }
    .inv-shell__figures { margin-bottom: 12px; }
    .inv-shell__figures small { line-height: 1.3; }
    .inv-shell--phone .inv-shell__notice { font-size: 13.5px; }
    .inv-shell--phone .inv-shell__tools { margin-left: 0; flex-basis: 100%; }
    .inv-shell__desk { margin: 16px 4px 0; color: var(--muted); font-size: 13.5px; line-height: 1.45; text-align: center; }
    /* The side column only where the product table of step 3 still fits beside it. */
    @media (min-width: 1560px) {
      .inv-shell__grid { grid-template-columns: minmax(0, 1fr) 280px; }
      .inv-shell__aside { position: sticky; top: calc(var(--appbar-h) + 12px); grid-template-columns: minmax(0, 1fr); order: 0;
        max-height: calc(100vh - var(--appbar-h) - 24px); overflow-y: auto; }
    }
  `,
})
export class StockClosingPage {
  private readonly api = inject(InventoryApi);
  private readonly ui = inject(Ui);
  private readonly router = inject(Router);
  readonly desktop = inject(DesktopViewport);

  /** Route parameter: the closing. */
  readonly id = input.required<string>();
  /** Query `stap`: the step on screen. Absent: the first step that is not done. */
  readonly stapParam = input<string>(undefined, { alias: 'stap' });

  readonly view = signal<ClosingView | null>(null);
  readonly loadError = signal<string | null>(null);
  /** A call under way: the steps and every button wait for its answer. */
  readonly busy = signal(false);
  /** That call is a recompute (opening the concept, "Herbereken", after a refused finalize). */
  readonly computing = signal(false);
  readonly correcting = signal(false);
  /** What the date field shows: the saved closing date, or the one being saved. */
  readonly dateDraft = signal('');

  /**
   * Why the figures on screen are behind, while they are: the server said
   * they moved (or took a write) and the recompute that should follow did
   * not answer. Cleared by the next view that comes from the server.
   */
  readonly stale = signal<string | null>(null);
  /** The server's refusal of "Definitief maken", kept beside the button until the next attempt or view change. */
  readonly refused = signal<string | null>(null);
  /** The route id is a closing id at all; otherwise there is nothing to retry. */
  readonly validId = signal(true);
  /** The step this closing opened on: the default until the user picks one, so no answer moves the step. */
  private readonly firstStep = signal<NoticeSegment | null>(null);

  readonly correctionSpec = CORRECTION_SPEC;
  private closingId = 0;
  /** The words of the last refused write, for the line that stays beside "Definitief maken". */
  private lastRefusal: string | null = null;

  readonly title = computed(() => {
    const view = this.view();
    return view ? `Jaarinventaris ${view.closingYear}` : 'Jaarinventaris';
  });
  readonly subtitle = computed(() => {
    const view = this.view();
    if (!view) return '';
    return `Afsluitdatum ${dateText(view.closingDate)} · versie ${view.versionNo} · ${view.status === 'CONCEPT' ? 'Concept' : 'Definitief'}`;
  });
  readonly steps = computed(() => {
    const view = this.view();
    return view ? stepStates(view) : [];
  });
  readonly stap = computed<NoticeSegment>(() => {
    const asked = this.stapParam() as NoticeSegment | undefined;
    if (asked && STEP_KEYS.includes(asked)) return asked;
    return this.firstStep() ?? 'tellen';
  });
  readonly strip = computed(() => {
    const view = this.view();
    return view ? stripItems(view.totals) : [];
  });
  readonly blockers = computed(() => (this.view()?.notices ?? []).filter((notice) => notice.severity === 'BLOCKER'));
  readonly warnings = computed(() => (this.view()?.notices ?? []).filter((notice) => notice.severity !== 'BLOCKER'));
  readonly replacedText = computed(() => {
    const view = this.view();
    const newer = view?.versions.find((version) => version.id === view.supersededById);
    return newer ? `Vervangen door versie ${newer.versionNo}` : 'Vervangen door een nieuwere versie';
  });

  constructor() {
    effect(() => {
      const id = Number(this.id());
      untracked(() => void this.open(id));
    });
  }

  tone(state: StepState): string {
    return STEP_TONE[state];
  }

  word(state: StepState): string {
    return STEP_WORD[state];
  }

  anchor(notice: Notice): string | undefined {
    return noticeAnchor(notice) ?? undefined;
  }

  /* ------------------------------------------------------------- loading */

  /** A view from the server: the figures are current again. */
  private show(view: ClosingView): void {
    /* Once per opened closing: the first step that is not done. A later answer never moves the step. */
    if (this.firstStep() === null) {
      this.firstStep.set(stepStates(view).find((step) => step.state !== 'KLAAR')?.key ?? 'afsluiten');
    }
    this.view.set(view);
    this.dateDraft.set(view.closingDate);
    this.stale.set(null);
  }

  private async open(id: number): Promise<void> {
    this.closingId = id;
    this.view.set(null);
    this.loadError.set(null);
    this.correcting.set(false);
    this.stale.set(null);
    this.refused.set(null);
    this.firstStep.set(null);
    /* "abc" or "0" is no closing: say so instead of waiting for an answer that cannot come. */
    const valid = Number.isInteger(id) && id > 0;
    this.validId.set(valid);
    if (!valid) {
      this.busy.set(false);
      this.computing.set(false);
      this.loadError.set('De gevraagde gegevens bestaan niet meer of zijn verplaatst.');
      return;
    }
    this.busy.set(true);
    try {
      /* The stored rows first: they say whether this is a concept, and a final closing is done here. */
      const stored = await this.api.closing(id);
      if (this.closingId !== id) return;
      if (stored.status !== 'CONCEPT') {
        this.show(stored);
        return;
      }
      /* A concept is never shown from its last compute: stock and containers moved on since. */
      this.computing.set(true);
      const fresh = await this.api.recompute(id);
      if (this.closingId === id) this.show(fresh);
    } catch (failure) {
      if (this.closingId !== id) return;
      /* Made final by someone else between the two calls: the stored rows are the truth. */
      if (refusalCode(failure) === 'DEFINITIEF') await this.read(id);
      else this.loadError.set(sentence(messageOf(failure, 'Probeer het opnieuw.')));
    } finally {
      if (this.closingId === id) {
        this.busy.set(false);
        this.computing.set(false);
      }
    }
  }

  private async read(id: number): Promise<void> {
    try {
      const stored = await this.api.closing(id);
      if (this.closingId === id) this.show(stored);
    } catch (failure) {
      if (this.closingId === id && !this.view()) this.loadError.set(sentence(messageOf(failure, 'Probeer het opnieuw.')));
    }
  }

  reload(): void {
    void this.open(this.closingId);
  }

  /**
   * One write and its answer. A new view replaces the one on screen (and
   * closes the sheet that asked); a refusal is shown and leaves the view as
   * it is, except where the server says the figures or the status moved.
   */
  private async run(call: (id: number) => Promise<ClosingView>, fallback: string, done?: string): Promise<boolean> {
    const id = this.closingId;
    if (this.busy() || !this.view()) return false;
    this.busy.set(true);
    try {
      const view = await call(id);
      if (this.closingId !== id) return false;
      this.show(view);
      if (done) this.ui.toast(done);
      return true;
    } catch (failure) {
      if (this.closingId !== id) return false;
      const message = sentence(messageOf(failure, fallback));
      this.lastRefusal = message;
      this.ui.toast(message, 'err');
      const code = refusalCode(failure);
      if (code === 'DEFINITIEF') await this.read(id);
      else if (code === 'CIJFERS_GEWIJZIGD' || code === 'GEBLOKKEERD') await this.recomputeQuietly(id, message);
      return false;
    } finally {
      if (this.closingId === id) this.busy.set(false);
    }
  }

  /**
   * The recompute that must follow when the server says the figures moved or
   * took a write that computes nothing. When it fails the page is marked as
   * behind with `why`, so nobody reads (or freezes) figures the server
   * already called outdated.
   */
  private async recomputeQuietly(id: number, why: string): Promise<boolean> {
    this.computing.set(true);
    try {
      const view = await this.api.recompute(id);
      if (this.closingId === id) this.show(view);
      return true;
    } catch (failure) {
      if (this.closingId === id) {
        this.stale.set(`${why} Herberekenen is mislukt: ${sentence(messageOf(failure, 'probeer het opnieuw'))}`);
      }
      return false;
    } finally {
      if (this.closingId === id) this.computing.set(false);
    }
  }

  /* ------------------------------------------------------------- actions */

  async recompute(say: boolean): Promise<void> {
    this.computing.set(true);
    await this.run((id) => this.api.recompute(id), 'Herberekenen is mislukt.', say ? 'Herberekend' : undefined);
    this.computing.set(false);
  }

  async changeDate(date: string): Promise<void> {
    const view = this.view();
    if (!view || !date || date === view.closingDate) return;
    this.dateDraft.set(date);
    const saved = await this.run((id) => this.api.setClosingDate(id, date), 'De afsluitdatum kon niet worden gewijzigd.', 'Afsluitdatum gewijzigd');
    /* Refused: the field goes back to the date the figures stand on. */
    if (!saved) this.dateDraft.set(this.view()?.closingDate ?? '');
  }

  saveDecision(write: DecisionWrite): void {
    void this.run((id) => this.api.saveDecision(id, write), 'De beslissing kon niet worden bewaard.');
  }

  removeDecision(decisionId: number): void {
    void this.run((id) => this.api.deleteDecision(id, decisionId), 'De beslissing kon niet worden verwijderd.');
  }

  /** Writing a beginwaarde computes nothing on the server: the recompute brings it into the figures. */
  saveOpeningLayers(write: OpeningLayerWrite): void {
    void this.writeThenRecompute(() => this.api.saveOpeningLayers(write),
      'De beginwaarden konden niet worden bewaard.', 'Beginwaarden bewaard', 'De beginwaarden zijn bewaard.');
  }

  retireOpeningLayer(layerId: number): void {
    void this.writeThenRecompute(() => this.api.retireOpeningLayer(layerId),
      'De beginwaarde kon niet worden verwijderd.', 'Beginwaarde verwijderd', 'De beginwaarde is verwijderd.');
  }

  /**
   * A write that is stored on its own, and the recompute after it, as two
   * steps with two outcomes: a failed write says nothing was stored; a
   * stored write whose recompute fails says it IS stored and that the
   * figures are behind, with "Herbereken" to catch up.
   */
  private async writeThenRecompute(write: () => Promise<unknown>, failed: string, done: string, stored: string): Promise<void> {
    const id = this.closingId;
    if (this.busy() || !this.view()) return;
    this.busy.set(true);
    try {
      try {
        await write();
      } catch (failure) {
        if (this.closingId === id) this.ui.toast(sentence(messageOf(failure, failed)), 'err');
        return;
      }
      if (this.closingId !== id) return;
      if (await this.recomputeQuietly(id, stored)) this.ui.toast(done);
      else if (this.closingId === id) this.ui.toast(`${stored} Herberekenen is mislukt.`, 'err');
    } finally {
      if (this.closingId === id) this.busy.set(false);
    }
  }

  /** The hash of the view on screen goes along: nobody freezes figures they have not seen. */
  async finalize(signerName: string): Promise<void> {
    const view = this.view();
    if (!view || this.stale() !== null) return;
    this.refused.set(null);
    this.lastRefusal = null;
    const computedBefore = view.computedAt;
    const done = await this.run((id) => this.api.finalize(id, view.dataSha256, signerName), 'Definitief maken is mislukt.',
      `Jaarinventaris ${view.closingYear} versie ${view.versionNo} is definitief`);
    const now = this.view();
    if (done || !now || now.id !== view.id || now.status !== 'CONCEPT') return;
    /* Refused: the server's reason stays beside the button, with what happened to the figures since. */
    const why = `Niet definitief gemaakt. ${this.lastRefusal ?? ''}`.trim();
    this.refused.set(this.stale() === null && now.computedAt !== computedBefore
      ? `${why} De cijfers zijn intussen herberekend: kijk ze na voor je opnieuw definitief maakt.` : why);
  }

  startVersionFromSheet(result: DecisionSheetResult): void {
    void this.startVersion(result.reason);
  }

  async startVersion(reason: string): Promise<void> {
    const id = this.closingId;
    if (this.busy() || !this.view()) return;
    this.busy.set(true);
    try {
      const created = await this.api.startVersion(id, reason);
      this.busy.set(false);
      await this.router.navigate(['/stock/inventaris/afsluiting', created.id]);
    } catch (failure) {
      if (this.closingId !== id) return;
      this.busy.set(false);
      this.ui.toast(sentence(messageOf(failure, 'De nieuwe versie kon niet worden gestart.')), 'err');
      /* A concept of this year is already open: that is the version to work in. */
      const next = versionStartRefusal(refusalCode(failure), refusalDetails<{ closingId?: unknown }>(failure));
      if (next.open !== null) await this.router.navigate(['/stock/inventaris/afsluiting', next.open]);
      else if (next.reload) {
        /* No longer the valid final version: the question is off, the stored rows say which version replaced it. */
        this.correcting.set(false);
        await this.read(id);
      }
    }
  }

  async download(kind: 'pdf' | 'xlsx'): Promise<void> {
    const view = this.view();
    if (!view || this.busy()) return;
    const id = this.closingId;
    this.busy.set(true);
    try {
      const blob = kind === 'pdf' ? await this.api.closingPdf(view.id) : await this.api.closingXlsx(view.id);
      saveBlob(blob, fileName(view, kind));
    } catch (failure) {
      /* The refusal of a file route arrives as a Blob: read the server's sentence out of it. */
      const readable = await readableFailure(failure);
      this.ui.toast(sentence(messageOf(readable, kind === 'pdf' ? 'De PDF kon niet worden gedownload.' : 'Het Excel-bestand kon niet worden gedownload.')), 'err');
    } finally {
      /* Another closing was opened meanwhile: its own call owns the flag now. */
      if (this.closingId === id) this.busy.set(false);
    }
  }
}
