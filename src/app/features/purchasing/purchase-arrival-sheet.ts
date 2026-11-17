import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import type { ContainerTracking } from '../../core/api/container-tracking-models';
import type { PurchaseArrival, PurchaseArrivalRequest, PurchaseOrder, PurchaseOrderView } from '../../core/api/models';
import { SourcingApi } from '../../core/api/sourcing-api';
import { messageOf } from '../../core/api/errors';
import { DateField } from '../../shared/date-field';
import { DateNlPipe } from '../../shared/pipes';
import { brusselsToday } from '../../shared/product-incoming';
import { Sheet, Ui } from '../../shared/ui';

/** "di 18/11/2026 · 14:00", "Nog niet gepland". */
export function arrivalText(day: string | null | undefined, hour: string | null | undefined, empty = 'Nog niet gepland'): string {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return empty;
  const [y, m, d] = day.split('-').map(Number);
  const weekday = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const text = `${weekday} ${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
  return hour ? `${text} · ${hour}` : text;
}

/** The arrival block of an order, also from a server without it. */
export function orderArrival(view: Pick<PurchaseOrderView, 'arrival'> | null | undefined): PurchaseArrival {
  return {
    containerAt: view?.arrival?.containerAt ?? null,
    containerByHand: view?.arrival?.containerByHand === true,
    warehouseOn: view?.arrival?.warehouseOn ?? null,
    warehouseAt: view?.arrival?.warehouseAt ?? null,
    portArrivedOn: view?.arrival?.portArrivedOn ?? null,
    departureByHand: view?.arrival?.departureByHand === true,
  };
}

/**
 * The server knows the departure by hand: it then always sends the boolean. Read raw, not through orderArrival(),
 * which turns a missing one into false. An older server ignores a shippedOn it does not know and answers the old
 * day, so without this the sheet would say "Vertrek opgeslagen" while nothing was stored.
 */
export function departureOnServer(view: Pick<PurchaseOrderView, 'arrival'> | null | undefined): boolean {
  return typeof view?.arrival?.departureByHand === 'boolean';
}

/**
 * The departure day the order pages show and the Aankomst sheet sets, or null. The one rule for every place the
 * departure shows (the sheet's section and title, the desk's Vertrek row, the phone's Vertrek cell, the desk's
 * "vertrokken …" small it replaces, the editors' label): a container under way with a real day, on a server that
 * takes the day. Pass the order with the dates the page shows (the tracking row's when fresher). On an older server
 * it answers null, so every screen reads as before.
 */
export function orderDepartureDay(view: Pick<PurchaseOrderView, 'arrival'> | null | undefined,
    order: Pick<PurchaseOrder, 'status' | 'shippedOn'> | null | undefined): string | null {
  const day = order?.shippedOn;
  return departureOnServer(view) && order?.status === 'ONDERWEG' && isDay(day) ? day : null;
}

/** A real calendar day as yyyy-mm-dd ("2026-02-31" is none). */
function isDay(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/**
 * The day the linked ship arrived at the port of destination, for an order page: from the order's own tracking row
 * when the page has one (it is read every minute, the order only when the page opened), else from the order. A row
 * of another reference does not count (the desk keeps its last row while it edits; savedReference is the reference
 * as saved when the view holds a draft). Null while no ship arrived, and on a server from before 2026-11-16.
 */
export function orderShipArrivedOn(view: Pick<PurchaseOrderView, 'order' | 'arrival'>, row: ContainerTracking | null | undefined,
    savedReference?: string | null): string | null {
  const reference = savedReference === undefined ? view.order.trackingReference ?? null : savedReference;
  const own = !!row && row.orderId === view.order.id && row.trackingReference === reference;
  const day = own && row.portArrivedOn !== undefined ? row.portArrivedOn : orderArrival(view).portArrivedOn;
  return day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

/**
 * The words beside the container's day once its ship is in (portArrivedOn): "schip aangekomen", and with the
 * ship's own day when the day shown is another one (a date by hand): "schip aangekomen zo 15/11 · met de hand".
 * The day of these words is always the ship's. Null while no ship arrived.
 */
export function shipArrivedText(portArrivedOn: string | null | undefined, shownDay: string | null | undefined, byHand: boolean): string | null {
  if (!portArrivedOn || !/^\d{4}-\d{2}-\d{2}$/.test(portArrivedOn)) return null;
  /* "zo 15/11": the day without its year, beside a date that carries it. */
  const own = portArrivedOn === shownDay ? '' : ` ${arrivalText(portArrivedOn, null).slice(0, -5)}`;
  return `schip aangekomen${own}${byHand ? ' · met de hand' : ''}`;
}

/**
 * The progress strip says "verwacht" before the container's day until the linked ship came in on that day; from
 * then on it says "schip aangekomen". A day by hand that is another day than the ship's stays "verwacht".
 */
export function shipIsIn(portArrivedOn: string | null | undefined, shownDay: string | null | undefined): boolean {
  return !!portArrivedOn && !!shownDay && portArrivedOn === shownDay;
}

const HOUR = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * The ship's arrival counts for a voyage from this many days after its departure up to this many: the server's
 * TrackingDateSync.ARRIVAL_EARLIEST_DAYS / ARRIVAL_LATEST_DAYS (change both sides or neither). A departure set by
 * hand that puts the stored arrival outside makes the server forget it, so the sheet says so before the save.
 */
export const ARRIVAL_EARLIEST_DAYS = 7, ARRIVAL_LATEST_DAYS = 180;

/** yyyy-mm-dd plus a number of days. */
function plusDays(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Aankomst (Emre, 2026-11-15): the container's day and hour at the port, and the day and hour it is expected at
 * the place it is unloaded at (Zaltbommel). With track & trace the container's day follows the source until
 * "Zelf instellen"; then it stays as set until "Track & trace volgen". The sheet saves itself and hands the
 * order as it stands to its parent. Verhoeven sees both in the partner portal.
 * Vertrek (Emre, 2026-11-16, "Ja, voeg toe"): for a container under way, the departure day as a first part. A day
 * set here stays: tracking no longer moves it (until a bill of lading's day or a status step back).
 */
@Component({
  selector: 'app-purchase-arrival-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet, DateField, DateNlPipe],
  template: `
    @let order = view().order;
    <app-sheet [title]="sheetTitle()" variant="ios" (closed)="close()">
      <div body class="arr" [attr.inert]="busy() ? '' : null">
        @if (departureDay(); as stored) {
          <!-- No data-initial-focus: the close button keeps the first focus, so the phone keyboard stays shut. -->
          <section class="arr__part" aria-labelledby="arr-departure">
            <div class="arr__head">
              <h3 id="arr-departure">{{ departurePort() ? 'Vertrek uit ' + departurePort() : 'Vertrek' }}</h3>
              @if (departureHand()) { <span class="arr__tag arr__tag--hand">Met de hand</span> }
            </div>
            <div class="arr__pair">
              <div class="field">
                <label for="arr-departure-day">Dag</label>
                <app-date-field fieldId="arr-departure-day" [value]="departureTyped() ?? stored" (valueChange)="departureTyped.set($event)" />
              </div>
            </div>
            @if (departureDropsShip()) { <p class="arr__note arr__note--warn">Let op: met deze vertrekdag vervalt 'schip aangekomen' ({{ text(shipArrivedOn(), null) }}).</p> }
          </section>
        }
        <section class="arr__part" aria-labelledby="arr-container">
          <div class="arr__head">
            <h3 id="arr-container">Container in {{ port() }}</h3>
            @if (tracked()) {
              <span class="arr__tag" [class.arr__tag--hand]="byHand()">{{ byHand() ? 'Met de hand' : 'Track & trace' }}</span>
            }
          </div>
          @if (tracked() && !byHand()) {
            <div class="arr__follow">
              <strong>{{ text(containerOn(), null, 'Datum nog onbekend') }}</strong>
              @if (shipArrivedOn(); as day) { <span>Schip aangekomen op {{ text(day, null) }}.</span> } @else { <span>Track &amp; trace zet deze datum.</span> }
            </div>
            <button class="btn arr__switch" type="button" (click)="setByHand(true)">Zelf instellen</button>
          } @else {
            <div class="arr__pair">
              <div class="field">
                <label for="arr-container-day">Dag</label>
                <app-date-field fieldId="arr-container-day" [value]="containerOn()" (valueChange)="containerOn.set($event)" />
              </div>
              <div class="field arr__hour">
                <label for="arr-container-hour">Uur <span class="opt"></span></label>
                <input class="input" id="arr-container-hour" type="time" step="300" [value]="containerAt()"
                       (input)="containerAt.set($any($event.target).value)" (change)="containerAt.set($any($event.target).value)" />
              </div>
            </div>
            @if (shipArrivedOn(); as day) { <p class="arr__note">Schip aangekomen op {{ text(day, null) }}.</p> }
            @if (tracked()) {
              <p class="arr__note">Track &amp; trace past deze datum niet meer aan.
                @if (sourceArrival(); as source) { Track &amp; trace meldt {{ source | dateNl }}. }
                <button class="linklike" type="button" (click)="setByHand(false)">Track &amp; trace volgen</button></p>
            } @else if (unsavedTracking()) {
              <p class="arr__note">Het track &amp; trace-nummer is nog niet opgeslagen: sla het eerst op om deze datum met de hand vast te zetten.</p>
            }
          }
        </section>

        <section class="arr__part" aria-labelledby="arr-warehouse">
          <div class="arr__head"><h3 id="arr-warehouse">Aankomst {{ placeName() }}</h3></div>
          <div class="arr__pair">
            <div class="field">
              <label for="arr-warehouse-day">Dag</label>
              <app-date-field fieldId="arr-warehouse-day" [value]="warehouseOn()" (valueChange)="warehouseOn.set($event)" />
            </div>
            <div class="field arr__hour">
              <label for="arr-warehouse-hour">Uur</label>
              <input class="input" id="arr-warehouse-hour" type="time" step="300" [value]="warehouseAt()"
                     (input)="warehouseAt.set($any($event.target).value)" (change)="warehouseAt.set($any($event.target).value)" />
            </div>
          </div>
          @if (beforePort()) { <p class="arr__note arr__note--warn">Let op: dat is vóór de aankomst van de container in {{ port() }}.</p> }
          @if (partnerSees()) { <p class="arr__note">Verhoeven ziet dit in het partnerportaal.</p> }
        </section>

        @if (problem(); as text) { <p class="arr__problem" role="alert">{{ text }}</p> }
      </div>
      <div foot style="display:contents">
        <button class="btn" type="button" [disabled]="busy()" (click)="close()">Annuleren</button>
        <button class="btn btn--primary" type="button" [disabled]="busy() || !!problem() || !changed()" (click)="save(order.id)">
          {{ busy() ? 'Bezig…' : 'Opslaan' }}
        </button>
      </div>
    </app-sheet>
  `,
  styles: `
    .arr{display:grid;gap:18px;min-width:0}
    .arr__part{display:grid;gap:10px;min-width:0}
    .arr__part + .arr__part{padding-top:16px;border-top:1px solid var(--line)}
    .arr__head{display:flex;align-items:center;justify-content:space-between;gap:10px;min-width:0}
    .arr__head h3{margin:0;font-size:15px;font-weight:650;min-width:0;overflow-wrap:anywhere}
    .arr__tag{flex:none;padding:2px 9px;border-radius:999px;background:var(--surface-2);color:var(--muted);font-size:12px;font-weight:600}
    .arr__tag--hand{background:var(--rose-soft);color:var(--rose)}
    .arr__follow{display:grid;gap:2px}
    .arr__follow strong{font-size:15px;font-variant-numeric:tabular-nums}
    .arr__follow span{color:var(--muted);font-size:13px}
    .arr__switch{justify-self:start}
    .arr__pair{display:grid;grid-template-columns:minmax(0,1fr) 136px;gap:10px;align-items:end}
    .arr__hour .input{font-variant-numeric:tabular-nums}
    .arr__note{margin:0;color:var(--muted);font-size:13px;line-height:1.45}
    .arr__note .linklike{font-size:13px}
    .arr__note--warn{color:#8a5a10}
    .arr__problem{margin:0;padding:10px 12px;border-radius:12px;background:var(--warn-soft);color:#7c450b;font-size:13px;line-height:1.45}
    @media (max-width: 679.98px), (hover: none) and (max-width: 1023.98px) {.arr{padding:0 16px}}
  `,
})
export class PurchaseArrivalSheet implements OnInit {
  private readonly sourcing = inject(SourcingApi);
  private readonly ui = inject(Ui);

  readonly view = input.required<PurchaseOrderView>();
  /** Where the container is unloaded ("Lossen op"): Zaltbommel for the main warehouse. */
  readonly placeName = input('Zaltbommel');
  /** The order's tracking row, when the page has it: names the source's date beside a date by hand. */
  readonly trackingRow = input<ContainerTracking | null>(null);
  /**
   * The track & trace reference as SAVED (an editor's draft may hold one that is not): the server decides "by hand"
   * from the stored reference, so the sheet does too. Undefined: the view's own reference (the phone view saves
   * nothing else).
   */
  readonly savedTrackingReference = input<string | null | undefined>(undefined);
  /** Whether the partner portal shows this place (the main warehouse, or the partner's own container). */
  readonly partnerSees = input(true);
  readonly saved = output<PurchaseOrderView>();
  readonly closed = output<void>();

  private readonly start = computed(() => {
    const view = this.view();
    const arrival = orderArrival(view);
    return {
      containerOn: view.order.expectedArrival ?? '',
      containerAt: arrival.containerAt ?? '',
      byHand: arrival.containerByHand,
      warehouseOn: arrival.warehouseOn ?? '',
      warehouseAt: arrival.warehouseAt ?? '',
    };
  });

  /* The draft starts from the order as opened (ngOnInit); a later answer of the page does not overwrite typing. */
  readonly containerOn = signal('');
  readonly containerAt = signal('');
  readonly byHand = signal(false);
  readonly warehouseOn = signal('');
  readonly warehouseAt = signal('');
  readonly busy = signal(false);

  readonly tracked = computed(() => {
    const saved = this.savedTrackingReference();
    return !!(saved === undefined ? this.view().order.trackingReference : saved)?.trim();
  });
  /** The draft has a reference the server does not have yet. */
  readonly unsavedTracking = computed(() => !this.tracked() && !!this.view().order.trackingReference?.trim());
  readonly port = computed(() => this.view().order.destinationPort?.trim() || 'Rotterdam');
  readonly sourceArrival = computed(() => {
    const row = this.trackingRow();
    return row?.sourceArrival && row.sourceArrival !== this.containerOn() ? row.sourceArrival : null;
  });
  /** The day the linked ship arrived at the port: the tracking row's when the page has this order's, else the order's. */
  readonly shipArrivedOn = computed(() => orderShipArrivedOn(this.view(), this.trackingRow(), this.savedTrackingReference()));

  /* ---- the departure (2026-11-16) ---- */
  /**
   * The stored departure the section shows, from the LIVE view: the hosts hand the sheet a new view when the minute's
   * tracking read brings another day, and an untouched field follows it. Null hides the section (the one rule).
   */
  readonly departureDay = computed(() => orderDepartureDay(this.view(), this.view().order));
  /**
   * What the user set in the departure's Dag; null while untouched. Never copied from the order (no ngOnInit copy,
   * not in start): a copy compared with the live day would send a stale day after a tracking read and pin it by hand.
   */
  readonly departureTyped = signal<string | null>(null);
  /** The user set another day than the one stored: only then is it sent, checked, warned about and named. */
  readonly departureChanged = computed(() => {
    const stored = this.departureDay();
    const typed = this.departureTyped();
    return stored !== null && typed !== null && typed !== stored;
  });
  /** The loading port as the page's route names it (the server falls back on the supplier's port). */
  readonly departurePort = computed(() => this.view().costLabels?.loadingPort?.trim() || this.view().order.departurePort?.trim() || '');
  /** As the container's mark: only with a saved track & trace reference, for a stored day by hand or one being set. */
  readonly departureHand = computed(() => this.tracked() && (orderArrival(this.view()).departureByHand || this.departureChanged()));
  /**
   * A changed departure only: the stored day as it stands never blocks (the server judges only a day that differs
   * from it). Today is Brussels' day, as the server's, read here rather than kept from when the sheet opened. The
   * order date is the server's to judge: an editor's draft may hold one the server does not know.
   */
  readonly departureProblem = computed(() => {
    if (!this.departureChanged()) return null;
    const day = this.departureTyped();
    if (!day) return 'Kies de vertrekdag.';
    if (day > brusselsToday()) return 'De vertrekdag kan niet in de toekomst liggen.';
    return null;
  });
  /**
   * The ship is in on a day that cannot be this voyage's arrival for the changed departure: the server then forgets
   * "schip aangekomen" (and the day it put on the order). Said, not refused: a typo should not pass unseen.
   */
  readonly departureDropsShip = computed(() => {
    const day = this.departureChanged() && !this.departureProblem() ? this.departureTyped() : null;
    const ship = this.shipArrivedOn();
    return !!day && !!ship && (ship < plusDays(day, ARRIVAL_EARLIEST_DAYS) || ship > plusDays(day, ARRIVAL_LATEST_DAYS));
  });
  readonly sheetTitle = computed(() => this.departureDay() ? 'Vertrek en aankomst' : 'Aankomst');

  /** The warehouse day lies before the day at the port: allowed (a hand slip is likelier), said quietly. */
  readonly beforePort = computed(() => {
    const port = this.containerOn();
    const warehouse = this.warehouseOn();
    return !!port && !!warehouse && warehouse < port;
  });

  readonly problem = computed(() => {
    const departure = this.departureProblem();
    if (departure) return departure;
    const containerAt = this.containerAt().trim();
    const warehouseAt = this.warehouseAt().trim();
    if (containerAt && !HOUR.test(containerAt.slice(0, 5))) return 'Het uur van de container is geen geldig uur.';
    if (warehouseAt && !HOUR.test(warehouseAt.slice(0, 5))) return `Het uur in ${this.placeName()} is geen geldig uur.`;
    if (containerAt && !this.containerOn() && (!this.tracked() || this.byHand())) return 'Kies ook de dag waarop de container aankomt.';
    if (warehouseAt && !this.warehouseOn()) return `Kies ook de dag van de aankomst in ${this.placeName()}.`;
    return null;
  });

  /** The two arrival parts differ from the order as it stands (the departure has its own rule above). */
  private readonly arrivalChanged = computed(() => {
    const start = this.start();
    return this.containerOn() !== start.containerOn || this.hour(this.containerAt()) !== start.containerAt
      || (this.tracked() && this.byHand() !== start.byHand)
      || this.warehouseOn() !== start.warehouseOn || this.hour(this.warehouseAt()) !== start.warehouseAt;
  });
  readonly changed = computed(() => this.departureChanged() || this.arrivalChanged());

  ngOnInit(): void {
    const start = this.start();
    this.containerOn.set(start.containerOn);
    this.containerAt.set(start.containerAt);
    this.byHand.set(start.byHand);
    this.warehouseOn.set(start.warehouseOn);
    this.warehouseAt.set(start.warehouseAt);
  }

  text(day: string | null | undefined, hour: string | null | undefined, empty?: string): string {
    return arrivalText(day, hour, empty);
  }

  /** No closing while the save runs: its answer must still reach the page (the draft and its baseline). */
  close(): void {
    if (!this.busy()) this.closed.emit();
  }

  setByHand(value: boolean): void {
    this.byHand.set(value);
    if (!value) {
      /* Following again: the day stays until the source's date replaces it, an hour does not come along. Once
         the ship is in, the server puts the container on that day at once, so the sheet shows it. */
      this.containerOn.set(this.shipArrivedOn() ?? this.start().containerOn);
      this.containerAt.set('');
    }
  }

  async save(id: number): Promise<void> {
    if (this.busy() || this.problem()) return;
    this.busy.set(true);
    /* Decided before the call: a tracking read during it may hand the sheet another view. */
    const departure = this.departureChanged() ? this.departureTyped() : null;
    const arrival = this.arrivalChanged();
    try {
      const following = this.tracked() && !this.byHand();
      const request: PurchaseArrivalRequest = {
        /* Following: the day the sheet opened with (the server keeps its stored day anyway). */
        containerOn: (following ? this.start().containerOn : this.containerOn()) || null,
        containerAt: following ? null : this.hour(this.containerAt()) || null,
        containerByHand: this.tracked() && this.byHand(),
        warehouseOn: this.warehouseOn() || null,
        warehouseAt: this.warehouseOn() ? this.hour(this.warehouseAt()) || null : null,
        /* Only a day the user set: the server reads a request that carries one as "by hand". */
        ...(departure ? { shippedOn: departure } : {}),
      };
      const fresh = await this.sourcing.setArrival(id, request);
      this.ui.toast(departure ? (arrival ? 'Vertrek en aankomst opgeslagen' : 'Vertrek opgeslagen') : 'Aankomst opgeslagen');
      this.saved.emit(fresh);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Opslaan mislukt'), 'err');
    } finally {
      this.busy.set(false);
    }
  }

  /** "08:30:00" from some browsers reads "08:30". */
  private hour(value: string): string {
    const text = value.trim();
    return text.length >= 5 ? text.slice(0, 5) : text;
  }
}
