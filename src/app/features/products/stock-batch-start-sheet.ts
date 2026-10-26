import { ChangeDetectionStrategy, Component, type OnInit, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import { StockBatchApi } from '../../core/api/stock-batch-api';
import type { StockBatchBackfillReport, StockBatchCheckRow, StockBatchStatus } from '../../core/api/stock-batch-models';
import { batchFormat } from '../../core/api/stock-batch-units';
import { messageOf } from '../../core/api/errors';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { Skeleton } from '../../shared/skeleton';
import { Sheet, Ui } from '../../shared/ui';
import {
  FLAGGED_LIMIT, backfillFigures, backfillRowPartner, backfillRowText, backfillRowValue, backfillRowValueTitle, checkRowText, flaggedRows,
  notBookedText, productsText, repairedCount, type StockBatchSheetMode,
} from './stock-batch-start';

/**
 * Batches on the stock page (2026-10-25). Start mode: the read-only dry run
 * of the backfill (figures, flagged rows, containers not booked) and
 * "Batches opbouwen", which starts the batches for real. Check mode: the
 * products whose batches differ from their stock, "Herstellen", and
 * "Pauzeren" / "Hervatten" (one click, no deploy). Texts: stock-batch-start.ts.
 */
@Component({
  selector: 'app-stock-batch-start-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet, Skeleton],
  template: `
    <app-sheet [title]="mode() === 'start' ? 'Batches opbouwen' : 'Batches controleren'" variant="ios" [wide]="desktop.active()" (closed)="closed.emit()">
      <div body class="sbs-sheet">
        @if (mode() === 'start') {
          @if (error(); as message) {
            <p class="sbs-error" role="alert">{{ message }} <button class="linklike" type="button" (click)="load()">Opnieuw</button></p>
          } @else if (report(); as report) {
            <div class="sbs-figs" role="group" aria-label="Proef">
              @for (figure of figures(); track figure.label) {
                <div [attr.title]="figure.title ?? null"><small>{{ figure.label }}</small><b>{{ figure.value }}</b>
                  @if (figure.sub) { <small class="sbs-figs__sub">{{ figure.sub }}</small> }</div>
              }
            </div>
            <p class="sbs-help">Proef: er wordt nog niets bewaard.</p>
            @if (flagged().length) {
              <ul class="sbs-rows" aria-label="Na te kijken">
                @for (row of shownFlagged(); track row.productId) {
                  @let text = backfillText(row);
                  <li class="sbs-row">
                    <span class="sbs-row__main"><b class="sbs-row__title" [title]="text.title">{{ text.title }}</b>
                      <span class="sbs-row__sub" [title]="text.sub">{{ text.sub }}</span></span>
                    <span class="sbs-row__num" [attr.title]="backfillValueTitle(row)">{{ backfillValue(row) }}
                      @if (backfillPartner(row); as partner) { <small class="sbs-row__part">{{ partner }}</small> }</span>
                  </li>
                }
              </ul>
              @if (moreCount() > 0) {
                <button class="linklike sbs-more" type="button" (click)="showAll.set(true)">Meer ({{ moreCount() }})</button>
              }
            }
            @if (notBooked(); as line) { <p class="sbs-note">{{ line }}</p> }
          } @else {
            <app-skeleton kind="lines" [rows]="4" />
          }
        } @else {
          @if (state().paused) { <p class="sbs-help sbs-help--warn">Batches staan op pauze.</p> }
          @if (error(); as message) {
            <p class="sbs-error" role="alert">{{ message }} <button class="linklike" type="button" (click)="load()">Opnieuw</button></p>
          } @else if (rows(); as rows) {
            @if (rows.length) {
              <ul class="sbs-rows" aria-label="Verschillen">
                @for (row of rows; track row.productId) {
                  @let text = checkText(row);
                  <li class="sbs-row">
                    <span class="sbs-row__main"><b class="sbs-row__title" [title]="text.title">{{ text.title }}</b>
                      <span class="sbs-row__sub" [title]="text.sub">{{ text.sub }}</span></span>
                    <span class="sbs-row__num sbs-row__num--warn">{{ text.value }}</span>
                  </li>
                }
              </ul>
            } @else {
              <p class="sbs-help">Geen verschillen.</p>
            }
          } @else {
            <app-skeleton kind="lines" [rows]="3" />
          }
        }
      </div>
      <div foot style="display:contents">
        <span class="spacer"></span>
        @if (mode() === 'start') {
          <button class="btn" type="button" (click)="closed.emit()">Annuleren</button>
          <button class="btn btn--primary" type="button" [disabled]="!report() || busy()" (click)="start()">{{ busy() ? 'Bezig…' : 'Batches opbouwen' }}</button>
        } @else {
          <button class="btn" type="button" (click)="closed.emit()">Sluiten</button>
          @if (state().started) {
            <button class="btn" type="button" [disabled]="busy()" (click)="togglePause()">{{ state().paused ? 'Hervatten' : 'Pauzeren' }}</button>
          }
          @if (canRepair()) {
            <button class="btn btn--primary" type="button" [disabled]="busy()" (click)="repair()">Herstellen</button>
          }
        }
      </div>
    </app-sheet>
  `,
  styles: `
    .sbs-sheet { display: grid; gap: 12px; min-width: 0; }
    /* Waarde gets a little more room for its "waarvan partner € x" line */
    .sbs-figs { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)) minmax(0, 1.3fr); overflow: hidden; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); }
    .sbs-figs > div { display: grid; align-content: start; gap: 1px; min-width: 0; padding: 10px 12px; border-left: 1px solid var(--line); }
    .sbs-figs > div:first-child { border-left: 0; }
    .sbs-figs small { overflow: hidden; color: var(--muted); font-size: 10.5px; font-weight: 700; letter-spacing: .06em; text-overflow: ellipsis; text-transform: uppercase; white-space: nowrap; }
    .sbs-figs b { font-size: 17px; font-weight: 720; font-variant-numeric: tabular-nums; letter-spacing: -.01em; white-space: nowrap; }
    /* "waarvan partner € x" under Waarde: a plain muted line, not the uppercase label */
    .sbs-figs .sbs-figs__sub { font-size: 11.5px; font-weight: 500; font-variant-numeric: tabular-nums; letter-spacing: 0; text-transform: none; }
    .sbs-help, .sbs-note, .sbs-error { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.45; }
    .sbs-help--warn { color: var(--warn); font-weight: 650; }
    .sbs-error { color: var(--danger); }
    .sbs-rows { display: grid; margin: 0; padding: 0; overflow: hidden; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); list-style: none; }
    .sbs-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; min-width: 0; padding: 9px 14px; border-top: 1px solid var(--line); }
    .sbs-row:first-child { border-top: 0; }
    .sbs-row__main { display: grid; gap: 1px; min-width: 0; }
    .sbs-row__title, .sbs-row__sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sbs-row__title { font-size: 13.5px; font-weight: 650; line-height: 1.35; }
    .sbs-row__sub { color: var(--muted); font-size: 12px; line-height: 1.35; }
    .sbs-row__num { display: grid; justify-items: end; font-size: 13.5px; font-weight: 650; font-variant-numeric: tabular-nums; white-space: nowrap; }
    /* "partner € x" under a row value that mixes own and partner stock */
    .sbs-row__part { color: var(--muted); font-size: 11.5px; font-weight: 500; }
    .sbs-row__num--warn { color: var(--warn); }
    .sbs-more { justify-self: start; }
    @media (max-width: 679.98px) {
      .sbs-sheet { padding: 0 16px; }
      /* Two per row so "Beginvoorraad" is never cut; Waarde takes the last row. */
      .sbs-figs { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .sbs-figs > div:nth-child(odd) { border-left: 0; }
      .sbs-figs > div:nth-child(n + 3) { border-top: 1px solid var(--line); }
      .sbs-figs > div:last-child:nth-child(odd) { grid-column: 1 / -1; }
      .sbs-rows { border: 0; border-radius: 12px; }
    }
  `,
})
export class StockBatchStartSheet implements OnInit {
  private readonly api = inject(StockBatchApi);
  private readonly ui = inject(Ui);
  protected readonly desktop = inject(DesktopViewport);

  readonly mode = input.required<StockBatchSheetMode>();
  readonly status = input.required<StockBatchStatus>();
  readonly closed = output<void>();
  /** The state of the start changed (started, paused, resumed or repaired): the page reloads its status. */
  readonly changed = output<void>();

  /** Counts and euros only; every row names its own unit through count(pieces, unitPieces). */
  protected readonly fmt = batchFormat({ singular: 'stuk', plural: 'stuks' });
  /** The status as the page passed it, or as pause/resume answered until the page passes the new one. */
  protected readonly state = linkedSignal(() => this.status());

  protected readonly report = signal<StockBatchBackfillReport | null>(null);
  protected readonly rows = signal<StockBatchCheckRow[] | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly showAll = signal(false);

  protected readonly figures = computed(() => {
    const report = this.report();
    return report ? backfillFigures(report, this.fmt) : [];
  });
  protected readonly flagged = computed(() => {
    const report = this.report();
    return report ? flaggedRows(report) : [];
  });
  protected readonly shownFlagged = computed(() => this.showAll() ? this.flagged() : this.flagged().slice(0, FLAGGED_LIMIT));
  protected readonly moreCount = computed(() => this.flagged().length - this.shownFlagged().length);
  protected readonly notBooked = computed(() => {
    const report = this.report();
    return report ? notBookedText(report) : null;
  });
  protected readonly canRepair = computed(() => this.state().started && !this.state().paused && (this.rows()?.length ?? 0) > 0);

  protected backfillText = (row: StockBatchBackfillReport['rows'][number]) => backfillRowText(row, this.fmt);
  protected backfillValue = (row: StockBatchBackfillReport['rows'][number]) => backfillRowValue(row, this.fmt);
  protected backfillValueTitle = (row: StockBatchBackfillReport['rows'][number]) => backfillRowValueTitle(row, this.fmt);
  protected backfillPartner = (row: StockBatchBackfillReport['rows'][number]) => backfillRowPartner(row, this.fmt);
  protected checkText = (row: StockBatchCheckRow) => checkRowText(row, this.fmt);

  ngOnInit(): void {
    void this.load();
  }

  /** Start mode: the dry run (reads only); check mode: today's differences. */
  async load(): Promise<void> {
    this.error.set(null);
    try {
      if (this.mode() === 'start') {
        this.report.set(null);
        this.report.set(await this.api.backfill(true));
      } else {
        this.rows.set(null);
        this.rows.set(await this.api.check());
      }
    } catch (failure: unknown) {
      this.error.set(messageOf(failure, this.mode() === 'start' ? 'De proef kon niet worden geladen.' : 'De controle kon niet worden geladen.'));
    }
  }

  /**
   * "Batches opbouwen" for real, after the dry run was read. It asks once more first: the start locks every
   * product while it runs (up to 10 minutes), so it belongs outside business hours (plan §7.2 R1).
   */
  start(): void {
    if (this.busy() || !this.report()) return;
    this.ui.confirm({
      title: 'Batches echt opbouwen?',
      message: 'Tot 10 minuten liggen alle producten vast: verkopen, ontvangen en voorraad boeken wachten. Doe dit buiten de kantooruren.',
      confirmLabel: 'Ja, opbouwen',
    }, () => { void this.startNow(); });
  }

  private async startNow(): Promise<void> {
    if (this.busy() || !this.report()) return;
    this.busy.set(true);
    try {
      const report = await this.api.backfill(false);
      this.ui.toast(`Batches opgebouwd · ${productsText(report.products, this.fmt)}`, 'ok');
      this.changed.emit();
      this.closed.emit();
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Batches opbouwen mislukt'), 'err');
    } finally {
      this.busy.set(false);
    }
  }

  /** Books every listed difference to zero; the answer is the new list. */
  async repair(): Promise<void> {
    if (this.busy()) return;
    const before = this.rows() ?? [];
    this.busy.set(true);
    try {
      const after = await this.api.repair([]);
      this.rows.set(after);
      this.ui.toast(`Hersteld · ${productsText(repairedCount(before, after), this.fmt)}`, 'ok');
      this.changed.emit();
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Herstellen mislukt'), 'err');
    } finally {
      this.busy.set(false);
    }
  }

  /** Pauzeren stops every batch hook at once; Hervatten starts them again (Herstellen then books the drift). */
  async togglePause(): Promise<void> {
    if (this.busy()) return;
    const pausing = !this.state().paused;
    this.busy.set(true);
    try {
      this.state.set(pausing ? await this.api.pause() : await this.api.resume());
      this.ui.toast(pausing ? 'Batches gepauzeerd' : 'Batches hervat', 'ok');
      this.changed.emit();
      /* What drifted while paused shows at once, so Herstellen follows Hervatten. */
      try { this.rows.set(await this.api.check()); } catch { /* the list stays as it was */ }
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, pausing ? 'Pauzeren mislukt' : 'Hervatten mislukt'), 'err');
    } finally {
      this.busy.set(false);
    }
  }
}
