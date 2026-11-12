import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { PartnerDocumentBreakdown } from '../../core/api/partner-sales-api';
import { SignedEurPipe } from '../../shared/signed-eur';
import { Sheet } from '../../shared/ui';
import { ReportCostInput, reportCostView } from './report-backed-cost';

/** What the parent knows when a "Marge" cell is clicked; the breakdown comes separately (it may still be loading). */
export interface ReportCostRequest extends Omit<ReportCostInput, 'breakdown'> {
  /** The product line's description, the sheet's title. */
  title: string;
  /** What the clicked cell showed: per unit or for the whole line. */
  mode: 'unit' | 'line';
}

const DAY = new Intl.DateTimeFormat('nl-BE', { day: 'numeric', month: 'short' });

/**
 * The margin popup of a document from Veilingverkopen, desk and phone: per invoiced unit and per regel, Bruto (with
 * the auction's own price) − commissie − transport − extra − terugkoopkost = Netto opbrengst; − Inkoopkost, split
 * → partner x % / → Enrosed y % by who paid it; = Winst, → Enrosed z % (the clicked figure, highlighted) / → the
 * partner; Onze waarde − voorschot = Te factureren; what the partner keeps; the meldingen as links. Amounts below
 * zero read "− € x". Standalone so the sales screens' style budgets stay as they are.
 */
