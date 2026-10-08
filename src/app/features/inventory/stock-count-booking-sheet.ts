import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { BookingCheck, CountLine, CountView } from '../../core/api/inventory-models';
import { Icon } from '../../shared/icon';
import { NumPipe } from '../../shared/pipes';
import { Skeleton } from '../../shared/skeleton';
import { Sheet } from '../../shared/ui';
import { bookingSummaryText, differenceText } from './inventory-count';
import { StockCountDocuments } from './stock-count-reason-sheet';

type MovedRow = BookingCheck['moved'][number];
type Movement = MovedRow['movements'][number];

const whole = (value: number) => value.toLocaleString('nl-BE');

/** "+40", "-12", "0": a change of the stock figure. */
export function signedQuantity(value: number): string {
  return value > 0 ? `+${whole(value)}` : value < 0 ? `-${whole(-value)}` : '0';
}

/** "09:02", the Brussels time of an instant; empty when there is none. */
export function countTime(instant: string | null): string {
  const at = instant ? new Date(instant) : null;
  if (!at || isNaN(at.getTime())) return '';
  return new Intl.DateTimeFormat('nl-BE', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Brussels' }).format(at);
}

/**
 * "Controleren en boeken": the server's booking check as a list of what
 * still stops the booking (not counted, no reason, an open invoice or
 * container, a result under zero), the products whose stock changed while
 * counting with the one question that decides their difference, and the
 * summary of what gets booked. It shows and asks; the page saves, reloads
 * the check and books.
 */
@Component({
  selector: 'app-stock-count-booking-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet, Skeleton, Icon, NumPipe, StockCountDocuments],
  template: `
    <app-sheet variant="ios" [wide]="true" title="Controleren en boeken" (closed)="closed.emit()">
      <div body class="inv-book">
        @if (check(); as c) {
          @if (!correction() && c.uncounted.length) {
            <section class="ios-section" aria-labelledby="inv-book-uncounted">
              <div class="ios-section__head inv-book__head inv-book__head--stop"><h2 id="inv-book-uncounted">Niet geteld met voorraad ({{ c.uncounted.length }})</h2></div>
              <div class="ios-group">
                @for (row of c.uncounted; track row.productId) {
                  @if (row.lineId !== null) {
                    <button class="ios-cell ios-cell--tall" type="button" (click)="showUncounted.emit()">
                      <span class="ios-cell__body"><span class="ios-cell__title">{{ row.productName }}</span><span class="ios-cell__sub">{{ row.sku || 'Geen SKU' }}</span></span>
                      <span class="ios-cell__trail"><span class="ios-cell__value">{{ row.liveQuantity | num }}</span><span class="ios-cell__meta">volgens systeem</span></span>
                      <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
                    </button>
                  } @else {
                    <div class="ios-cell ios-cell--tall">
                      <span class="ios-cell__body"><span class="ios-cell__title">{{ row.productName }}</span>
                        <span class="ios-cell__sub">{{ row.sku || 'Geen SKU' }} · {{ row.liveQuantity | num }} volgens systeem</span>
                        <span class="ios-cell__sub">Staat niet op de lijst</span></span>
                      <button class="ios-capsule ios-capsule--sm ios-capsule--tinted" type="button" [disabled]="busy()" (click)="add.emit(row.productId)">Toevoegen</button>
                    </div>
                  }
                }
              </div>
              <p class="ios-section__foot">Tik op een product om naar 'Te tellen' te gaan.</p>
            </section>
          }

          @if (missingReasons().length) {
            <section class="ios-section" aria-labelledby="inv-book-reasons">
              <div class="ios-section__head inv-book__head inv-book__head--stop"><h2 id="inv-book-reasons">Verschillen zonder reden ({{ missingReasons().length }})</h2></div>
              <div class="ios-group">
                <button class="ios-cell ios-cell--action" type="button" [disabled]="busy()" (click)="sameReason.emit(missingReasonIds())">Zelfde reden voor alle {{ missingReasons().length }}</button>
                @for (line of missingReasons(); track line.id) {
                  <button class="ios-cell ios-cell--tall" type="button" (click)="reason.emit(line.id)">
                    <span class="ios-cell__body"><span class="ios-cell__title">{{ line.productName }}</span><span class="ios-cell__sub">{{ countedText(line) }}</span></span>
                    <span class="ios-cell__trail"><span class="inv-chip inv-chip--stop">Reden kiezen</span></span>
                    <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
                  </button>
                }
              </div>
            </section>
          }

          @if (openDocuments().length) {
            <section class="ios-section" aria-labelledby="inv-book-documents">
              <div class="ios-section__head inv-book__head inv-book__head--stop"><h2 id="inv-book-documents">Eerst afpunten of bijboeken ({{ openDocuments().length }})</h2></div>
              <div class="ios-group">
                @for (line of openDocuments(); track line.id) {
                  <div class="ios-cell ios-cell--tall inv-book__documents">
                    <span class="ios-cell__body"><span class="ios-cell__title">{{ line.productName }}</span><span class="ios-cell__sub">{{ countedText(line) }}</span>
                      <app-stock-count-documents [line]="line" [disabled]="busy() || saving().has(line.id)" (confirmed)="documents.emit({ lineId: line.id, confirmed: $event })" /></span>
                  </div>
                }
              </div>
            </section>
          }

          @if (c.negative.length) {
            <section class="ios-section" aria-labelledby="inv-book-negative">
              <div class="ios-section__head inv-book__head inv-book__head--stop"><h2 id="inv-book-negative">Onder nul ({{ c.negative.length }})</h2></div>
              <div class="ios-group">
                @for (row of c.negative; track row.lineId) {
                  <div class="ios-cell ios-cell--tall">
                    <span class="ios-cell__body"><span class="ios-cell__title">{{ row.productName }}</span><span class="ios-cell__sub">Tel dit product opnieuw</span></span>
                    <span class="ios-cell__trail"><span class="ios-cell__value inv-book__negative">{{ row.resultQuantity | num }}</span><span class="ios-cell__meta">nieuwe stand</span></span>
                  </div>
                }
              </div>
            </section>
          }

          @if (c.moved.length || rebased().length) {
            <section class="ios-section" aria-labelledby="inv-book-moved">
              <div class="ios-section__head inv-book__head"><h2 id="inv-book-moved">Voorraad gewijzigd tijdens de telling ({{ c.moved.length }})</h2></div>
              @for (row of c.moved; track row.lineId) {
                <div class="ios-group inv-book__moved">
                  <div class="inv-moved">
                    <strong class="inv-moved__name">{{ row.productName }}</strong>
                    <p class="inv-moved__text">{{ movedText(row) }}</p>
                    @if (row.movements.length) {
                      <ul class="inv-moved__rows">
                        @for (movement of row.movements; track $index) { <li>{{ movementText(movement) }}</li> }
                      </ul>
                    }
                    <p class="inv-moved__question">Waren deze stuks al weg (of al binnen) toen je telde?</p>
                    <div class="inv-moved__answers">
                      <button class="btn btn--sm" type="button" [class.inv-moved__answer--on]="looked().has(row.lineId)" [attr.aria-pressed]="looked().has(row.lineId)"
                              [disabled]="busy() || saving().has(row.lineId)" (click)="keep.emit(row.lineId)">Nee, klopt zo</button>
                      <button class="btn btn--sm" type="button" [disabled]="busy() || saving().has(row.lineId)" (click)="rebase.emit(row.lineId)">{{ saving().has(row.lineId) ? 'Bezig…' : 'Ja, herreken het verschil' }}</button>
                    </div>
                  </div>
                </div>
              }
              @if (rebased().length) {
                <div class="ios-group inv-book__moved">
                  @for (line of rebased(); track line.id) {
                    <div class="ios-cell ios-cell--tall">
                      <span class="ios-cell__body"><span class="ios-cell__title">{{ line.productName }}</span>
                        <span class="ios-cell__sub">Geteld {{ line.countedQuantity | num }}; verschil nu {{ signed(line.difference ?? 0) }}</span></span>
                      <span class="ios-cell__trail"><span class="ios-cell__meta">herrekend</span></span>
                    </div>
                  }
                </div>
              }
              <p class="ios-section__foot">Houdt het boeken niet tegen: zonder antwoord wordt het getelde verschil toegepast op de stand van nu.</p>
            </section>
          }

          <section class="ios-section inv-book__summary" aria-label="Samenvatting">
            @if (refusal(); as why) {
              <div class="inv-book__refused" role="alert">
                <span>{{ why }}</span>
                <button class="btn btn--sm" type="button" [disabled]="busy() || checking()" (click)="reload.emit()">Opnieuw controleren</button>
              </div>
            }
            <p class="inv-book__total">{{ summary() }}</p>
            <p class="inv-book__note">Boek de telling op een moment dat niemand verzendt of ontvangt.</p>
            @if (blocked()) { <p class="inv-book__note inv-book__note--stop">Werk eerst af wat hierboven staat; daarna kan je boeken.</p> }
          </section>
        } @else if (failed()) {
          <div class="alert alert--danger inv-book__alert" role="alert">
            <span>De controle kon niet worden geladen.</span>
            <button class="btn btn--sm" type="button" (click)="reload.emit()">Opnieuw</button>
          </div>
        } @else {
          <div class="inv-book__loading" aria-busy="true"><app-skeleton kind="lines" [rows]="6" /></div>
        }
      </div>
      <div foot style="display:contents">
        <button class="btn" type="button" (click)="closed.emit()">Sluiten</button>
        <button class="btn btn--primary" type="button" [disabled]="!check() || blocked() || busy() || checking() || saving().size > 0" (click)="book.emit()">{{ busy() ? 'Bezig…' : 'Telling boeken' }}</button>
      </div>
    </app-sheet>
  `,
})
export class StockCountBookingSheet {
  readonly view = input.required<CountView>();
  /** Null while the first check loads; a later reload keeps the previous one on screen. */
  readonly check = input<BookingCheck | null>(null);
  readonly checking = input(false);
  readonly failed = input(false);
  readonly busy = input(false);
  /** Line ids with a save under way: their buttons wait, so no answer is sent twice. */
  readonly saving = input<ReadonlySet<number>>(new Set());
  /** Why the server refused the last "Telling boeken"; stays above the summary until the next attempt. */
  readonly refusal = input<string | null>(null);
  /** Line ids answered "Nee, klopt zo" on this phone. */
  readonly looked = input<ReadonlySet<number>>(new Set());
  /** Lines answered "Ja, herreken het verschil" since the sheet opened. */
  readonly rebased = input<CountLine[]>([]);

  readonly reload = output<void>();
  readonly showUncounted = output<void>();
  readonly add = output<number>();
  readonly reason = output<number>();
  readonly sameReason = output<number[]>();
  readonly documents = output<{ lineId: number; confirmed: boolean }>();
  readonly keep = output<number>();
  readonly rebase = output<number>();
  readonly book = output<void>();
  readonly closed = output<void>();

  readonly correction = computed(() => this.view().correctsCountId !== null);
  private readonly linesById = computed(() => new Map(this.view().lines.map((line) => [line.id, line])));
  readonly missingReasons = computed(() => this.lines(this.check()?.missingReasons ?? []));
  readonly missingReasonIds = computed(() => this.missingReasons().map((line) => line.id));
  readonly openDocuments = computed(() => this.lines(this.check()?.openDocuments ?? []));
  readonly summary = computed(() => {
    const check = this.check();
    return check ? bookingSummaryText(check.summary) : '';
  });
  /** What the server refuses to book over (4.5); the changed products do not stop it. */
  readonly blocked = computed(() => {
    const check = this.check();
    return !!check && (check.uncounted.length > 0 || check.missingReasons.length > 0
      || check.openDocuments.length > 0 || check.negative.length > 0);
  });

  private lines(ids: readonly number[]): CountLine[] {
    const byId = this.linesById();
    return ids.map((id) => byId.get(id)).filter((line): line is CountLine => !!line);
  }

  countedText(line: CountLine): string {
    return `Geteld ${whole(line.countedQuantity ?? 0)} · ${differenceText(line.difference ?? 0)}`;
  }

  signed(value: number): string {
    return signedQuantity(value);
  }

  movedText(row: MovedRow): string {
    return `Geteld ${whole(row.countedQuantity)} bij stand ${whole(row.expectedQuantity)}; nu ${whole(row.liveQuantity)}. `
      + `Het verschil van ${signedQuantity(row.difference)} wordt toegepast: nieuwe stand ${whole(row.resultQuantity)}.`;
  }

  /** "{delta} {soort} {referentie}, {uu:mm} door {naam}". */
  movementText(movement: Movement): string {
    const what = [signedQuantity(movement.delta), movement.kindLabel, movement.reference].filter(Boolean).join(' ');
    const when = [countTime(movement.at), movement.actor ? `door ${movement.actor}` : ''].filter(Boolean).join(' ');
    return when ? `${what}, ${when}` : what;
  }
}