@Component({
  selector: 'app-report-backed-cost-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, SignedEurPipe, Sheet],
  template: `
    <app-sheet [title]="request().title" [variant]="variant()" [backdropCloses]="true" (closed)="closed.emit()">
      <div body class="rbc" [class.rbc--ios]="variant() === 'ios'">
        <p class="rbc-lead">{{ view().quantities }}@if (view().meldingen.length) { · {{ view().meldingen.length }} {{ view().meldingen.length === 1 ? 'melding' : 'meldingen' }} }</p>
        @if (breakdown() === undefined) {
          <p class="rbc-note" role="status">Opbouw laden…</p>
        } @else {
          <div class="rbc-table" role="table" [attr.aria-label]="'Opbouw van ' + request().title">
            <div class="rbc-row rbc-row--head" role="row">
              <span role="columnheader"><span class="sr-only">Wat</span></span>
              <span role="columnheader" class="rbc-num" [class.is-on]="request().mode === 'unit'">{{ view().unitHead }}</span>
              <span role="columnheader" class="rbc-num" [class.is-on]="request().mode === 'line'">Regel</span>
            </div>
            @for (row of view().rows; track row.key) {
              @let hit = row.key === view().highlight;
              <div role="row" [class]="'rbc-row rbc-row--' + row.tone" [class.is-hit]="hit" [attr.aria-current]="hit ? 'true' : null">
                <span role="cell" class="rbc-label"><i aria-hidden="true">{{ row.sign }}</i><span>{{ row.label }}@if (row.hint) { <small>{{ row.hint }}</small> }</span></span>
                <span role="cell" class="rbc-num" [class.is-neg]="row.tone !== 'plain' && row.lineEur < 0" [class.is-clicked]="hit && request().mode === 'unit'">
                  {{ row.unitEur === null ? '—' : (row.unitEur | signedEur: 2) }}
                  @if (hit && view().perPiece !== null) { <small>= {{ view().perPiece! | signedEur: pieceDecimals() }} per {{ request().unit.pieceOne }}</small> }
                </span>
                <span role="cell" class="rbc-num" [class.is-neg]="row.tone !== 'plain' && row.lineEur < 0" [class.is-clicked]="hit && request().mode === 'line'">{{ row.lineEur | signedEur: 2 }}</span>
              </div>
            }
          </div>
          @for (note of view().notes; track note) { <p class="rbc-note">{{ note }}</p> }
        }
        @if (view().meldingen.length) {
          <p class="rbc-sec">Meldingen</p>
          <div class="rbc-links">
            @for (melding of view().meldingen; track melding.id) {
              <a class="rbc-link" routerLink="/veilingverkopen" [queryParams]="{ melding: melding.id }" (click)="closed.emit()">
                <b>{{ melding.number }}</b><small>{{ day(melding.soldOn) }} · {{ melding.channel === 'DIRECT' ? 'direct' : 'veiling' }}</small></a>
            }
          </div>
        }
      </div>
      <div foot style="display:contents">
        <span class="spacer"></span>
        <button class="btn" type="button" (click)="closed.emit()">Sluiten</button>
      </div>
    </app-sheet>
  `,
  styles: `
    .rbc { display: grid; gap: 10px; }
    /* The iOS sheet's body runs edge to edge: the table keeps the inset of the grouped lists. */
    .rbc--ios { padding: 4px 16px 12px; }
    .rbc--ios .rbc-table { background: var(--surface); }
    .rbc-lead { margin: 0; color: var(--muted); font-size: 12.5px; }
    .rbc-table { display: grid; border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
    .rbc-row { display: grid; grid-template-columns: minmax(0, 1fr) 96px 104px; align-items: center; column-gap: 10px; min-height: 38px;
      padding: 6px 12px; border-top: 1px solid var(--line); font-size: 13px; }
    .rbc-row--head { min-height: 30px; border-top: 0; background: var(--surface-2); color: var(--muted); font-size: 10px; font-weight: 750;
      letter-spacing: .05em; text-transform: uppercase; }
    .rbc-row--head .is-on { color: var(--ink); }
    .rbc-row--head .rbc-num { white-space: normal; line-height: 1.2; }
    .rbc-label { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
    .rbc-label i { flex: none; width: 12px; color: var(--muted); font-style: normal; font-weight: 700; text-align: center; }
    .rbc-label > span { display: grid; min-width: 0; }
    .rbc-label small { color: var(--muted); font-size: 11px; line-height: 1.3; overflow-wrap: anywhere; }
    .rbc-num { display: grid; justify-items: end; font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
    .rbc-num small { color: var(--rose-dark); font-size: 10.5px; font-weight: 650; }
    .rbc-row--sum { background: var(--surface-2); font-weight: 700; }
    .rbc-row--total { background: var(--surface-2); font-weight: 800; border-top: 2px solid var(--line-strong); }
    .rbc-row--part .rbc-label { padding-left: 14px; }
    .rbc-row.is-hit { background: var(--rose-soft); box-shadow: inset 3px 0 0 var(--rose); font-weight: 750; }
    .rbc-num.is-clicked { color: var(--rose-dark); font-weight: 800; }
    .is-neg, .rbc-num.is-clicked.is-neg { color: var(--danger); }
    .rbc-note { margin: 0; color: var(--muted); font-size: 12px; line-height: 1.45; }
    .rbc-sec { margin: 6px 0 0; color: var(--muted); font-size: 10.5px; font-weight: 750; letter-spacing: .06em; text-transform: uppercase; }
    .rbc-links { display: flex; flex-wrap: wrap; gap: 6px; }
    .rbc-link { display: grid; align-content: center; min-height: 44px; padding: 4px 12px; border: 1px solid var(--line); border-radius: 10px;
      background: var(--surface); color: inherit; text-decoration: none; }
    .rbc-link:hover { border-color: var(--rose-line); background: var(--rose-soft); }
    .rbc-link b { font-size: 13px; }
    .rbc-link small { color: var(--muted); font-size: 11px; }
    @media (max-width: 479.98px) {
      .rbc-row { grid-template-columns: minmax(0, 1fr) 80px 88px; column-gap: 6px; padding: 6px 10px; font-size: 12.5px; }
    }
  `,
})
export class ReportBackedCostSheet {
  readonly request = input.required<ReportCostRequest>();
  /** undefined while loading, null when the server has none. */
  readonly breakdown = input<PartnerDocumentBreakdown | null | undefined>(undefined);
  readonly variant = input<'default' | 'ios'>('default');
  readonly closed = output<void>();

  readonly view = computed(() => reportCostView({ ...this.request(), breakdown: this.breakdown() }));
  /** A piece figure in cents; three decimals only when two would read € 0,00. */
  readonly pieceDecimals = computed(() => {
    const value = Math.abs(this.view().perPiece ?? 0);
    return value > 0 && Math.round(value * 100) === 0 ? 3 : 2;
  });

  day(iso: string): string {
    const date = new Date(`${iso}T12:00:00`);
    return Number.isNaN(date.getTime()) ? iso : DAY.format(date);
  }
}
